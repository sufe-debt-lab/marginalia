import type { Locale } from "@/i18n/messages.js";

/**
 * Compact relative timestamp for session lists — mirrors the design's
 * `现在 / 2h / 昨天 / 3d / 1w` meta tokens. `ts` is epoch milliseconds.
 */
export function relativeTime(ts: number, locale: Locale, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return locale === "zh" ? "现在" : "now";
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    return locale === "zh" ? `${n}分钟` : `${n}m`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return locale === "zh" ? `${n}小时` : `${n}h`;
  }
  const days = Math.floor(diff / day);
  if (days === 1) return locale === "zh" ? "昨天" : "1d";
  if (days < 7) return locale === "zh" ? `${days}天` : `${days}d`;
  const weeks = Math.floor(days / 7);
  return locale === "zh" ? `${weeks}周` : `${weeks}w`;
}
