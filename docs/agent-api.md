# Preflight Agent API

## Endpoint

```http
POST /api/preflight
Content-Type: application/json
```

## Request

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task` | string | 是 | 8–6000 字符的任务说明 |
| `repository` | string | 否 | 仓库 URL、名称或其他上下文 |
| `language` | `zh` / `en` | 否 | 输出语言，默认中文 |

## Success response

```json
{
  "ok": true,
  "source": "agent",
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "agent_version": "preflight-v2",
  "latency_ms": 1280,
  "assessment": {
    "goal_summary": "修复支付回调幂等性并用并发测试证明",
    "success_probability": 63,
    "confidence_quality": "MEDIUM",
    "risk": "HIGH",
    "route": "REVIEW",
    "estimated_minutes": 38,
    "estimated_cost_usd": 2.4,
    "missing_context": ["生产回调的去重键规则"],
    "preconditions": ["使用隔离数据库运行并发测试"],
    "failure_modes": ["并发状态可能无法稳定复现"],
    "verification_steps": ["运行并发幂等性测试", "检查最终差异范围"],
    "abort_conditions": ["迁移不可回滚或测试环境无法复现时停止"],
    "policy": "仅允许在沙箱执行，合并前必须人工审查。",
    "assumptions": ["仓库存在可运行的支付测试环境"],
    "guardrails_applied": ["高影响任务禁止直接自动执行"]
  },
  "trace": {
    "stages": ["SENSE", "CHALLENGE", "DECIDE", "GUARD"],
    "outside_view_prior": 55,
    "risk_signals": ["可能涉及不可逆的数据或状态变更"],
    "attempted_providers": ["deepseek"]
  },
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

## Error codes

| Code | 含义 | 前端行为 |
|---|---|---|
| `INVALID_JSON` | 请求不是 JSON | 显示输入错误 |
| `INVALID_REQUEST` | 任务说明不完整 | 要求补充任务 |
| `AGENT_NOT_CONFIGURED` | 未配置 API Key | 使用本地降级评估 |
| `AGENT_UNAVAILABLE` | API 暂时异常 | 使用本地降级评估 |

## Environment

```env
AI_PROVIDER=auto
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

`auto` 优先使用 DeepSeek，失败后尝试 OpenAI；两者都不可用时，前端使用明确标记的本地确定性规则。`AI_PROVIDER=openai` 会交换两个云端提供商的优先级。

生产环境应通过托管平台的 Secret 管理功能配置密钥，不要将密钥写入源码、客户端变量或 Git 历史。
