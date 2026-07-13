import { spawn } from "node:child_process";
import type {
  BankedResetCreditAnalysisOptions,
  BankedResetCreditAnalysisResult,
  BankedResetCreditActiveCredit,
  BankedResetCreditActiveCreditBasis,
  BankedResetCreditActiveCreditBaseline,
  BankedResetCreditEvent,
  BankedResetCreditInitialGrantSeed,
  BankedResetCreditObservation,
  BankedResetCreditPublicGrantSeed,
  CodexAccountRateLimitsReadOptions,
  CodexAccountRateLimitsSnapshot,
  CodexCreditsSnapshot,
  CodexRateLimitResetCredit,
  CodexRateLimitResetCreditStatus,
  CodexRateLimitResetCreditsSummary,
  CodexRateLimitSnapshot,
  CodexRateLimitWindowSnapshot
} from "./contracts.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_VALIDITY_DAYS = 30;
const DEFAULT_EXPIRATION_SAFETY_MARGIN_DAYS = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_BANKED_RESET_CREDIT_PUBLIC_GRANT_SEEDS: BankedResetCreditPublicGrantSeed[] = [
  {
    id: "codex-banking-launch-free-reset-2026-06-11",
    grantedAt: "2026-06-11T00:00:00.000Z",
    sourceId: "openai-codex-app-26.609-launch",
    matchByDefault: false
  },
  {
    id: "codex-usage-incident-compensation-2026-06-30",
    grantedAt: "2026-06-30T00:00:00.000Z",
    sourceId: "public-codex-usage-incident-compensation"
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toIsoStringOrNull(valueMs: number | null) {
  return valueMs === null ? null : new Date(valueMs).toISOString();
}

function normalizeUnixSeconds(value: unknown) {
  const seconds = numberOrNull(value);
  if (seconds === null) {
    return { iso: null, seconds: null };
  }

  return {
    iso: new Date(seconds * 1000).toISOString(),
    seconds
  };
}

function normalizeWindow(raw: unknown): CodexRateLimitWindowSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }

  const usedPercent = numberOrNull(raw.usedPercent);
  if (usedPercent === null) {
    return null;
  }

  const resetsAt = normalizeUnixSeconds(raw.resetsAt);
  return {
    usedPercent,
    windowDurationMins: numberOrNull(raw.windowDurationMins),
    resetsAt: resetsAt.iso,
    resetsAtUnixSeconds: resetsAt.seconds
  };
}

function normalizeCredits(raw: unknown): CodexCreditsSnapshot | null {
  if (!isRecord(raw) || typeof raw.hasCredits !== "boolean" || typeof raw.unlimited !== "boolean") {
    return null;
  }

  return {
    hasCredits: raw.hasCredits,
    unlimited: raw.unlimited,
    balance: stringOrNull(raw.balance)
  };
}

function normalizeRateLimitSnapshot(raw: unknown): CodexRateLimitSnapshot {
  if (!isRecord(raw)) {
    throw new Error("account/rateLimits/read 响应缺少 rateLimits 对象");
  }

  return {
    limitId: stringOrNull(raw.limitId),
    limitName: stringOrNull(raw.limitName),
    planType: stringOrNull(raw.planType),
    primary: normalizeWindow(raw.primary),
    secondary: normalizeWindow(raw.secondary),
    credits: normalizeCredits(raw.credits),
    rateLimitReachedType: stringOrNull(raw.rateLimitReachedType)
  };
}

function normalizeResetCredits(raw: unknown): CodexRateLimitResetCreditsSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const availableCount = numberOrNull(raw.availableCount);
  if (availableCount === null) {
    return null;
  }

  const credits = raw.credits === null || raw.credits === undefined
    ? null
    : Array.isArray(raw.credits)
      ? raw.credits.map(normalizeResetCredit).filter((credit): credit is CodexRateLimitResetCredit => credit !== null)
      : null;
  return { availableCount, credits };
}

function normalizeResetCreditStatus(value: unknown): CodexRateLimitResetCreditStatus {
  return value === "available" || value === "redeeming" || value === "redeemed" ? value : "unknown";
}

