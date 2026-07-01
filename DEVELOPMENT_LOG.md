# DEVELOPMENT LOG

## [2026-07-01] v0.1.0-dev.1 feat: 初始化 Codex 用量核心包

- 开发原因：`codex-companion` 与 `dev-ledger` 都需要维护 Codex 用量、额度周期和 reset 检测规则，近期稳定边界回看规则更新暴露出双项目同步成本。
- 实现方式：初始化 `@lifeinhand/codex-usage-core`；新增共享类型、`analyzeQuotaObservations` reset 引擎、`codex-usage inspect-reset` CLI、脱敏测试样例和基于当前项目规则的 `AGENTS.md`；首版覆盖相邻下降、高水位证据、边界贴近证据、`24h` 稳定边界回看、`30min / 6h` 稳定确认、`15min` 漂移排除和边界去重。
- 当前结果：核心包可作为本地 file dependency 被 `codex-companion` 与 `dev-ledger` 集成；输出类型不包含原始 Codex session 正文。
- 验证方式：执行 `npm run build`；执行 `npm run test`。
