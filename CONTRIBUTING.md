# 贡献指南

感谢关注 `codex-usage-core`。提交改动前，请先阅读 [README.md](README.md) 中的数据口径与隐私边界。

## 开发流程

1. 从最新 `main` 创建聚焦的功能分支。
2. 只使用脱敏 fixture，不提交原始 Codex session、用户输入、模型输出、账号信息、访问令牌或私有源码。
3. 统计口径、阈值、字段或 reset 规则变化必须同步更新 README、测试和 `DEVELOPMENT_LOG.md`。
4. 执行 `npm ci`、`npm run build`、`npm run test` 和 `git diff --check`。
5. 在 Pull Request 中写明适用范围、触发条件、排除条件、验证样例和下游兼容性。

## 下游兼容

本包由 `codex-companion` 与 `dev-ledger` 共同使用。对外类型或统计行为变化必须升级开发版本、创建 Git tag，并分别验证两个下游项目。

本项目专注 Codex，不把其他开发工具作为首版 provider 扩展方向。