function normalizeResetCredit(raw: unknown): CodexRateLimitResetCredit | null {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    return null;
  }

  const grantedAt = normalizeUnixSeconds(raw.grantedAt);
  if (grantedAt.iso === null || grantedAt.seconds === null) {
    return null;
  }
  const expiresAt = raw.expiresAt === null ? { iso: null, seconds: null } : normalizeUnixSeconds(raw.expiresAt);

  return {
    id: raw.id,
    resetType: raw.resetType === "codexRateLimits" ? "codexRateLimits" : "unknown",
    status: normalizeResetCreditStatus(raw.status),
    grantedAt: grantedAt.iso,
    grantedAtUnixSeconds: grantedAt.seconds,
    expiresAt: expiresAt.iso,
    expiresAtUnixSeconds: expiresAt.seconds,
    title: stringOrNull(raw.title),
    description: stringOrNull(raw.description)
  };
}

function normalizeRateLimitsByLimitId(raw: unknown): Record<string, CodexRateLimitSnapshot> | null {
  if (!isRecord(raw)) {
    return null;
  }

  const entries = Object.entries(raw).map(([limitId, value]) => [limitId, normalizeRateLimitSnapshot(value)] as const);
  return Object.fromEntries(entries);
}

export function normalizeCodexAccountRateLimitsReadResult(
  result: unknown,
  observedAt = new Date().toISOString()
): CodexAccountRateLimitsSnapshot {
  if (!isRecord(result)) {
    throw new Error("account/rateLimits/read 响应不是对象");
  }

  return {
    observedAt,
    source: "codex-app-server",
    rateLimitResetCredits: normalizeResetCredits(result.rateLimitResetCredits),
    rateLimits: normalizeRateLimitSnapshot(result.rateLimits),
    rateLimitsByLimitId: normalizeRateLimitsByLimitId(result.rateLimitsByLimitId)
  };
}

export function createBankedResetCreditObservationFromSnapshot(
  snapshot: CodexAccountRateLimitsSnapshot,
  sourceId: string | null = null
): BankedResetCreditObservation {
  return {
    observedAt: snapshot.observedAt,
    availableCount: snapshot.rateLimitResetCredits?.availableCount ?? 0,
    officialCredits: snapshot.rateLimitResetCredits?.credits ?? null,
    rateLimits: snapshot.rateLimits,
    rateLimitsByLimitId: snapshot.rateLimitsByLimitId,
    sourceId
  };
}

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

export function readCodexAccountRateLimits(
  options: CodexAccountRateLimitsReadOptions = {}
): Promise<CodexAccountRateLimitsSnapshot> {
  const command = options.command ?? "codex";
  const args = options.args ?? ["app-server", "--stdio"];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const clientName = options.clientName ?? "codex-usage-core";
  const clientVersion = options.clientVersion ?? "0.0.0";
  const useShell = options.shell ?? (process.platform === "win32" && command === "codex");
  const spawnCommand = useShell ? [command, ...args].join(" ") : command;
  const spawnArgs = useShell ? [] : args;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spawnCommand, spawnArgs, {
        shell: useShell,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let sentReadRequest = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const finish = (snapshot: CodexAccountRateLimitsSnapshot) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(snapshot);
    };

    const timeout = setTimeout(() => {
      fail(new Error(`读取 Codex app-server rate limits 超时：${timeoutMs}ms`));
    }, timeoutMs);

    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const handleLine = (line: string) => {
      if (!line.startsWith("{")) {
        return;
      }

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        return;
      }

      if (message.id === 1 && message.result && !sentReadRequest) {
        sentReadRequest = true;
        send({ id: 2, method: "account/rateLimits/read", params: null });
        return;
      }

      if (message.id !== 2) {
        return;
      }

      if (message.error) {
        fail(new Error(`account/rateLimits/read 失败：${JSON.stringify(message.error)}`));
        return;
      }

      try {
        finish(normalizeCodexAccountRateLimitsReadResult(message.result, observedAt));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      if (stderrBuffer.length > 4000) {
        stderrBuffer = stderrBuffer.slice(-4000);
      }
    });

    child.on("error", (error) => fail(error));
    child.on("exit", (code) => {
      if (!settled) {
        fail(new Error(`Codex app-server 在返回 rate limits 前退出：code=${code}, stderr=${stderrBuffer.trim()}`));
      }
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: clientName,
          version: clientVersion
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: []
        }
      }
    });
  });
}

function parseIsoMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function windowWasReset(
  previous: CodexRateLimitWindowSnapshot | null | undefined,
  current: CodexRateLimitWindowSnapshot | null | undefined
) {
  if (!previous || !current) {
    return false;
  }

  const previousResetMs = parseIsoMs(previous.resetsAt);
  const currentResetMs = parseIsoMs(current.resetsAt);
  return (
    previousResetMs !== null &&
    currentResetMs !== null &&
    currentResetMs > previousResetMs &&
    current.usedPercent < previous.usedPercent
  );
}

function collectRateLimitBuckets(observation: BankedResetCreditObservation) {
  const buckets = new Map<string, CodexRateLimitSnapshot>();
  if (observation.rateLimits?.limitId) {
    buckets.set(observation.rateLimits.limitId, observation.rateLimits);
  } else if (observation.rateLimits) {
    buckets.set("default", observation.rateLimits);
  }

  for (const [limitId, snapshot] of Object.entries(observation.rateLimitsByLimitId ?? {})) {
    buckets.set(limitId, snapshot);
  }

  return buckets;
}

function getAffectedLimitIds(previous: BankedResetCreditObservation, current: BankedResetCreditObservation) {
  const affected = new Set<string>();
  const previousBuckets = collectRateLimitBuckets(previous);
  const currentBuckets = collectRateLimitBuckets(current);
  const limitIds = new Set([...previousBuckets.keys(), ...currentBuckets.keys()]);

  for (const limitId of limitIds) {
    const before = previousBuckets.get(limitId);
    const after = currentBuckets.get(limitId);
    if (windowWasReset(before?.primary, after?.primary) || windowWasReset(before?.secondary, after?.secondary)) {
      affected.add(limitId);
    }
  }

  return [...affected].sort();
}

interface EstimatedCredit extends BankedResetCreditActiveCredit {
  estimatedExpiresAtMs: number;
  safeEstimatedExpiresAtMs: number;
}

function creditSortTime(credit: EstimatedCredit) {
  return credit.safeEstimatedExpiresAtMs;
}

function sortEstimatedCredits(credits: EstimatedCredit[]) {
  credits.sort((a, b) => {
    const expiresDiff = creditSortTime(a) - creditSortTime(b);
    if (expiresDiff !== 0) {
      return expiresDiff;
    }

    return new Date(a.firstObservedAt).getTime() - new Date(b.firstObservedAt).getTime();
  });
}

function removeEstimatedCredits(credits: EstimatedCredit[], count: number, expiredOnly: boolean, nowMs: number) {
  let remaining = count;
  sortEstimatedCredits(credits);

  for (let index = 0; index < credits.length && remaining > 0; ) {
    const credit = credits[index];
    if (!credit) {
      break;
    }

    if (expiredOnly && credit.estimatedExpiresAtMs > nowMs) {
      index += 1;
      continue;
    }

    credits.splice(index, 1);
    remaining -= 1;
  }
}

