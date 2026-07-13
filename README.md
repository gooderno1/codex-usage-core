# codex-usage-core

`codex-usage-core` 是 `codex-companion` 与 `dev-ledger` 共享的 Codex 本地用量核心包，用于统一 token 用量、额度周期、reset 检测和 banked reset credit 观测规则。

本项目是非官方工具，不隶属于 OpenAI。核心包只处理本机解析后的结构化数据，不要求上传原始 Codex session、用户输入正文、模型输出正文或仓库源码。

## 当前能力

- 共享 `QuotaCycleObservation`、`QuotaResetEvent`、`QuotaUsageSegment` 等类型。
- 分析 5H / 周额度观测序列。
- 识别相邻下降 reset。
- 识别周额度 `24h` 稳定边界回看 reset。
- 对候选执行 `30min` 延迟、`6h` 确认窗口、`15min` 漂移排除和边界去重。
- 在 `QuotaResetEvent` 中补充 `beforeWindowMinutes / afterWindowMinutes / boundaryAt`，用于追踪 reset 后窗口起点和过期时间。
- 在 `usageSegments` 中补充 `windowStartedAt / expiresAt / startedByResetAt / closedByResetAt`，用于追踪每段额度使用时间和被哪次 reset 开启或截止。
- 通过 Codex 本地 app-server 只读接口 `account/rateLimits/read` 读取 `rateLimitResetCredits.availableCount / credits[]`，用于监控 OpenAI 赠送的 banked reset credit 当前可用次数与官方逐笔到期信息。
- 提供 `analyzeBankedResetCreditObservations`，基于公开发放事件、调用方确认的初始 seed、上一轮 active credit baseline 和多次 `availableCount` 采样推断获得次数、使用次数、过期候选、未知减少和当前逐个可用 credit 明细。
- 提供 `codex-usage inspect-reset <snapshot.json>` CLI，用于检查快照中的 reset 事件证据。
- 提供 `codex-usage inspect-banked-reset` CLI，用于只读检查当前 Codex app-server 返回的 banked reset credit 可用次数。

## 使用方式

```ts
import {
  analyzeBankedResetCreditObservations,
  analyzeQuotaObservations,
  createBankedResetCreditObservationFromSnapshot,
  readCodexAccountRateLimits
} from "@lifeinhand/codex-usage-core";

const result = analyzeQuotaObservations(observations, {
  comparisonScope: "timeline"
});

const snapshot = await readCodexAccountRateLimits();
const bankedResetResult = analyzeBankedResetCreditObservations(
  [createBankedResetCreditObservationFromSnapshot(snapshot)],
  {
    initialGrantSeeds: [
      {
        id: "user-assumed-first-banked-reset-2026-06-14",
        acquiredAt: "2026-06-14T00:00:00.000Z",
        sourceId: "user-confirmed-assumption",
        estimateBasis: "assumed-grant"
      }
    ]
  }
);
```

reset 口径：

- 本包没有官方“充值次数”数据，也不从网络或账单推断充值。
- `resetCount / resetEvents` 只表示本地 `rate_limits` 中稳定确认的额度窗口 reset：`used_percent` 回落、`resets_at` 后移，且满足高水位、边界贴近或稳定边界回看证据之一。
- `resetEvents[].boundaryAt` 来自 reset 后 `resetsAt - windowMinutes`。
- `resetEvents[].afterWindowResetsAt` 表示 reset 后额度窗口的过期时间。
- `usageSegments[].startAt / endAt / usedPercent` 记录每段 reset 前后的额度使用区间和最高已用百分比。
- 本包只输出结构化百分比和时间，不输出原始 session 正文、用户输入、模型输出或仓库源码。

banked reset credit 口径：

