# DEVELOPMENT LOG

## [2026-09-21] v0.2.0-dev.4 perf(quota): 复用历史回看中的时间解析结果

- 开发原因：Companion 新增历史额度估算页后，大量观测在 24h 回看循环内重复解析 observedAt、resetsAt 和窗口起点，查询耗时明显。
- 实现方式：稳定边界候选分析先按原有顺序缓存每条观测的毫秒时间，再用数值比较；同窗口先排除不满足边界前移的观测。
- 适用范围：历史 stabilized-boundary-drop 候选。保留原有时长匹配、回看区间、下降阈值和并列高水位选择；不改变当前额度或 reset 确认规则。
- 验证样例：1000 条密集高水位后边界前移，仍选最近并列高水位 16:39；逆序输入结果一致。
- 当前结果：固定 55,866 条本地有效周观测，完整分析结果深度相等；同机一次对比从 32.12s 降至 8.31s。真实数据和分析明细不入库。
- 验证方式：npm test（含构建、历史 reset、当前额度和新增密集观测回归）；独立进程比较 dev.3 / dev.4 完整输出；git diff --check。
- 下游同步：Companion v0.7.0-dev.1（ff2bfee，codex/quota-estimation）和 dev-ledger v0.14.0-dev.29（8b21c83）均固定远程 tag v0.2.0-dev.4，已提交推送。
- 下游验证：Companion 构建、用量 / 当前额度 / 估算 / 通知 / 更新器回归和真实数据 Electron 页面检查通过；dev-ledger 脱敏隔离环境的完整 verify 通过，包含构建、挂件、Agent / Master、本机 HTTP 流程。结果详情保留在各项目开发记录。

## [2026-09-17] v0.2.0-dev.3 fix(quota): 当前窗口选择不依赖用量下降

- 开发原因：补充“首次新窗口观测已消耗 99%，旧窗口迟到记录为 98%”边界时，发现 dev.2 本地选择仍依赖 5 点下降，会倒退到旧窗口。
- 实现方式：同池同类观测先校验，再按最新有效截止时间确定窗口身份；只在最新截止时间前 60s 时钟容差内选择最新记录，不使用历史 reset 的下降阈值。
- 排除条件：无效、过期、不合理未来观测仍由当前窗口校验器排除；不改变历史 reset 的 30min / 6h 确认要求。
- 当前结果：无下降、低下降和多窗口迟到均不能倒退到旧窗口；真实当前值回落仍保持最新观测。
- 验证方式：npm test，包含原有及新增 no-drop 用例；最终两个下游固定远程 tag v0.2.0-dev.3。
- 下游同步：Companion `0.5.3-dev.2`（`16c3be6`）与 dev-ledger `0.14.0-dev.28`（`314327c`）均已升级并推送，最终依赖均为 `v0.2.0-dev.3`。
- 集成验证：Companion 完整构建、当前额度及历史用量回归、真实官方采集、Electron 页面、Windows 打包与原位安装通过。dev-ledger 真实数据构建通过；最终版本在脱敏隔离环境通过 `npm run verify`，覆盖挂件、Agent / Master 和本地 HTTP 全流程。

## [2026-09-17] v0.2.0-dev.2 fix(quota): 分离当前窗口与历史 reset 证据

