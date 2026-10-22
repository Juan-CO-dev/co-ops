/**
 * PEOPLE INPUT — pure (Scheduling Phase 2, Task 5; plan "Data reality", J15, J16, J19).
 *
 * Three things, all zero-I/O:
 *   - `punchPatterns`: the usual Toast punch pattern per person × ISO weekday over the last `weeks` ISO
 *     weeks, with a PERSON-SPECIFIC denominator (r2 P2-10): `weeksObserved` counts only weeks since the
 *     person's first punch at the shop (or their membership, whichever is later) in which the SHOP had
 *     any punch that weekday — a closed holiday is not "didn't work".
 *   - `assumedAvailability`: ≥ 3 observed weeks and a share ≥ 25% → [p10 in − 30 min, p90 out + 30 min]
 *     snapped to the grid and clamped to the shop day; ≥ 3 weeks and a share < 25% → not that weekday;
 *     fewer than 3 observed weeks → `insufficient_history`: the shop's normal hours. A new hire is never
 *     LESS available after their first punch than before it.
 *   - `toSchedPeople` / `makeSkillLookup`: the roster the generator sees (excluded roles and levels < 2
 *     dropped unless `rosterInclude`, MoO / Owner presence-only, role defaults overridden by person
 *     settings, retired cover positions dropped and reported, salaried = GM / AGM, the wage source), and
 *     the skill lookup where a starting-point skill is its OWN band, `unproven` (r2 P1-2): never "newer",
 *     never blocking. Everything is canonical (sorted by id) and plain JSON.
 */
import { etCalendarDate, etClockTime } from "@/lib/operational-day";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import type { SkillMatrix } from "@/lib/people/skill-matrix-shared";
import type { AvailabilityWindow, RulePerson, WorkType } from "./context-shared";
import { effectiveScheduleRole, type WorksAsRole } from "./works-as-shared";
import { eligibleForPosition, workTypeAllows } from "./rules-shared";
import { positionIds, type LeaderSetting, type ScheduleStructure, type StructurePosition } from "./structure-shared";
import { addDays, isoDowOf, isoWeekStart, Q_MINUTES, Q_PER_DAY } from "./time-shared";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ─── Punch patterns (Toast time entries → the usual pattern) ─────────────────

/** A `toast_time_entries` row, the fields the pattern needs. */
export interface PunchEntry { userId: string | null; businessDate: string; inAt: string; outAt: string | null; hours: number; deleted: boolean }

export interface DowPattern {
  weeksWorked: number;
  weeksObserved: number;
  /** weeksWorked / weeksObserved; 0 when nothing was observed. */
  share: number;
  /** The p10 clock-in quarter (floored to the grid), p90 clock-out quarter (ceiled); null without punches. */
  p10InQ: number | null;
  p90OutQ: number | null;
}

export interface PersonPattern {
  /** ISO weekday 1..7 → the pattern. */
  byDow: Record<number, DowPattern>;
  /** Mean hours per observed week over the last 4 observed weeks; null when none. */
  meanWeeklyHours: number | null;
  /** The first ISO week (Monday) that counts for this person. */
  firstWeek: string;
}

/** Whole calendar days from `a` to `b` (YYYY-MM-DD), pure UTC date math. */
function daysFrom(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86400000);
}

/**
 * The quarter of an instant ON ITS BUSINESS DATE's wall clock: floor for a clock-in, ceil for a clock-out.
 * Astra chunk B P2-4: the minutes are counted from the business date's ET midnight BEFORE clamping, so an
 * overnight clock-out (18:00 → 00:30 the next day) is 24:30 → clamped to the end of the day (96), never 00:30.
 */
function wallQ(iso: string, round: "floor" | "ceil", businessDate: string): number {
  const [h, m] = etClockTime(iso).split(":").map(Number);
  const minutes = daysFrom(businessDate, etCalendarDate(iso)) * 24 * 60 + h! * 60 + m!;
  const q = round === "floor" ? Math.floor(minutes / Q_MINUTES) : Math.ceil(minutes / Q_MINUTES);
  return Math.min(Q_PER_DAY, Math.max(0, q));
}

