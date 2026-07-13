import { strict as assert } from "node:assert";
import {
  analyzeBankedResetCreditObservations,
  analyzeQuotaObservations,
  readCodexAccountRateLimits
} from "../src/index.js";
import type { BankedResetCreditObservation, CodexRateLimitSnapshot, QuotaCycleObservation } from "../src/index.js";

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
  assert.equal(result.resetEvents[0]?.afterWindowResetsAt, "2026-06-09T00:00:00.000Z");
  assert.equal(result.usageSegments[0]?.expiresAt, "2026-06-08T00:00:00.000Z");
  assert.equal(result.usageSegments[0]?.closedByResetAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.usageSegments.at(-1)?.startedByResetAt, "2026-06-02T00:00:00.000Z");
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
}

function rateLimitSnapshot(
  usedPercent: number,
  resetsAt: string,
  secondaryUsedPercent = usedPercent,
  secondaryResetsAt = resetsAt
): CodexRateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: null,
    planType: "prolite",
    primary: {
      usedPercent,
      windowDurationMins: 300,
      resetsAt
    },
    secondary: {
      usedPercent: secondaryUsedPercent,
      windowDurationMins: 10080,
      resetsAt: secondaryResetsAt
    },
    credits: null,
    rateLimitReachedType: null
  };
}

{
  const observations: BankedResetCreditObservation[] = [
    {
      observedAt: "2030-01-01T00:00:00.000Z",
      availableCount: 0,
      rateLimits: rateLimitSnapshot(70, "2030-01-08T00:00:00.000Z")
    },
    {
      observedAt: "2030-01-02T00:00:00.000Z",
      availableCount: 2,
      rateLimits: rateLimitSnapshot(80, "2030-01-08T00:00:00.000Z")
    },
    {
      observedAt: "2030-01-03T00:00:00.000Z",
      availableCount: 1,
      rateLimits: rateLimitSnapshot(0, "2030-01-09T00:00:00.000Z")
    },
    {
      observedAt: "2030-02-02T00:00:00.000Z",
      availableCount: 0,
      rateLimits: rateLimitSnapshot(20, "2030-01-09T00:00:00.000Z")
    }
  ];

  const result = analyzeBankedResetCreditObservations(observations, { validityDays: 30 });
  assert.equal(result.currentAvailableCount, 0);
  assert.equal(result.inferredGrantCount, 2);
  assert.equal(result.inferredUseCount, 1);
  assert.equal(result.inferredExpirationCount, 1);
  assert.equal(result.inferredUnknownDecreaseCount, 0);
  assert.equal(result.events[0]?.kind, "grant");
  assert.equal(result.events[0]?.estimatedExpiresAt, "2030-02-01T00:00:00.000Z");
  assert.equal(result.events[1]?.kind, "use");
  assert.deepEqual(result.events[1]?.evidence.affectedLimitIds, ["codex"]);
  assert.equal(result.events[2]?.kind, "expiration");

  const activeResult = analyzeBankedResetCreditObservations(observations.slice(0, 2), { validityDays: 30 });
  assert.equal(activeResult.nextEstimatedExpiresAt, "2030-02-01T00:00:00.000Z");
  assert.equal(activeResult.nextSafeEstimatedExpiresAt, "2030-01-31T00:00:00.000Z");
  assert.equal(activeResult.activeCredits.length, 2);
  assert.equal(activeResult.activeCredits[0]?.acquiredAt, "2030-01-02T00:00:00.000Z");
  assert.equal(activeResult.activeCredits[0]?.estimatedExpiresAt, "2030-02-01T00:00:00.000Z");
  assert.equal(activeResult.activeCredits[0]?.safeEstimatedExpiresAt, "2030-01-31T00:00:00.000Z");
  assert.equal(activeResult.activeCredits[0]?.estimateBasis, "observed-grant");
}

