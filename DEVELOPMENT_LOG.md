# DEVELOPMENT LOG

## [2026-07-01] v0.1.0-dev.3 fix: 纠正额度重置字段命名

- 开发原因：上一轮需求中的“充值次数”是用户笔误，Codex 本地数据中没有独立的官方充值次数字段；`v0.1.0-dev.2` 将稳定确认的 reset 映射为 `rechargeCount / rechargeEvents` 会误导为真实充值数据。
- 实现方式：移除 `QuotaRechargeEvent`、`QuotaAnalysisResult.rechargeCount` 和 `QuotaAnalysisResult.rechargeEvents`；保留 `resetCount / resetEvents` 作为唯一事件口径；将 `QuotaUsageSegment.startedByRechargeAt / closedByRechargeAt` 改为 `startedByResetAt / closedByResetAt`；README、CLI、fixture 说明和脱敏测试同步改回 reset 口径。
- 适用范围：只适用于 Codex 本地 `rate_limits` 中可观测的 5H / 周额度窗口 reset 检测；不推断充值、账单、账户余额或未暴露月额度。
- 触发条件：reset 候选仍要求 `resets_at` 后移、`used_percent` 下降不少于默认 `5%`，并具备高水位下降、窗口边界贴近或 `24h` 稳定边界回看证据之一；候选还必须通过 `30min` 延迟后的 `6h` 稳定确认窗口。
- 排除条件：确认窗口内新窗口边界漂移超过默认 `15min`、缺少稳定确认观测、时间或窗口字段不可解析时，不计入 `resetCount`。
- 关键字段：`resetEvents[].boundaryAt` 表示 reset 后窗口起点，`resetEvents[].afterWindowResetsAt` 表示 reset 后窗口过期时间，`usageSegments[].startedByResetAt / closedByResetAt` 表示用量段由哪次 reset 开启或截止。
- 验证样例：脱敏测试中 `2026-06-01T00:00:00Z` 观测到 `65% / resetsAt=2026-06-08T00:00:00Z`，`2026-06-02T00:00:00Z` 下降到 `2% / resetsAt=2026-06-09T00:00:00Z`，稳定确认后输出 `resetCount=1`、`boundaryAt=2026-06-02T00:00:00Z`、`afterWindowResetsAt=2026-06-09T00:00:00Z`，并把下一段 `usageSegments[].startedByResetAt` 记录为 `2026-06-02T00:00:00Z`。
- 当前结果：核心包只声明和输出 reset 数据，不再暴露充值字段；输出仍不包含原始 Codex session 正文、用户输入、模型输出或私有路径。
- 验证方式：执行 `npm run build`；执行 `npm run test`。

## [2026-07-01] v0.1.0-dev.2 feat: 输出 Codex 额度充值跟踪字段

- 开发原因：下游 `codex-companion` 与 `dev-ledger` 需要直接展示 Codex 额度充值次数、充值后过期时间和每轮使用时间，旧版只输出 `resetCount / resetEvents / usageSegments`，业务语义需要由下游重复解释。
- 实现方式：保留原有 reset 检测规则和字段，新增 `QuotaRechargeEvent`、`QuotaAnalysisResult.rechargeCount`、`QuotaAnalysisResult.rechargeEvents`；将稳定确认的 reset 映射为充值事件，并在 `QuotaUsageSegment` 补充 `windowStartedAt / expiresAt / startedByRechargeAt / closedByRechargeAt`。`QuotaResetEvent` 同步补充 `beforeWindowMinutes / afterWindowMinutes / boundaryAt`，方便从结构化字段计算充值窗口。
- 适用范围：只适用于 Codex 本地 `rate_limits` 中可观测的 5H / 周额度窗口；不推断未暴露的月额度、账户余额或官方账单。
- 触发条件：充值事件必须先满足 reset 候选规则，即 `resets_at` 后移、`used_percent` 下降不少于默认 `5%`，并具备高水位下降、窗口边界贴近或 `24h` 稳定边界回看证据之一；候选还必须通过 `30min` 延迟后的 `6h` 稳定确认窗口。
- 排除条件：确认窗口内新窗口边界漂移超过默认 `15min`、缺少稳定确认观测、时间或窗口字段不可解析时，不计入 `rechargeCount`。
- 关键字段：`rechargeEvents[].windowStartedAt = afterWindowResetsAt - afterWindowMinutes`，`rechargeEvents[].expiresAt = afterWindowResetsAt`，`previousUsageStartedAt / previousUsageEndedAt / previousUsedPercent` 表示充值前一轮用量区间；`usageSegments[].expiresAt` 表示该用量段对应额度窗口的过期时间。
- 验证样例：脱敏测试中 `2026-06-01T00:00:00Z` 观测到 `65% / resetsAt=2026-06-08T00:00:00Z`，`2026-06-02T00:00:00Z` 下降到 `2% / resetsAt=2026-06-09T00:00:00Z`，稳定确认后输出 `rechargeCount=1`、`windowStartedAt=2026-06-02T00:00:00Z`、`expiresAt=2026-06-09T00:00:00Z`，并把上一轮使用区间记录为 `2026-06-01T00:00:00Z -> 2026-06-02T00:00:00Z`。
- 当前结果：核心分析结果可同时服务旧的 reset 展示和新的充值次数/过期时间/使用区间展示；输出仍不包含原始 Codex session 正文、用户输入、模型输出或私有路径。
- 验证方式：执行 `npm run test`。

## [2026-07-01] v0.1.0-dev.1 feat: 初始化 Codex 用量核心包

- 开发原因：`codex-companion` 与 `dev-ledger` 都需要维护 Codex 用量、额度周期和 reset 检测规则，近期稳定边界回看规则更新暴露出双项目同步成本。
- 实现方式：初始化 `@lifeinhand/codex-usage-core`；新增共享类型、`analyzeQuotaObservations` reset 引擎、`codex-usage inspect-reset` CLI、脱敏测试样例和基于当前项目规则的 `AGENTS.md`；首版覆盖相邻下降、高水位证据、边界贴近证据、`24h` 稳定边界回看、`30min / 6h` 稳定确认、`15min` 漂移排除和边界去重。
- 当前结果：核心包可作为本地 file dependency 被 `codex-companion` 与 `dev-ledger` 集成；输出类型不包含原始 Codex session 正文。
- 验证方式：执行 `npm run build`；执行 `npm run test`。
