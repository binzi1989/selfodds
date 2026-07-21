# SelfOdds 系统架构

## 目标

SelfOdds 不替代 Coding Agent。它位于任务与执行器之间，负责在执行之前估计成功概率，并根据风险与可验证性选择自治等级。

## 当前架构

```text
Browser UI
  ├─ 中英文任务输入
  ├─ 本地预测账本（localStorage）
  └─ 真实结果结算与指标
          │
          ▼
POST /api/preflight
          │
          ├─ 请求校验与服务端密钥边界
          ├─ SENSE：确定性风险信号与外部视角先验
          ├─ CHALLENGE / DECIDE：DeepSeek V4 或 OpenAI
          ├─ GUARD：服务端路由与风险下限
          ├─ Zod / JSON Schema 结构化校验
          └─ 提供商切换与明确错误码
          │
          ▼
Decision Token
  ├─ goal_summary / confidence_quality
  ├─ success_probability
  ├─ risk
  ├─ route
  ├─ estimated_minutes / estimated_cost_usd
  ├─ failure_modes
  ├─ missing_context / preconditions
  ├─ verification_steps
  ├─ abort_conditions / guardrails_applied
  ├─ policy
  └─ assumptions
```

## 路由语义

- `AUTORUN`：成功概率至少 85%，影响范围低，且存在确定性验证。
- `REVIEW`：概率为 58%–84%，或者人工审查能够显著控制风险。
- `ESCALATE`：概率低于 58%、关键上下文缺失，或者潜在影响较大。

概率定义为：任务在限定范围内被正确完成，并通过建议的验证步骤的概率。它不是模型对自己文案的主观自信。

## 安全边界

- API Key 只存在于服务端环境变量。
- API 调用使用 `store: false`。
- DeepSeek 使用 JSON Output，OpenAI 使用 Structured Outputs；两者最终都必须通过同一 Zod Schema。
- 服务端守门器只允许模型收紧风险，不能绕过概率阈值、高影响任务或上下文缺口。
- Agent 不声称读取未提供的仓库内容。
- 本地降级结果在 UI 和数据记录中有独立来源标记。
- 当前系统只做评估，不执行外部写入或生产操作。

## 下一阶段：Runner 闭环

```text
Decision Token
   ↓
Policy Gate
   ├─ AUTORUN → Sandbox Runner
   ├─ REVIEW → Sandbox Runner → Human Approval
   └─ ESCALATE → Context Request / Stronger Model
   ↓
Deterministic Verifier
   ├─ tests
   ├─ build
   ├─ lint / typecheck
   ├─ diff scope
   └─ policy checks
   ↓
Resolved Outcome Store
```

## 数据演进

1. 先存结构化运行记录和结果。
2. 累积足够样本后，训练或拟合校准层。
3. 形成任务分类与失败模式库。
4. 最后建立任务、模型、工具、风险和结果之间的图谱关系。
