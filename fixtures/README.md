# fixtures

本目录只允许存放脱敏样例。

- 不提交原始 Codex session。
- 不提交用户输入正文或模型输出正文。
- 不提交私有仓库路径。
- reset 样例应抽取为最小化 `QuotaCycleObservation` 序列。
- reset 次数、过期时间和使用区间样例也必须由脱敏 `QuotaCycleObservation` 推导。
- banked reset credit 样例只允许保留 `observedAt`、`availableCount`、脱敏后的 `limitId`、`usedPercent`、`windowDurationMins`、`resetsAt`。
- banked reset credit 的 `estimatedExpiresAt` 只能由脱敏样例的 `observedAt + 30d` 推导，不能提交账号页面、邀请链接、账号 ID、邮箱、token 或原始 app-server 响应。