function createKnownCredit(
  acquiredAt: string,
  firstObservedAt: string,
  grantIndex: number | string,
  validityMs: number,
  safetyMarginMs: number,
  sourceId: string | null | undefined,
  estimateBasis: Exclude<BankedResetCreditActiveCreditBasis, "existing-at-first-observation"> = "observed-grant"
): EstimatedCredit | null {
  const acquiredMs = parseIsoMs(acquiredAt);
  const firstObservedMs = parseIsoMs(firstObservedAt);
  if (acquiredMs === null || firstObservedMs === null) {
    return null;
  }

  const estimatedExpiresAtMs = acquiredMs + validityMs;
  const safeFloorMs = estimateBasis === "public-grant" ? firstObservedMs : acquiredMs;
  const safeEstimatedExpiresAtMs = Math.min(
    estimatedExpiresAtMs,
    Math.max(safeFloorMs, estimatedExpiresAtMs - safetyMarginMs)
  );

  return {
    id: `${estimateBasis}:${acquiredAt}:${grantIndex}`,
    acquiredAt,
    firstObservedAt,
    expiresAt: new Date(estimatedExpiresAtMs).toISOString(),
    expiryBasis: "estimated",
    estimatedExpiresAt: new Date(estimatedExpiresAtMs).toISOString(),
    safeEstimatedExpiresAt: new Date(safeEstimatedExpiresAtMs).toISOString(),
    estimatedExpiresAtMs,
    safeEstimatedExpiresAtMs,
    estimateBasis,
    sourceId: sourceId ?? null
  };
}

function createInitialSeedCredits(
  firstObservation: BankedResetCreditObservation,
  validityMs: number,
  safetyMarginMs: number,
  initialGrantSeeds: BankedResetCreditInitialGrantSeed[]
) {
  const firstObservedMs = parseIsoMs(firstObservation.observedAt);
  if (firstObservedMs === null) {
    return [];
  }

  return initialGrantSeeds
    .flatMap((seed) => {
      const count = Math.max(0, Math.trunc(seed.count ?? 1));
      return Array.from({ length: count }, (_, index) => ({ seed, index }));
    })
    .map(({ seed, index }) => {
      const acquiredMs = parseIsoMs(seed.acquiredAt);
      if (acquiredMs === null || acquiredMs > firstObservedMs || acquiredMs + validityMs <= firstObservedMs) {
        return null;
      }

      const grantIndex = seed.count && seed.count > 1 ? `${seed.id}:${index + 1}` : seed.id;
      return createKnownCredit(
        seed.acquiredAt,
        firstObservation.observedAt,
        grantIndex,
        validityMs,
        safetyMarginMs,
        seed.sourceId ?? firstObservation.sourceId,
        seed.estimateBasis ?? "assumed-grant"
      );
    })
    .filter((credit): credit is EstimatedCredit => credit !== null)
    .sort((a, b) => a.estimatedExpiresAtMs - b.estimatedExpiresAtMs);
}

function createPublicSeedCredits(
  firstObservation: BankedResetCreditObservation,
  validityMs: number,
  safetyMarginMs: number,
  publicGrantSeeds: BankedResetCreditPublicGrantSeed[]
) {
  const firstObservedMs = parseIsoMs(firstObservation.observedAt);
  if (firstObservedMs === null) {
    return [];
  }

  return publicGrantSeeds
    .filter((seed) => seed.matchByDefault !== false)
    .map((seed) => {
      const grantedMs = parseIsoMs(seed.grantedAt);
      if (grantedMs === null || grantedMs > firstObservedMs || grantedMs + validityMs <= firstObservedMs) {
        return null;
      }

      return createKnownCredit(
        seed.grantedAt,
        firstObservation.observedAt,
        seed.id,
        validityMs,
        safetyMarginMs,
        seed.sourceId ?? firstObservation.sourceId,
        "public-grant"
      );
    })
    .filter((credit): credit is EstimatedCredit => credit !== null)
    .sort((a, b) => a.estimatedExpiresAtMs - b.estimatedExpiresAtMs);
}