{
  const result = analyzeBankedResetCreditObservations([
    {
      observedAt: "2030-01-10T00:00:00.000Z",
      availableCount: 2,
      rateLimits: rateLimitSnapshot(30, "2030-01-15T00:00:00.000Z")
    }
  ]);

  assert.equal(result.currentAvailableCount, 2);
  assert.equal(result.activeCredits.length, 2);
  assert.equal(result.activeCredits[0]?.acquiredAt, null);
  assert.equal(result.activeCredits[0]?.firstObservedAt, "2030-01-10T00:00:00.000Z");
  assert.equal(result.activeCredits[0]?.estimatedExpiresAt, null);
  assert.equal(result.activeCredits[0]?.safeEstimatedExpiresAt, "2030-01-10T00:00:00.000Z");
  assert.equal(result.activeCredits[0]?.estimateBasis, "existing-at-first-observation");
}

{
  const result = analyzeBankedResetCreditObservations([
    {
      observedAt: "2026-07-02T00:00:00.000Z",
      availableCount: 2,
      rateLimits: rateLimitSnapshot(30, "2026-07-05T00:00:00.000Z")
    }
  ]);

  assert.equal(result.currentAvailableCount, 2);
  assert.equal(result.activeCredits.length, 2);
  assert.equal(result.activeCredits[0]?.estimateBasis, "existing-at-first-observation");
  assert.equal(result.activeCredits[0]?.acquiredAt, null);
  assert.equal(result.activeCredits[0]?.estimatedExpiresAt, null);
  assert.equal(result.activeCredits[0]?.safeEstimatedExpiresAt, "2026-07-02T00:00:00.000Z");
  assert.equal(result.activeCredits[1]?.estimateBasis, "public-grant");
  assert.equal(result.activeCredits[1]?.acquiredAt, "2026-06-30T00:00:00.000Z");
  assert.equal(result.activeCredits[1]?.estimatedExpiresAt, "2026-07-30T00:00:00.000Z");
  assert.equal(result.activeCredits[1]?.safeEstimatedExpiresAt, "2026-07-29T00:00:00.000Z");
  assert.equal(result.nextEstimatedExpiresAt, "2026-07-30T00:00:00.000Z");
  assert.equal(result.nextSafeEstimatedExpiresAt, "2026-07-29T00:00:00.000Z");
}

{
  const result = analyzeBankedResetCreditObservations(
    [
      {
        observedAt: "2026-07-02T00:00:00.000Z",
        availableCount: 2,
        rateLimits: rateLimitSnapshot(30, "2026-07-05T00:00:00.000Z")
      }
    ],
    {
      publicGrantSeeds: [
        {
          id: "codex-banking-launch-free-reset-2026-06-11",
          grantedAt: "2026-06-11T00:00:00.000Z",
          matchByDefault: true
        },
        {
          id: "codex-usage-incident-compensation-2026-06-30",
          grantedAt: "2026-06-30T00:00:00.000Z"
        }
      ]
    }
  );

  assert.equal(result.activeCredits.length, 2);
  assert.equal(result.activeCredits[0]?.estimateBasis, "public-grant");
  assert.equal(result.activeCredits[0]?.acquiredAt, "2026-06-11T00:00:00.000Z");
  assert.equal(result.activeCredits[1]?.estimateBasis, "public-grant");
  assert.equal(result.activeCredits[1]?.acquiredAt, "2026-06-30T00:00:00.000Z");
}

