/**
 * THE SCHEDULE STRUCTURE — a per-shop SETTING, pure (Scheduling Phase 2, spec §5.7, plan Task 1).
 *
 * The mockup v17 `defaultStructure`, keyed by `station_positions.id`. Every value is a setting: the
 * shop day, the day-type thresholds, the crews per day type (BOH counts, the line waves, the closing
 * crew and — r3 — the per-position line FLOOR `lineMinHeads`), each position's open / trim / close and
 * head limits, the priority pairs, leadership, limits, the catering prep rule, the labor target and
 * the roster exclusions. Times are quarter-hours (time-shared). Code never matches a position NAME:
 * `PositionRole` maps the spec's named functions onto THIS shop's ids.
 *
 * `validScheduleStructure` is the TS twin of the SQL `valid_schedule_structure` (0274); both run the
 * ONE case file tests/fixtures/schedule/structure-cases.json. It names the FIRST failing key and never
 * throws. Infeasible-but-valid structures (heads on a window shorter than the minimum shift, …) stay
 * VALID: the generator answers them with a `structure` gap certificate.
 */
import { isRoleCode, type RoleCode } from "@/lib/roles";
import { ceil15Q, isQuarter, qToWall, Q_PER_DAY, wallToQ } from "./time-shared";
import { ScheduleError } from "./errors-shared";

export type PositionRole = "prep" | "prep_dish" | "register" | "expo" | "walk" | "walk_online" | "line_other";
export const POSITION_ROLES: readonly PositionRole[] = ["prep", "prep_dish", "register", "expo", "walk", "walk_online", "line_other"];
export const LINE_ROLES: readonly PositionRole[] = ["register", "expo", "walk", "walk_online", "line_other"];
export const BOH_ROLES: readonly PositionRole[] = ["prep", "prep_dish"];

export type CrewType = "slow" | "normal" | "busy" | "weekend";
export const CREW_TYPES: readonly CrewType[] = ["slow", "normal", "busy", "weekend"];
export type LeaderSetting = "opens" | "closes" | "mix";
export const LEADER_SETTINGS: readonly LeaderSetting[] = ["opens", "closes", "mix"];

export interface CrewRow {
  prepHeads: number;
  prepUntilQ: number;
  prepDishHeads: number;
  waves: { setup: { heads: number; atQ: number }; service: { heads: number }; rush: { heads: number; atQ: number } };
  close: { registerHeads: number; walkHeads: number; prepDishHeads: number };
  /** r3 P2-2: the FLOOR per line position id (default 1 on primaries, 0 on secondaries); a missing id is 0. */
  lineMinHeads: Record<string, number>;
}

export interface StructurePosition {
  role: PositionRole;
  openQ: number;
  trimQ: number;
  closeQ: number;
  headsBefore: number;
  headsAfter: number;
  allowedRoles: RoleCode[];
}

export interface ScheduleStructure {
  version: 1;
  shopDay: { prepStartQ: number; prepDishArrivalQ: number; serviceStartQ: number; serviceCloseQ: number; outEarliestQ: number; outLatestQ: number };
  dayTypes: { slowBelowCents: number; busyAboveCents: number; weekendIsoDows: number[] };
  crews: Record<CrewType, CrewRow>;
  positions: Record<string, StructurePosition>;
  priority: Array<{ pair: [string, string]; primary: string }>;
  leadership: { modRequired: boolean; closingRoles: RoleCode[]; leaderDefaults: Partial<Record<RoleCode, LeaderSetting>> };
  limits: {
    minimumShiftQ: number; flexMinimumQ: number; flexUsesPer2w: number; flexMaxQ: number; overtimeH: number;
    /** R5: the weekly floor-time limit per salaried manager (32 h). */
    managerFloorH: number; gmMinimumH: number; agmMinimumH: number;
    /** r2: WINS over the measured closing duration when set. */
    closingMinutesOverride: number | null;
    segmentMinQ: number;
    /** r4: DISPLAY ONLY — a shaped rush further than this from its configured time is flagged in the reason; never alters heads. */
    rushShiftMaxQ: number;
  };
  catering: { minHeadcount: number; extraPrepDishHeads: number; defaultStartQ: number; defaultEndQ: number; leadMinutes: number };
  labor: { targetPct: number; basis: "hourly" | "total"; strong: number; watch: number; budgetDeadbandH: number };
  roster: { excludedRoles: RoleCode[] };
}

