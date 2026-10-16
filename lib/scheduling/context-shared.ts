/**
 * THE VALIDATION CONTEXT — what `checkScheduleRules` judges against, and its persisted SNAPSHOT
 * (Scheduling Phase 2, r3 P2-4 + r4 P2; plan "Original validation vs current inputs").
 *
 * A `RuleContext` is plain JSON: the structure in force per built day, the people (role, work type,
 * leader setting, cover list, salaried, presence-only, assumed availability, skill bands), the
 * per-date budgets and closing windows, and — r4 — the COMPLETE derived quarter-hour need grid per
 * built date with the inputs that produced it (the hourly forecast used, the day type and its source,
 * the override row, the catering events, the shape note). Each revision stores the snapshot it was
 * validated with (`schedule_revision_contexts`); ORIGINAL validation replays a day against the
 * snapshot of its origin revision and makes NO live read. `contextAdvisory(snapshot, live)` lists
 * what changed since, separately — it never alters the original verdict.
 */
import type { RoleCode } from "@/lib/roles";
import { ScheduleError } from "./errors-shared";
import type { CrewType, LeaderSetting, ScheduleStructure } from "./structure-shared";

export type WorkType = "boh" | "foh" | "management";
export const WORK_TYPES: readonly WorkType[] = ["boh", "foh", "management"];

/** A person's assumed availability on a date (Phase 2: assumed from Toast punches, flagged). */
export interface AvailabilityWindow { fromQ: number; toQ: number; source: "toast_pattern" | "insufficient_history" }

export interface RulePerson {
  userId: string;
  role: RoleCode;
  /** An ACTIVE member of the shop (user_locations.active × users.active). */
  activeMember: boolean;
  workType: WorkType;
  alsoAllowed: Array<"boh" | "foh">;
  /** null = the structure's role default. */
  leaderSetting: LeaderSetting | null;
  /** Ordered preferred cover positions (managers); [] = any cover is last resort until set (J17). */
  coverPositions: string[];
  salaried: boolean;
  /** MoO / Owner: appear only through presence pins and "Add to schedule", never auto-scheduled. */
  presenceOnly: boolean;
  softMinH: number | null;
  softMaxH: number | null;
  /** Per business date: a window, or null = not available that day. A date absent = no information (available). */
  availability: Record<string, AvailabilityWindow | null>;
  /** Phase 3 inputs, fed [] in Phase 2 (the inert flex / untouchable branches). */
  flexDates: string[];
  untouchableDates: string[];
  /** Position ids where the person is "newer" (real evidence) / "strong" (r2 P1-2); unproven is neither. */
  newerPositions: string[];
  strongPositions: string[];
}

export type ShapeNote = "normal" | "zero_demand" | "zero_profile";
export type NeedSource = "shape" | "closing_crew" | "boh_crew" | "catering" | "head_limit";
export interface NeedRun { positionId: string; fromQ: number; toQ: number; heads: number; source: NeedSource }

/** The derived quarter-hour need grid of one date (r4: persisted COMPLETE in the snapshot). */
export interface DayNeed {
  /** Required heads per position id per quarter (96 entries each). */
  positions: Record<string, number[]>;
  /** The shaped line heads per quarter, and its floor / capacity. */
  lineTotal: number[];
  minHeads: number[];
  maxHeads: number[];
  /** The provenance of every need run. */
  sources: NeedRun[];
  shapeNote: ShapeNote;
}

/** What produced a date's need (r4): the inputs replay reads from the snapshot, never live. */
export interface DayInputs {
  demandKind: "ok" | "no_history";
  hourlyCents: number[] | null;
  dayCents: number | null;
  dayTypeSource: "override" | "weekend" | "forecast" | "no_history";
  overrideId: string | null;
  cateringEvents: Array<{ id: string; headcount: number; eventQ: number | null }>;
}

export interface DayContext {
  structureVersionId: string;
  structure: ScheduleStructure;
  dayType: CrewType;
  closingMinutes: number;
  scheduledOutQ: number;
  need: DayNeed;
  inputs: DayInputs;
}

