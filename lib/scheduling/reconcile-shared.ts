/**
 * THE THREE-WAY RECONCILIATION — pure (Scheduling Phase 2, Task 25; spec §8.0; plan J24, r2 P2-11).
 *
 * Before 7shifts carries the schedule, Toast is the interim people source: who clocked in, when, for how long. This view
 * lines up, per shop, the three identities a person has — the CO-OPS user (THE ANCHOR), the Toast employee, the 7shifts
 * user — and what each source says they did.
 *
 *  - NOTHING LINKS BY NAME. A Toast employee joins a person only through an ACTIVE `toast_employee_links` row at this
 *    shop (0233), a 7shifts user only through an ACTIVE `sevenshifts_user_links` row (0269, manual only). Two people
 *    with the same first name stay two rows; an unlinked Toast clock-in shows its FIRST name only (0224 keeps nothing
 *    more) and is never attached to anyone.
 *  - ATTENDANCE IS JUDGED AGAINST THE SCHEDULE PEOPLE FOLLOW. When the shop has PUBLISHED mirrored 7shifts shifts for a
 *    date (`draft === false`, not deleted — a draft or a null draft flag is never "published") and the person is linked,
 *    the comparison is "against the published 7shifts schedule": `shift_no_punch` (a published shift no Toast or
 *    7shifts punch overlaps) and `punch_no_shift` (a punch no published shift overlaps). A follower of the published
 *    schedule therefore never gets `punch_no_shift`, whatever the CO-OPS proposal said.
 *  - Otherwise the day is "against the CO-OPS proposal (not published)": a difference is INFORMATIONAL
 *    (`proposal_differs`, never `punch_no_shift` / `shift_no_punch`), and the missing evidence is named
 *    (`seven_not_connected` · `shop_not_linked` · `person_not_linked` · `no_published_shifts`). A date with no CO-OPS
 *    proposal at all is not compared.
 *  - `sources_disagree`: 7shifts punch hours vs Toast hours differ by more than 15 min for the same person-day. Toast
 *    stays the backup source of actual hours.
 *
 * Every flag is a code from the closed `RECONCILE_FLAG_CODES` (en + es under `schedule.reconcile.flag.*`); params are
 * raw (ISO instants, hours, dates) and the page formats them. Zero I/O; reads no clock; never throws on valid input.
 */
import { etCalendarDate } from "@/lib/operational-day";
import { Q_MINUTES } from "./time-shared";

export const RECONCILE_FLAG_CODES = [
  "member_no_toast", "member_no_seven", "toast_clockin_no_user", "seven_user_unlinked",
  "shift_no_punch", "punch_no_shift", "proposal_differs", "sources_disagree",
] as const;
export type ReconcileFlagCode = (typeof RECONCILE_FLAG_CODES)[number];

/** Why a day could not be judged against a published schedule. */
export const RECONCILE_MISSING = ["seven_not_connected", "shop_not_linked", "person_not_linked", "no_published_shifts"] as const;
export type ReconcileMissing = (typeof RECONCILE_MISSING)[number];

/** A flag that is a fact about the record, never a question of attendance (shown, never counted as "needs a look"). */
export const INFORMATIONAL_FLAGS: readonly ReconcileFlagCode[] = ["proposal_differs"];

/** 7shifts as the 7shifts screen reports it; anything but `ready` reads "not connected" on the tick. */
export type SevenStatus = "ready" | "not_connected" | "sync_off" | "not_supported";

export interface ReconcileMember { userId: string; name: string }
export interface ToastLinkRow { employeeGuid: string; userId: string }
export interface SevenLinkRow { sevenUserId: string; userId: string }
export interface SevenUserAtShop { sevenUserId: string; displayName: string; employeeId: string | null }
/** A `toast_time_entries` row (0224): the first name only, never a wage. */
export interface ToastPunch { employeeGuid: string; firstName: string | null; businessDate: string; inAt: string; outAt: string | null; hours: number | null }
export interface SevenPunch { sevenUserId: string; clockedIn: string; clockedOut: string | null; breakMinutes: number | null }
export interface SevenShiftRow { sevenUserId: string | null; startAt: string; endAt: string; draft: boolean | null; deleted: boolean }
/** A shift of the CO-OPS head revision (ET wall-clock quarters on its business date). */
export interface ProposalShift { userId: string; date: string; startQ: number; endQ: number }