/** Nearest-rank quantile of a sorted numeric array. */
function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/**
 * Per user × ISO weekday over the last `weeks` COMPLETE ISO weeks before `asOf`'s week. `firstSeen[userId]`
 * (the later of the first punch at the shop and `user_locations.created_at`, as a date) floors the
 * person's observed weeks and is never overridden by the window (Astra chunk B P2-3); without it the
 * person's first punch in the window does. Entries with
 * `deleted` or no `userId` are skipped; an open entry (no `outAt`) counts its day and its in time, never
 * an out time.
 */
export function punchPatterns(
  entries: readonly PunchEntry[],
  opts: { asOf: string; weeks?: number; firstSeen?: Readonly<Record<string, string>> },
): Record<string, PersonPattern> {
  const weeks = opts.weeks ?? 8;
  const windowEnd = isoWeekStart(opts.asOf);
  const windowStart = addDays(windowEnd, -7 * weeks);
  const live = entries.filter((e) => !e.deleted && e.userId !== null && e.businessDate >= windowStart && e.businessDate < windowEnd);
  const weekStarts: string[] = [];
  for (let w = windowStart; w < windowEnd; w = addDays(w, 7)) weekStarts.push(w);
  const shopPunched = new Set(live.map((e) => `${isoWeekStart(e.businessDate)}/${isoDowOf(e.businessDate)}`));
  const byUser = new Map<string, PunchEntry[]>();
  for (const e of live) {
    const list = byUser.get(e.userId!) ?? [];
    list.push(e);
    byUser.set(e.userId!, list);
  }
  const out: Record<string, PersonPattern> = {};
  for (const userId of [...byUser.keys()].sort(cmp)) {
    const mine = byUser.get(userId)!;
    const firstPunch = mine.map((e) => e.businessDate).sort(cmp)[0]!;
    // Astra chunk B P2-3: the supplied historical start (the later of the first punch at the shop and the
    // membership, from the loader) WINS; the truncated window's first punch is only the fallback.
    const seen = opts.firstSeen?.[userId];
    const firstWeek = isoWeekStart(seen ?? firstPunch);
    const byDow: Record<number, DowPattern> = {};
    for (let dow = 1; dow <= 7; dow++) {
      const observed = weekStarts.filter((w) => w >= firstWeek && shopPunched.has(`${w}/${dow}`));
      // Punches before the person's first counted week (a membership that started later) count for nothing.
      const punches = mine.filter((e) => isoDowOf(e.businessDate) === dow && isoWeekStart(e.businessDate) >= firstWeek);
      const workedWeeks = new Set(punches.map((e) => isoWeekStart(e.businessDate))).size;
      const ins = punches.map((e) => wallQ(e.inAt, "floor", e.businessDate)).sort((a, b) => a - b);
      const outs = punches.filter((e) => e.outAt !== null).map((e) => wallQ(e.outAt!, "ceil", e.businessDate)).sort((a, b) => a - b);
      byDow[dow] = {
        weeksWorked: workedWeeks, weeksObserved: observed.length,
        share: observed.length === 0 ? 0 : workedWeeks / observed.length,
        p10InQ: ins.length ? quantile(ins, 0.1) : null, p90OutQ: outs.length ? quantile(outs, 0.9) : null,
      };
    }
    // Mean weekly hours over the last 4 observed weeks (weeks since firstWeek in which the shop punched at all).
    const observedWeeks = weekStarts.filter((w) => w >= firstWeek && [1, 2, 3, 4, 5, 6, 7].some((d) => shopPunched.has(`${w}/${d}`))).slice(-4);
    const hours = observedWeeks.map((w) => mine.filter((e) => isoWeekStart(e.businessDate) === w).reduce((n, e) => n + e.hours, 0));
    out[userId] = { byDow, meanWeeklyHours: observedWeeks.length ? Math.round((hours.reduce((a, b) => a + b, 0) / observedWeeks.length) * 100) / 100 : null, firstWeek };
  }
  return out;
}