export interface RuleContext {
  version: 1;
  locationId: string;
  weekStart: string;
  /** Today (ET business date) — always a parameter. */
  today: string;
  /** The week's 7 dates. */
  dates: string[];
  /** Context per BUILT (non-inherited) date. Inherited days keep their recorded problems. */
  days: Record<string, DayContext>;
  /** r3 per-DATE budgets for all 7 dates; null = no budget (never 0). */
  budgetByDate: Record<string, number | null>;
  /** The closing window [service close, scheduled out) of all 7 dates (essential hours, inherited days too). */
  closingWindowByDate: Record<string, { fromQ: number; toQ: number }>;
  people: Record<string, RulePerson>;
}

// ─── Canonical JSON + digest ────────────────────────────────────────────────

/** JSON with object keys sorted at every level (arrays keep their order). Deterministic. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** A 64-bit FNV-1a digest (two 32-bit lanes) of a string, hex. Pure, client-safe. */
export function digest64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The 0275 CHECK ceiling on a stored context. */
export const CONTEXT_MAX_BYTES = 262144;
/** CC chunk D ruling 3: the lib's own ceiling, a 32 KiB margin under the CHECK (refused by name past it). */
export const CONTEXT_SAFE_MAX_BYTES = CONTEXT_MAX_BYTES - 32 * 1024;