const crew = (prepHeads: number, prepUntilQ: number, setup: number, service: number, rush: number, closeWalk: number): CrewRow => ({
  prepHeads, prepUntilQ, prepDishHeads: 1,
  waves: { setup: { heads: setup, atQ: 38 }, service: { heads: service }, rush: { heads: rush, atQ: 46 } },
  close: { registerHeads: 1, walkHeads: closeWalk, prepDishHeads: 1 },
  lineMinHeads: {},
});

/**
 * The shipped defaults — the mockup v17 values, with no positions (positions are a shop's own ids;
 * `structureFromStations` seeds them). Pinned equal to the case file's CASE_DEFAULTS.
 */
export const SCHEDULE_STRUCTURE_DEFAULTS: ScheduleStructure = {
  version: 1,
  shopDay: { prepStartQ: 28, prepDishArrivalQ: 34, serviceStartQ: 42, serviceCloseQ: 80, outEarliestQ: 82, outLatestQ: 84 },
  dayTypes: { slowBelowCents: 400000, busyAboveCents: 480000, weekendIsoDows: [6, 7] },
  crews: {
    slow: crew(0, 60, 2, 2, 2, 1),
    normal: crew(1, 60, 2, 3, 3, 2),
    busy: crew(1, 64, 3, 3, 4, 2),
    weekend: crew(1, 68, 2, 3, 3, 2),
  },
  positions: {},
  priority: [],
  leadership: {
    modRequired: true,
    closingRoles: ["key_holder", "shift_lead", "agm", "gm", "moo", "owner"],
    leaderDefaults: { key_holder: "closes", shift_lead: "opens", agm: "opens", gm: "opens", moo: "mix", owner: "mix" },
  },
  limits: {
    minimumShiftQ: 16, flexMinimumQ: 12, flexUsesPer2w: 1, flexMaxQ: 12, overtimeH: 40,
    managerFloorH: 32, gmMinimumH: 8, agmMinimumH: 8, closingMinutesOverride: null, segmentMinQ: 2, rushShiftMaxQ: 4,
  },
  catering: { minHeadcount: 30, extraPrepDishHeads: 1, defaultStartQ: 34, defaultEndQ: 52, leadMinutes: 210 },
  labor: { targetPct: 28, basis: "total", strong: 0.8, watch: 0.65, budgetDeadbandH: 2 },
  roster: { excludedRoles: ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] },
};

const FLOOR_ROLES: RoleCode[] = ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"];

