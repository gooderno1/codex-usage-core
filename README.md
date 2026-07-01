# codex-usage-core

`codex-usage-core` 是 `codex-companion` 与 `dev-ledger` 共享的 Codex 本地用量核心包，用于统一 token 用量、额度周期和 reset 检测规则。

本项目是非官方工具，不隶属于 OpenAI。核心包只处理本机解析后的结构化数据，不要求上传原始 Codex session、用户输入正文、模型输出正文或仓库源码。

## 当前能力

- 共享 `QuotaCycleObservation`、`QuotaResetEvent`、`QuotaUsageSegment` 等类型。
- 分析 5H / 周额度观测序列。
- 识别相邻下降 reset。
- 识别周额度 `24h` 稳定边界回看 reset。
- 对候选执行 `30min` 延迟、`6h` 确认窗口、`15min` 漂移排除和边界去重。
- 提供 `codex-usage inspect-reset <snapshot.json>` CLI，用于检查快照中的 reset 事件证据。

## 使用方式

```ts
import { analyzeQuotaObservations } from "@lifeinhand/codex-usage-core";

const result = analyzeQuotaObservations(observations, {
  comparisonScope: "timeline"
});
```

`comparisonScope`：

- `session`：按同一 `sourceId` 内的相邻观测比较，适合 5H 窗口。
- `timeline`：按同一额度池全局时间线比较，适合周额度窗口。

## 验证

```bash
npm run build
npm run test
```

测试样例位于 `tests/quota-reset.test.ts`，只包含脱敏观测点，不包含原始 session 正文。
