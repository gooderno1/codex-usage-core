import type {
  QuotaAnalysisOptions,
  QuotaAnalysisResult,
  QuotaCycleObservation,
  QuotaResetComparisonScope,
  QuotaResetConfirmation,
  QuotaResetEvent,
  QuotaResetEvidence
} from "./contracts.js";

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
    !Number.isFinite(currentResetMs)
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
    afterWindowMinutes: Number(current.windowMinutes ?? previous.windowMinutes) || null
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
  options: RequiredQuotaOptions
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
  const confirmationEndMs = candidateAtMs + options.confirmationWindowMs;
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
    .filter((item) => item.observedAt && Number.isFinite(item.usedPercent))
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
    sourceId: current.sourceId,
    beforeSourceId: previous.sourceId,
    comparisonScope,
    evidence
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
        !Number.isFinite(previousBoundaryMs)
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
          afterWindowMinutes: Number(current.windowMinutes ?? bestPrevious.windowMinutes) || null,
          lookbackWindowMs: options.lookbackWindowMs,
          lookbackObservedAt: bestPrevious.observedAt
        },
        comparisonScope
      )
    );
  }
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

  const confirmedCandidates = resetCandidates
    .map((candidate) => ({
      ...candidate,
      confirmation: confirmQuotaResetCandidate(candidate, orderedTimings, options)
    }))
    .filter((candidate) => candidate.confirmation.status === "confirmed");

  const resetEvents: QuotaResetEvent[] = [];
  for (const candidate of confirmedCandidates.sort(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime()
  )) {
    const candidateAtMs = new Date(candidate.at).getTime();
    const duplicate = resetEvents.some((event) => {
      const eventAtMs = new Date(event.at).getTime();
      const eventBoundaryMs = event.evidence?.afterBoundaryAt
        ? new Date(event.evidence.afterBoundaryAt).getTime()
        : Number.NaN;
      const candidateBoundaryMs = candidate.evidence?.afterBoundaryAt
        ? new Date(candidate.evidence.afterBoundaryAt).getTime()
        : Number.NaN;
      const eventAfterResetMs = new Date(event.afterWindowResetsAt ?? 0).getTime();
      const candidateAfterResetMs = new Date(candidate.afterWindowResetsAt ?? 0).getTime();
      const sameWindowBoundary =
        Number.isFinite(eventBoundaryMs) &&
        Number.isFinite(candidateBoundaryMs) &&
        Math.abs(candidateBoundaryMs - eventBoundaryMs) <= options.boundaryDriftToleranceMs;

      if (sameWindowBoundary) {
        return true;
      }

      return (
        Number.isFinite(candidateAtMs) &&
        Number.isFinite(eventAtMs) &&
        Math.abs(candidateAtMs - eventAtMs) <= options.dedupeWindowMs &&
        Math.abs(candidate.beforeUsedPercent - event.beforeUsedPercent) <= 1 &&
        (!Number.isFinite(eventAfterResetMs) ||
          !Number.isFinite(candidateAfterResetMs) ||
          Math.abs(candidateAfterResetMs - eventAfterResetMs) <= options.dedupeWindowMs)
      );
    });

    if (!duplicate) {
      resetEvents.push(candidate);
    }
  }

  const usageSegments =
    resetEvents.length > 0
      ? resetEvents.map((event, index) => ({
          usedPercent: event.beforeUsedPercent,
          maxObservedAt: event.beforeObservedAt,
          startAt: index === 0 ? ordered[0]?.observedAt ?? event.beforeObservedAt : resetEvents[index - 1]?.at ?? event.beforeObservedAt,
          endAt: event.at
        }))
      : [];

  if (resetEvents.length === 0) {
    const maxObservation = ordered.reduce<QuotaCycleObservation | null>(
      (best, item) => (item.usedPercent > (best?.usedPercent ?? -1) ? item : best),
      null
    );
    if (maxObservation) {
      usageSegments.push({
        usedPercent: maxObservation.usedPercent,
        maxObservedAt: maxObservation.observedAt,
        startAt: ordered[0]?.observedAt ?? maxObservation.observedAt,
        endAt: ordered.at(-1)?.observedAt ?? maxObservation.observedAt
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
        endAt: ordered.at(-1)?.observedAt ?? postResetMax.observedAt
      });
    }
  }

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
