/**
 * Canonical i18n + TZ-aware time formatter.
 *
 * Lifted from 6 duplicate inline copies (dashboard / closing-page /
 * AmPrepForm / ReportReferenceItem / closing-client / ChecklistItem) per
 * the AGENTS.md "Language-aware time/date formatting is the canonical
 * pattern" durable lesson hitting its 5-site lift threshold.
 *
 * Two architectural commitments enforced by this helper:
 *
 * 1. **Locale follows app language preference** (per SPEC_AMENDMENTS.md
 *    C.31 + AGENTS.md "Language-aware time/date formatting"). A
 *    Spanish-language user with an en-US browser locale should see
 *    Spanish-language time formatting matching their app preference,
 *    not browser default.
 *
 * 2. **TZ is explicitly the operational TZ, NOT the runtime default**
 *    (per Build #2 PR 2 Bug C diagnosis):
 *      - Server Components run on Vercel (UTC); without explicit
 *        timeZone, formatTime renders UTC time ("19:17 UTC" instead
 *        of "3:17 PM EDT"). Surfaced when Juan saw the dashboard
 *        AmPrepTile subtitle reading "Submitted at 7:17 PM by Juan"
 *        for a 3:17 PM EDT submission — 4-hour offset = EDT vs UTC.
 *      - Client Components run in the browser; without explicit
 *        timeZone, formatTime renders the browser's local TZ. Looks
 *        right for operators in DC (EDT matches operational TZ) but
 *        breaks the moment a manager logs in from another TZ
 *        (traveling, remote, etc.) — they would see local-not-
 *        operational time, breaking ops continuity.
 *
 *    Both surfaces fix uniformly by always passing
 *    `timeZone: OPERATIONAL_TZ`. The fix is per-deployment-context
 *    safe (server or client; UTC runtime or browser-local) and
 *    forward-compatible: when CO eventually expands beyond DC, the
 *    operational TZ becomes a per-location field on `locations` and
 *    this helper takes the TZ as a third argument. Until then,
 *    OPERATIONAL_TZ is the single hardcoded constant — same pattern
 *    as dashboard/page.tsx's existing OPERATIONAL_TZ usage for
 *    today/yesterday-date arithmetic.
 *
 * Usage:
 *   import { formatTime } from "@/lib/i18n/format";
 *   const t = formatTime(completion.completedAt, language);
 *   // → "3:17 PM" (en) / "3:17 p. m." (es) — always operational TZ
 */

import type { ChecklistChainEntry } from "@/lib/checklists";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";

/**
 * Operational TZ. Hardcoded to America/New_York while CO operates
 * exclusively in DC. When CO expands beyond DC, this becomes a
 * per-location field; the helper accepts a TZ argument and the
 * constant is used as a defensive fallback. Same locked-pattern
 * guidance as dashboard/page.tsx.
 */
const OPERATIONAL_TZ = "America/New_York";

/**
 * Format an ISO timestamp into a localized time string in the
 * operational timezone. Empty string on parse failure (defensive —
 * preserves the existing inline-helper behavior).
 *
 * @param iso        ISO 8601 timestamp (typically from a DB column
 *                   like `confirmedAt`, `completedAt`, etc.)
 * @param language   App language code; drives locale selection.
 *                   "es" → es-US; anything else → en-US (per the
 *                   established CO-OPS Spanish dialect choice).
 */
export function formatTime(iso: string, language: Language): string {
  try {
    return new Date(iso).toLocaleTimeString(
      language === "es" ? "es-US" : "en-US",
      { hour: "numeric", minute: "2-digit", timeZone: OPERATIONAL_TZ },
    );
  } catch {
    return "";
  }
}

/**
 * Format a YYYY-MM-DD date string into a localized short label
 * ("Tue, May 5" / "mar, 5 may"). Returns the input string verbatim on
 * parse failure (defensive — preserves the existing inline-helper
 * behavior).
 *
 * Lifted from 2 inline copies (dashboard / closing-page) per the AGENTS.md
 * "Language-aware time/date formatting" durable lesson hitting its 2-site
 * lift trigger. Closing-page version was hardcoded `"en-US"` (Spanish-UX
 * regression — Spanish users saw English-format dates on the historical
 * banner + no-instance view); this lift fixes it.
 *
 * Same architectural commitments as formatTime:
 *   - Locale follows app language preference (not browser default).
 *   - Date math is anchored to UTC at parse time and the formatter pins
 *     `timeZone: "UTC"` so the day boundary doesn't shift under
 *     locale-default conversion. YYYY-MM-DD has no intrinsic TZ; UTC is
 *     the safe canonical anchor (matches both prior inline implementations).
 *
 * @param yyyymmdd  Date string in YYYY-MM-DD form (DB `date` column shape).
 * @param language  App language code; "es" → es-US, anything else → en-US.
 *
 * Usage:
 *   import { formatDateLabel } from "@/lib/i18n/format";
 *   const label = formatDateLabel(state.todayDate, language);
 *   // → "Tue, May 5" (en) / "mar, 5 may" (es)
 */
export function formatDateLabel(yyyymmdd: string, language: Language): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const locale = language === "es" ? "es-US" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

/**
 * Translation function shape compatible with both serverT (lib/i18n/server.ts)
 * and the client-side t from useTranslation (lib/i18n/provider.tsx). Used by
 * formatChainAttribution so callers can supply either.
 */
type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

/**
 * C.46 A4 — chained-attribution string formatter.
 *
 * Renders the full chain (head + updates) as a single comma-separated string
 * suitable for banner display in AmPrepForm read-only / edit-mode banners and
 * for ReportReferenceItem closing-side rendering.
 *
 * Format:
 *   - 1 entry  → "Submitted by {name} at {time}"
 *   - 2+ entries → "Submitted by {name1} at {time1}, updated by {name2} at {time2}, ..."
 *
 * No Intl.ListFormat — chain isn't an "X, Y, and Z" conjunction; it's a
 * sequence with role-specific connector verbs. Per-segment translation keys
 * joined with ", " is the right pattern. Spanish punctuation in this context
 * uses ", " same as English; no locale-specific separator needed.
 *
 * Translation keys consumed (Phase 6 ships):
 *   - am_prep.attribution.original — "Submitted by {name} at {time}"
 *   - am_prep.attribution.update   — "updated by {name} at {time}"
 *
 * Returns empty string for an empty chain (defensive).
 */
export function formatChainAttribution(
  chain: ChecklistChainEntry[],
  language: Language,
  t: TranslateFn,
): string {
  if (chain.length === 0) return "";
  const segments = chain.map((entry, i) => {
    const time = formatTime(entry.submittedAt, language);
    return i === 0
      ? t("am_prep.attribution.original", { name: entry.submitterName, time })
      : t("am_prep.attribution.update", { name: entry.submitterName, time });
  });
  return segments.join(", ");
}