// ─── Assumed availability ────────────────────────────────────────────────────

export const PATTERN_MIN_WEEKS = 3;
export const PATTERN_MIN_SHARE = 0.25;
const PATTERN_PAD_Q = 2;

/**
 * A person's assumed availability on one weekday. `null` = not that weekday. Every result names its source
 * (the UI flag "Assumed from Toast punches · until availability syncs").
 */
export function assumedAvailability(pattern: DowPattern | undefined, shopDay: { fromQ: number; toQ: number }): AvailabilityWindow | null {
  if (!pattern || pattern.weeksObserved < PATTERN_MIN_WEEKS) return { fromQ: shopDay.fromQ, toQ: shopDay.toQ, source: "insufficient_history" };
  if (pattern.share < PATTERN_MIN_SHARE) return null;
  const fromQ = Math.max(shopDay.fromQ, (pattern.p10InQ ?? shopDay.fromQ) - PATTERN_PAD_Q);
  const toQ = Math.min(shopDay.toQ, (pattern.p90OutQ ?? shopDay.toQ) + PATTERN_PAD_Q);
  return { fromQ, toQ: Math.max(toQ, fromQ + 1), source: "toast_pattern" };
}

// ─── The roster the generator sees ───────────────────────────────────────────

export interface MemberInput { userId: string; role: RoleCode; active: boolean }
export interface PersonSettingsRow {
  worksAs?: WorksAsRole | null;
  userId: string;
  workType: WorkType | null;
  alsoAllowed: Array<"boh" | "foh">;
  leaderSetting: LeaderSetting | null;
  coverPositions: string[];
  softMinH: number | null;
  softMaxH: number | null;
  fullTime: boolean;
  fullTimeMinH: number | null;
  rosterInclude: boolean | null;
}
export type WageSource = "sevenshifts" | "estimate";

export interface SchedPerson extends RulePerson {
  wageCents: number | null;
  wageSource: WageSource | null;
  fullTime: boolean;
  fullTimeMinH: number | null;
  /** The person was included although their role is excluded by default (R6). */
  rosterIncluded: boolean;
  /**
   * CC chunk H9 (spec §5.1): ISO weekday → the share of observed weeks the person worked it (Toast punches), ONLY for weekdays
   * with at least `PATTERN_MIN_WEEKS` observed weeks. The generator's off days prefer the LOWEST shares. Absent = no evidence.
   */
  observedDowShare?: Record<number, number>;
}

export interface RosterNote { code: "cover_position_retired" | "excluded_role_included"; userId: string; positionId: string | null }

const NEVER_INCLUDED: readonly RoleCode[] = ["cgs", "social_media_mgr"];
const PRESENCE_ONLY: readonly RoleCode[] = ["moo", "owner"];
const SALARIED: readonly RoleCode[] = ["gm", "agm"];

export function defaultWorkType(role: RoleCode): WorkType {
  return getRoleLevel(role) >= 5 ? "management" : "foh";
}

export interface ToSchedPeopleInput {
  members: readonly MemberInput[];
  settings: readonly PersonSettingsRow[];
  patterns: Readonly<Record<string, PersonPattern>>;
  dates: readonly string[];
  structure: ScheduleStructure;
  /** The shop day the availability fallback uses: [prep start, the latest out). */
  shopDay: { fromQ: number; toQ: number };
  wages: { byUserCents: Readonly<Record<string, number>>; estimateHourlyCents: number | null };
  skills: SkillLookup | null;
  /** On leave / separated (0279): never on the roster, whatever their role, settings or account state say. */
  excludedUserIds?: readonly string[];
}

