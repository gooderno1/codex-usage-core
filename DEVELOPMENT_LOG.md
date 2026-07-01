# DEVELOPMENT LOG

## [2026-07-02] v0.1.0-dev.6 feat: 用公开 seed 推断赠送重置过期时间

- 开发原因：用户指出 banked reset credit 已有官方公开 `30` 天有效期口径，且当前本机可用的 `2` 次可以分别对应公开发放事件；首次观测已有库存不应全部显示为无法推断。
- 实现方式：将版本从 `v0.1.0-dev.5` 提升到 `v0.1.0-dev.6`；新增 `BankedResetCreditPublicGrantSeed` 与 `estimateBasis=public-grant`；`analyzeBankedResetCreditObservations` 默认使用两个公开 seed：`2026-06-11T00:00:00.000Z` 的 Codex banking 上线 free reset，以及 `2026-06-30T00:00:00.000Z` 的异常消耗修复补偿 reset；首次观测已有库存时优先匹配仍在 `30d` 有效期内的公开 seed，匹配不上的数量仍回退为 `existing-at-first-observation`。
- 适用范围：仅用于 Codex app-server 只读 `rateLimitResetCredits.availableCount` 已返回可用次数但不返回逐笔时间的场景；公开 seed 可通过 `publicGrantSeeds: []` 关闭或由下游传入替代列表。
- 触发条件：首次有效观测的 `availableCount > 0`，且公开 seed 的 `grantedAt <= observedAt < grantedAt + validityDays` 时，生成 `public-grant` active credit；后续相邻采样增加仍按实际观测时间生成 `observed-grant`。
- 排除条件：公开 seed 已过期、发放时间晚于首次观测、或可用次数超过公开 seed 数量时，不强行归因；剩余条目继续标记为首次观测已有库存。
- 关键字段：`activeCredits[].acquiredAt` 对 `public-grant` 取公开 seed 时间；`estimatedExpiresAt = acquiredAt + 30d`；`safeEstimatedExpiresAt` 默认提前 `1d`，如果首次观测已晚于安全提醒时间则取首次观测时间，提示尽快使用。
- 验证样例：脱敏测试中 `2026-07-02 available=2` 输出两条 `public-grant`，分别为 `2026-06-11 -> 2026-07-11` 和 `2026-06-30 -> 2026-07-30`，保守提醒时间分别为 `2026-07-10` 和 `2026-07-29`；`2030-01-10 available=2` 因公开 seed 已过期，仍输出 `existing-at-first-observation`。
- 验证方式：执行 `npm run test`，覆盖 TypeScript build、原 reset 引擎、banked reset credit 差分分析、公开 seed 首次库存推断和假 app-server 读取测试；执行 `git diff --check`，仅有 Windows 换行提示。

## [2026-07-01] v0.1.0-dev.5 feat: 输出 banked reset 逐个明细

- 开发原因：下游需要在总览和 Codex 页面展示每个可用 banked reset credit 的获取时间和预期过期时间；过期提醒需要保守提前，避免用户按最后时刻安排导致错过使用机会。
- 实现方式：`BankedResetCreditAnalysisResult` 新增 `activeCredits[]` 和 `nextSafeEstimatedExpiresAt`；`BankedResetCreditActiveCredit` 记录 `acquiredAt / firstObservedAt / estimatedExpiresAt / safeEstimatedExpiresAt / estimateBasis`；`analyzeBankedResetCreditObservations` 在首次观测时为已有库存创建 `existing-at-first-observation` 明细，在 `availableCount` 增加时创建 `observed-grant` 明细，在减少时按最早保守过期时间优先移除。
- 适用范围：适用于下游持续保存脱敏观测历史后展示逐个可用 credit；已观测到新增的 credit 可展示推断获取时间和按 `30d` 有效期估算的过期时间。
- 触发条件：`availableCount` 首次大于 `0` 时输出既有 credit 明细；后续相邻采样增加时输出推断获得明细；相邻采样减少时沿用 `use / expiration / decrease-unknown` 事件判断并同步扣减 active 明细。
- 排除条件：Codex app-server 仍不暴露官方逐笔 `grantedAt / expiresAt / usedAt`；首次采样时已经存在的 credit 无法反推真实获取时间和真实过期时间，只能标记为既有库存。
- 关键字段：`activeCredits[].safeEstimatedExpiresAt` 默认等于 `estimatedExpiresAt - 1d`；`estimateBasis=existing-at-first-observation` 的 `safeEstimatedExpiresAt` 取首次观测时间，下游应展示为“建议尽快使用”。
- 验证样例：脱敏测试中 `2030-01-02 available=2` 输出 2 条 `observed-grant` active 明细，`acquiredAt=2030-01-02T00:00:00.000Z`、`estimatedExpiresAt=2030-02-01T00:00:00.000Z`、`safeEstimatedExpiresAt=2030-01-31T00:00:00.000Z`；首次观测 `2030-01-10 available=2` 输出 2 条 `existing-at-first-observation` 明细，获取时间为空，保守提醒时间为首次观测时间。
- 当前结果：核心包可同时输出当前可用次数、推断事件和逐个可用 credit 展示明细；输出仍不包含原始 Codex session 正文、用户输入、模型输出、账号邮箱、token 或原始 app-server 响应。
- 验证方式：执行 `npm run test`，通过 TypeScript build、原 reset 引擎、banked reset credit 差分分析、逐个 active credit 明细和假 app-server 读取测试；执行 `git diff --check`，仅有 Windows 换行提示。