- 开发原因：Companion 的补丁仍会在 reset 确认前显示旧高水位；旧窗口迟到使 reset 被拒绝，连续 reset 被漂移检查或 12h 去重误合并。
- 实现方式：新增当前窗口校验、最新有效观测选择、窗口身份匹配、历史观测归属和当前边界锚定函数。窗口身份由截止时刻与时长决定，不用写入时间替代身份。
- 适用范围：同额度池、同业务时长的结构化观测；额度池由调用方隔离，未知/过期窗口返回 null，不能推算恢复额度。
- 触发条件：本地选择时新截止时间后移超过 60s、消耗下降至少 5 点，旧身份被淘汰；当前值为 100 减最新有效 usedPercent。
- 排除条件：无效时间、非有限或越界百分比、非正时长、已过期及未来起点超过观测时间 5min 的样本不能作为当前值。
- 实现方式：确认阶段排除更接近旧边界且在 5min 内的旧窗口回流；保留对未知漂移的拒绝。后续已确认独立 reset 截止前一个确认区间。
- 实现方式：确认仍要求 30min 后、6h 内稳定样本；不同窗口不再因为 12h 内用量相似被去重，保留同窗口 15min 容差。
- 当前结果：脱敏旧窗口回流样例从 resetCount=0 修正为 1；2h 内连续 reset 从 1 修正为 2；当前余量在历史确认前也可立即返回 100%。
- 验证方式：npm run build、npm test，包含原有全部用例和新 fixture；覆盖乱序、连续 reset、普通回落、过期、无效值、当前边界锚定和真实漂移拒绝。
- 下游同步：本轮初始升级目标为 Companion 0.5.3-dev.2、dev-ledger 0.14.0-dev.28；补测后统一升级至核心 v0.2.0-dev.3，最终同步与验证见上条记录。

## [2026-07-31] v0.2.0-dev.1 feat: 接入 Codex 官方用量路径

- 开发原因：本地 session `token_count.rate_limits` 与 app-server `account/rateLimits/read` 当前均只返回周额度，无法代表 Codex 官方桌面端用量页面的完整采集路径；两个下游需要在官方重新下发 5H 时自动恢复展示。
- 实现方式：新增 `readCodexUsageRateLimits()`，读取本机 Codex ChatGPT 登录状态并请求官方桌面端使用的 `GET https://chatgpt.com/backend-api/wham/usage`；新增 `normalizeCodexWhamUsageResult()`，把 snake_case 响应规范化为现有 `CodexAccountRateLimitsSnapshot`；运行时增加 `undici`，支持 `HTTPS_PROXY / ALL_PROXY / NO_PROXY`。
- 适用范围：主额度字段 `rate_limit.primary_window / secondary_window`，模型附加额度 `additional_rate_limits[]`，赠送重置总数 `rate_limit_reset_credits.available_count`。
- 触发条件：`limit_window_seconds / 60` 生成 `windowDurationMins`；`300±60` 分钟由共享分类器识别为 `five-hour`，`10080±60` 分钟识别为 `weekly`；primary/secondary 只保留真实槽位，不绑定业务语义。
- 排除条件：接口缺失的窗口不使用历史值补齐；接口失败时核心读取器抛出脱敏错误，由下游回退到 app-server 或 session；Wham 只提供赠送重置总数，不覆盖 app-server 的官方逐笔到期明细。
- 隐私边界：access token 和 account id 只从本机 `auth.json` 读取并放入请求头，不进入返回值、错误信息、fixture、日志或仓库。
- 验证样例：脱敏 Wham fixture 返回 `18000s / 604800s` 两个窗口，规范化后输出 `300min / 10080min`；假 HTTP 服务验证认证头和代理关闭分支；本机 live 响应输出周额度 `10080min / usedPercent=13`、5H 未观测，与 Codex 桌面端“1 周剩余 87%”一致。
- 当前结果：核心包具备官方用量采集能力，并保持既有 app-server banked reset 读取兼容；窗口检测可在官方重新下发 300 分钟字段后自适应恢复 5H。
- 验证方式：执行 `npm run build`、`npm run test`、live 官方接口脱敏读取和 `git diff --check`。

## [2026-07-15] v0.1.0-dev.11 docs: 完成核心包公开准备

- 开发原因：`codex-companion` 公开后，GitHub Actions 无法读取仍为 private 的共享核心仓库；用户确认两个仓库都可以公开，需要补齐开源许可证、安全报告和贡献边界。
- 实现方式：扫描当前跟踪文件、敏感文件名和完整 Git 历史中的常见 token、私钥、访问密钥及密码模式；检查 fixture、源码、测试和文档中的账号标识、会话标识与本机绝对路径；新增 MIT `LICENSE`、`SECURITY.md` 和 `CONTRIBUTING.md`，并在 README 中明确公开源码、Git tag 依赖、`private=true` 防误发包和 local-first 隐私边界。
- 当前结果：审计未发现凭据、私钥、账号/会话标识、原始 Codex session、用户/模型正文、私有源码或敏感绝对路径；核心包具备公开仓库所需的许可证与安全协作说明。
- 验证方式：执行 `npm ci`、`npm run build`、`npm run test`、完整 Git 历史敏感模式扫描和 `git diff --check`；公开后再验证匿名 HTTPS clone、tag `v0.1.0-dev.11` 读取和两个下游的 CI 安装。

