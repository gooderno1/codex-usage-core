import type {
  QuotaAnalysisOptions,
  QuotaAnalysisResult,
  QuotaCycleObservation,
  QuotaResetComparisonScope,
  QuotaResetConfirmation,
  QuotaResetEvent,
  QuotaResetEvidence,
  QuotaUsageSegment
} from "./contracts.js";
import { quotaWindowDurationsMatch } from "./quota-window.js";
import { isObservationBeforeResetWindow } from "./quota-current.js";

const DEFAULT_DROP_THRESHOLD_PERCENT = 5;
const DEFAULT_HIGH_WATER_PERCENT = 50;
const DEFAULT_LOOKBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const DEFAULT_BOUNDARY_SNAP_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CONFIRMATION_DELAY_MS = 30 * 60 * 1000;
const DEFAULT_CONFIRMATION_WINDOW_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BOUNDARY_DRIFT_TOLERANCE_MS = 15 * 60 * 1000;

type RequiredQuotaOptions = Required<QuotaAnalysisOptions>;

type QuotaResetCandidate = QuotaResetEvent & {
  evidence: QuotaResetEvidence;
  confirmation?: QuotaResetConfirmation;
};

interface TimedQuotaObservation {
  observation: QuotaCycleObservation;
  observedMs: number;
  boundaryMs: number;
}

function resolveOptions(options: QuotaAnalysisOptions = {}): RequiredQuotaOptions {
  return {
    comparisonScope: options.comparisonScope ?? "session",
    dropThresholdPercent: Number(options.dropThresholdPercent ?? DEFAULT_DROP_THRESHOLD_PERCENT),
    highWaterPercent: Number(options.highWaterPercent ?? DEFAULT_HIGH_WATER_PERCENT),
    lookbackWindowMs: Number(options.lookbackWindowMs ?? DEFAULT_LOOKBACK_WINDOW_MS),
    dedupeWindowMs: Number(options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS),
    boundarySnapWindowMs: Number(options.boundarySnapWindowMs ?? DEFAULT_BOUNDARY_SNAP_WINDOW_MS),
    confirmationDelayMs: Number(options.confirmationDelayMs ?? DEFAULT_CONFIRMATION_DELAY_MS),
    confirmationWindowMs: Number(options.confirmationWindowMs ?? DEFAULT_CONFIRMATION_WINDOW_MS),
    boundaryDriftToleranceMs: Number(
      options.boundaryDriftToleranceMs ?? DEFAULT_BOUNDARY_DRIFT_TOLERANCE_MS
    )
  };
}