{
  const initialGrantSeeds = [
    {
      id: "user-assumed-first-banked-reset-2026-06-14",
      acquiredAt: "2026-06-14T00:00:00.000Z",
      sourceId: "user-confirmed-assumption",
      estimateBasis: "assumed-grant" as const
    },
    {
      id: "codex-companion-observed-banked-reset-2026-07-01",
      acquiredAt: "2026-07-01T19:58:24.705Z",
      sourceId: "codex-companion-local-observation",
      estimateBasis: "observed-grant" as const
    }
  ];
  const observedHistory = [
    {
      observedAt: "2026-07-01T17:02:29.327Z",
      availableCount: 2,
      rateLimits: rateLimitSnapshot(30, "2026-07-02T00:00:00.000Z")
    },
    {
      observedAt: "2026-07-01T19:58:24.705Z",
      availableCount: 3,
      rateLimits: rateLimitSnapshot(35, "2026-07-02T00:00:00.000Z")
    }
  ];
  const result = analyzeBankedResetCreditObservations(observedHistory, { initialGrantSeeds });

  assert.equal(result.currentAvailableCount, 3);
  assert.equal(result.inferredGrantCount, 1);
  assert.equal(result.activeCredits.length, 3);
  assert.equal(result.activeCredits[0]?.estimateBasis, "assumed-grant");
  assert.equal(result.activeCredits[0]?.acquiredAt, "2026-06-14T00:00:00.000Z");
  assert.equal(result.activeCredits[0]?.estimatedExpiresAt, "2026-07-14T00:00:00.000Z");
  assert.equal(result.activeCredits[1]?.estimateBasis, "public-grant");
  assert.equal(result.activeCredits[1]?.acquiredAt, "2026-06-30T00:00:00.000Z");
  assert.equal(result.activeCredits[2]?.estimateBasis, "observed-grant");
  assert.equal(result.activeCredits[2]?.acquiredAt, "2026-07-01T19:58:24.705Z");

  const prunedResult = analyzeBankedResetCreditObservations(
    [
      {
        observedAt: "2026-07-01T21:13:24.380Z",
        availableCount: 3,
        rateLimits: rateLimitSnapshot(40, "2026-07-02T02:13:25.000Z")
      },
      {
        observedAt: "2026-07-02T10:14:15.667Z",
        availableCount: 3,
        rateLimits: rateLimitSnapshot(22, "2026-07-02T14:29:01.000Z")
      }
    ],
    {
      initialGrantSeeds,
      activeCreditBaseline: {
        observedAt: "2026-07-01T19:58:24.705Z",
        activeCredits: result.activeCredits
      }
    }
  );

  assert.deepEqual(
    prunedResult.activeCredits.map((credit) => [credit.estimateBasis, credit.acquiredAt]),
    result.activeCredits.map((credit) => [credit.estimateBasis, credit.acquiredAt])
  );

  const migratedBaselineResult = analyzeBankedResetCreditObservations(
    [
      {
        observedAt: "2026-07-02T10:14:15.667Z",
        availableCount: 3,
        rateLimits: rateLimitSnapshot(22, "2026-07-02T14:29:01.000Z")
      }
    ],
    {
      initialGrantSeeds,
      activeCreditBaseline: {
        observedAt: "2026-07-02T10:14:15.667Z",
        activeCredits: [
          {
            id: "existing:2026-07-02T10:14:15.667Z:1",
            acquiredAt: null,
            firstObservedAt: "2026-07-02T10:14:15.667Z",
            expiresAt: null,
            expiryBasis: "unknown",
            estimatedExpiresAt: null,
            safeEstimatedExpiresAt: "2026-07-02T10:14:15.667Z",
            estimateBasis: "existing-at-first-observation",
            sourceId: "codex-app-server"
          },
          {
            id: "existing:2026-07-02T10:14:15.667Z:2",
            acquiredAt: null,
            firstObservedAt: "2026-07-02T10:14:15.667Z",
            expiresAt: null,
            expiryBasis: "unknown",
            estimatedExpiresAt: null,
            safeEstimatedExpiresAt: "2026-07-02T10:14:15.667Z",
            estimateBasis: "existing-at-first-observation",
            sourceId: "codex-app-server"
          },
          {
            id: "public-grant:2026-06-30T00:00:00.000Z:codex-usage-incident-compensation-2026-06-30",
            acquiredAt: "2026-06-30T00:00:00.000Z",
            firstObservedAt: "2026-07-02T10:14:15.667Z",
            expiresAt: "2026-07-30T00:00:00.000Z",
            expiryBasis: "estimated",
            estimatedExpiresAt: "2026-07-30T00:00:00.000Z",
            safeEstimatedExpiresAt: "2026-07-29T00:00:00.000Z",
            estimateBasis: "public-grant",
            sourceId: "public-codex-usage-incident-compensation"
          }
        ]
      }
    }
  );

  assert.deepEqual(
    migratedBaselineResult.activeCredits.map((credit) => [credit.estimateBasis, credit.acquiredAt]),
    [
      ["assumed-grant", "2026-06-14T00:00:00.000Z"],
      ["public-grant", "2026-06-30T00:00:00.000Z"],
      ["observed-grant", "2026-07-01T19:58:24.705Z"]
    ]
  );
}

