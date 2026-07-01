import { strict as assert } from "node:assert";
import { analyzeQuotaObservations } from "../src/index.js";
import type { QuotaCycleObservation } from "../src/index.js";

function observation(
  observedAt: string,
  usedPercent: number,
  resetsAt: string,
  sourceId = "fixture"
): QuotaCycleObservation {
  return {
    observedAt,
    usedPercent,
    resetsAt,
    windowMinutes: 10080,
    sourceId
  };
}

function addStableObservations(
  base: QuotaCycleObservation[],
  startAt: string,
  resetsAt: string,
  count = 3
) {
  const startMs = new Date(startAt).getTime();
  for (let index = 0; index < count; index += 1) {
    base.push(observation(new Date(startMs + index * 30 * 60 * 1000).toISOString(), 0, resetsAt));
  }
}

{
  const observations = [
    observation("2026-06-01T00:00:00.000Z", 65, "2026-06-08T00:00:00.000Z"),
    observation("2026-06-02T00:00:00.000Z", 2, "2026-06-09T00:00:00.000Z")
  ];
  addStableObservations(observations, "2026-06-02T00:40:00.000Z", "2026-06-09T00:00:00.000Z");
  observations.push(observation("2026-06-03T00:00:00.000Z", 12, "2026-06-09T00:00:00.000Z"));
  const result = analyzeQuotaObservations(observations, { comparisonScope: "timeline" });
  assert.equal(result.resetCount, 1);
  assert.ok(result.resetEvents[0]?.evidence?.evidenceTypes.includes("high-water-drop"));
  assert.equal(result.resetEvents[0]?.afterWindowMinutes, 10080);
  assert.equal(result.resetEvents[0]?.boundaryAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.rechargeCount, 1);
  assert.equal(result.rechargeEvents[0]?.rechargeIndex, 1);
  assert.equal(result.rechargeEvents[0]?.windowStartedAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.rechargeEvents[0]?.expiresAt, "2026-06-09T00:00:00.000Z");
  assert.equal(result.rechargeEvents[0]?.previousUsageStartedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(result.rechargeEvents[0]?.previousUsageEndedAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.usageSegments[0]?.expiresAt, "2026-06-08T00:00:00.000Z");
  assert.equal(result.usageSegments[0]?.closedByRechargeAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.usageSegments.at(-1)?.startedByRechargeAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.usageSegments.at(-1)?.expiresAt, "2026-06-09T00:00:00.000Z");
  assert.equal(result.usageSegments.at(-1)?.usedPercent, 12);
}

{
  const observations = [
    observation("2026-06-29T00:50:00.000Z", 10, "2026-07-02T13:11:36.000Z"),
    observation("2026-06-29T01:01:51.803Z", 0, "2026-07-06T01:01:36.000Z")
  ];
  addStableObservations(observations, "2026-06-29T01:40:00.000Z", "2026-07-06T01:01:36.000Z");
  const result = analyzeQuotaObservations(observations, { comparisonScope: "timeline" });
  assert.equal(result.resetCount, 1);
  assert.ok(result.resetEvents[0]?.evidence?.evidenceTypes.includes("boundary-aligned-drop"));
}

{
  const observations = [
    observation("2026-06-29T18:16:43.673Z", 15, "2026-07-06T01:01:36.000Z"),
    observation("2026-06-30T03:10:00.000Z", 0, "2026-07-06T01:01:36.000Z"),
    observation("2026-06-30T03:56:42.332Z", 0, "2026-07-07T03:22:09.000Z")
  ];
  addStableObservations(observations, "2026-06-30T04:30:00.000Z", "2026-07-07T03:22:09.000Z", 4);
  const result = analyzeQuotaObservations(observations, { comparisonScope: "timeline" });
  assert.equal(result.resetCount, 1);
  assert.deepEqual(result.resetEvents[0]?.evidence?.evidenceTypes, ["stabilized-boundary-drop"]);
  assert.equal(result.resetEvents[0]?.evidence?.lookbackObservedAt, "2026-06-29T18:16:43.673Z");
}

{
  const observations = [
    observation("2026-06-24T00:00:00.000Z", 10, "2026-07-01T00:00:00.000Z"),
    observation("2026-06-24T00:05:00.000Z", 0, "2026-07-01T00:05:00.000Z"),
    observation("2026-06-24T00:40:00.000Z", 0, "2026-07-01T00:30:00.000Z")
  ];
  const result = analyzeQuotaObservations(observations, { comparisonScope: "timeline" });
  assert.equal(result.resetCount, 0);
  assert.equal(result.rechargeCount, 0);
}

console.log("quota-reset tests passed");
