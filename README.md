# SelfOdds

> 让 AI Agent 在行动之前，先预测自己能不能成功。

SelfOdds 是一个面向 AI Agent 的执行前风控与校准系统。它在 Agent 花费推理成本、修改代码或接触生产系统之前，生成结构化的成功概率、风险等级、预计成本、失败模式和验证计划；任务完成后，再使用真实结果结算预测并计算校准指标。

**在线演示：** [selfodds-preflight.xiaozongzi1989.chatgpt.site](https://selfodds-preflight.xiaozongzi1989.chatgpt.site)

## 为什么需要 SelfOdds

传统 Agent 评估通常发生在执行之后。SelfOdds 将判断前移：

- 这个任务应该自动运行、人工审查，还是暂停并补充上下文？
- Agent 报告的 80% 成功率，长期看是否真的约等于 80%？
- 哪类模型、工具和任务组合最容易“自信地失败”？
- 能否在维持成功率的同时减少无效 Token、重试和事故？

## 当前能力

- 默认中文界面，可一键切换英文。
- 服务端 Preflight Agent，支持 DeepSeek V4 与 OpenAI 双提供商自动路由。
- 四阶段决策闭环：`SENSE → CHALLENGE → DECIDE → GUARD`。
- 先计算确定性的外部视角风险信号，再由模型挑战假设，最后由守门器阻止过度乐观的自动执行。
- 严格结构化输出：目标复述、概率、证据质量、风险、路由、缺失上下文、前置条件、失败模式、验证步骤和中止条件。
- 三档路由：`AUTORUN`、`REVIEW`、`ESCALATE`。
- API 未配置或异常时，明确切换到可解释的本地规则，不伪装为 AI 结果。
- 本机预测账本、PASS/FAIL 结算、Brier Score 和校准分。
- 响应式界面和中英文文案。

## 快速开始

### 环境要求

- Node.js `>=22.13.0`
- 可选：DeepSeek 或 OpenAI API Key。没有 Key 时仍可运行本地降级版。

### 安装与运行

```bash
npm install
copy .env.example .env.local
npm run dev
```

在 `.env.local` 中配置：

```env
AI_PROVIDER=auto
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-v4-flash

OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.6-terra
```

`auto` 默认按 DeepSeek → OpenAI → 本地规则的顺序路由。也可把 `AI_PROVIDER` 设置为 `openai`，让 OpenAI 优先。不要把真实密钥提交到 Git；只有占位的 `.env.example` 会进入版本控制。

### 验证

```bash
npm test
npm run lint
```

## 工作原理

```text
任务说明
   ↓
SENSE：外部视角基准 + 确定性风险信号
   ↓
CHALLENGE：缺失上下文 + 危险假设 + 隐藏依赖
   ↓
DECIDE：概率 + 风险 + 自治路由
   ↓
GUARD：前置条件 + 验证步骤 + 中止条件
   ↓
Decision Token：概率 / 风险 / 路由 / 成本 / 验证计划
   ↓
独立 Coding Agent 执行（下一阶段）
   ↓
测试、构建、Diff 和人工审核结算真实结果
   ↓
校准曲线、Brier Score、模型与任务路由策略
```

详细设计参见：

- [系统架构](docs/architecture.md)
- [Agent API](docs/agent-api.md)

## API

`POST /api/preflight`

请求：

```json
{
  "task": "修复支付回调重复处理并增加幂等性测试",
  "repository": "github.com/acme/payments-api",
  "language": "zh"
}
```

密钥只在服务端读取，浏览器不会接触 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`。

## 数据与知识层路线

第一阶段不建立空泛的知识图谱。先积累可结算运行记录：

```text
任务类型 × 模型 × 工具 × 仓库特征 × 预测 × 失败原因 × 实际结果
```

达到数百条真实记录后，再建设失败模式知识库和关系图谱，用于相似任务检索、先验概率和路由。

## 路线图

- [x] 中英文 Preflight 产品原型
- [x] OpenAI 结构化评估 Agent
- [x] DeepSeek V4 / OpenAI 自动路由
- [x] SENSE / CHALLENGE / DECIDE / GUARD 决策闭环
- [x] 确定性风险信号与服务端路由守门器
- [x] 本地降级与结果来源标记
- [x] 预测账本与 Brier Score
- [ ] 接入 GitHub Issue 与仓库元数据
- [ ] 接入真实 Coding Agent Runner
- [ ] 使用测试、构建和 Diff 自动结算
- [ ] D1 持久化与团队排行榜
- [ ] 基于真实运行的概率校准器
- [ ] 失败模式知识库与知识图谱

## English

SelfOdds is a pre-execution reliability and calibration layer for AI agents. It predicts task success, cost, duration, failure modes, and the correct autonomy route before an agent acts, then scores that forecast against the real outcome.

## License

[MIT](LICENSE)
