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
  startedByRechargeAt?: string | null;
  closedByRechargeAt?: string | null;
}

export interface QuotaRechargeEvent {
  rechargeIndex: number;
  at: string;
  windowStartedAt: string | null;
  expiresAt: string | null;
  windowMinutes: number | null;
  afterUsedPercent: number;
  previousWindowStartedAt: string | null;
  previousExpiresAt: string | null;
  previousUsedPercent: number;
  previousUsageStartedAt: string;
  previousUsageEndedAt: string;
  previousMaxObservedAt: string;
  sourceId?: string | null;
  beforeSourceId?: string | null;
  comparisonScope?: QuotaResetComparisonScope;
  evidence?: QuotaResetEvidence;
  confirmation?: QuotaResetConfirmation;
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
  rechargeCount: number;
  rechargeEvents: QuotaRechargeEvent[];
  usageSegments: QuotaUsageSegment[];
}
