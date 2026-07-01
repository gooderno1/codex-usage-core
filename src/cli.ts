#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readCodexAccountRateLimits } from "./banked-reset-credits.js";
import { analyzeQuotaObservations } from "./quota-reset.js";
import type { QuotaCycleObservation } from "./contracts.js";

function printUsage() {
  console.log("用法：");
  console.log("  codex-usage inspect-reset <snapshot.json>");
  console.log("  codex-usage inspect-banked-reset");
}

function collectObservationsFromSnapshot(snapshot: unknown): QuotaCycleObservation[] {
  const source = snapshot as {
    overview?: {
      windowPeriods?: {
        weekLimit?: {
          quotaEvidence?: {
            usageSegments?: unknown[];
          };
        };
      };
    };
    ledger?: {
      weeklyPeriods?: Array<{
        quotaEvidence?: {
          resetEvents?: unknown[];
        };
      }>;
    };
  };

  const resetEvents = source.ledger?.weeklyPeriods?.flatMap((period) =>
    (period.quotaEvidence?.resetEvents ?? []).map((event) => event)
  );

  if (resetEvents && resetEvents.length > 0) {
    console.log(JSON.stringify({ resetEvents }, null, 2));
    return [];
  }

  return [];
}

async function main() {
  const [, , command, target] = process.argv;

  if (command === "inspect-banked-reset") {
    console.log(JSON.stringify(await readCodexAccountRateLimits(), null, 2));
    return;
  }

  if (command !== "inspect-reset" || !target) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const snapshot = JSON.parse(readFileSync(target, "utf8")) as unknown;
  const observations = collectObservationsFromSnapshot(snapshot);
  if (observations.length > 0) {
    console.log(JSON.stringify(analyzeQuotaObservations(observations, { comparisonScope: "timeline" }), null, 2));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