/**
 * Members → `SchedPerson[]`, canonical (sorted by userId). Excluded roles and levels < 2 are dropped
 * unless `rosterInclude`; CGS / social media require a valid shop-specific `worksAs`. That effective
 * role drives every scheduling rule. MoO / Owner are presence-only; role defaults for
 * work type and leader setting apply and person settings override; cover preferences outside the shop's
 * active positions are dropped and reported; salaried = GM / AGM; wage = 7shifts else the estimate else
 * null. Availability comes from the pattern per weekday (assumed, flagged).
 */
export function toSchedPeople(input: ToSchedPeopleInput): { people: SchedPerson[]; notes: RosterNote[] } {
  const { structure } = input;
  const live = new Set(positionIds(structure));
  const settings = new Map(input.settings.map((s) => [s.userId, s]));
  const notes: RosterNote[] = [];
  const people: SchedPerson[] = [];
  const away = new Set(input.excludedUserIds ?? []);
  for (const m of [...input.members].sort((a, b) => cmp(a.userId, b.userId))) {
    // Staff separations: on leave (while on leave) and separated (always) are off the schedule.
    if (away.has(m.userId)) continue;
    // An off-floor account joins through its explicit shop-specific floor role.
    const st = settings.get(m.userId);
    const role = effectiveScheduleRole(m.role, st?.worksAs);
    if (NEVER_INCLUDED.includes(role)) continue;
    // A valid works_as intentionally bypasses this shop's excludedRoles: it explicitly opts this person into floor work.
    const excluded = role === m.role && (structure.roster.excludedRoles.includes(role) || getRoleLevel(role) < 2);
    const presenceOnly = PRESENCE_ONLY.includes(role);
    if (excluded && !presenceOnly) {
      if (!st?.rosterInclude) continue;
      notes.push({ code: "excluded_role_included", userId: m.userId, positionId: null });
    }
    const cover: string[] = [];
    for (const id of st?.coverPositions ?? []) {
      if (live.has(id)) { if (!cover.includes(id)) cover.push(id); } else notes.push({ code: "cover_position_retired", userId: m.userId, positionId: id });
    }
    const pattern = input.patterns[m.userId];
    const availability: Record<string, AvailabilityWindow | null> = {};
    for (const d of input.dates) availability[d] = assumedAvailability(pattern?.byDow[isoDowOf(d)], input.shopDay);
    const mean = pattern?.meanWeeklyHours ?? null;
    const salaried = SALARIED.includes(role);
    const wage = input.wages.byUserCents[m.userId];
    const person: SchedPerson = {
      userId: m.userId, role, activeMember: m.active,
      workType: st?.workType ?? defaultWorkType(role), alsoAllowed: [...(st?.alsoAllowed ?? [])].sort(),
      leaderSetting: st?.leaderSetting ?? null, coverPositions: cover, salaried, presenceOnly,
      softMinH: salaried || presenceOnly ? null : st?.softMinH ?? (mean === null ? 0 : Math.max(0, Math.round((mean - 4) * 4) / 4)),
      softMaxH: salaried || presenceOnly ? null : st?.softMaxH ?? (mean === null ? 40 : Math.round((mean + 4) * 4) / 4),
      availability, flexDates: [], untouchableDates: [], newerPositions: [], strongPositions: [],
      wageCents: salaried || presenceOnly ? null : wage !== undefined ? wage : input.wages.estimateHourlyCents,
      wageSource: salaried || presenceOnly ? null : wage !== undefined ? "sevenshifts" : input.wages.estimateHourlyCents !== null ? "estimate" : null,
      fullTime: st?.fullTime ?? false, fullTimeMinH: st?.fullTimeMinH ?? null, rosterIncluded: excluded,
    };
    const share: Record<number, number> = {};
    for (let dow = 1; dow <= 7; dow++) {
      const dp = pattern?.byDow[dow];
      if (dp && dp.weeksObserved >= PATTERN_MIN_WEEKS) share[dow] = Math.round(dp.share * 1000) / 1000;
    }
    if (Object.keys(share).length > 0) person.observedDowShare = share;
    if (input.skills) {
      for (const id of positionIds(structure)) {
        const sk = skillOf(input.skills, person, id, structure.positions[id]);
        if (sk.isNewer) person.newerPositions.push(id);
        if (sk.isStrong) person.strongPositions.push(id);
      }
    }
    people.push(person);
  }
  notes.sort((a, b) => cmp(a.userId, b.userId) || cmp(a.code, b.code) || cmp(a.positionId ?? "", b.positionId ?? ""));
  return { people, notes };
}

