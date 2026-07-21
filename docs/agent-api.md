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
| `mode` | `auto` / `project` / `task` / `agent` | 否 | 项目机会、任务执行或用户 Agent 审计；默认自动识别 |

## Success response

```json
{
  "ok": true,
  "source": "agent",
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "agent_version": "evidence-calibration-v4",
  "latency_ms": 1280,
  "assessment": {
    "goal_summary": "修复支付回调幂等性并用并发测试证明",
    "assessment_kind": "TASK_FEASIBILITY",
    "opportunity_score": null,
    "rubric_scores": null,
    "recommended_experiment": null,
    "trend_probability": null,
    "demand_analysis": null,
    "evidence_ledger": [],
    "reasoning_gaps": [],
    "adversarial_tests": [],
    "agent_improvement": null,
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
    "attempted_providers": ["deepseek"],
    "assessment_mode": "task",
    "repository_evidence": {
      "status": "verified",
      "full_name": "acme/payments-api",
      "stars": 2400,
      "language": "TypeScript",
      "license": "MIT"
    }
  },
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

项目模式还会返回 `standard`、`calibration_forecast` 与 `calibration_record`。`standard` 包含固定权重、等级和评分锚点；`calibration_forecast` 包含 7 天结果契约和概率区间；`calibration_record` 表示预测已经进入自动结算队列。

`GET /api/calibration` 会结算到期预测，并返回已结算数量、实际成功率、Brier Score、校准分和概率分桶结果。该过程不要求用户手工标记结果。

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
GITHUB_TOKEN=
```

`auto` 优先使用 DeepSeek，失败后尝试 OpenAI；两者都不可用时，前端使用明确标记的本地确定性规则。`AI_PROVIDER=openai` 会交换两个云端提供商的优先级。

`GITHUB_TOKEN` 是可选项。公开仓库可匿名读取；配置后可以提高 API 配额，并读取该 Token 获准访问的仓库。Token 只应具有只读仓库内容权限。

生产环境应通过托管平台的 Secret 管理功能配置密钥，不要将密钥写入源码、客户端变量或 Git 历史。

## Runner API

任务模式成功预测后，响应会包含：

```json
{
  "runner_record": {
    "id": "uuid",
    "status": "predicted",
    "created_at": 1784620192669
  },
  "probability_calibration": {
    "raw": 75,
    "calibrated": 75,
    "sample_size": 1,
    "method": "identity_insufficient_data"
  }
}
```

`GET /api/runner?id=<uuid>` 读取运行状态。Runner 使用 `POST /api/runner` 的 `start` 和 `settle` 动作回写执行事实，并通过 `x-selfodds-runner-token` 验证 `RUNNER_SHARED_SECRET`。

## Intelligence API

`GET /api/intelligence` 返回：

- 模型与 Runner 排行榜；
- 预测概率和实际成功率分桶；
- 失败模式计数；
- 失败类型到任务模式、模型的关系图；
- 最近真实运行记录。
