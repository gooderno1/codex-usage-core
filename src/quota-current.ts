import type { QuotaCycleObservation, QuotaResetEvent } from "./contracts.js";
import { quotaWindowDurationsMatch } from "./quota-window.js";

const CLOCK_TOLERANCE_MS = 5 * 60_000;

/** 当前值与历史消耗独立；过期、无效及不合理未来窗口不能作为当前额度。 */
export function resolveCurrentQuotaWindow(observation: QuotaCycleObservation, now: string) {
  const at = Date.parse(observation.observedAt);
  const end = Date.parse(observation.resetsAt ?? "");
  const nowMs = Date.parse(now);
  const minutes = observation.windowMinutes;
  if (!Number.isFinite(at) || !Number.isFinite(end) || !Number.isFinite(nowMs) ||
      minutes === null || !Number.isFinite(minutes) || minutes <= 0 ||
      !Number.isFinite(observation.usedPercent) || observation.usedPercent < 0 || observation.usedPercent > 100 ||
      end <= nowMs || at > nowMs + CLOCK_TOLERANCE_MS ||
      end - minutes * 60_000 > at + CLOCK_TOLERANCE_MS) return null;
  return {
    ...observation,
    resetsAt: new Date(end).toISOString(),
    startAt: new Date(end - minutes * 60_000).toISOString(),
    remainingPercent: 100 - observation.usedPercent
  };
}

/** 只比较同额度池/时长的观测；调用方须先隔离额度池。 */
export function selectLatestQuotaObservation(observations: QuotaCycleObservation[], now: string) {
  const valid = observations.filter(item => resolveCurrentQuotaWindow(item, now)).sort((a, b) =>
    Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
    Date.parse(a.resetsAt!) - Date.parse(b.resetsAt!) || b.usedPercent - a.usedPercent
  );
  if (valid.length === 0) return null;
  // 当前窗口身份先于写入时间；即使首次新观测已消耗很多、没有百分比下降，
  // 旧窗口也不能因迟到而复活。这不是历史 reset 检测，不应用其下降阈值。
  const newestEnd = Math.max(...valid.map(item => Date.parse(item.resetsAt!)));
  return valid.filter(item => Date.parse(item.resetsAt!) >= newestEnd - 60_000).at(-1) ?? null;
}

/** 窗口身份由截止时间和时长决定，记录时间不能将旧窗口变成新窗口。 */
export function quotaObservationMatchesWindow(left: QuotaCycleObservation, right: QuotaCycleObservation) {
  const leftEnd = Date.parse(left.resetsAt ?? "");
  const rightEnd = Date.parse(right.resetsAt ?? "");
  return Number.isFinite(leftEnd) && leftEnd === rightEnd &&
    quotaWindowDurationsMatch(left.windowMinutes, right.windowMinutes);
}

export function isObservationBeforeResetWindow(observation: QuotaCycleObservation, event: QuotaResetEvent, toleranceMs = CLOCK_TOLERANCE_MS) {
  if (!quotaWindowDurationsMatch(observation.windowMinutes, event.beforeWindowMinutes ?? event.afterWindowMinutes ?? null)) return false;
  const end = Date.parse(observation.resetsAt ?? "");
  const beforeDistance = Math.abs(end - Date.parse(event.beforeWindowResetsAt ?? ""));
  const afterDistance = Math.abs(end - Date.parse(event.afterWindowResetsAt ?? ""));
  return beforeDistance <= toleranceMs && beforeDistance < afterDistance;
}

/** 返回周期查找时间；原始观测与 Token 时间均不修改。 */
export function quotaObservationCycleTimestamp(observation: QuotaCycleObservation, events: QuotaResetEvent[]) {
  const event = events.find(item => item.confirmation?.status === "confirmed" &&
    Date.parse(observation.observedAt) >= Date.parse(item.boundaryAt ?? "") &&
    isObservationBeforeResetWindow(observation, item));
  return event ? new Date(Date.parse(event.boundaryAt!) - 1).toISOString() : observation.observedAt;
}

/** 当前窗口边界优先于历史推断，历史 reset 未确认不能把当前 Token 归到旧窗口。 */
export function anchorQuotaCycleBounds<T extends { key: string; startAt: string; endAt: string }>(
  timestamp: string, current: QuotaCycleObservation, historical: T | null
): T | { key: string; startAt: string; endAt: string } | null {
  const end = Date.parse(current.resetsAt ?? "");
  const start = end - (current.windowMinutes ?? 0) * 60_000;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || !Number.isFinite(end) || !(start < end)) return historical;
  const startAt = new Date(start).toISOString(), endAt = new Date(end).toISOString();
  if (time >= start && time < end) return { key: `${startAt}/${endAt}`, startAt, endAt };
  if (historical && time < start && Date.parse(historical.endAt) > start) {
    return { ...historical, key: `${historical.startAt}/${startAt}`, endAt: startAt };
  }
  return historical;
}