async function runAppServerReadTest() {
  const fakeServer = `
const bucket = {
  limitId: "codex",
  limitName: null,
  planType: "prolite",
  primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 1782918977 },
  secondary: { usedPercent: 14, windowDurationMins: 10080, resetsAt: 1783394530 },
  credits: { hasCredits: false, unlimited: false, balance: "redacted" },
  rateLimitReachedType: null
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.id === 1) {
        console.log(JSON.stringify({ id: 1, result: { userAgent: "fake", codexHome: "C:/fake/.codex", platformFamily: "windows", platformOs: "windows" } }));
      }
      if (message.id === 2 && message.method === "account/rateLimits/read") {
        console.log(JSON.stringify({ id: 2, result: { rateLimitResetCredits: { availableCount: 2, credits: [{ id: "RateLimitResetCredit_1", resetType: "codexRateLimits", status: "available", grantedAt: 1781654400, expiresAt: 1784246400, title: "Full reset", description: "Ready to redeem" }] }, rateLimits: bucket, rateLimitsByLimitId: { codex: bucket } } }));
      }
    }
    index = buffer.indexOf("\\n");
  }
});
`;

  const snapshot = await readCodexAccountRateLimits({
    command: process.execPath,
    args: ["-e", fakeServer],
    shell: false,
    observedAt: "2026-07-01T10:00:00.000Z",
    timeoutMs: 5000
  });

  assert.equal(snapshot.observedAt, "2026-07-01T10:00:00.000Z");
  assert.equal(snapshot.source, "codex-app-server");
  assert.equal(snapshot.rateLimitResetCredits?.availableCount, 2);
  assert.equal(snapshot.rateLimitResetCredits?.credits?.[0]?.grantedAt, "2026-06-17T00:00:00.000Z");
  assert.equal(snapshot.rateLimitResetCredits?.credits?.[0]?.expiresAt, "2026-07-17T00:00:00.000Z");
  assert.equal(snapshot.rateLimitResetCredits?.credits?.[0]?.status, "available");
  assert.equal(snapshot.rateLimits.primary?.resetsAt, "2026-07-01T15:16:17.000Z");
  assert.equal(snapshot.rateLimitsByLimitId?.codex?.secondary?.windowDurationMins, 10080);
}

{
  const result = analyzeBankedResetCreditObservations([
    {
      observedAt: "2026-07-13T00:00:00.000Z",
      availableCount: 2,
      officialCredits: [
        {
          id: "RateLimitResetCredit_1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: "2026-06-17T00:00:00.000Z",
          grantedAtUnixSeconds: 1781654400,
          expiresAt: "2026-07-17T00:00:00.000Z",
          expiresAtUnixSeconds: 1784246400,
          title: "Full reset",
          description: "Ready to redeem"
        }
      ]
    }
  ]);

  assert.equal(result.officialDetailCount, 1);
  assert.equal(result.officialDetailsComplete, false);
  assert.equal(result.nextExpiresAt, "2026-07-17T00:00:00.000Z");
  assert.equal(result.nextExpiryBasis, "official");
  const officialCredit = result.activeCredits.find((credit) => credit.estimateBasis === "official-detail");
  assert.equal(officialCredit?.expiryBasis, "official");
  assert.equal(officialCredit?.expiresAt, "2026-07-17T00:00:00.000Z");
  assert.equal(result.activeCredits.length, 2);
}

void runAppServerReadTest()
  .then(() => {
    console.log("quota-reset tests passed");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