- `rateLimitResetCredits.availableCount` 来自 Codex 本地 app-server 只读方法 `account/rateLimits/read`，表示当前可用的 banked Codex rate-limit reset 数量。
- 本包不会调用 `account/rateLimitResetCredit/consume`，不会消耗用户的 banked reset credit。
- 新版 Codex app-server 会在 `rateLimitResetCredits.credits[]` 中返回逐笔 `id / resetType / status / grantedAt / expiresAt / title / description`；本包将 Unix 秒转换为 ISO 时间，并在 `activeCredits[]` 中以 `estimateBasis=official-detail`、`expiryBasis=official` 输出。
- `credits=null` 表示当前 Codex 或后端只提供总数；空数组表示已获取明细但当前没有可用明细。官方说明明细可能被截断，因此 `availableCount` 始终是权威总数，`officialDetailsComplete` 只有在明细数与总数一致时才为 `true`。
- 当官方逐笔明细不可用或不完整时，未覆盖的库存继续使用本地观测、公开 seed 和调用方 seed 估算；`nextExpiresAt / nextExpiryBasis` 统一给出最近已知到期时间及其官方或估算来源。
- OpenAI 公开资料说明 banked Codex rate-limit reset 授予后 `30` 天可用；本包默认按 `30d` 估算过期时间，并允许通过 `validityDays` 覆盖。
- `analyzeBankedResetCreditObservations` 会用仍在有效期内且允许默认匹配的公开发放事件为首次已有库存补种子：
  - `2026-06-11T00:00:00.000Z`：Codex app `26.609` rate-limit reset banking 上线时面向 Plus / Pro 用户的一次 free reset；这次 reset 可能已在开始监控前被用户手动使用，因此默认 `matchByDefault=false`，不自动归因到当前库存。
  - `2026-06-30T00:00:00.000Z`：Codex 异常消耗修复后的公开补偿 reset，时间按公开消息保守提前到当天 `00:00 UTC`。
  - 这些种子只用于 `activeCredits[]` 的 `public-grant` 估算，不表示接口返回了私有账号的逐笔明细；调用方可传入 `publicGrantSeeds: []` 关闭默认种子，或显式把某个 seed 的 `matchByDefault` 设为 `true`。
- 调用方可通过 `initialGrantSeeds` 传入本地确认或用户确认的初始 credit 口径：
  - `estimateBasis=assumed-grant` 表示时间无法从接口反推，但用户或下游项目明确采用某个假定获取时间，例如把首次未知 credit 假定为 `2026-06-14T00:00:00.000Z`。
  - `estimateBasis=observed-grant` 表示下游曾经实际观测到 `availableCount` 增加；当滚动历史裁剪掉早期 `2 -> 3` 差分时，可作为初始 seed 恢复这条已观测 grant。
  - 初始 seed 只在 `acquiredAt <= firstObservedAt < acquiredAt + validityDays` 时匹配，超过有效期或晚于首次观测则不会参与首次库存归因。
- 调用方可通过 `activeCreditBaseline` 传入上一轮 `observedAt + activeCredits[]`，让分析从这条 baseline 之后继续处理新增观测；这用于避免下游滚动裁剪 `observations` 后丢失已经识别出的 `observed-grant / public-grant / assumed-grant` 明细。
- `analyzeBankedResetCreditObservations` 同时基于相邻采样差值推断：
  - `grant`：`availableCount` 增加，`estimatedExpiresAt = observedAt + 30d`，该过期时间是按官方有效期规则估算，不是接口原始字段。
  - `use`：`availableCount` 减少，且同一采样区间内 5H 或周额度窗口出现 `usedPercent` 回落、`resetsAt` 后移。
  - `expiration`：`availableCount` 减少，未观察到额度窗口 reset，且存在已推断 grant 到达估算过期时间。
  - `decrease-unknown`：`availableCount` 减少，但证据不足以区分使用或过期。
- `activeCredits[]` 表示当前仍可用的逐个 banked reset credit；官方明细优先，缺失部分才回退到估算：
  - `acquiredAt`：采样中观测到 `availableCount` 增加时取当前采样时间；命中公开 seed 时取公开发放时间；命中调用方初始 seed 时取调用方传入时间；其他首次已有库存仍为空。
  - `estimatedExpiresAt`：按 `acquiredAt + 30d` 估算。
  - `safeEstimatedExpiresAt`：默认按 `estimatedExpiresAt - 1d` 输出，供下游优先展示，避免用户卡着最后时刻错过使用机会。
  - `estimateBasis=public-grant` 表示来自公开发放事件种子，时间是保守估算。
  - `estimateBasis=assumed-grant` 表示来自调用方明确传入的假定获取时间，不表示 Codex app-server 返回了逐笔时间。
  - `estimateBasis=existing-at-first-observation` 表示首次采样时已经存在的 credit，接口无法反推获取时间和真实过期时间；此类条目的 `safeEstimatedExpiresAt` 取首次观测时间，下游应展示为“建议尽快使用”。

`comparisonScope`：

- `session`：按同一 `sourceId` 内的相邻观测比较，适合 5H 窗口。
- `timeline`：按同一额度池全局时间线比较，适合周额度窗口。

## 验证

```bash
npm run build
npm run test
```

测试样例位于 `tests/quota-reset.test.ts`，只包含脱敏观测点，不包含原始 session 正文。
