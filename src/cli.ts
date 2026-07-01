#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { analyzeQuotaObservations } from "./quota-reset.js";
import type { QuotaCycleObservation } from "./contracts.js";

function printUsage() {
  console.log("用法：codex-usage inspect-reset <snapshot.json>");
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
          rechargeEvents?: unknown[];
        };
      }>;
    };
  };

  const resetEvents = source.ledger?.weeklyPeriods?.flatMap((period) =>
    (period.quotaEvidence?.resetEvents ?? []).map((event) => event)
  );
  const rechargeEvents = source.ledger?.weeklyPeriods?.flatMap((period) =>
    (period.quotaEvidence?.rechargeEvents ?? []).map((event) => event)
  );

  if ((resetEvents && resetEvents.length > 0) || (rechargeEvents && rechargeEvents.length > 0)) {
    console.log(
      JSON.stringify({ resetEvents: resetEvents ?? [], rechargeEvents: rechargeEvents ?? [] }, null, 2)
    );
    return [];
  }

  return [];
}

const [, , command, target] = process.argv;

if (command !== "inspect-reset" || !target) {
  printUsage();
  process.exitCode = 1;
} else {
  const snapshot = JSON.parse(readFileSync(target, "utf8")) as unknown;
  const observations = collectObservationsFromSnapshot(snapshot);
  if (observations.length > 0) {
    console.log(JSON.stringify(analyzeQuotaObservations(observations, { comparisonScope: "timeline" }), null, 2));
  }
}