// ─── The skill lookup (r2 P1-2: unproven is its own band) ────────────────────

export type SchedSkillBand = "unproven" | "building" | "solid" | "strong";
export interface SkillCell { value: number; confidence: number; startingPoint: boolean }
export interface SkillLookup {
  /** userId → positionId → the cell. A missing cell is an unproven neutral prior (0.5). */
  byUser: Record<string, Record<string, SkillCell>>;
  /** The max `perKind.closeOnTime.mean` across positions; null without evidence. */
  closeScoreByUser: Record<string, number | null>;
  bands: { building: number; strong: number };
}
export interface SkillRead { value: number; band: SchedSkillBand; confidence: number; isNewer: boolean; isStrong: boolean }

export const NEUTRAL_PRIOR = 0.5;
export const EVIDENCE_CONFIDENCE = 0.3;

/** The matrix Phase 1 hands Phase 2 → the lookup. Plain data, canonical keys. */
export function makeSkillLookup(matrix: Pick<SkillMatrix, "people">, bands: { building: number; strong: number }): SkillLookup {
  const byUser: Record<string, Record<string, SkillCell>> = {};
  const closeScoreByUser: Record<string, number | null> = {};
  for (const p of [...matrix.people].sort((a, b) => cmp(a.userId, b.userId))) {
    const cells: Record<string, SkillCell> = {};
    let close: number | null = null;
    for (const s of [...p.skills].sort((a, b) => cmp(a.positionId, b.positionId))) {
      cells[s.positionId] = { value: s.value, confidence: s.confidence, startingPoint: s.startingPoint };
      const c = s.perKind.closeOnTime;
      if (c && (close === null || c.mean > close)) close = c.mean;
    }
    byUser[p.userId] = cells;
    closeScoreByUser[p.userId] = close;
  }
  return { byUser, closeScoreByUser, bands: { building: bands.building, strong: bands.strong } };
}

/**
 * `{value, band, isNewer, isStrong}` for a person on a position. Value is 0 when the work type (or the
 * role, or the Prep/Dishwasher manager rule) forbids the position, as in the mockup's `skill`. Unproven
 * (starting point, or no cell) is its own band and is NEVER newer. Newer = real evidence of inexperience
 * (confidence ≥ 0.3 and value < building); strong = value ≥ strong with confidence ≥ 0.3.
 */
export function skillOf(lookup: SkillLookup, person: RulePerson, positionId: string, position: StructurePosition | undefined): SkillRead {
  const cell = lookup.byUser[person.userId]?.[positionId];
  const allowed = !!position && eligibleForPosition(person, position) && workTypeAllows(person, position);
  const raw = cell ? cell.value : NEUTRAL_PRIOR;
  const value = allowed ? Math.max(0, Math.min(1, raw)) : 0;
  const unproven = !cell || cell.startingPoint;
  const confidence = cell ? cell.confidence : 0;
  const band: SchedSkillBand = unproven ? "unproven" : raw < lookup.bands.building ? "building" : raw < lookup.bands.strong ? "solid" : "strong";
  const evidence = !unproven && confidence >= EVIDENCE_CONFIDENCE;
  return { value, band, confidence, isNewer: evidence && raw < lookup.bands.building, isStrong: evidence && raw >= lookup.bands.strong };
}

export function closeScore(lookup: SkillLookup, userId: string): number | null {
  return lookup.closeScoreByUser[userId] ?? null;
}