## [2026-07-15] v0.1.0-dev.11 fix: 兼容周额度迁移到 primary

- 开发原因：本机 Codex app-server 已从旧版 `primary=300 / secondary=10080` 切换为 `primary=10080 / secondary=null`；旧逻辑会把槽位迁移误判为一次额度 reset，并可能把同区间的 banked reset credit 减少误归因为使用。
- 实现方式：新增共享窗口分类常量与 `classifyCodexQuotaWindowDuration / isCodexQuotaWindowDuration`；reset 相邻比较、`24h` 稳定边界回看和 banked reset 使用证据均要求前后窗口时长完全一致；版本升级为 `v0.1.0-dev.11`。
- 适用范围：处理 Codex 本地 session `rate_limits` 和 app-server `account/rateLimits/read` 返回的 `300` 分钟、`10080` 分钟或未知时长窗口；`primary / secondary` 仅作为槽位，不作为 5H / 周额度的固定语义。
- 触发条件：`300` 分钟分类为 `five-hour`，`10080` 分钟分类为 `weekly`，分类容差为 `60` 分钟；reset/use 证据要求相邻观测的实际 `windowMinutes / windowDurationMins` 完全相等。
- 排除条件：前后时长不等、任一时长缺失或不可解析时，不生成 reset 候选，也不把 banked reset credit 减少归因为使用；不修改百分比下降 `5%`、高水位 `50%`、确认延迟 `30min`、确认窗口 `6h` 和漂移容差 `15min`。
- 关键字段：session 观测使用 `windowMinutes`；app-server 快照使用 `windowDurationMins`；窗口业务类型使用 `CodexQuotaWindowKind=five-hour | weekly | unknown`。
- 验证样例：脱敏 fixture 从 `80% / 300min` 切换为 `2% / 10080min`，并提供后续稳定边界观测；旧逻辑输出 `resetCount=1`，新逻辑输出 `resetCount=0`。同一迁移区间内 `availableCount=1 -> 0` 输出 `decrease-unknown`，不输出 `use`。
- 当前结果：核心包可安全处理当前仅有周额度 primary 的契约，且不会跨窗口类型污染 reset 或 banked reset 使用计数；对外输出仍不包含原始会话正文。
- 下游同步：`codex-companion v0.3.9-dev.1` 与 `dev-ledger v0.14.0-dev.26` 均已升级到本版本并推送；两个下游按窗口时长选择 5H / 周额度，不再固定绑定 primary / secondary。Companion 的 live 快照、DevLedger 的 Agent / Master 完整聚合均验证 `primary=10080 / secondary=null` 时周额度可用、5H 明确为未观测。
- 验证方式：执行 `npm run build`、`npm run test` 和 `git diff --check`；新增 `fixtures/quota-window-contract-transition.json` 及仅 `primary=10080 / secondary=null` 的假 app-server 覆盖。

## [2026-07-13] v0.1.0-dev.10 fix: 兼容旧版到期估算 baseline

- 开发原因：两个下游升级时会把 `v0.1.0-dev.8` 生成的 `activeCredits[]` 缓存作为 baseline 传回，新字段 `expiryBasis` 在旧缓存中不存在。
- 实现方式：恢复已知旧 credit 时，统一以 `expiresAt ?? estimatedExpiresAt` 迁移到新字段，并把缺失的 `expiryBasis` 设为 `estimated`；首次未知库存仍设为 `unknown`。
- 当前结果：升级后的首次刷新无需清空本地历史即可平滑迁移到官方/估算统一到期模型。
- 下游同步：`codex-companion v0.3.8-dev.1` 已升级到本版本并接入官方到期展示/通知；`dev-ledger v0.14.0-dev.25` 已升级到本版本并接入采集、汇总、页面展示和字段校验。两个下游构建通过；live 额度契约校验另发现本机当前仅返回 10080 分钟 primary、缺少 secondary 的既有问题，已分别记录，不影响本次 banked reset 明细解析。
- 验证方式：执行 `npm run test` 与 `git diff --check`。

