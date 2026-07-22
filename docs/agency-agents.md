# Agency Agents 集成与专家闭环

## 目标

SelfOdds 的 Agency 模式不是让多个 Agent 互相说服，而是让专业视角先独立作答，再由服务端用公开、确定性的规则合成一个可结算预测。这样既保留分歧，也能在任务完成后判断“哪个角色在什么任务上更可靠”。

## 来源与许可

四个角色的原始画像来自开源项目 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) 的 Engineering Division。上游以 [MIT License](https://github.com/msitarzewski/agency-agents/blob/main/LICENSE) 发布；本仓库保留项目级 Codex 适配快照，具体版本以 Git 历史为准。

| 本地配置 | 上游角色 | 在 SelfOdds 中的关注点 |
| --- | --- | --- |
| `.codex/agents/engineering-ai-engineer.toml` | [AI Engineer](https://github.com/msitarzewski/agency-agents/blob/main/engineering/engineering-ai-engineer.md) | 模型能力、推理/评估方法、生产 AI 风险与可观测性 |
| `.codex/agents/engineering-backend-architect.toml` | [Backend Architect](https://github.com/msitarzewski/agency-agents/blob/main/engineering/engineering-backend-architect.md) | API、服务边界、安全、可靠性、扩展性与回滚 |
| `.codex/agents/engineering-data-engineer.toml` | [Data Engineer](https://github.com/msitarzewski/agency-agents/blob/main/engineering/engineering-data-engineer.md) | 数据契约、持久化、幂等、质量、血缘与结算数据可信度 |
| `.codex/agents/engineering-prompt-engineer.toml` | [Prompt Engineer](https://github.com/msitarzewski/agency-agents/blob/main/engineering/engineering-prompt-engineer.md) | 提示协议、结构化输出、对抗输入、模型差异与回归测试 |

本地 TOML 是已审查的快照，不在安装或构建时自动追踪上游 `main`。更新角色时应单独审查上游差异，同时更新运行时注册表的角色版本或定义哈希，并执行回归测试；不要无审查地覆盖现有文件。

## 两种配置层必须区分

### 开发期：`.codex/agents`

这些 TOML 文件服务于 Codex 开发协作：主智能体可以创建对应的子智能体，让它们分别研究模型、后端、数据或提示协议。它们应随仓库提交，使新的开发者或新的 Codex 任务能够复用同一组角色画像。

开发期配置的特点：

- 由 Codex 读取，面向代码研究、实现与审查；
- 可以使用工作区工具，但仍受 Codex 权限和任务范围约束；
- 不参与网页请求，不写入 D1，也不会被 `npm run build` 打包成线上专家；
- 修改后通常需要在新的 Codex 任务中重新发现或加载配置。

### 线上运行时：服务端角色注册表

生产环境的 `/api/agency` 使用代码内维护的精简角色注册表和严格结构化协议。注册表只携带线上会审需要的角色标识、名称、专长、版本/定义哈希和运行时指令，不直接读取 `.codex/agents/*.toml`。

这种分离是有意的：完整开发画像适合协作式开发，但不应成为每次线上请求的隐式、不可版本化依赖。线上角色变化必须通过代码评审、测试和发布流程进入生产。

## 专家选择与编排

Agency 请求使用与 Preflight 相同的服务端密钥边界：

```json
{
  "task": "为支付回调增加幂等结算与回归测试",
  "repository": "github.com/acme/payments-api",
  "language": "zh",
  "mode": "agency"
}
```

当前编排流程：

```text
任务与仓库上下文
   ↓
确定性任务分类与角色相关度排序
   ↓
从 4 个角色选择 Top 3
   ↓
固定一次 provider / model，三位专家并行独立评估
   ↓
逐票 Schema 校验；至少 2 票形成法定人数
   ↓
确定性合成：概率中位数 + 预测范围 + 共识度 + 分歧/否决守门；总体概率校准
   ↓
Agency Decision Token + agent_runs + agency_votes
   ↓
Runner 测试 / 构建 / Diff
   ↓
总体运行与每位专家同步结算
   ↓
Brier Score、角色榜单与下一轮校准
```

选择 Top 3 而不是固定全员，目的是保留跨专业检查，同时控制调用成本。三位专家共享同一份经过服务端整理的任务上下文，但彼此看不到其他专家的答案，避免先到达的判断锚定后续意见。同一轮固定 provider / model，减少“角色差异”和“模型差异”混在一起的测量噪声。如果一位专家失败，剩余两票仍可形成法定人数；少于两票时该 provider 整轮失败，并按已配置的提供商顺序尝试下一项。

任务分类和当前固定入选顺序如下；同分时以角色 ID 排序，所以相同输入会得到相同团队：

| 任务分类 | Top 3（从高到低） |
| --- | --- |
| `AI_ML` | AI Engineer → Prompt Engineer → Data Engineer |
| `BACKEND_SYSTEMS` | Backend Architect → Data Engineer → AI Engineer |
| `DATA_PIPELINE` | Data Engineer → Backend Architect → AI Engineer |
| `PROMPT_AGENT` | Prompt Engineer → AI Engineer → Backend Architect |
| `GENERAL_ENGINEERING` | Backend Architect → AI Engineer → Prompt Engineer |

运行时角色版本为 `agency-agents-profile-v1`。团队版本由固定前缀和四份本地定义 SHA-256 的前 8 位组合，因此角色快照变化会得到新的 `team_version`，历史记录仍能追溯到当时使用的定义。

每位专家的模型输出只允许通过严格 Schema 提交：

- `probability`、`confidence`、`risk`、`route`；
- 简短 `verdict`、有限的 `findings`、`missing_context` 与 `assumptions`；
- `preconditions`、`failure_modes`、`verification_steps`、`abort_conditions`；
- 预计时间、预计成本和可选 `veto_reason`。

`profile_id`、`profile_name`、角色版本与定义哈希由服务端根据入选注册表注入，不能由模型自报。D1 专家票据保存身份、概率、置信度、风险、路由、结论、发现、否决原因和校准字段；其余字段先合并进总体 assessment，避免重复保存大段内容。

## 共识不是投票通过

服务端使用专家概率的中位数作为总体概率中心，避免单个极端值直接支配结论；同时公开最小值—最大值范围和共识度。共识度的当前公式为 `max(0, 100 - 概率跨度 - 路由分歧 15 分 - 风险分歧 10 分)`。

自治路由取最严格的专家路由，风险取最高风险。任一显式否决或 `ESCALATE` 都使总体路由变为 `ESCALATE`；概率跨度至少 20 个百分点、路由/风险不一致或存在 `HIGH` 风险时，总体至少为 `REVIEW`。有实质分歧时置信度取最低值，否则取中位等级。合成方法在 API 中标记为 `median_probability+conservative_route_v1`。

因此，“两位认为可行”不等于任务已经成功，也不等于一定允许 `AUTORUN`。Agency 的输出仍是执行前预测；真实结果必须由 Runner 的退出码与 Diff 范围确定。

## 结算与校准闭环

一次成功的 Agency 评估会生成一条总体 `agent_runs` 记录，并为本轮成功返回的每位专家生成一条 `agency_votes`（正常为三张，降级法定人数时为两张）：

1. 请求时保存总体决策、任务分类、选择策略以及本轮达到法定人数的独立票据。
2. Runner 启动并执行操作者明确传入的测试、构建命令，同时检查 Diff 范围。
3. 服务端确定 PASS / FAIL 后，在同一批数据库操作中回填总体运行与所有尚未结算专家票据的 `outcome`。
4. 总体和每张票分别计算 Brier Score：`(预测概率 - 实际结果)²`；实际结果成功为 `1`，失败为 `0`。
5. 总体运行同时保留原始共识概率、校准后概率及各自 Brier Score。票据表也为角色级校准预留了两套字段；当前线上尚未启用逐角色概率校准时，两者相同，不能把字段存在误读为校准已经带来提升。
6. 角色级已结算记录按 `profile_id` 聚合成功率、原始/校准后 Brier、校准增益和校准分；未结算预测不能充当训练标签。

角色表现必须结合任务类型、样本量和时间窗口解释。少量样本的高成功率不代表角色普遍更强，也不应立即驱动自动淘汰或放宽自治权限。

## 隐私与可解释性

SelfOdds 不请求、不返回、也不保存模型的 hidden chain-of-thought（隐藏思维链）。开发期角色画像中即使包含“逐步推理”等方法描述，线上协议也只接收简短结论、证据摘要、风险、概率和可验证发现；这些是面向审计的输出，不是模型内部推理记录。

需要注意：任务文本、仓库标识、结构化专家结论和结算指标会进入运行记录。因此不要在任务描述、仓库字段或专家上下文中提交密钥、访问令牌、个人敏感信息或不应持久化的源码片段。API Key 仅从服务端环境读取，浏览器和专家结果不会回显密钥。

## 当前边界

- 当前只有四个工程角色，每次自动选择三位；这不是覆盖法律、财务、安全合规或产品研究的完整专家池。
- 角色选择仍是可解释的任务分类与相关度规则，不是基于大样本训练出的最优路由器。
- 同一轮专家通常使用同一 provider / model；角色多样性不等同于模型或数据源多样性。
- 并行三次评估会增加推理成本，整体延迟取决于最慢的专家调用。
- 结构化共识无法证明仓库代码正确，也不能替代测试、构建、安全扫描、人工审查或生产监控。
- `.codex/agents` 不会自动部署到线上；只修改 TOML 不会改变 `/api/agency` 行为。
- 只有完成客观结算的票据才能参与 Brier Score 和校准；长期未结算的任务会造成选择偏差。

## 复现与变更检查表

克隆或交接项目时：

1. 确认四个 `.codex/agents/*.toml` 文件存在且已被 Git 跟踪；`.gitignore` 不应排除 `.codex/agents`。
2. 使用新的 Codex 任务验证四个角色可被创建；开发期不需要 AI Provider 环境变量。
3. 按 README 配置服务端 Provider 后，调用 `/api/agency`，确认正常返回三张专家票（允许一位失败后的两票法定人数）、预测范围、共识度和合成方法。
4. 检查 D1 中存在一条总体 `agent_runs`，对应的 `agency_votes` 数量与 API 实际成功专家数一致。
5. 使用 Runner 结算同一 `run_id`，确认总体与全部对应票据获得相同真实结果，并生成 Brier Score。
6. 修改角色定义、选择规则或共识算法时，同步提升团队/角色版本或定义哈希，并保留可比较的历史记录。

## 延续方向

下一阶段应优先使用已结算数据增强闭环，而不是单纯增加更多人格：

- 建立“任务类型 × 角色 × 模型”的样本量、Brier、校准误差和失败类型面板；
- 先以 shadow 模式评估新角色，再根据真实结算决定是否进入 Top 3 候选；
- 对角色定义和共识规则建立版本化回归集，防止提示更新造成概率漂移；
- 引入选择倾向记录与离线评估，降低只观察入选专家导致的选择偏差；
- 增加敏感字段检测、保留期、删除流程与租户隔离后，再面向私有仓库扩大使用范围。