export interface ReconcileInput {
  /** The business dates compared (the last 14 operational days), ascending. */
  dates: string[];
  sevenStatus: SevenStatus;
  /** The shop has a live 7shifts location link. */
  shopLinkedToSeven: boolean;
  members: ReconcileMember[];
  toastLinks: ToastLinkRow[];
  sevenLinks: SevenLinkRow[];
  sevenUsersAtShop: SevenUserAtShop[];
  toastPunches14d: ToastPunch[];
  sevenPunches14d: SevenPunch[];
  publishedSevenShifts14d: SevenShiftRow[];
  coopsProposalShifts14d: ProposalShift[];
  /** The dates a CO-OPS head revision covers (a proposal exists for them, even with no shift for a person). */
  coopsProposalDates: string[];
}

export interface ReconcileFlag { code: ReconcileFlagCode; date?: string; params?: Record<string, string | number> }
export interface ReconcileDay {
  date: string;
  basis: "published" | "proposal_not_published";
  /** Why it is not judged against a published schedule; null when it is. */
  missing: ReconcileMissing | null;
  /** A CO-OPS proposal covers this date. */
  proposal: boolean;
  toastHours: number | null;
  sevenHours: number | null;
  flags: ReconcileFlag[];
}
export interface ReconcileRow {
  userId: string;
  name: string;
  ticks: { coops: true; toast: "linked" | "missing"; seven: "linked" | "missing" | "not_connected" };
  flags: ReconcileFlag[];
  days: ReconcileDay[];
}
export interface ToastUnlinkedRow { employeeGuid: string; firstName: string | null; punchDays: number; flags: ReconcileFlag[] }
export interface SevenUnlinkedRow { sevenUserId: string; displayName: string; employeeId: string | null; flags: ReconcileFlag[] }
export interface ReconcileView {
  rows: ReconcileRow[];
  toastUnlinked: ToastUnlinkedRow[];
  sevenUnlinked: SevenUnlinkedRow[];
  counts: { people: number; flagged: number; toastUnlinked: number; sevenUnlinked: number };
}

/** Over 15 minutes apart, the two sources disagree. */
export const SOURCES_DISAGREE_H = Q_MINUTES / 60;
/** An open punch (no clock-out yet) is a one-minute instant for overlap. */
const OPEN_PUNCH_MS = 60_000;

/** An interval in ms, with the ISO instants it came from (flags carry those, never a re-derived Date). */
interface Span { from: number; to: number; fromIso?: string; toIso?: string | null }
const overlaps = (a: Span, b: Span) => a.from < b.to && b.from < a.to;
const round2 = (n: number) => Math.round(n * 100) / 100;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
const isPublished = (s: SevenShiftRow) => s.draft === false && !s.deleted;

/** The instant of an ET wall-clock quarter on a business date: the date's ET midnight (via the calendar) + quarters. */
function quarterSpan(p: ProposalShift, etMidnightMs: (date: string) => number): Span {
  const base = etMidnightMs(p.date);
  return { from: base + p.startQ * Q_MINUTES * 60_000, to: base + p.endQ * Q_MINUTES * 60_000 };
}

/**
 * ET midnight of a business date, found without a clock: probe UTC 04:00 and 05:00 of that date (EDT / EST midnight)
 * and keep the one whose ET calendar date is the date at 00:00 ET. The shop day (7:00–21:00) never touches the DST hours.
 */
function etMidnightMs(date: string): number {
  const edt = Date.parse(`${date}T04:00:00.000Z`);
  const est = Date.parse(`${date}T05:00:00.000Z`);
  // 04:00Z is ET midnight under EDT; under EST it is 23:00 of the previous ET day.
  return etCalendarDate(`${date}T04:00:00.000Z`) === date ? edt : est;
}

