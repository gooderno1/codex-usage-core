import type { CodexQuotaWindowKind } from "./contracts.js";

export const CODEX_FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
export const CODEX_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const CODEX_WINDOW_DURATION_TOLERANCE_MINUTES = 60;

function normalizeWindowMinutes(value: unknown) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function isCodexQuotaWindowDuration(
  windowMinutes: unknown,
  expectedWindowMinutes: number,
  toleranceMinutes = CODEX_WINDOW_DURATION_TOLERANCE_MINUTES
) {
  const normalizedWindowMinutes = normalizeWindowMinutes(windowMinutes);
  const normalizedExpectedWindowMinutes = normalizeWindowMinutes(expectedWindowMinutes);
  const normalizedToleranceMinutes = Math.max(0, Number(toleranceMinutes));
  return (
    normalizedWindowMinutes !== null &&
    normalizedExpectedWindowMinutes !== null &&
    Number.isFinite(normalizedToleranceMinutes) &&
    Math.abs(normalizedWindowMinutes - normalizedExpectedWindowMinutes) <= normalizedToleranceMinutes
  );
}

export function classifyCodexQuotaWindowDuration(windowMinutes: unknown): CodexQuotaWindowKind {
  if (isCodexQuotaWindowDuration(windowMinutes, CODEX_FIVE_HOUR_WINDOW_MINUTES)) {
    return "five-hour";
  }

  if (isCodexQuotaWindowDuration(windowMinutes, CODEX_WEEKLY_WINDOW_MINUTES)) {
    return "weekly";
  }

  return "unknown";
}

export function quotaWindowDurationsMatch(left: unknown, right: unknown) {
  const normalizedLeft = normalizeWindowMinutes(left);
  const normalizedRight = normalizeWindowMinutes(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}