## [2026-07-13] v0.1.0-dev.9 feat: 接入官方赠送重置到期明细

- 开发原因：OpenAI Codex 官方 app-server 主线已在 `account/rateLimits/read` 的 `rateLimitResetCredits.credits[]` 暴露逐笔赠送重置的获取和到期信息，旧版仅基于 `availableCount`、公开事件和本地采样估算到期时间的口径需要升级。
- 实现方式：新增 `CodexRateLimitResetCredit` 及相关状态/类型，解析 `id / resetType / status / grantedAt / expiresAt / title / description`，将 Unix 秒同步规范化为 ISO；`BankedResetCreditObservation` 保存 `officialCredits`；分析结果新增 `expiresAt / expiryBasis`、`nextExpiresAt / nextExpiryBasis`、`officialDetailCount / officialDetailsComplete`，并以 `official-detail` 优先覆盖对应库存，未被官方明细覆盖的数量继续沿用旧估算回退。
- 适用范围：Codex app-server 返回 `rateLimitResetCredits` 的环境。`credits=null` 代表仅总数可用；`credits=[]` 代表明细已获取但没有可用条目；明细数可能小于 `availableCount`，因此总数仍以 `availableCount` 为准，不能用数组长度覆盖。
- 触发条件：逐笔记录必须包含字符串 `id` 和可解析的 Unix 秒 `grantedAt`；`expiresAt=null` 表示官方声明该条不设到期时间。未知 `resetType / status` 规范化为 `unknown`，非法逐笔记录被忽略且不会降低权威总数。
- 排除条件：本包仍不会调用 `account/rateLimitResetCredit/consume`；不保存原始 app-server 响应、用户输入、模型输出、账号凭据或私有源码。官方明细不完整时，不把已返回的部分误判为完整库存。
- 验证样例：脱敏 fixture 使用 `availableCount=2`、仅返回 1 条明细，明细 `grantedAt=1781654400`、`expiresAt=1784246400`；输出为 `2026-06-17T00:00:00.000Z -> 2026-07-17T00:00:00.000Z`、`expiryBasis=official`、`officialDetailCount=1`、`officialDetailsComplete=false`，同时保留第 2 条估算/未知库存。
- 当前结果：新版 Codex 可直接展示官方到期时间，旧版 Codex 仍兼容现有估算逻辑；对外类型不包含原始会话正文。
- 验证方式：执行 `npm run build` 和 `npm run test`，覆盖旧 schema、官方完整字段规范化、部分明细与估算回退；执行 `git diff --check`。

## [2026-07-02] v0.1.0-dev.8 feat: 支持初始赠送重置假定和 active baseline