/** Per-role seed values when a station column is missing (the mockup v17 station hours). */
export const POSITION_ROLE_DEFAULTS: Record<PositionRole, StructurePosition> = {
  prep: { role: "prep", openQ: 28, trimQ: 60, closeQ: 68, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
  prep_dish: { role: "prep_dish", openQ: 28, trimQ: 68, closeQ: 84, headsBefore: 1, headsAfter: 1, allowedRoles: ["trainee", "employee", "trainer"] },
  register: { role: "register", openQ: 42, trimQ: 64, closeQ: 84, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
  expo: { role: "expo", openQ: 46, trimQ: 64, closeQ: 80, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
  walk: { role: "walk", openQ: 42, trimQ: 68, closeQ: 84, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
  walk_online: { role: "walk_online", openQ: 42, trimQ: 68, closeQ: 84, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
  line_other: { role: "line_other", openQ: 38, trimQ: 62, closeQ: 62, headsBefore: 1, headsAfter: 1, allowedRoles: FLOOR_ROLES },
};

// ─── Reads over a structure ──────────────────────────────────────────────────

export function crewFor(s: ScheduleStructure, dayType: CrewType): CrewRow {
  return s.crews[dayType];
}

export function isLineRole(role: PositionRole): boolean {
  return LINE_ROLES.includes(role);
}

/** Position ids in canonical order (ascending id, `<`, never a locale compare). */
export function positionIds(s: ScheduleStructure): string[] {
  return Object.keys(s.positions).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The head LIMIT at quarter q (rule b): headsBefore before the trim, headsAfter from it; 0 outside [open, close). */
export function positionLimit(p: StructurePosition, q: number): number {
  if (q < p.openQ || q >= p.closeQ) return 0;
  return q < p.trimQ ? p.headsBefore : p.headsAfter;
}

/** The primary of the priority pair holding `positionId`, or null when it is in no pair. */
export function primaryOf(s: ScheduleStructure, positionId: string): string | null {
  const pair = s.priority.find((x) => x.pair.includes(positionId));
  return pair ? pair.primary : null;
}

/** The other member of the pair when `positionId` is the primary; null otherwise. */
export function secondaryOf(s: ScheduleStructure, positionId: string): string | null {
  const pair = s.priority.find((x) => x.primary === positionId);
  return pair ? (pair.pair[0] === positionId ? pair.pair[1] : pair.pair[0]) : null;
}

export function isSecondary(s: ScheduleStructure, positionId: string): boolean {
  const primary = primaryOf(s, positionId);
  return primary !== null && primary !== positionId;
}

/** Scheduled out = clamp(serviceClose + ceil15(closing minutes), outEarliest, outLatest). */
export function scheduledOut(s: ScheduleStructure, closingMinutes: number): number {
  const finish = s.shopDay.serviceCloseQ + ceil15Q(closingMinutes);
  return Math.min(s.shopDay.outLatestQ, Math.max(s.shopDay.outEarliestQ, finish));
}

/** Does the closing checklist finish by the latest out time? (The board flags `checklist_past_max` when not.) */
export function checklistFits(s: ScheduleStructure, closingMinutes: number): boolean {
  return s.shopDay.serviceCloseQ + ceil15Q(closingMinutes) <= s.shopDay.outLatestQ;
}

/**
 * The line FLOOR and CAPACITY per quarter for a day type (r3 P2-2):
 *   minHeads(q) = Σ over line positions open at q of `crews[type].lineMinHeads[id]`;
 *   maxHeads(q) = Σ over line positions open at q of their head limit (rule b).
 */
export function lineBounds(s: ScheduleStructure, dayType: CrewType): { minHeads: number[]; maxHeads: number[] } {
  const minHeads = new Array<number>(Q_PER_DAY).fill(0);
  const maxHeads = new Array<number>(Q_PER_DAY).fill(0);
  const floors = s.crews[dayType].lineMinHeads;
  for (const id of positionIds(s)) {
    const p = s.positions[id]!;
    if (!isLineRole(p.role)) continue;
    for (let q = p.openQ; q < p.closeQ && q < Q_PER_DAY; q++) {
      minHeads[q]! += floors[id] ?? 0;
      maxHeads[q]! += positionLimit(p, q);
    }
  }
  return { minHeads, maxHeads };
}

/** Line position ids in the canonical order every placement uses: primaries (not a pair's secondary) by id, then secondaries by id. */
export function lineOrder(s: ScheduleStructure): string[] {
  const line = positionIds(s).filter((id) => isLineRole(s.positions[id]!.role));
  return [...line.filter((id) => !isSecondary(s, id)), ...line.filter((id) => isSecondary(s, id))];
}

/**
 * Who closes on the walk side: the walk pair's primary (a pair whose members are both walk roles), else
 * the first `walk_online` position; and the other walk-role positions, in id order. By id, never by name.
 */
export function walkClosers(s: ScheduleStructure): { primary: string | null; others: string[] } {
  const isWalk = (id: string) => ["walk", "walk_online"].includes(s.positions[id]?.role ?? "");
  const walkPair = s.priority.find((p) => p.pair.every(isWalk));
  const line = lineOrder(s);
  const primary = walkPair?.primary ?? line.find((id) => s.positions[id]!.role === "walk_online") ?? null;
  return { primary, others: line.filter((id) => isWalk(id) && id !== primary) };
}

export type WaveSource = "closing_crew" | "setup" | "service" | "rush";
export interface WaveSlot { positionId: string; fromQ: number; toQ: number; source: WaveSource }

/**
 * THE CONFIGURED WAVES, PLACED (CC's W ruling 2026-10-16; Astra chunk A P2-6): the mockup's
 * `templatesFor` WITHOUT its head-count fill. In order: (1) the closing crew is reserved first —
 * register heads, the walk pair's primary (min 1), the other walk position (the rest), primaries before
 * secondaries, each from max(trim, service start) to its close, capped at `headsAfter`; (2) the setup,
 * service and rush waves, each head on the MOST DEFICIENT open line position at the wave time (head
 * limit at that time minus heads already placed; ties in canonical line order), ending at that
 * position's TRIM — the mockup's rule for a wave head. The fill ("every station head-count is a rule")
 * is gone: it was a mockup display convenience, not a staffing rule.
 */
export function waveSlots(s: ScheduleStructure, dayType: CrewType): WaveSlot[] {
  const crew = s.crews[dayType];
  const order = lineOrder(s);
  const { serviceStartQ } = s.shopDay;
  const slots: WaveSlot[] = [];
  const walk = walkClosers(s);
  for (const id of order) {
    const p = s.positions[id]!;
    let n = 0;
    if (p.role === "register") n = crew.close.registerHeads;
    else if (id === walk.primary) n = Math.min(1, crew.close.walkHeads);
    else if (walk.others[0] === id) n = Math.max(0, crew.close.walkHeads - 1);
    n = Math.min(n, p.headsAfter);
    const from = Math.max(p.trimQ, serviceStartQ);
    for (let i = 0; i < n && p.closeQ > from; i++) slots.push({ positionId: id, fromQ: from, toQ: p.closeQ, source: "closing_crew" });
  }
  const waves: Array<[WaveSource, number, number]> = [
    ["setup", crew.waves.setup.heads, crew.waves.setup.atQ], ["service", crew.waves.service.heads, serviceStartQ], ["rush", crew.waves.rush.heads, crew.waves.rush.atQ],
  ];
  for (const [source, heads, a] of waves) {
    for (let i = 0; i < heads; i++) {
      let best: { id: string; deficit: number; b: number } | null = null;
      for (const id of order) {
        const p = s.positions[id]!;
        const b = Math.min(p.trimQ, p.closeQ);
        const limit = positionLimit(p, a);
        if (b <= a || limit <= 0) continue;
        const assigned = slots.filter((x) => x.positionId === id && x.fromQ <= a && x.toQ > a).length;
        if (!best || limit - assigned > best.deficit) best = { id, deficit: limit - assigned, b };
      }
      if (best) slots.push({ positionId: best.id, fromQ: a, toQ: best.b, source });
    }
  }
  return slots;
}

/**
 * THE WAVE PROFILE W_q (plan step 3a): the line heads per quarter the configured waves and the closing
 * crew produce (`waveSlots`), over the SERVICE period (before service close; 0 after it), clamped into
 * [minHeads(q), maxHeads(q)] — the target can never exceed the positions' capacity nor fall below the
 * floor (zero waves target the minimum crew; the v17 defaults ask more heads than positions and are
 * capped). The structure validator therefore refuses only a floor above the capacity.
 */
export function waveProfile(s: ScheduleStructure, dayType: CrewType): number[] {
  const { minHeads, maxHeads } = lineBounds(s, dayType);
  const end = s.shopDay.serviceCloseQ;
  const w = new Array<number>(Q_PER_DAY).fill(0);
  for (const slot of waveSlots(s, dayType)) for (let q = slot.fromQ; q < Math.min(slot.toQ, end, Q_PER_DAY); q++) w[q]!++;
  for (let q = 0; q < Q_PER_DAY; q++) w[q] = q < end ? Math.min(maxHeads[q]!, Math.max(minHeads[q]!, w[q]!)) : 0;
  return w;
}

// ─── The validator ───────────────────────────────────────────────────────────

type Problem = string | null;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v) && Number.isInteger(v) && v >= lo && v <= hi;
const isQuarterHours = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi && Number.isInteger(v * 4);

/** The first unknown or missing key of `o` against `keys`, as a path; null when exact. */
function exactKeys(o: Record<string, unknown>, keys: readonly string[], path: string): Problem {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `${path}${k}`;
  for (const k of keys) if (!(k in o)) return `${path}${k}`;
  return null;
}

function checkRoleList(v: unknown, path: string): Problem {
  if (!Array.isArray(v) || v.some((r) => typeof r !== "string" || !isRoleCode(r)) || new Set(v).size !== v.length) return path;
  return null;
}

const TOP_KEYS = ["version", "shopDay", "dayTypes", "crews", "positions", "priority", "leadership", "limits", "catering", "labor", "roster"] as const;
const SHOPDAY_KEYS = ["prepStartQ", "prepDishArrivalQ", "serviceStartQ", "serviceCloseQ", "outEarliestQ", "outLatestQ"] as const;
const POSITION_KEYS = ["role", "openQ", "trimQ", "closeQ", "headsBefore", "headsAfter", "allowedRoles"] as const;
const LIMIT_KEYS = ["minimumShiftQ", "flexMinimumQ", "flexUsesPer2w", "flexMaxQ", "overtimeH", "managerFloorH", "gmMinimumH",
  "agmMinimumH", "closingMinutesOverride", "segmentMinQ", "rushShiftMaxQ"] as const;

function checkShopDay(v: unknown): Problem {
  if (!isObj(v)) return "shopDay";
  const k = exactKeys(v, SHOPDAY_KEYS, "shopDay.");
  if (k) return k;
  for (const key of SHOPDAY_KEYS) if (!isQuarter(v[key])) return `shopDay.${key}`;
  const d = v as unknown as ScheduleStructure["shopDay"];
  if (d.prepDishArrivalQ < d.prepStartQ) return "shopDay.prepDishArrivalQ";
  if (d.serviceStartQ < d.prepStartQ) return "shopDay.serviceStartQ";
  if (d.serviceCloseQ <= d.serviceStartQ) return "shopDay.serviceCloseQ";
  if (d.outEarliestQ < d.serviceCloseQ || d.outEarliestQ > d.outLatestQ) return "shopDay.outEarliestQ";
  return null;
}

function checkDayTypes(v: unknown): Problem {
  if (!isObj(v)) return "dayTypes";
  const k = exactKeys(v, ["slowBelowCents", "busyAboveCents", "weekendIsoDows"], "dayTypes.");
  if (k) return k;
  if (!isInt(v.slowBelowCents, 0, 1e9)) return "dayTypes.slowBelowCents";
  if (!isInt(v.busyAboveCents, 0, 1e9)) return "dayTypes.busyAboveCents";
  if (v.slowBelowCents >= v.busyAboveCents) return "dayTypes.slowBelowCents";
  const w = v.weekendIsoDows;
  if (!Array.isArray(w) || w.some((x) => !isInt(x, 1, 7)) || new Set(w).size !== w.length) return "dayTypes.weekendIsoDows";
  return null;
}

function checkPositions(v: unknown): Problem {
  if (!isObj(v)) return "positions";
  for (const id of Object.keys(v).sort()) {
    const p = v[id];
    const at = `positions.${id}`;
    if (id === "" || id === "mod" || !isObj(p)) return at;
    const k = exactKeys(p, POSITION_KEYS, `${at}.`);
    if (k) return k;
    if (typeof p.role !== "string" || !POSITION_ROLES.includes(p.role as PositionRole)) return `${at}.role`;
    for (const key of ["openQ", "trimQ", "closeQ"] as const) if (!isQuarter(p[key])) return `${at}.${key}`;
    for (const key of ["headsBefore", "headsAfter"] as const) if (!isInt(p[key], 0, 8)) return `${at}.${key}`;
    const pp = p as unknown as StructurePosition;
    if (pp.openQ > pp.trimQ) return `${at}.openQ`;
    if (pp.trimQ > pp.closeQ) return `${at}.trimQ`;
    const r = checkRoleList(p.allowedRoles, `${at}.allowedRoles`);
    if (r) return r;
  }
  return null;
}

function checkCrews(v: unknown, positions: Record<string, StructurePosition>): Problem {
  if (!isObj(v)) return "crews";
  const k = exactKeys(v, CREW_TYPES, "crews.");
  if (k) return k;
  for (const t of CREW_TYPES) {
    const c = v[t];
    const at = `crews.${t}`;
    if (!isObj(c)) return at;
    const ck = exactKeys(c, ["prepHeads", "prepUntilQ", "prepDishHeads", "waves", "close", "lineMinHeads"], `${at}.`);
    if (ck) return ck;
    if (!isInt(c.prepHeads, 0, 8)) return `${at}.prepHeads`;
    if (!isQuarter(c.prepUntilQ)) return `${at}.prepUntilQ`;
    if (!isInt(c.prepDishHeads, 0, 8)) return `${at}.prepDishHeads`;
    const w = c.waves;
    if (!isObj(w)) return `${at}.waves`;
    const wk = exactKeys(w, ["setup", "service", "rush"], `${at}.waves.`);
    if (wk) return wk;
    for (const [name, timed] of [["setup", true], ["service", false], ["rush", true]] as const) {
      const wave = w[name];
      if (!isObj(wave)) return `${at}.waves.${name}`;
      const keys = timed ? ["heads", "atQ"] : ["heads"];
      const kk = exactKeys(wave, keys, `${at}.waves.${name}.`);
      if (kk) return kk;
      if (!isInt(wave.heads, 0, 8)) return `${at}.waves.${name}.heads`;
      if (timed && !isQuarter(wave.atQ)) return `${at}.waves.${name}.atQ`;
    }
    const cl = c.close;
    if (!isObj(cl)) return `${at}.close`;
    const clk = exactKeys(cl, ["registerHeads", "walkHeads", "prepDishHeads"], `${at}.close.`);
    if (clk) return clk;
    for (const key of ["registerHeads", "walkHeads", "prepDishHeads"] as const) if (!isInt(cl[key], 0, 8)) return `${at}.close.${key}`;
    const mins = c.lineMinHeads;
    if (!isObj(mins)) return `${at}.lineMinHeads`;
    for (const id of Object.keys(mins).sort()) {
      const p = positions[id];
      const n = mins[id];
      const key = `${at}.lineMinHeads.${id}`;
      if (!p || !isLineRole(p.role) || !isInt(n, 0, 8)) return key;
      // r3: the floor never exceeds the position's head limits.
      const limit = Math.max(p.openQ < p.trimQ ? p.headsBefore : 0, p.trimQ < p.closeQ ? p.headsAfter : 0);
      if (n > limit) return key;
    }
  }
  return null;
}

function checkPriority(v: unknown, positions: Record<string, StructurePosition>): Problem {
  if (!Array.isArray(v)) return "priority";
  const seen = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    const at = `priority.${i}`;
    if (!isObj(e)) return at;
    const k = exactKeys(e, ["pair", "primary"], `${at}.`);
    if (k) return k;
    const pair = e.pair;
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((x) => typeof x !== "string" || !positions[x]) || pair[0] === pair[1]
      || pair.some((x) => seen.has(x as string))) return `${at}.pair`;
    if (typeof e.primary !== "string" || !pair.includes(e.primary)) return `${at}.primary`;
    for (const x of pair) seen.add(x as string);
  }
  return null;
}

function checkLeadership(v: unknown): Problem {
  if (!isObj(v)) return "leadership";
  const k = exactKeys(v, ["modRequired", "closingRoles", "leaderDefaults"], "leadership.");
  if (k) return k;
  if (typeof v.modRequired !== "boolean") return "leadership.modRequired";
  const r = checkRoleList(v.closingRoles, "leadership.closingRoles");
  if (r) return r;
  const d = v.leaderDefaults;
  if (!isObj(d)) return "leadership.leaderDefaults";
  for (const role of Object.keys(d).sort()) {
    if (!isRoleCode(role) || typeof d[role] !== "string" || !LEADER_SETTINGS.includes(d[role] as LeaderSetting)) return `leadership.leaderDefaults.${role}`;
  }
  return null;
}

function checkLimits(v: unknown, shopDay: ScheduleStructure["shopDay"]): Problem {
  if (!isObj(v)) return "limits";
  const k = exactKeys(v, LIMIT_KEYS, "limits.");
  if (k) return k;
  if (!isInt(v.minimumShiftQ, 1, Q_PER_DAY)) return "limits.minimumShiftQ";
  if (!isInt(v.flexMinimumQ, 1, Q_PER_DAY)) return "limits.flexMinimumQ";
  if (!isInt(v.flexUsesPer2w, 0, 14)) return "limits.flexUsesPer2w";
  if (!isInt(v.flexMaxQ, 1, Q_PER_DAY)) return "limits.flexMaxQ";
  if (!isQuarterHours(v.overtimeH, 0, 80)) return "limits.overtimeH";
  if (!isQuarterHours(v.managerFloorH, 0, 80)) return "limits.managerFloorH";
  if (!isQuarterHours(v.gmMinimumH, 0, 24)) return "limits.gmMinimumH";
  if (!isQuarterHours(v.agmMinimumH, 0, 24)) return "limits.agmMinimumH";
  if (v.closingMinutesOverride !== null && !isInt(v.closingMinutesOverride, 0, 240)) return "limits.closingMinutesOverride";
  if (!isInt(v.segmentMinQ, 1, 16)) return "limits.segmentMinQ";
  if (!isInt(v.rushShiftMaxQ, 0, 16)) return "limits.rushShiftMaxQ";
  if (v.flexMinimumQ > v.minimumShiftQ || v.flexMinimumQ > v.flexMaxQ) return "limits.flexMinimumQ";
  // The mockup's guard: the longest required block fits the shop day.
  const span = shopDay.outLatestQ - shopDay.prepStartQ;
  if (v.minimumShiftQ > span) return "limits.minimumShiftQ";
  if (v.gmMinimumH * 4 > span) return "limits.gmMinimumH";
  if (v.agmMinimumH * 4 > span) return "limits.agmMinimumH";
  return null;
}

function checkCatering(v: unknown): Problem {
  if (!isObj(v)) return "catering";
  const k = exactKeys(v, ["minHeadcount", "extraPrepDishHeads", "defaultStartQ", "defaultEndQ", "leadMinutes"], "catering.");
  if (k) return k;
  if (!isInt(v.minHeadcount, 0, 10000)) return "catering.minHeadcount";
  if (!isInt(v.extraPrepDishHeads, 0, 8)) return "catering.extraPrepDishHeads";
  if (!isQuarter(v.defaultStartQ)) return "catering.defaultStartQ";
  if (!isQuarter(v.defaultEndQ) || v.defaultEndQ <= v.defaultStartQ) return "catering.defaultEndQ";
  if (!isInt(v.leadMinutes, 0, 720) || v.leadMinutes % 15 !== 0) return "catering.leadMinutes";
  return null;
}

function checkLabor(v: unknown): Problem {
  if (!isObj(v)) return "labor";
  const k = exactKeys(v, ["targetPct", "basis", "strong", "watch", "budgetDeadbandH"], "labor.");
  if (k) return k;
  if (!isNum(v.targetPct) || v.targetPct <= 0 || v.targetPct > 100) return "labor.targetPct";
  if (v.basis !== "hourly" && v.basis !== "total") return "labor.basis";
  if (!isNum(v.strong) || v.strong <= 0 || v.strong >= 1) return "labor.strong";
  if (!isNum(v.watch) || v.watch <= 0 || v.watch >= v.strong) return "labor.watch";
  if (!isQuarterHours(v.budgetDeadbandH, 0, 40)) return "labor.budgetDeadbandH";
  return null;
}

function checkRoster(v: unknown): Problem {
  if (!isObj(v)) return "roster";
  const k = exactKeys(v, ["excludedRoles"], "roster.");
  if (k) return k;
  return checkRoleList(v.excludedRoles, "roster.excludedRoles");
}

/**
 * r3: for every day type, minHeads(q) ≤ W_q ≤ maxHeads(q) at every quarter of the service period (the
 * flat-curve precondition). W is clamped into those bounds, so this fails exactly when the floor exceeds
 * the capacity somewhere (a `lineMinHeads` floor on a position trimmed to 0 heads).
 */
function checkWaveBounds(s: ScheduleStructure): Problem {
  for (const t of CREW_TYPES) {
    const { minHeads, maxHeads } = lineBounds(s, t);
    const w = waveProfile(s, t);
    for (let q = 0; q < s.shopDay.serviceCloseQ; q++) {
      if (w[q]! < minHeads[q]! || w[q]! > maxHeads[q]!) return `crews.${t}.waveProfile@${qToWall(q)}`;
    }
  }
  return null;
}

/** The first failing key (a dotted path), or null when the structure is valid. Never throws. */
export function structureProblem(v: unknown): string | null {
  if (!isObj(v)) return "structure";
  const top = exactKeys(v, TOP_KEYS, "");
  if (top) return top;
  if (v.version !== 1) return "version";
  const sd = checkShopDay(v.shopDay);
  if (sd) return sd;
  const dt = checkDayTypes(v.dayTypes);
  if (dt) return dt;
  const ps = checkPositions(v.positions);
  if (ps) return ps;
  const positions = v.positions as Record<string, StructurePosition>;
  return checkCrews(v.crews, positions)
    ?? checkPriority(v.priority, positions)
    ?? checkLeadership(v.leadership)
    ?? checkLimits(v.limits, v.shopDay as ScheduleStructure["shopDay"])
    ?? checkCatering(v.catering)
    ?? checkLabor(v.labor)
    ?? checkRoster(v.roster)
    ?? checkWaveBounds(v as unknown as ScheduleStructure);
}

export function validScheduleStructure(v: unknown): { ok: true } | { ok: false; key: string } {
  const key = structureProblem(v);
  return key === null ? { ok: true } : { ok: false, key };
}

/** Throws `structure_invalid` (key named) unless `v` is a valid structure. */
export function assertScheduleStructure(v: unknown): asserts v is ScheduleStructure {
  const key = structureProblem(v);
  if (key !== null) throw new ScheduleError("structure_invalid", { key });
}

// ─── Seeding from the station columns (J4) ───────────────────────────────────

export interface SeedStation { id: string; active: boolean; usuallyClosesAt: string | null; trims: Array<{ at: string; to_count: number }> | null }
export interface SeedPosition { id: string; stationId: string; active: boolean; usuallyTrimsAt: string | null }
export interface SeededFrom { close: "station" | "default"; trim: "position" | "station_trims" | "default" }

/**
 * A station time ("HH:MM[:SS]") as a schedule quarter. A time before 12:00 is NEXT-DAY in the station
 * rule (`lib/station-schedule-shared`), which a schedule day cannot hold: refused. Off-grid: refused.
 */
function stationTimeQ(time: string): number | null {
  const hm = time.slice(0, 5);
  if (hm < "12:00") return null;
  try {
    return wallToQ(time.length > 5 ? `${hm}:${time.slice(6, 8)}` : hm);
  } catch {
    return null;
  }
}

/**
 * The structure a shop's editor opens with the FIRST time: the shipped defaults plus one entry per
 * active position on an active station, its close ← `stations.usually_closes_at`, its trim ←
 * `station_positions.usually_trims_at`, else the station's first `trims` entry, missing → the role's
 * defaults. Roles come from the manager's mapping (`roles`), never from a name; an unmapped position is
 * `line_other`. A priority pair is seeded only where exactly one position holds each role of it.
 * After this the structure is the scheduler's single source; a later station change is an advisory.
 */
export function structureFromStations(
  stations: readonly SeedStation[],
  positions: readonly SeedPosition[],
  roles: Readonly<Record<string, PositionRole>>,
  base: ScheduleStructure = SCHEDULE_STRUCTURE_DEFAULTS,
): { ok: true; structure: ScheduleStructure; seededFrom: Record<string, SeededFrom> } | { ok: false; code: "structure_invalid"; key: string } {
  const s: ScheduleStructure = structuredClone(base);
  s.positions = {};
  const seededFrom: Record<string, SeededFrom> = {};
  const stationById = new Map(stations.map((st) => [st.id, st]));
  const live = positions.filter((p) => p.active && stationById.get(p.stationId)?.active === true)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const p of live) {
    const st = stationById.get(p.stationId)!;
    const role = roles[p.id] ?? "line_other";
    const d = POSITION_ROLE_DEFAULTS[role];
    let closeQ = d.closeQ;
    let close: SeededFrom["close"] = "default";
    if (st.usuallyClosesAt) {
      const q = stationTimeQ(st.usuallyClosesAt);
      if (q === null) return { ok: false, code: "structure_invalid", key: `positions.${p.id}.closeQ` };
      closeQ = q;
      close = "station";
    }
    let trimQ = Math.min(d.trimQ, closeQ);
    let trim: SeededFrom["trim"] = "default";
    const trimTime = p.usuallyTrimsAt ?? st.trims?.[0]?.at ?? null;
    if (trimTime) {
      const q = stationTimeQ(trimTime);
      if (q === null) return { ok: false, code: "structure_invalid", key: `positions.${p.id}.trimQ` };
      trimQ = Math.min(q, closeQ); // a trim at or after the close is moot: the position is closed by then
      trim = p.usuallyTrimsAt ? "position" : "station_trims";
    }
    s.positions[p.id] = { ...d, allowedRoles: [...d.allowedRoles], openQ: Math.min(d.openQ, trimQ), trimQ, closeQ };
    seededFrom[p.id] = { close, trim };
  }
  const byRole = (role: PositionRole) => Object.keys(s.positions).filter((id) => s.positions[id]!.role === role);
  for (const [primaryRole, secondaryRole] of [["prep_dish", "prep"], ["register", "expo"], ["walk_online", "walk"]] as const) {
    const a = byRole(primaryRole);
    const b = byRole(secondaryRole);
    if (a.length === 1 && b.length === 1) s.priority.push({ pair: [a[0]!, b[0]!], primary: a[0]! });
  }
  const floors: Record<string, number> = {};
  for (const id of positionIds(s)) {
    const p = s.positions[id]!;
    if (!isLineRole(p.role)) continue;
    const limit = Math.max(p.openQ < p.trimQ ? p.headsBefore : 0, p.trimQ < p.closeQ ? p.headsAfter : 0);
    floors[id] = isSecondary(s, id) ? 0 : Math.min(1, limit);
  }
  for (const t of CREW_TYPES) s.crews[t].lineMinHeads = { ...floors };
  const key = structureProblem(s);
  if (key !== null) return { ok: false, code: "structure_invalid", key };
  return { ok: true, structure: s, seededFrom };
}