function createSeedCredits(
  firstObservation: BankedResetCreditObservation,
  validityMs: number,
  safetyMarginMs: number,
  publicGrantSeeds: BankedResetCreditPublicGrantSeed[],
  initialGrantSeeds: BankedResetCreditInitialGrantSeed[]
) {
  const credits = [
    ...createInitialSeedCredits(firstObservation, validityMs, safetyMarginMs, initialGrantSeeds),
    ...createPublicSeedCredits(firstObservation, validityMs, safetyMarginMs, publicGrantSeeds)
  ];
  const deduped = new Map<string, EstimatedCredit>();
  for (const credit of credits) {
    const key = `${credit.estimateBasis}:${credit.acquiredAt}:${credit.sourceId ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, credit);
    }
  }

  return [...deduped.values()].sort((a, b) => a.estimatedExpiresAtMs - b.estimatedExpiresAtMs);
}

function createExistingCredit(
  observedAt: string,
  creditIndex: number,
  sourceId: string | null | undefined
): EstimatedCredit | null {
  const observedMs = parseIsoMs(observedAt);
  if (observedMs === null) {
    return null;
  }

  return {
    id: `existing:${observedAt}:${creditIndex}`,
    acquiredAt: null,
    firstObservedAt: observedAt,
    expiresAt: null,
    expiryBasis: "unknown",
    estimatedExpiresAt: null,
    safeEstimatedExpiresAt: observedAt,
    estimatedExpiresAtMs: Number.POSITIVE_INFINITY,
    safeEstimatedExpiresAtMs: observedMs,
    estimateBasis: "existing-at-first-observation",
    sourceId: sourceId ?? null
  };
}

function restoreBaselineCredit(credit: BankedResetCreditActiveCredit): EstimatedCredit | null {
  const firstObservedMs = parseIsoMs(credit.firstObservedAt);
  if (firstObservedMs === null) {
    return null;
  }

  if (credit.estimateBasis === "existing-at-first-observation") {
    return {
      ...credit,
      acquiredAt: null,
      expiresAt: null,
      expiryBasis: "unknown",
      estimatedExpiresAt: null,
      safeEstimatedExpiresAt: credit.safeEstimatedExpiresAt ?? credit.firstObservedAt,
      estimatedExpiresAtMs: Number.POSITIVE_INFINITY,
      safeEstimatedExpiresAtMs: parseIsoMs(credit.safeEstimatedExpiresAt) ?? firstObservedMs
    };
  }

  const estimatedExpiresAtMs = parseIsoMs(credit.expiresAt ?? credit.estimatedExpiresAt);
  if (parseIsoMs(credit.acquiredAt) === null || estimatedExpiresAtMs === null) {
    return null;
  }

  return {
    ...credit,
    acquiredAt: credit.acquiredAt,
    expiresAt: credit.expiresAt ?? credit.estimatedExpiresAt,
    estimatedExpiresAt: credit.estimatedExpiresAt,
    safeEstimatedExpiresAt: credit.safeEstimatedExpiresAt ?? credit.estimatedExpiresAt,
    estimatedExpiresAtMs,
    safeEstimatedExpiresAtMs: parseIsoMs(credit.safeEstimatedExpiresAt) ?? estimatedExpiresAtMs
  };
}

function publicGrantCreditIsAllowed(credit: EstimatedCredit, publicGrantSeeds: BankedResetCreditPublicGrantSeed[]) {
  if (credit.estimateBasis !== "public-grant") {
    return true;
  }

  const matchingSeed = publicGrantSeeds.find(
    (seed) => seed.grantedAt === credit.acquiredAt || credit.id.includes(seed.id)
  );
  return matchingSeed ? matchingSeed.matchByDefault !== false : true;
}

function normalizeBaselineCredits(
  baseline: BankedResetCreditActiveCreditBaseline,
  targetCount: number,
  validityMs: number,
  safetyMarginMs: number,
  publicGrantSeeds: BankedResetCreditPublicGrantSeed[],
  initialGrantSeeds: BankedResetCreditInitialGrantSeed[]
) {
  const baselineObservation: BankedResetCreditObservation = {
    observedAt: baseline.observedAt,
    availableCount: targetCount,
    sourceId: "active-credit-baseline"
  };
  const knownSeedCredits = createSeedCredits(
    baselineObservation,
    validityMs,
    safetyMarginMs,
    publicGrantSeeds,
    initialGrantSeeds
  );
  const restored = baseline.activeCredits
    .map(restoreBaselineCredit)
    .filter((credit): credit is EstimatedCredit => credit !== null)
    .filter((credit) => publicGrantCreditIsAllowed(credit, publicGrantSeeds));
  const knownKeys = new Set(
    restored
      .filter((credit) => credit.estimateBasis !== "existing-at-first-observation")
      .map((credit) => `${credit.estimateBasis}:${credit.acquiredAt}:${credit.sourceId ?? ""}`)
  );

  for (const seedCredit of knownSeedCredits) {
    const key = `${seedCredit.estimateBasis}:${seedCredit.acquiredAt}:${seedCredit.sourceId ?? ""}`;
    if (knownKeys.has(key)) {
      continue;
    }

    const existingIndex = restored.findIndex((credit) => credit.estimateBasis === "existing-at-first-observation");
    if (existingIndex >= 0) {
      restored.splice(existingIndex, 1, seedCredit);
      knownKeys.add(key);
    } else if (restored.length < targetCount) {
      restored.push(seedCredit);
      knownKeys.add(key);
    }
  }

  while (restored.length < targetCount) {
    const credit = createExistingCredit(baseline.observedAt, restored.length + 1, "active-credit-baseline");
    if (!credit) {
      break;
    }
    restored.push(credit);
  }

  return restored.slice(0, targetCount);
}

function createBaselineState(
  baseline: BankedResetCreditActiveCreditBaseline | undefined,
  ordered: BankedResetCreditObservation[],
  validityMs: number,
  safetyMarginMs: number,
  publicGrantSeeds: BankedResetCreditPublicGrantSeed[],
  initialGrantSeeds: BankedResetCreditInitialGrantSeed[]
): { timeline: BankedResetCreditObservation[]; startIndex: number; activeCredits: EstimatedCredit[] } | null {
  const baselineMs = parseIsoMs(baseline?.observedAt);
  if (!baseline || ordered.length === 0 || baselineMs === null) {
    return null;
  }

  const exactIndex = ordered.findIndex((observation) => observation.observedAt === baseline.observedAt);
  const targetCount =
    exactIndex >= 0 ? ordered[exactIndex]?.availableCount ?? baseline.activeCredits.length : baseline.activeCredits.length;
  const activeCredits = normalizeBaselineCredits(
    baseline,
    targetCount,
    validityMs,
    safetyMarginMs,
    publicGrantSeeds,
    initialGrantSeeds
  );

  if (activeCredits.length !== targetCount) {
    return null;
  }

  if (exactIndex >= 0) {
    return {
      timeline: ordered,
      startIndex: exactIndex + 1,
      activeCredits
    };
  }

  const timeline = [
    {
      observedAt: baseline.observedAt,
      availableCount: activeCredits.length,
      sourceId: "active-credit-baseline"
    },
    ...ordered.filter((observation) => {
      const observedMs = parseIsoMs(observation.observedAt);
      return observedMs !== null && observedMs > baselineMs;
    })
  ];

  return {
    timeline,
    startIndex: 1,
    activeCredits
  };
}

function serializeActiveCredit(credit: EstimatedCredit): BankedResetCreditActiveCredit {
  return {
    id: credit.id,
    acquiredAt: credit.acquiredAt,
    firstObservedAt: credit.firstObservedAt,
    expiresAt: credit.expiresAt,
    expiryBasis: credit.expiryBasis,
    estimatedExpiresAt: credit.estimatedExpiresAt,
    safeEstimatedExpiresAt: credit.safeEstimatedExpiresAt,
    estimateBasis: credit.estimateBasis,
    sourceId: credit.sourceId ?? null,
    resetType: credit.resetType ?? null,
    status: credit.status ?? null,
    title: credit.title ?? null,
    description: credit.description ?? null
  };
}

function createOfficialCredit(
  credit: CodexRateLimitResetCredit,
  observedAt: string
): EstimatedCredit | null {
  const grantedAtMs = parseIsoMs(credit.grantedAt);
  const observedAtMs = parseIsoMs(observedAt);
  const expiresAtMs = parseIsoMs(credit.expiresAt);
  if (grantedAtMs === null || observedAtMs === null) {
    return null;
  }

  return {
    id: credit.id,
    acquiredAt: credit.grantedAt,
    firstObservedAt: observedAt,
    expiresAt: credit.expiresAt,
    expiryBasis: "official",
    estimatedExpiresAt: null,
    safeEstimatedExpiresAt: null,
    estimatedExpiresAtMs: expiresAtMs ?? Number.POSITIVE_INFINITY,
    safeEstimatedExpiresAtMs: expiresAtMs ?? Number.POSITIVE_INFINITY,
    estimateBasis: "official-detail",
    sourceId: "codex-app-server-official-detail",
    resetType: credit.resetType,
    status: credit.status,
    title: credit.title,
    description: credit.description
  };
}

export function analyzeBankedResetCreditObservations(
  observations: BankedResetCreditObservation[],
  options: BankedResetCreditAnalysisOptions = {}
): BankedResetCreditAnalysisResult {
  const validityMs = (options.validityDays ?? DEFAULT_VALIDITY_DAYS) * MS_PER_DAY;
  const safetyMarginMs =
    Math.max(0, options.expirationSafetyMarginDays ?? DEFAULT_EXPIRATION_SAFETY_MARGIN_DAYS) * MS_PER_DAY;
  const publicGrantSeeds = options.publicGrantSeeds ?? DEFAULT_BANKED_RESET_CREDIT_PUBLIC_GRANT_SEEDS;
  const initialGrantSeeds = options.initialGrantSeeds ?? [];
  const ordered = observations
    .filter((observation) => Number.isFinite(new Date(observation.observedAt).getTime()))
    .slice()
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());

  const events: BankedResetCreditEvent[] = [];
  const estimatedCredits: EstimatedCredit[] = [];
  const baselineState = createBaselineState(
    options.activeCreditBaseline,
    ordered,
    validityMs,
    safetyMarginMs,
    publicGrantSeeds,
    initialGrantSeeds
  );
  const timeline = baselineState?.timeline ?? ordered;
  const startIndex = Math.max(1, baselineState?.startIndex ?? 1);

  if (baselineState) {
    estimatedCredits.push(...baselineState.activeCredits);
  } else {
    const firstObservation = timeline[0];
    if (firstObservation) {
      const seedCredits = createSeedCredits(
        firstObservation,
        validityMs,
        safetyMarginMs,
        publicGrantSeeds,
        initialGrantSeeds
      ).slice(0, firstObservation.availableCount);
      estimatedCredits.push(...seedCredits);

      for (let index = seedCredits.length; index < firstObservation.availableCount; index += 1) {
        const credit = createExistingCredit(
          firstObservation.observedAt,
          index - seedCredits.length + 1,
          firstObservation.sourceId
        );
        if (credit) {
          estimatedCredits.push(credit);
        }
      }
    }
  }

  for (let index = startIndex; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    if (!previous || !current) {
      continue;
    }

    const delta = current.availableCount - previous.availableCount;
    const currentMs = new Date(current.observedAt).getTime();

    if (delta > 0) {
      const estimatedExpiresAt = toIsoStringOrNull(currentMs + validityMs);
      if (estimatedExpiresAt) {
        for (let creditIndex = 0; creditIndex < delta; creditIndex += 1) {
          const credit = createKnownCredit(
            current.observedAt,
            current.observedAt,
            creditIndex + 1,
            validityMs,
            safetyMarginMs,
            current.sourceId,
            "observed-grant"
          );
          if (credit) {
            estimatedCredits.push(credit);
          }
        }
      }

      events.push({
        kind: "grant",
        at: current.observedAt,
        count: delta,
        beforeAvailableCount: previous.availableCount,
        afterAvailableCount: current.availableCount,
        estimatedExpiresAt,
        sourceId: current.sourceId ?? null,
        evidence: {
          beforeAvailableCount: previous.availableCount,
          afterAvailableCount: current.availableCount,
          resetObserved: false,
          affectedLimitIds: [],
          estimatedFromGrant: true
        }
      });
      continue;
    }

    if (delta >= 0) {
      continue;
    }

    const decreaseCount = Math.abs(delta);
    const affectedLimitIds = getAffectedLimitIds(previous, current);
    const resetObserved = affectedLimitIds.length > 0;
    const expiredCredits = estimatedCredits.filter((credit) => credit.estimatedExpiresAtMs <= currentMs).length;
    const kind = resetObserved ? "use" : expiredCredits >= decreaseCount ? "expiration" : "decrease-unknown";

    if (kind === "expiration") {
      removeEstimatedCredits(estimatedCredits, decreaseCount, true, currentMs);
    } else {
      removeEstimatedCredits(estimatedCredits, decreaseCount, false, currentMs);
    }

    events.push({
      kind,
      at: current.observedAt,
      count: decreaseCount,
      beforeAvailableCount: previous.availableCount,
      afterAvailableCount: current.availableCount,
      sourceId: current.sourceId ?? null,
      evidence: {
        beforeAvailableCount: previous.availableCount,
        afterAvailableCount: current.availableCount,
        resetObserved,
        affectedLimitIds
      }
    });
  }

  const latestObservation = ordered.at(-1);
  const latestObservedMs = parseIsoMs(latestObservation?.observedAt ?? null) ?? Date.now();
  const officialCredits = latestObservation?.officialCredits?.map((credit) => createOfficialCredit(credit, latestObservation.observedAt))
    .filter((credit): credit is EstimatedCredit => credit !== null) ?? [];
  const officialIds = new Set(officialCredits.map((credit) => credit.id));
  const inferredRemainder = estimatedCredits.filter((credit) => !officialIds.has(credit.id)).slice(officialCredits.length);
  const reconciledCredits = latestObservation?.officialCredits === null || latestObservation?.officialCredits === undefined
    ? estimatedCredits
    : [...officialCredits, ...inferredRemainder].slice(0, latestObservation.availableCount);
  const activeExpirations = estimatedCredits
    .filter((credit) => credit.estimatedExpiresAtMs > latestObservedMs)
    .sort((a, b) => a.estimatedExpiresAtMs - b.estimatedExpiresAtMs);
  const activeSafeExpirations = estimatedCredits
    .filter((credit) => credit.safeEstimatedExpiresAtMs > latestObservedMs)
    .sort((a, b) => a.safeEstimatedExpiresAtMs - b.safeEstimatedExpiresAtMs);
  const activeCredits = reconciledCredits.slice();
  sortEstimatedCredits(activeCredits);
  const nextOfficialExpiresAt = officialCredits
    .map((credit) => credit.expiresAt)
    .filter((value): value is string => value !== null)
    .sort()[0] ?? null;
  const nextEstimatedExpiresAt = activeExpirations[0]?.estimatedExpiresAt ?? null;

  return {
    currentAvailableCount: ordered.at(-1)?.availableCount ?? null,
    inferredGrantCount: events.filter((event) => event.kind === "grant").reduce((sum, event) => sum + event.count, 0),
    inferredUseCount: events.filter((event) => event.kind === "use").reduce((sum, event) => sum + event.count, 0),
    inferredExpirationCount: events
      .filter((event) => event.kind === "expiration")
      .reduce((sum, event) => sum + event.count, 0),
    inferredUnknownDecreaseCount: events
      .filter((event) => event.kind === "decrease-unknown")
      .reduce((sum, event) => sum + event.count, 0),
    nextEstimatedExpiresAt,
    nextSafeEstimatedExpiresAt: activeSafeExpirations[0]?.safeEstimatedExpiresAt ?? null,
    nextExpiresAt: nextOfficialExpiresAt ?? nextEstimatedExpiresAt,
    nextExpiryBasis: nextOfficialExpiresAt ? "official" : nextEstimatedExpiresAt ? "estimated" : null,
    officialDetailCount: officialCredits.length,
    officialDetailsComplete:
      latestObservation?.officialCredits !== null &&
      latestObservation?.officialCredits !== undefined &&
      officialCredits.length === (latestObservation?.availableCount ?? 0),
    activeCredits: activeCredits.map(serializeActiveCredit),
    events
  };
}