## [2026-07-01] v0.1.0-dev.4 feat: 读取 banked reset credit 可用次数

- 开发原因：用户要监控 OpenAI 赠送的 Codex banked rate-limit reset 可用次数、推断获得次数、使用时间和一个月有效期；这类数据不是本地 session `rate_limits` reset 事件，必须从 Codex 产品层数据源读取。
- 实现方式：新增 `readCodexAccountRateLimits`，通过 Codex 本地 app-server JSON-RPC 只读方法 `account/rateLimits/read` 读取 `rateLimitResetCredits.availableCount`、`rateLimits` 和 `rateLimitsByLimitId`；新增 `createBankedResetCreditObservationFromSnapshot`，把 app-server 快照转换成可入库观测；新增 `analyzeBankedResetCreditObservations`，基于连续采样的 `availableCount` 差值推断 `grant / use / expiration / decrease-unknown` 事件；新增 `CodexAccountRateLimitsSnapshot`、`CodexRateLimitResetCreditsSummary`、`BankedResetCreditObservation`、`BankedResetCreditEvent` 等共享类型；CLI 新增 `codex-usage inspect-banked-reset`。
- 适用范围：适用于本机已登录 Codex 且 `codex app-server --stdio` 可正常访问 `account/rateLimits/read` 的环境；该接口是只读读取，不调用 `account/rateLimitResetCredit/consume`，不会消耗可用 reset。
- 触发条件：`availableCount` 相邻采样增加时推断 `grant`；相邻采样减少且同一区间内任一额度桶的 `primary / secondary` 出现 `usedPercent` 回落、`resetsAt` 后移时推断 `use`；相邻采样减少、未观测到额度窗口 reset，且存在已推断 grant 到达 `observedAt + 30d` 估算过期时间时推断 `expiration`；其余减少归为 `decrease-unknown`。
- 排除条件：当前 Codex app-server schema 只暴露 `availableCount`，不暴露逐笔 `grantedAt / expiresAt / usedAt`；因此过期时间只能以 `estimatedExpiresAt` 表示，不能当作官方返回字段；首次观测已有的可用次数不能反推来源和精确过期时间。
- 关键字段：`rateLimitResetCredits.availableCount` 表示当前可用 banked reset credit 数量；`BankedResetCreditEvent.estimatedExpiresAt` 表示按 grant 观测时间加默认 `30d` 推导的估算过期时间；`BankedResetCreditEvent.evidence.affectedLimitIds` 记录推断使用时发生 reset 的额度桶。
- 验证样例：脱敏测试中 `2030-01-01 available=0 -> 2030-01-02 available=2` 输出 `grant count=2`、`estimatedExpiresAt=2030-02-01T00:00:00.000Z`；`2030-01-03 available=1` 且 `codex.primary.resetsAt` 后移、`usedPercent` 回落时输出 `use count=1`；`2030-02-02 available=0` 且无 reset 证据时输出 `expiration count=1`。
- 当前结果：核心包可以稳定读取当前可用 banked reset credit 次数，并用后续采样推断获得/使用/过期候选；输出仍不包含原始 Codex session 正文、用户输入、模型输出、账号邮箱、token 或原始 app-server 响应。
- 验证方式：执行 `npm run build`；执行 `npm run test`，覆盖原 reset 引擎、banked reset credit 差分分析和假 app-server 读取；执行真实 app-server 只读抽查，当前返回 `rateLimitResetCredits.availableCount=2`，并确认 `codex / codex_bengalfox` 两个额度桶可读；待最终提交前执行 `git diff --check`。

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