export function reconcile(input: ReconcileInput): ReconcileView {
  const ready = input.sevenStatus === "ready";
  const dates = [...new Set(input.dates)].sort(cmp);
  const inWindow = new Set(dates);
  const toastUser = new Map(input.toastLinks.map((l) => [l.employeeGuid, l.userId]));
  const toastLinkedUsers = new Set(input.toastLinks.map((l) => l.userId));
  const sevenOf = new Map<string, string>(); // CO-OPS user → 7shifts user
  const sevenUserOf = new Map<string, string>(); // 7shifts user → CO-OPS user
  if (ready) for (const l of input.sevenLinks) { sevenOf.set(l.userId, l.sevenUserId); sevenUserOf.set(l.sevenUserId, l.userId); }
  const proposalDates = new Set(input.coopsProposalDates);

  // Published shifts (draft === false, not deleted) by their ET start date; the shop's published DATES.
  const published = ready && input.shopLinkedToSeven ? input.publishedSevenShifts14d.filter(isPublished) : [];
  const publishedDates = new Set(published.map((s) => etCalendarDate(s.startAt)));
  const pubBy = new Map<string, Span[]>(); // `${sevenUser}|${date}`
  for (const s of published) {
    if (s.sevenUserId === null) continue;
    const k = `${s.sevenUserId}|${etCalendarDate(s.startAt)}`;
    pubBy.set(k, [...(pubBy.get(k) ?? []), { from: Date.parse(s.startAt), to: Date.parse(s.endAt), fromIso: s.startAt, toIso: s.endAt }]);
  }

  // Punches by CO-OPS user and date. Toast through the link only (never by name); 7shifts through the link only.
  const punchSpans = new Map<string, Span[]>();
  const toastH = new Map<string, number>();
  const sevenH = new Map<string, number>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  const unlinkedToast = new Map<string, { firstName: string | null; days: Set<string> }>();
  for (const p of input.toastPunches14d) {
    if (!inWindow.has(p.businessDate)) continue;
    const userId = toastUser.get(p.employeeGuid);
    if (!userId) {
      const u = unlinkedToast.get(p.employeeGuid) ?? { firstName: p.firstName, days: new Set<string>() };
      u.days.add(p.businessDate);
      if (u.firstName === null && p.firstName !== null) u.firstName = p.firstName;
      unlinkedToast.set(p.employeeGuid, u);
      continue;
    }
    const from = Date.parse(p.inAt);
    const to = p.outAt === null ? from + OPEN_PUNCH_MS : Date.parse(p.outAt);
    const k = `${userId}|${p.businessDate}`;
    add(punchSpans, k, { from, to, fromIso: p.inAt, toIso: p.outAt });
    const h = p.hours !== null ? p.hours : p.outAt === null ? 0 : (to - from) / 3_600_000;
    toastH.set(k, (toastH.get(k) ?? 0) + h);
  }
  for (const p of input.sevenPunches14d) {
    const userId = sevenUserOf.get(p.sevenUserId);
    const date = etCalendarDate(p.clockedIn);
    if (!userId || !inWindow.has(date)) continue;
    const from = Date.parse(p.clockedIn);
    const to = p.clockedOut === null ? from + OPEN_PUNCH_MS : Date.parse(p.clockedOut);
    const k = `${userId}|${date}`;
    add(punchSpans, k, { from, to, fromIso: p.clockedIn, toIso: p.clockedOut });
    const h = p.clockedOut === null ? 0 : (to - from) / 3_600_000 - (p.breakMinutes ?? 0) / 60;
    sevenH.set(k, (sevenH.get(k) ?? 0) + Math.max(0, h));
  }
  const proposalBy = new Map<string, Span[]>();
  for (const s of input.coopsProposalShifts14d) {
    if (inWindow.has(s.date)) add(proposalBy, `${s.userId}|${s.date}`, quarterSpan(s, etMidnightMs));
  }

  const missingFor = (userId: string, date: string): ReconcileMissing | null => {
    if (!ready) return "seven_not_connected";
    if (!input.shopLinkedToSeven) return "shop_not_linked";
    if (!sevenOf.has(userId)) return "person_not_linked";
    if (!publishedDates.has(date)) return "no_published_shifts";
    return null;
  };

  const members = [...new Map(input.members.map((m) => [m.userId, m])).values()];
  const rows: ReconcileRow[] = members.map((m) => {
    const identity: ReconcileFlag[] = [];
    const hasToast = toastLinkedUsers.has(m.userId);
    const hasSeven = sevenOf.has(m.userId);
    if (!hasToast) identity.push({ code: "member_no_toast" });
    if (ready && !hasSeven) identity.push({ code: "member_no_seven" });
    const days: ReconcileDay[] = [];
    for (const date of dates) {
      const k = `${m.userId}|${date}`;
      const punches = [...(punchSpans.get(k) ?? [])].sort((a, b) => a.from - b.from || a.to - b.to);
      const seven = sevenOf.get(m.userId);
      const pub = seven ? [...(pubBy.get(`${seven}|${date}`) ?? [])].sort((a, b) => a.from - b.from || a.to - b.to) : [];
      const prop = [...(proposalBy.get(k) ?? [])].sort((a, b) => a.from - b.from || a.to - b.to);
      if (punches.length === 0 && pub.length === 0 && prop.length === 0) continue;
      const missing = missingFor(m.userId, date);
      const flags: ReconcileFlag[] = [];
      if (missing === null) {
        for (const s of pub) if (!punches.some((p) => overlaps(p, s))) {
          flags.push({ code: "shift_no_punch", date, params: { startAt: s.fromIso!, endAt: s.toIso! } });
        }
        for (const p of punches) if (!pub.some((s) => overlaps(p, s))) {
          flags.push({ code: "punch_no_shift", date, params: { inAt: p.fromIso!, ...(p.toIso ? { outAt: p.toIso } : {}) } });
        }
      } else if (proposalDates.has(date)) {
        const differs = prop.some((s) => !punches.some((p) => overlaps(p, s))) || punches.some((p) => !prop.some((s) => overlaps(p, s)));
        if (differs) flags.push({ code: "proposal_differs", date });
      }
      const tH = toastH.has(k) ? round2(toastH.get(k)!) : null;
      const sH = sevenH.has(k) ? round2(sevenH.get(k)!) : null;
      if (tH !== null && sH !== null && Math.abs(tH - sH) > SOURCES_DISAGREE_H + 1e-9) flags.push({ code: "sources_disagree", date, params: { toastHours: tH, sevenHours: sH } });
      days.push({ date, basis: missing === null ? "published" : "proposal_not_published", missing, proposal: proposalDates.has(date), toastHours: tH, sevenHours: sH, flags });
    }
    return {
      userId: m.userId, name: m.name,
      ticks: { coops: true, toast: hasToast ? "linked" : "missing", seven: !ready ? "not_connected" : hasSeven ? "linked" : "missing" },
      flags: [...identity, ...days.flatMap((d) => d.flags)],
      days,
    };
  });
  rows.sort((a, b) => Number(b.flags.length > 0) - Number(a.flags.length > 0) || byName(a.name, b.name) || cmp(a.userId, b.userId));

  const toastUnlinked: ToastUnlinkedRow[] = [...unlinkedToast]
    .map(([employeeGuid, u]) => ({ employeeGuid, firstName: u.firstName, punchDays: u.days.size, flags: [{ code: "toast_clockin_no_user" as const }] }))
    .sort((a, b) => byName(a.firstName ?? "", b.firstName ?? "") || cmp(a.employeeGuid, b.employeeGuid));
  const linkedSeven = new Set(input.sevenLinks.map((l) => l.sevenUserId));
  const sevenUnlinked: SevenUnlinkedRow[] = !ready || !input.shopLinkedToSeven ? [] : [...new Map(input.sevenUsersAtShop.map((u) => [u.sevenUserId, u])).values()]
    .filter((u) => !linkedSeven.has(u.sevenUserId))
    .map((u) => ({ sevenUserId: u.sevenUserId, displayName: u.displayName, employeeId: u.employeeId, flags: [{ code: "seven_user_unlinked" as const }] }))
    .sort((a, b) => byName(a.displayName, b.displayName) || cmp(a.sevenUserId, b.sevenUserId));

  return {
    rows, toastUnlinked, sevenUnlinked,
    counts: { people: rows.length, flagged: rows.filter((r) => r.flags.length > 0).length, toastUnlinked: toastUnlinked.length, sevenUnlinked: sevenUnlinked.length },
  };
}
