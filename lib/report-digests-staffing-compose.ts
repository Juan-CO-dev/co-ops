/**
 * Digest staffing lines (digests round 3, PR 2) — the ONE wording of the published 7shifts schedule in every digest.
 * PURE: facts in, lines out, zero I/O. The shop composer (lib/report-digests-v2-compose.ts) and the catering
 * composer (lib/report-digests-compose.ts) both call these builders, so a roster reads the same everywhere.
 *
 * THE RULE: every line built here carries `needs: "published_staffing"`. A builder never asks a role, a level or a
 * shop: `finishSection` cuts the line for a recipient Juan has not approved BEFORE anything is counted, so that
 * recipient's email is byte-identical whether the schedule loaded, is missing or failed (cut first, then count).
 *
 * Unknown is never zero: a schedule that did not load is ONE "Schedule not available" line (`unknown`), never
 * "No one scheduled"; clocked hours that are not known are "clocked hours not available" (`unknown`), never 0 h.
 * Names are first names only (the roster holds no last name and never a user id); times go through `formatTime`
 * (ET).
 */
import { formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { capItems } from "@/lib/report-digests-layout-shared";
import type { DigestLine } from "@/lib/report-digests-compose";
import type { DayRoster, RosterPerson, ShopSchedule } from "@/lib/report-digests-schedule-shared";
import type { Loaded } from "@/lib/report-digests-v2-shared";
import type { LaborSummary } from "@/lib/toast/labor-shared";

type Tr = (key: TranslationKey, params?: Record<string, string | number>) => string;
export interface StaffingCtx { t: Tr; language: Language }

/** Every staffing line needs this capability; the composers never decide it themselves. */
const NEEDS = "published_staffing" as const;

const plural = (c: StaffingCtx, n: number, one: TranslationKey, other: TranslationKey) => n === 1 ? c.t(one) : c.t(other, { n });

/**
 * The rosters of `days` from a loaded schedule, in that order; null = not available (the read was `unavailable` /
 * `error`, or a day the composer needs is missing from the answer — a missing day is unknown, never an empty day).
 */
export function scheduleDays(schedule: Loaded<ShopSchedule>, days: readonly string[]): DayRoster[] | null {
  if (schedule.kind !== "ok") return null;
  const out: DayRoster[] = [];
  for (const day of days) {
    const r = schedule.value.days.find((d) => d.day === day);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

const span = (c: StaffingCtx, startAt: string, endAt: string) =>
  c.t("digest.staffing.span", { start: formatTime(startAt, c.language), end: formatTime(endAt, c.language) });

/** "Person A 7:00 AM to 3:00 PM (Line) +1 shift": first name (or "unnamed"), the first shift, the role, the extras. */
function personText(c: StaffingCtx, p: RosterPerson): string {
  const name = p.firstName ?? c.t("digest.staffing.unnamed");
  return [
    `${name} ${span(c, p.startAt, p.endAt)}`,
    p.roleName ? `(${p.roleName})` : null,
    p.extraShifts > 0 ? plural(c, p.extraShifts, "digest.staffing.extra_one", "digest.staffing.extra_other") : null,
  ].filter((x): x is string => x !== null).join(" ");
}

/**
 * "Staff scheduled" for one shop and one day:
 * `6 people · 7:00 AM to 9:30 PM · Person A 7:00 AM to 3:00 PM (Line), … +1 · 1 open shift`. No assigned shift =
 * "No one scheduled" (+ the open-shift count). An open shift is a to-do (`attention`); otherwise `info`.
 * `href`: today's lines open reconcile → stations (the caller's chain); tomorrow's roster has no screen (null).
 */
export function staffScheduledLine(c: StaffingCtx, day: DayRoster, href: string | null): DigestLine {
  const open = day.openShifts > 0 ? plural(c, day.openShifts, "digest.staffing.open_one", "digest.staffing.open_other") : null;
  const parts = day.people.length === 0 || day.firstStart === null || day.lastEnd === null
    ? [c.t("digest.staffing.none"), open]
    : [
      plural(c, day.people.length, "digest.staffing.people_one", "digest.staffing.people_other"),
      span(c, day.firstStart, day.lastEnd),
      capItems(day.people.map((p) => personText(c, p))),
      open,
    ];
  return {
    label: c.t("digest.staffing.label"),
    text: parts.filter((x): x is string => x !== null).join(" · "),
    tone: day.openShifts > 0 ? "attention" : "info",
    href,
    needs: NEEDS,
  };
}

/** The ONE line per shop per digest when the schedule is not available: plain, unknown, no detail, no link. */
export function scheduleNotAvailableLine(c: StaffingCtx): DigestLine {
  return { label: c.t("digest.staffing.label"), text: c.t("digest.staffing.not_available"), tone: "info", href: null, unknown: true, needs: NEEDS };
}

/** Hours with exactly one decimal, localized. */
export function staffingHours(language: Language, hours: number): string {
  return new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(hours);
}

/**
 * clocked − scheduled of the two figures AS PRINTED (each rounded to tenths first, so the line's own arithmetic
 * holds): "+4.5", "−1.0" (a true minus sign), "0.0" (never "−0.0").
 */
function signedDiff(language: Language, clockedHours: number, scheduledHours: number): string {
  const tenths = Math.round(clockedHours * 10) - Math.round(scheduledHours * 10);
  if (tenths === 0) return staffingHours(language, 0);
  return `${tenths > 0 ? "+" : "−"}${staffingHours(language, Math.abs(tenths) / 10)}`;
}

/**
 * "Scheduled vs worked" for day D (the Labor section). The scheduled half is the roster's assigned shifts that START
 * on D, before breaks. The clocked half, from `labor`:
 *   1. ok, no open clock-in and no shift of unknown hours → "Clocked X h (Toast business day) (+4.5 h)";
 *   2. ok with an open clock-in or a shift of unknown hours → "Clocked X h so far (Toast business day)", no difference;
 *   3. absent, `unavailable` or `error` → "clocked hours not available", and the line is `unknown`.
 */
export function scheduledVsWorkedLine(c: StaffingCtx, day: DayRoster, labor: Loaded<LaborSummary> | undefined, href: string | null): DigestLine {
  const scheduled = c.t("digest.staffing.scheduled", { hours: staffingHours(c.language, day.scheduledMinutes / 60) });
  const label = c.t("digest.staffing.vs_label");
  if (!labor || labor.kind !== "ok") {
    return { label, text: [scheduled, c.t("digest.staffing.clocked_unknown")].join(" · "), tone: "info", href, unknown: true, needs: NEEDS };
  }
  const s = labor.value;
  const clocked = staffingHours(c.language, s.totalHours);
  const complete = s.openEntries === 0 && s.unknownHoursEntries === 0;
  const worked = complete
    ? `${c.t("digest.staffing.clocked", { hours: clocked })} ${c.t("digest.staffing.diff", { diff: signedDiff(c.language, s.totalHours, day.scheduledMinutes / 60) })}`
    : c.t("digest.staffing.clocked_so_far", { hours: clocked });
  return { label, text: [scheduled, worked].join(" · "), tone: "info", href, needs: NEEDS };
}
