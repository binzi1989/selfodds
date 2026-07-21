# SelfOdds Runner 闭环

## 目标

Runner 将执行前预测和执行后事实连接起来。模型负责预测与提出验证计划；Runner 负责执行用户明确允许的命令；服务端根据测试、构建和 Diff 事实结算结果。

## 使用方式

1. 在 SelfOdds 选择“任务执行”并运行 Preflight。
2. 保存结果卡中的 Runner ID。
3. 在目标仓库运行：

```bash
npm run runner -- --run <RUNNER_ID> --api http://localhost:3000 --repo . --test "npm test" --build "npm run build"
```

可选参数：

- `--runner <name>`：团队或执行器名称，用于排行榜。
- `--max-diff-files <n>`：允许修改的最大文件数，默认 25。
- `--test <command>`：测试命令。
- `--build <command>`：构建命令。

## 确定性结算

成功必须同时满足：

- 至少实际执行了测试或构建中的一个；
- 已执行项全部退出码为 0；
- Diff 文件数没有超过配置上限。

失败会归类为：

- `TEST_FAILURE`
- `BUILD_FAILURE`
- `DIFF_SCOPE_VIOLATION`
- `NO_VERIFICATION`

每条结算记录保存预测概率、真实结果和 Brier Score，并进入模型与 Runner 排行榜、概率分桶和失败知识图谱。

## 概率校准

同一模型、同一任务模式少于 5 条真实结算记录时，SelfOdds 保持模型原概率。达到最小样本后，系统选择邻近概率区间的历史记录，并用强度为 5 的原始概率先验进行经验贝叶斯收缩。这样既利用真实结果，也避免小样本剧烈摆动。

## 安全边界

- Runner 不从模型输出中读取并执行命令。
- 只有命令行参数中由操作者明确提供的测试和构建命令会执行。
- Runner 更新接口使用 `RUNNER_SHARED_SECRET`，密钥只保存在服务端和执行器环境。
- 云端 Worker 不执行任意仓库代码；实际执行发生在操作者选择的本地或隔离环境。
- 当前 MVP 使用 Diff 文件数控制范围；后续版本将增加路径允许列表、容器隔离、CPU/内存/时间限制和 GitHub Actions 执行器。
