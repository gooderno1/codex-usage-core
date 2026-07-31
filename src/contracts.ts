export type QuotaResetComparisonScope = "session" | "timeline";
export type CodexQuotaWindowKind = "five-hour" | "weekly" | "unknown";

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
  credits: CodexRateLimitResetCredit[] | null;
}

export type CodexRateLimitResetType = "codexRateLimits" | "unknown";
export type CodexRateLimitResetCreditStatus = "available" | "redeeming" | "redeemed" | "unknown";

export interface CodexRateLimitResetCredit {
  id: string;
  resetType: CodexRateLimitResetType;
  status: CodexRateLimitResetCreditStatus;
  grantedAt: string;
  grantedAtUnixSeconds: number;
  expiresAt: string | null;
  expiresAtUnixSeconds: number | null;
  title: string | null;
  description: string | null;
}

export interface CodexAccountRateLimitsSnapshot {
  observedAt: string;
  source: "codex-app-server" | "codex-wham-usage";
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

export interface CodexUsageRateLimitsReadOptions {
  authPath?: string;
  codexHome?: string;
  endpoint?: string;
  timeoutMs?: number;
  observedAt?: string;
  clientVersion?: string;
  useEnvProxy?: boolean;
}

export interface BankedResetCreditObservation {
  observedAt: string;
  availableCount: number;
  officialCredits?: CodexRateLimitResetCredit[] | null;
  rateLimits?: CodexRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
  sourceId?: string | null;
}

export interface BankedResetCreditAnalysisOptions {
  validityDays?: number;
  expirationSafetyMarginDays?: number;
  publicGrantSeeds?: BankedResetCreditPublicGrantSeed[];
  initialGrantSeeds?: BankedResetCreditInitialGrantSeed[];
  activeCreditBaseline?: BankedResetCreditActiveCreditBaseline;
}

export type BankedResetCreditEventKind = "grant" | "use" | "expiration" | "decrease-unknown";
export type BankedResetCreditActiveCreditBasis =
  | "official-detail"
  | "observed-grant"
  | "public-grant"
  | "assumed-grant"
  | "existing-at-first-observation";
export type BankedResetCreditInitialGrantBasis = "observed-grant" | "assumed-grant";

export interface BankedResetCreditPublicGrantSeed {
  id: string;
  grantedAt: string;
  sourceId?: string | null;
  matchByDefault?: boolean;
}

export interface BankedResetCreditInitialGrantSeed {
  id: string;
  acquiredAt: string;
  sourceId?: string | null;
  count?: number;
  estimateBasis?: BankedResetCreditInitialGrantBasis;
}

export interface BankedResetCreditActiveCreditBaseline {
  observedAt: string;
  activeCredits: BankedResetCreditActiveCredit[];
}

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
  expiresAt: string | null;
  expiryBasis: "official" | "estimated" | "unknown";
  estimatedExpiresAt: string | null;
  safeEstimatedExpiresAt: string | null;
  estimateBasis: BankedResetCreditActiveCreditBasis;
  resetType?: CodexRateLimitResetType | null;
  status?: CodexRateLimitResetCreditStatus | null;
  title?: string | null;
  description?: string | null;
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
  nextExpiresAt: string | null;
  nextExpiryBasis: "official" | "estimated" | null;
  officialDetailCount: number;
  officialDetailsComplete: boolean;
  activeCredits: BankedResetCreditActiveCredit[];
  events: BankedResetCreditEvent[];
}