function roundTo(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIsoStringOrNull(value: number) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function normalizeWindowMinutes(value: unknown) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function getQuotaObservationBoundaryMs(observation: QuotaCycleObservation) {
  if (!observation.resetsAt) {
    return Number.NaN;
  }

  const resetMs = new Date(observation.resetsAt).getTime();
  const windowMinutes = Number(observation.windowMinutes);
  const windowMs = windowMinutes * 60 * 1000;

  if (!Number.isFinite(resetMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    return Number.NaN;
  }

  return resetMs - windowMs;
}

function getQuotaResetObservationEvidence(
  previous: QuotaCycleObservation,
  current: QuotaCycleObservation,
  options: RequiredQuotaOptions
): QuotaResetEvidence | null {
  const previousResetMs = previous.resetsAt ? new Date(previous.resetsAt).getTime() : Number.NaN;
  const currentResetMs = current.resetsAt ? new Date(current.resetsAt).getTime() : Number.NaN;
  const currentObservedMs = new Date(current.observedAt).getTime();
  const afterBoundaryMs = getQuotaObservationBoundaryMs(current);

  if (
    !Number.isFinite(previous.usedPercent) ||
    !Number.isFinite(current.usedPercent) ||
    !Number.isFinite(previousResetMs) ||
    !Number.isFinite(currentResetMs) ||
    !quotaWindowDurationsMatch(previous.windowMinutes, current.windowMinutes)
  ) {
    return null;
  }

  const resetMovedForward = currentResetMs > previousResetMs + 60 * 1000;
  const droppedFromPrevious =
    previous.usedPercent - current.usedPercent >= options.dropThresholdPercent;
  const highWaterEvidence = previous.usedPercent >= options.highWaterPercent;
  const boundaryAlignedEvidence =
    Number.isFinite(currentObservedMs) &&
    Number.isFinite(afterBoundaryMs) &&
    Math.abs(currentObservedMs - afterBoundaryMs) <= options.boundarySnapWindowMs;

  if (!resetMovedForward || !droppedFromPrevious || (!highWaterEvidence && !boundaryAlignedEvidence)) {
    return null;
  }

  return {
    highWaterEvidence,
    boundaryAlignedEvidence,
    evidenceTypes: [
      highWaterEvidence ? "high-water-drop" : null,
      boundaryAlignedEvidence ? "boundary-aligned-drop" : null
    ].filter((item): item is string => Boolean(item)),
    afterBoundaryAt: toIsoStringOrNull(afterBoundaryMs),
    afterWindowMinutes: normalizeWindowMinutes(current.windowMinutes ?? previous.windowMinutes)
  };
}

function prepareQuotaObservationTiming(observation: QuotaCycleObservation): TimedQuotaObservation {
  return {
    observation,
    observedMs: new Date(observation.observedAt).getTime(),
    boundaryMs: getQuotaObservationBoundaryMs(observation)
  };
}

function findFirstTimedObservationIndex(timedObservations: TimedQuotaObservation[], targetMs: number) {
  let low = 0;
  let high = timedObservations.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const observedMs = timedObservations[middle]?.observedMs ?? Number.NaN;
    if (!Number.isFinite(observedMs) || observedMs < targetMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function confirmQuotaResetCandidate(
  candidate: QuotaResetCandidate,
  timedObservations: TimedQuotaObservation[],
  options: RequiredQuotaOptions,
  subsequentResets: QuotaResetEvent[] = []
): QuotaResetConfirmation {
  const candidateAtMs = new Date(candidate.at).getTime();
  const candidateBoundaryMs = candidate.evidence.afterBoundaryAt
    ? new Date(candidate.evidence.afterBoundaryAt).getTime()
    : Number.NaN;

  if (!Number.isFinite(candidateAtMs) || !Number.isFinite(candidateBoundaryMs)) {
    return {
      status: "rejected",
      reason: "invalid-boundary"
    };
  }

  const confirmationStartMs = candidateAtMs + options.confirmationDelayMs;
  const nextResetAt = subsequentResets
    .filter(event => Date.parse(event.at) > candidateAtMs &&
      Math.abs(Date.parse(event.beforeWindowResetsAt ?? "") - Date.parse(candidate.afterWindowResetsAt ?? "")) <= options.boundarySnapWindowMs &&
      Date.parse(event.boundaryAt ?? "") > candidateBoundaryMs + options.boundaryDriftToleranceMs)
    .reduce((end, event) => Math.min(end, Date.parse(event.at) - 1), Infinity);
  const confirmationEndMs = Math.min(candidateAtMs + options.confirmationWindowMs, nextResetAt);
  const postCandidateObservations: TimedQuotaObservation[] = [];
  for (
    let index = findFirstTimedObservationIndex(timedObservations, confirmationStartMs);
    index < timedObservations.length;
    index += 1
  ) {
    const item = timedObservations[index];
    if (!item || !Number.isFinite(item.observedMs) || !Number.isFinite(item.boundaryMs)) {
      continue;
    }

    if (item.observedMs > confirmationEndMs) {
      break;
    }

    // 旧窗口的迟到记录不构成新窗口漂移；不同窗口时长也不能参与确认。
    if (!quotaWindowDurationsMatch(item.observation.windowMinutes, candidate.afterWindowMinutes ?? null) ||
        isObservationBeforeResetWindow(item.observation, candidate, options.boundarySnapWindowMs)) continue;
    postCandidateObservations.push(item);
  }

  const stableObservations = postCandidateObservations.filter(
    (item) => Math.abs(item.boundaryMs - candidateBoundaryMs) <= options.boundarySnapWindowMs
  );
  const driftObservations = postCandidateObservations.filter(
    (item) => Math.abs(item.boundaryMs - candidateBoundaryMs) > options.boundaryDriftToleranceMs
  );

  if (stableObservations.length === 0) {
    return {
      status: "rejected",
      reason: "missing-stable-window-confirmation",
      checkedObservationCount: postCandidateObservations.length,
      confirmationAfterMs: options.confirmationDelayMs,
      confirmationWindowMs: options.confirmationWindowMs
    };
  }

  const firstDrift = driftObservations[0];
  if (firstDrift) {
    return {
      status: "rejected",
      reason: "window-boundary-drifted",
      checkedObservationCount: postCandidateObservations.length,
      stableObservationCount: stableObservations.length,
      firstDriftObservedAt: firstDrift.observation.observedAt,
      firstDriftBoundaryAt: toIsoStringOrNull(firstDrift.boundaryMs)
    };
  }

  const firstStable = stableObservations[0];
  return {
    status: "confirmed",
    reason: "stable-window-boundary",
    checkedObservationCount: postCandidateObservations.length,
    stableObservationCount: stableObservations.length,
    firstStableObservedAt: firstStable?.observation.observedAt,
    lastStableObservedAt: stableObservations.at(-1)?.observation.observedAt,
    stableBoundaryAt: toIsoStringOrNull(candidateBoundaryMs)
  };
}

export function sortQuotaResetObservationTimeline(observations: QuotaCycleObservation[]) {
  return observations
    .filter((item) => Number.isFinite(Date.parse(item.observedAt)) && Number.isFinite(item.usedPercent) && item.usedPercent >= 0 && item.usedPercent <= 100)
    .sort((left, right) => {
      const timeDiff = new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      const resetDiff =
        new Date(left.resetsAt ?? 0).getTime() - new Date(right.resetsAt ?? 0).getTime();
      if (resetDiff !== 0) {
        return resetDiff;
      }

      return right.usedPercent - left.usedPercent;
    });
}

function createQuotaResetCandidate(
  previous: QuotaCycleObservation,
  current: QuotaCycleObservation,
  evidence: QuotaResetEvidence,
  comparisonScope: QuotaResetComparisonScope
): QuotaResetCandidate {
  return {
    at: current.observedAt,
    beforeObservedAt: previous.observedAt,
    beforeUsedPercent: previous.usedPercent,
    afterUsedPercent: current.usedPercent,
    beforeWindowResetsAt: previous.resetsAt,
    afterWindowResetsAt: current.resetsAt,
    beforeWindowMinutes: normalizeWindowMinutes(previous.windowMinutes),
    afterWindowMinutes: normalizeWindowMinutes(current.windowMinutes ?? previous.windowMinutes),
    sourceId: current.sourceId,
    beforeSourceId: previous.sourceId,
    comparisonScope,
    evidence,
    boundaryAt: evidence.afterBoundaryAt
  };
}

function addQuotaResetCandidates(
  resetCandidates: QuotaResetCandidate[],
  observations: QuotaCycleObservation[],
  comparisonScope: QuotaResetComparisonScope,
  options: RequiredQuotaOptions
) {
  const sourceOrdered = sortQuotaResetObservationTimeline(observations);

  for (let index = 1; index < sourceOrdered.length; index += 1) {
    const previous = sourceOrdered[index - 1];
    const current = sourceOrdered[index];
    if (!previous || !current) {
      continue;
    }

    const evidence = getQuotaResetObservationEvidence(previous, current, options);
    if (!evidence) {
      continue;
    }

    resetCandidates.push(createQuotaResetCandidate(previous, current, evidence, comparisonScope));
  }
}

function addStabilizedBoundaryResetCandidates(
  resetCandidates: QuotaResetCandidate[],
  observations: QuotaCycleObservation[],
  comparisonScope: QuotaResetComparisonScope,
  options: RequiredQuotaOptions
) {
  const sourceOrdered = sortQuotaResetObservationTimeline(observations);

  for (let index = 1; index < sourceOrdered.length; index += 1) {
    const current = sourceOrdered[index];
    if (!current) {
      continue;
    }

    const currentObservedMs = new Date(current.observedAt).getTime();
    const currentResetMs = current.resetsAt ? new Date(current.resetsAt).getTime() : Number.NaN;
    const currentBoundaryMs = getQuotaObservationBoundaryMs(current);

    if (
      !Number.isFinite(current.usedPercent) ||
      !Number.isFinite(currentObservedMs) ||
      !Number.isFinite(currentResetMs) ||
      !Number.isFinite(currentBoundaryMs)
    ) {
      continue;
    }

    const lookbackStartMs = currentObservedMs - options.lookbackWindowMs;
    let bestPrevious: QuotaCycleObservation | null = null;

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = sourceOrdered[previousIndex];
      if (!previous) {
        continue;
      }

      const previousObservedMs = new Date(previous.observedAt).getTime();
      if (!Number.isFinite(previousObservedMs)) {
        continue;
      }

      if (previousObservedMs < lookbackStartMs) {
        break;
      }

      const previousResetMs = previous.resetsAt ? new Date(previous.resetsAt).getTime() : Number.NaN;
      const previousBoundaryMs = getQuotaObservationBoundaryMs(previous);
      if (
        !Number.isFinite(previous.usedPercent) ||
        !Number.isFinite(previousResetMs) ||
        !Number.isFinite(previousBoundaryMs) ||
        !quotaWindowDurationsMatch(previous.windowMinutes, current.windowMinutes)
      ) {
        continue;
      }

      const resetMovedForward = currentResetMs > previousResetMs + 60 * 1000;
      const boundaryMovedForward =
        currentBoundaryMs > previousBoundaryMs + options.boundaryDriftToleranceMs;
      if (!resetMovedForward || !boundaryMovedForward) {
        continue;
      }

      if (previous.usedPercent > (bestPrevious?.usedPercent ?? -1)) {
        bestPrevious = previous;
      }
    }

    if (
      !bestPrevious ||
      bestPrevious.usedPercent - current.usedPercent < options.dropThresholdPercent
    ) {
      continue;
    }

    resetCandidates.push(
      createQuotaResetCandidate(
        bestPrevious,
        current,
        {
          highWaterEvidence: bestPrevious.usedPercent >= options.highWaterPercent,
          boundaryAlignedEvidence: false,
          stabilizedBoundaryEvidence: true,
          evidenceTypes: ["stabilized-boundary-drop"],
          afterBoundaryAt: toIsoStringOrNull(currentBoundaryMs),
          afterWindowMinutes: normalizeWindowMinutes(current.windowMinutes ?? bestPrevious.windowMinutes),
          lookbackWindowMs: options.lookbackWindowMs,
          lookbackObservedAt: bestPrevious.observedAt
        },
        comparisonScope
      )
    );
  }
}

function getQuotaWindowStartedAt(
  resetsAt: string | null | undefined,
  windowMinutes: number | null | undefined
) {
  const resetMs = resetsAt ? new Date(resetsAt).getTime() : Number.NaN;
  const minutes = normalizeWindowMinutes(windowMinutes);
  if (!Number.isFinite(resetMs) || minutes === null) {
    return null;
  }

  return new Date(resetMs - minutes * 60 * 1000).toISOString();
}

function getQuotaObservationExpiresAt(observation: QuotaCycleObservation | null | undefined) {
  const resetMs = observation?.resetsAt ? new Date(observation.resetsAt).getTime() : Number.NaN;
  return Number.isFinite(resetMs) ? observation?.resetsAt ?? null : null;
}

function getQuotaObservationWindowStartedAt(
  observation: QuotaCycleObservation | null | undefined
) {
  return observation ? toIsoStringOrNull(getQuotaObservationBoundaryMs(observation)) : null;
}

function getResetWindowStartedAt(event: QuotaResetEvent) {
  return (
    event.boundaryAt ??
    event.evidence?.afterBoundaryAt ??
    getQuotaWindowStartedAt(
      event.afterWindowResetsAt,
      event.afterWindowMinutes ?? event.evidence?.afterWindowMinutes ?? null
    )
  );
}

function buildQuotaUsageSegments(
  ordered: QuotaCycleObservation[],
  resetEvents: QuotaResetEvent[]
) {
  const usageSegments: QuotaUsageSegment[] = [];

  if (resetEvents.length > 0) {
    for (let index = 0; index < resetEvents.length; index += 1) {
      const event = resetEvents[index];
      if (!event) {
        continue;
      }

      const previousReset = resetEvents[index - 1] ?? null;
      usageSegments.push({
        usedPercent: event.beforeUsedPercent,
        maxObservedAt: event.beforeObservedAt,
        startAt:
          index === 0
            ? ordered[0]?.observedAt ?? event.beforeObservedAt
            : previousReset?.at ?? event.beforeObservedAt,
        endAt: event.at,
        windowStartedAt:
          getQuotaWindowStartedAt(event.beforeWindowResetsAt, event.beforeWindowMinutes ?? null) ??
          (previousReset ? getResetWindowStartedAt(previousReset) : null),
        expiresAt: event.beforeWindowResetsAt,
        startedByResetAt: index === 0 ? null : previousReset?.at ?? null,
        closedByResetAt: event.at
      });
    }
  }

  if (resetEvents.length === 0) {
    const maxObservation = ordered.reduce<QuotaCycleObservation | null>(
      (best, item) => (item.usedPercent > (best?.usedPercent ?? -1) ? item : best),
      null
    );
    const latestObservation = ordered.at(-1);
    if (maxObservation) {
      usageSegments.push({
        usedPercent: maxObservation.usedPercent,
        maxObservedAt: maxObservation.observedAt,
        startAt: ordered[0]?.observedAt ?? maxObservation.observedAt,
        endAt: latestObservation?.observedAt ?? maxObservation.observedAt,
        windowStartedAt: getQuotaObservationWindowStartedAt(latestObservation),
        expiresAt: getQuotaObservationExpiresAt(latestObservation),
        startedByResetAt: null,
        closedByResetAt: null
      });
    }
  }

  const lastReset = resetEvents.at(-1);
  if (lastReset) {
    const lastResetWindowMs = new Date(lastReset.afterWindowResetsAt ?? 0).getTime();
    const postResetMax = ordered
      .filter((item) => {
        const itemResetMs = new Date(item.resetsAt ?? 0).getTime();
        return (
          new Date(item.observedAt).getTime() > new Date(lastReset.at).getTime() &&
          (!Number.isFinite(lastResetWindowMs) ||
            !Number.isFinite(itemResetMs) ||
            itemResetMs >= lastResetWindowMs - 60 * 1000)
        );
      })
      .reduce<QuotaCycleObservation | null>(
        (best, item) => (item.usedPercent > (best?.usedPercent ?? -1) ? item : best),
        null
      );
    if (postResetMax && postResetMax.usedPercent > 0) {
      usageSegments.push({
        usedPercent: postResetMax.usedPercent,
        maxObservedAt: postResetMax.observedAt,
        startAt: lastReset.at,
        endAt: ordered.at(-1)?.observedAt ?? postResetMax.observedAt,
        windowStartedAt: getResetWindowStartedAt(lastReset),
        expiresAt: lastReset.afterWindowResetsAt,
        startedByResetAt: lastReset.at,
        closedByResetAt: null
      });
    }
  }

  return usageSegments;
}

export function analyzeQuotaObservations(
  observations: QuotaCycleObservation[],
  rawOptions: QuotaAnalysisOptions = {}
): QuotaAnalysisResult {
  const options = resolveOptions(rawOptions);
  const comparisonScope = options.comparisonScope;
  const ordered = sortQuotaResetObservationTimeline(observations);
  const orderedTimings = ordered.map((observation) => prepareQuotaObservationTiming(observation));
  const resetCandidates: QuotaResetCandidate[] = [];

  if (comparisonScope === "timeline") {
    addQuotaResetCandidates(resetCandidates, ordered, "timeline", options);
    addStabilizedBoundaryResetCandidates(resetCandidates, ordered, "timeline", options);
  } else {
    const sourceGroups = new Map<string, QuotaCycleObservation[]>();
    for (const observation of ordered) {
      const sourceId = observation.sourceId ?? "__unknown__";
      const group = sourceGroups.get(sourceId) ?? [];
      group.push(observation);
      sourceGroups.set(sourceId, group);
    }

    for (const group of sourceGroups.values()) {
      addQuotaResetCandidates(resetCandidates, group, "session", options);
    }
  }

  // 从后向前确认，后一个已确认的独立 reset 是前一个确认区间的终点。
  const confirmedCandidates: QuotaResetEvent[] = [];
  for (const candidate of resetCandidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const confirmation = confirmQuotaResetCandidate(candidate, orderedTimings, options, confirmedCandidates);
    if (confirmation.status === "confirmed") confirmedCandidates.push({ ...candidate, confirmation });
  }

  const resetEvents: QuotaResetEvent[] = [];
  for (const candidate of confirmedCandidates.sort(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime()
  )) {
    const duplicate = resetEvents.some((event) => {
      const eventBoundaryMs = event.evidence?.afterBoundaryAt
        ? new Date(event.evidence.afterBoundaryAt).getTime()
        : Number.NaN;
      const candidateBoundaryMs = candidate.evidence?.afterBoundaryAt
        ? new Date(candidate.evidence.afterBoundaryAt).getTime()
        : Number.NaN;
      const sameWindowBoundary =
        Number.isFinite(eventBoundaryMs) &&
        Number.isFinite(candidateBoundaryMs) &&
        Math.abs(candidateBoundaryMs - eventBoundaryMs) <= options.boundaryDriftToleranceMs;

      // 只有相同窗口才去重，不能因时间接近和百分比相同合并两个独立 reset。
      return sameWindowBoundary;
    });

    if (!duplicate) {
      resetEvents.push(candidate);
    }
  }

  const usageSegments = buildQuotaUsageSegments(ordered, resetEvents);

  const cumulativeUsedPercent =
    usageSegments.length > 0
      ? roundTo(
          usageSegments.reduce((sum, segment) => sum + segment.usedPercent, 0),
          2
        )
      : null;

  return {
    cumulativeUsedPercent,
    resetCount: resetEvents.length,
    resetEvents,
    usageSegments
  };
}
