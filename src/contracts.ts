export type QuotaResetComparisonScope = "session" | "timeline";

export interface QuotaCycleObservation {
  observedAt: string;
  usedPercent: number;
  resetsAt: string | null;
  windowMinutes: number | null;
  sourceId?: string | null;
}

export interface QuotaResetEvidence {
  highWaterEvidence: boolean;
  boundaryAlignedEvidence: boolean;
  stabilizedBoundaryEvidence?: boolean;
  evidenceTypes: string[];
  afterBoundaryAt: string | null;
  afterWindowMinutes: number | null;
  lookbackWindowMs?: number;
  lookbackObservedAt?: string;
}

export interface QuotaResetConfirmation {
  status: "confirmed" | "rejected";
  reason:
    | "stable-window-boundary"
    | "invalid-boundary"
    | "missing-stable-window-confirmation"
    | "window-boundary-drifted";
  checkedObservationCount?: number;
  stableObservationCount?: number;
  confirmationAfterMs?: number;
  confirmationWindowMs?: number;
  firstStableObservedAt?: string;
  lastStableObservedAt?: string;
  stableBoundaryAt?: string | null;
  firstDriftObservedAt?: string;
  firstDriftBoundaryAt?: string | null;
}

export interface QuotaResetEvent {
  at: string;
  beforeObservedAt: string;
  beforeUsedPercent: number;
  afterUsedPercent: number;
  beforeWindowResetsAt: string | null;
  afterWindowResetsAt: string | null;
  beforeWindowMinutes?: number | null;
  afterWindowMinutes?: number | null;
  sourceId?: string | null;
  beforeSourceId?: string | null;
  comparisonScope?: QuotaResetComparisonScope;
  evidence?: QuotaResetEvidence;
  confirmation?: QuotaResetConfirmation;
  boundaryAt?: string | null;
}

export interface QuotaUsageSegment {
  usedPercent: number;
  maxObservedAt: string;
  startAt: string;
  endAt: string;
  windowStartedAt?: string | null;
  expiresAt?: string | null;
  startedByResetAt?: string | null;
  closedByResetAt?: string | null;
}

export interface QuotaAnalysisOptions {
  comparisonScope?: QuotaResetComparisonScope;
  dropThresholdPercent?: number;
  highWaterPercent?: number;
  lookbackWindowMs?: number;
  dedupeWindowMs?: number;
  boundarySnapWindowMs?: number;
  confirmationDelayMs?: number;
  confirmationWindowMs?: number;
  boundaryDriftToleranceMs?: number;
}

export interface QuotaAnalysisResult {
  cumulativeUsedPercent: number | null;
  resetCount: number;
  resetEvents: QuotaResetEvent[];
  usageSegments: QuotaUsageSegment[];
}

export interface CodexRateLimitWindowSnapshot {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: string | null;
  resetsAtUnixSeconds?: number | null;
}

export interface CodexCreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexRateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: CodexRateLimitWindowSnapshot | null;
  secondary: CodexRateLimitWindowSnapshot | null;
  credits: CodexCreditsSnapshot | null;
  rateLimitReachedType: string | null;
}

export interface CodexRateLimitResetCreditsSummary {
  availableCount: number;
}

export interface CodexAccountRateLimitsSnapshot {
  observedAt: string;
  source: "codex-app-server";
  rateLimitResetCredits: CodexRateLimitResetCreditsSummary | null;
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
}

export interface CodexAccountRateLimitsReadOptions {
  command?: string;
  args?: string[];
  shell?: boolean;
  timeoutMs?: number;
  observedAt?: string;
  clientName?: string;
  clientVersion?: string;
}

export interface BankedResetCreditObservation {
  observedAt: string;
  availableCount: number;
  rateLimits?: CodexRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
  sourceId?: string | null;
}

export interface BankedResetCreditAnalysisOptions {
  validityDays?: number;
  expirationSafetyMarginDays?: number;
}

export type BankedResetCreditEventKind = "grant" | "use" | "expiration" | "decrease-unknown";
export type BankedResetCreditActiveCreditBasis = "observed-grant" | "existing-at-first-observation";

export interface BankedResetCreditEventEvidence {
  beforeAvailableCount: number;
  afterAvailableCount: number;
  resetObserved: boolean;
  affectedLimitIds: string[];
  estimatedFromGrant?: boolean;
}

export interface BankedResetCreditEvent {
  kind: BankedResetCreditEventKind;
  at: string;
  count: number;
  beforeAvailableCount: number;
  afterAvailableCount: number;
  estimatedExpiresAt?: string | null;
  sourceId?: string | null;
  evidence: BankedResetCreditEventEvidence;
}

export interface BankedResetCreditActiveCredit {
  id: string;
  acquiredAt: string | null;
  firstObservedAt: string;
  estimatedExpiresAt: string | null;
  safeEstimatedExpiresAt: string | null;
  estimateBasis: BankedResetCreditActiveCreditBasis;
  sourceId?: string | null;
}

export interface BankedResetCreditAnalysisResult {
  currentAvailableCount: number | null;
  inferredGrantCount: number;
  inferredUseCount: number;
  inferredExpirationCount: number;
  inferredUnknownDecreaseCount: number;
  nextEstimatedExpiresAt: string | null;
  nextSafeEstimatedExpiresAt: string | null;
  activeCredits: BankedResetCreditActiveCredit[];
  events: BankedResetCreditEvent[];
}