- 开发原因：用户确认本项目此前对第三次 banked reset credit 的观测是准确的；首次观测前已有的第一条 credit 无法从接口反推真实获取时间，本轮统一假定为 `2026-06-14`；后续增加和使用仍应优先沿用本地 `availableCount` 观测，而不能因为下游滚动裁剪历史后退回未知。
- 实现方式：将版本从 `v0.1.0-dev.7` 提升到 `v0.1.0-dev.8`；`BankedResetCreditActiveCreditBasis` 新增 `assumed-grant`；`BankedResetCreditAnalysisOptions` 新增 `initialGrantSeeds` 和 `activeCreditBaseline`；首次库存归因时会合并调用方初始 seed、默认公开 seed 和剩余未知项；传入上一轮 `activeCreditBaseline` 时会从 baseline 后的观测继续分析，并按当前 seed 配置过滤掉不再默认匹配的 `2026-06-11` public grant。
- 适用范围：仅适用于 Codex app-server 只读 `rateLimitResetCredits.availableCount` 已返回可用次数但不返回逐笔 `grantedAt / expiresAt / usedAt` 的场景；`initialGrantSeeds` 是调用方显式传入的本地或用户确认口径，核心包默认不会自行假定 `2026-06-14`。
- 触发条件：初始 seed 仅在 `acquiredAt <= firstObservedAt < acquiredAt + validityDays` 时参与首次库存匹配；`activeCreditBaseline` 仅在下游传入 `observedAt + activeCredits[]` 且当前观测可继续衔接时作为分析起点。
- 排除条件：`2026-06-11` launch seed 仍默认 `matchByDefault=false`；核心包不从单次 `availableCount=3` 自行臆造第三次获取时间；若没有调用方初始 seed、baseline 或相邻观测差分，剩余库存仍保持 `existing-at-first-observation`。
- 关键字段：`initialGrantSeeds[].estimateBasis=assumed-grant` 表示用户确认的假定时间；`initialGrantSeeds[].estimateBasis=observed-grant` 表示下游曾经实际观测到的新增时间；`activeCreditBaseline.activeCredits[]` 用于跨滚动历史延续已识别明细。
- 验证样例：脱敏测试中 `2026-07-01T17:02:29.327Z available=2 -> 2026-07-01T19:58:24.705Z available=3` 输出 3 条 active 明细：`2026-06-14 assumed-grant`、`2026-06-30 public-grant`、`2026-07-01T19:58:24.705Z observed-grant`；当历史裁剪为 `2026-07-01T21:13:24.380Z available=3` 后，传入上一轮 baseline 仍保留同样 3 条明细。
- 当前结果：核心包可同时表达“第一次按 6 月 14 日假定”和“后续增加/使用按实际观测延续”的口径；下游可在升级依赖后移除本地 `6.11` 强制匹配，并传入本项目确认过的初始 seed 与 baseline。
- 验证方式：执行 `npm run build` 和 `npm run test`，均通过。

## [2026-07-02] v0.1.0-dev.7 fix: 避免默认匹配已用 launch reset

- 开发原因：用户确认当前 `rateLimitResetCredits.availableCount=3` 是正确的，但 `2026-06-11` banking 上线赠送的 launch free reset 很可能已经在开始监控前被使用；核心包不能继续把这次 seed 默认归因到当前库存。
- 实现方式：将版本从 `v0.1.0-dev.6` 提升到 `v0.1.0-dev.7`；`BankedResetCreditPublicGrantSeed` 新增 `matchByDefault`；默认公开 seed 仍保留 `2026-06-11` launch free reset，但设置 `matchByDefault=false`；`createPublicSeedCredits()` 只自动匹配 `matchByDefault !== false` 的 seed；文档说明调用方可显式把某个 seed 打开或传入自定义 seed 列表。
- 适用范围：仅影响首次观测时已有的 banked reset credit 归因；后续 `availableCount` 增加仍按本地观测时间输出 `observed-grant`，减少仍按 reset 证据判断 `use / expiration / decrease-unknown`。
- 触发条件：首次观测 `availableCount > 0` 时，只把仍在有效期内且允许默认匹配的公开 seed 归因为 `public-grant`；未匹配的数量继续标记为 `existing-at-first-observation`。
- 排除条件：`2026-06-11` launch seed 默认不参与匹配，除非调用方明确传入 `matchByDefault=true`；核心包不从 `availableCount` 反推用户是否曾经手动使用过某个具体 seed。
- 关键字段：`publicGrantSeeds[].matchByDefault=false` 表示“公开事件存在，但不应自动当作当前仍可用”；`activeCredits[].estimateBasis=existing-at-first-observation` 表示仍无法逐笔确认。
- 验证样例：脱敏测试中 `2026-07-02 available=2` 默认输出 `2026-06-30 -> 2026-07-30` 的 `public-grant` 和 1 条 `existing-at-first-observation`；同一测试显式把 `2026-06-11` seed 设置为 `matchByDefault=true` 时，才输出 `2026-06-11` 与 `2026-06-30` 两条 `public-grant`。
- 验证方式：执行 `npm run test`，覆盖 TypeScript build、原 reset 引擎、banked reset credit 差分分析、`2026-06-11` seed 默认不匹配、显式启用后匹配和假 app-server 读取测试；执行 `git diff --check`，仅有 Windows 换行提示。

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
