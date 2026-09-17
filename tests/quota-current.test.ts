import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeQuotaObservations, quotaObservationCycleTimestamp, quotaObservationMatchesWindow, resolveCurrentQuotaWindow, selectLatestQuotaObservation } from "../src/index.js";
import type { QuotaCycleObservation } from "../src/index.js";
import { anchorQuotaCycleBounds } from "../src/index.js";
const { observations } = JSON.parse(readFileSync("fixtures/quota-stale-window.json", "utf8")) as { observations: QuotaCycleObservation[] };
const now = "2026-09-16T11:00:00Z";
const base = observations.slice(0, 4);
const result = analyzeQuotaObservations(observations, { comparisonScope: "timeline" });
assert.equal(result.resetCount, 1, "旧窗口迟到不能否定已稳定 reset");
assert.equal(selectLatestQuotaObservation(observations, now)?.usedPercent, 5, "回退不得倒退到已淘汰旧窗口");
const noDrop = observations.map(item => ({ ...item, usedPercent: item.resetsAt === "2026-09-23T08:00:00Z" ? 99 : 98 }));
assert.equal(selectLatestQuotaObservation(noDrop, now)?.usedPercent, 99, "新窗口首条观测没有下降时，仍不能被迟到的旧窗口覆盖");
assert.equal(resolveCurrentQuotaWindow(observations[2]!, now)?.remainingPercent, 100, "当前值不等待历史确认");
assert.equal(quotaObservationMatchesWindow(observations[1]!, observations[2]!), false);
assert.ok(Date.parse(quotaObservationCycleTimestamp(observations[1]!, result.resetEvents)) < Date.parse("2026-09-16T08:00:00Z"));
assert.equal(quotaObservationCycleTimestamp(observations[2]!, result.resetEvents), observations[2]!.observedAt);
assert.equal(anchorQuotaCycleBounds("2026-09-16T08:10:00Z", observations[2]!, { key: "old", startAt: "2026-09-12T08:00:00Z", endAt: "2026-09-19T08:00:00Z" })?.endAt, "2026-09-23T08:00:00.000Z");
assert.equal(analyzeQuotaObservations(observations.slice(0, 3), { comparisonScope: "timeline" }).resetCount, 0, "不伪造未确认 reset");

const make = (observedAt: string, usedPercent: number, resetsAt = "2026-09-23T08:00:00Z"): QuotaCycleObservation => ({ observedAt, usedPercent, resetsAt, windowMinutes: 10080, sourceId: "a" });
const consecutive = [...base, make("2026-09-16T09:00:00Z", 98), make("2026-09-16T10:00:00Z", 0, "2026-09-23T10:00:00Z"), make("2026-09-16T10:35:00Z", 5, "2026-09-23T10:00:00Z")];
assert.equal(analyzeQuotaObservations(consecutive, { comparisonScope: "timeline" }).resetCount, 2, "连续 reset 不能互相否定或按 12h 误合并");
for (const list of [observations, [...observations].reverse(), [...observations.slice(2), ...observations.slice(0, 2)]]) {
  assert.deepEqual(analyzeQuotaObservations(list, { comparisonScope: "timeline" }), result, "乱序输入结果确定");
  assert.equal(selectLatestQuotaObservation(list, now)?.usedPercent, 5);
}
const rebound = [...base, make("2026-09-16T09:00:00Z", 3)];
assert.equal(selectLatestQuotaObservation(rebound, now)?.usedPercent, 3, "同一窗口当前值回落不能被高水位覆盖");
for (const invalid of [
  make("invalid", 1), make(now, NaN), make(now, Infinity), make(now, -1), make(now, 101),
  make(now, 1, "invalid"), make(now, 1, now), make(now, 1, "2026-10-23T08:00:00Z"),
  { ...make(now, 1), windowMinutes: null }, { ...make(now, 1), windowMinutes: 0 }
]) assert.equal(resolveCurrentQuotaWindow(invalid, now), null);
assert.equal(selectLatestQuotaObservation(observations, "2026-09-24T00:00:00Z"), null, "过期后不推算新窗口");
const drift = [...base, make("2026-09-16T09:00:00Z", 5, "2026-09-23T09:00:00Z")];
assert.equal(analyzeQuotaObservations(drift, { comparisonScope: "timeline" }).resetCount, 0, "非旧窗口回流的真实漂移仍拒绝确认");
console.log("当前额度、延迟窗口、乱序、连续 reset、过期和无效字段回归通过。");