/** A JSON number as Postgres' numeric prints it: never in exponent form (1e-7 → 0.0000001, 1e21 → 1000…0). */
function numericText(n: number): string {
  const t = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(t);
  if (!m) return t;
  const [, sign, int, frac = "", expS] = m;
  const exp = Number(expS);
  const digits = int! + frac;
  const point = int!.length + exp;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * CC chunk D ruling 3: the byte length of `value::jsonb::text` — what 0275's CHECK `octet_length(context::text)` measures.
 * jsonb's text form puts a space after every `:` and `,` and spells numbers out, so it is LONGER than the canonical JSON
 * the digest reads. Object members with an `undefined` value are dropped, as JSON drops them. Pure; proved equal to
 * Postgres on PGlite (tests/schedule-context-guard.test.ts).
 */
export function jsonbTextBytes(v: unknown): number {
  const enc = new TextEncoder();
  const walk = (x: unknown): number => {
    if (x === null || x === undefined) return 4;
    if (typeof x === "boolean") return x ? 4 : 5;
    if (typeof x === "number") return Number.isFinite(x) ? numericText(x).length : 4;
    if (typeof x === "string") return enc.encode(JSON.stringify(x)).length;
    if (Array.isArray(x)) return 2 + x.reduce((n: number, e) => n + walk(e === undefined ? null : e), 0) + Math.max(0, x.length - 1) * 2;
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    return 2 + keys.reduce((n, k) => n + enc.encode(JSON.stringify(k)).length + 2 + walk(o[k]), 0) + Math.max(0, keys.length - 1) * 2;
  };
  return walk(v);
}

/** The context a revision will store fits, well under the CHECK — else `context_too_large` (en + es), before any RPC. */
export function assertContextFits(ctx: unknown): { bytes: number } {
  const bytes = jsonbTextBytes(ctx);
  if (bytes > CONTEXT_SAFE_MAX_BYTES) throw new ScheduleError("context_too_large", { params: { bytes, max: CONTEXT_SAFE_MAX_BYTES } });
  return { bytes };
}

/**
 * The snapshot a revision stores: the canonical context, its digest and its size. The digest is for
 * quick comparison only, never a substitute for the snapshot.
 */
export function toContextSnapshot(ctx: RuleContext): { context: RuleContext; json: string; digest: string; bytes: number } {
  const json = canonicalJson(ctx);
  return { context: JSON.parse(json) as RuleContext, json, digest: digest64(json), bytes: new TextEncoder().encode(json).length };
}

/** The context to replay ORIGINAL validation with — from the stored snapshot only. */
export function ruleContextFromSnapshot(stored: unknown): RuleContext {
  const v = typeof stored === "string" ? (JSON.parse(stored) as unknown) : stored;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("ruleContextFromSnapshot: not an object");
  const o = v as Partial<RuleContext>;
  if (o.version !== 1 || typeof o.locationId !== "string" || typeof o.today !== "string" || !Array.isArray(o.dates)
    || !o.days || !o.people || !o.budgetByDate || !o.closingWindowByDate) {
    throw new Error("ruleContextFromSnapshot: not a version-1 rule context");
  }
  return JSON.parse(canonicalJson(v)) as RuleContext;
}

// ─── The current-inputs advisory ─────────────────────────────────────────────

export type AdvisoryCode =
  | "member_removed" | "member_added" | "member_changed" | "availability_changed" | "budget_changed"
  | "structure_changed" | "closing_minutes_changed" | "day_type_changed" | "demand_changed" | "catering_changed" | "need_changed";

export interface AdvisoryItem { code: AdvisoryCode; date: string | null; userId: string | null; params: Record<string, string | number | null> }

const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const byKey = (a: AdvisoryItem, b: AdvisoryItem) =>
  (a.date ?? "").localeCompare(b.date ?? "") || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  || ((a.userId ?? "") < (b.userId ?? "") ? -1 : (a.userId ?? "") > (b.userId ?? "") ? 1 : 0);

/**
 * What changed between the snapshot a revision was validated with and the LIVE inputs: members gone /
 * added / changed, availability per person × date, per-date budgets, and per built date the structure
 * version, closing minutes, day type, demand, catering and the derived need. Deterministic order.
 * Shown beside the original verdict; it never changes it.
 */
export function contextAdvisory(snapshot: RuleContext, live: RuleContext): AdvisoryItem[] {
  const out: AdvisoryItem[] = [];
  const ids = [...new Set([...Object.keys(snapshot.people), ...Object.keys(live.people)])].sort();
  for (const id of ids) {
    const was = snapshot.people[id];
    const now = live.people[id];
    if (was?.activeMember && !now?.activeMember) { out.push({ code: "member_removed", date: null, userId: id, params: {} }); continue; }
    if (!was?.activeMember && now?.activeMember) { out.push({ code: "member_added", date: null, userId: id, params: {} }); continue; }
    if (!was || !now) continue;
    const { availability: wa, ...wRest } = was;
    const { availability: na, ...nRest } = now;
    if (!sameJson(wRest, nRest)) out.push({ code: "member_changed", date: null, userId: id, params: {} });
    for (const d of snapshot.dates) {
      if (!sameJson(wa[d] ?? "absent", na[d] ?? "absent")) out.push({ code: "availability_changed", date: d, userId: id, params: {} });
    }
  }
  for (const d of snapshot.dates) {
    const was = snapshot.budgetByDate[d] ?? null;
    const now = live.budgetByDate[d] ?? null;
    if (was !== now) out.push({ code: "budget_changed", date: d, userId: null, params: { from: was, to: now } });
    const wd = snapshot.days[d];
    const nd = live.days[d];
    if (!wd || !nd) continue;
    if (wd.structureVersionId !== nd.structureVersionId || !sameJson(wd.structure, nd.structure)) {
      out.push({ code: "structure_changed", date: d, userId: null, params: { from: wd.structureVersionId, to: nd.structureVersionId } });
    }
    if (wd.closingMinutes !== nd.closingMinutes) out.push({ code: "closing_minutes_changed", date: d, userId: null, params: { from: wd.closingMinutes, to: nd.closingMinutes } });
    if (wd.dayType !== nd.dayType || wd.inputs.dayTypeSource !== nd.inputs.dayTypeSource || wd.inputs.overrideId !== nd.inputs.overrideId) {
      out.push({ code: "day_type_changed", date: d, userId: null, params: { from: wd.dayType, to: nd.dayType } });
    }
    if (wd.inputs.demandKind !== nd.inputs.demandKind || !sameJson(wd.inputs.hourlyCents, nd.inputs.hourlyCents)) {
      out.push({ code: "demand_changed", date: d, userId: null, params: { from: wd.inputs.dayCents, to: nd.inputs.dayCents } });
    }
    if (!sameJson(wd.inputs.cateringEvents, nd.inputs.cateringEvents)) out.push({ code: "catering_changed", date: d, userId: null, params: {} });
    if (!sameJson(wd.need, nd.need)) out.push({ code: "need_changed", date: d, userId: null, params: {} });
  }
  return out.sort(byKey);
}
