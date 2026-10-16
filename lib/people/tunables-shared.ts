/**
 * THE SKILL TUNABLES — the skill model's constants as settings (R11). Pure, client-safe.
 *
 * Scheduling Phase 1, Tasks 14–15. `SKILL_TUNABLE_DEFAULTS` are the starting values; a MoO+ may store
 * one company row (`people_skill_tunables.location_id IS NULL`) and an optional row per shop (J19).
 * No row = the defaults, so nothing is seeded. The pure skill model (skills-shared.ts) takes a resolved
 * `SkillTunables` as a PARAMETER and never imports the defaults itself.
 *
 * ONE RULE SET, TWICE (r2 #3): `validSkillTunables` here and `public.valid_skill_tunables(jsonb)` in
 * 0270 (the CHECK on the table) accept and refuse EXACTLY the same values. Both are pinned against
 * one shared case file, `tests/fixtures/skill-tunables-cases.json` — vitest runs it here, the 0270
 * PGlite harness runs it against the SQL twin. A change to one side without the other fails a test.
 *
 * The rules:
 *  - exactly the known keys (nested objects too), each a JSON number — never a string, null, NaN or
 *    ±Infinity — and never a nonzero value below the smallest normal double (both sides refuse it);
 *  - priorWhenNoRating ∈ [0, 1]; priorStrength (k) ∈ (0, 60];
 *  - weights.pm / closeOnTime / prepYield each ≥ 0, NO per-weight cap (CC ruling 2026-10-15, Astra r3
 *    P3: 3 / 1 / 1 is valid and means 0.6 / 0.2 / 0.2), at least one > 0, and their double-precision sum
 *    (pm + closeOnTime) + prepYield finite (three weights of 1e308 overflow and are refused);
 *  - gradeValue.great ≥ good ≥ needs_work, each ∈ [0, 1];
 *  - yieldTolerance ∈ [0.01, 0.5]; closeGraceMinutes ∈ [0, 120];
 *  - 0 < bands.building < bands.strong < 1 (strict at both ends);
 *  - minQualityDaysForLearned an integer ∈ [0, 30]; windowDays an integer ∈ [7, 365].
 * A rejected set leaves the previous set live: the lib refuses before the write (`invalid_tunables`,
 * naming the key) and the CHECK fails the one upsert statement if a bad set ever reached SQL.
 */

export interface SkillTunables {
  /** The prior when no manager rating exists (J5: neutral). */
  priorWhenNoRating: number;
  /** k: how many quality-observed DAYS the prior is worth. */
  priorStrength: number;
  /** Normalised at use over the COUNTING kinds; 0 = shown as evidence, not counted. */
  weights: { pm: number; closeOnTime: number; prepYield: number };
  /** A PM grade → [0, 1]. */
  gradeValue: { great: number; good: number; needs_work: number };
  /** A batch is on target within ± this fraction of the recipe yield (the 0218 band). */
  yieldTolerance: number;
  closeGraceMinutes: number;
  /** < building = Building · building..strong = Solid · ≥ strong = Strong. */
  bands: { building: number; strong: number };
  /** Below this many quality days the skill reads "Starting point" (prior-led). */
  minQualityDaysForLearned: number;
  /** The evidence window, in ET business days ending on the as-of day. */
  windowDays: number;
}

export const SKILL_TUNABLE_DEFAULTS: SkillTunables = deepFreeze({
  priorWhenNoRating: 0.5,
  priorStrength: 6,
  weights: { pm: 0.6, closeOnTime: 0.2, prepYield: 0.2 },
  gradeValue: { great: 1, good: 0.6, needs_work: 0.2 },
  yieldTolerance: 0.15,
  closeGraceMinutes: 15,
  bands: { building: 0.45, strong: 0.75 },
  minQualityDaysForLearned: 3,
  windowDays: 90,
});

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v as object);
  return Object.freeze(o);
}

/** The keys, in order. The SQL twin lists the same keys. */
export const SKILL_TUNABLE_KEYS = [
  "priorWhenNoRating", "priorStrength", "weights", "gradeValue", "yieldTolerance", "closeGraceMinutes",
  "bands", "minQualityDaysForLearned", "windowDays",
] as const;
const NESTED: Record<string, readonly string[]> = {
  weights: ["pm", "closeOnTime", "prepYield"],
  gradeValue: ["great", "good", "needs_work"],
  bands: ["building", "strong"],
};

/** The smallest positive NORMAL double. A nonzero magnitude below it is refused on both sides. */
export const MIN_NORMAL_DOUBLE = 2.2250738585072014e-308;

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && (v === 0 || Math.abs(v) >= MIN_NORMAL_DOUBLE);
}
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

/**
 * The first rule a value breaks, as the dotted key it names (`"bands.strong"`, `"weights"`), or null
 * when the value is a valid `SkillTunables`. `"tunables"` = not an object with exactly the known keys.
 */
export function tunablesProblem(value: unknown): string | null {
  if (!plainObject(value) || !exactKeys(value, SKILL_TUNABLE_KEYS)) return "tunables";
  for (const [k, inner] of Object.entries(NESTED)) {
    const o = value[k];
    if (!plainObject(o) || !exactKeys(o, inner)) return k;
    for (const ik of inner) if (!num(o[ik])) return `${k}.${ik}`;
  }
  for (const k of ["priorWhenNoRating", "priorStrength", "yieldTolerance", "closeGraceMinutes", "minQualityDaysForLearned", "windowDays"]) {
    if (!num(value[k])) return k;
  }
  const t = value as unknown as SkillTunables;
  if (!inRange(t.priorWhenNoRating, 0, 1)) return "priorWhenNoRating";
  if (!(t.priorStrength > 0 && t.priorStrength <= 60)) return "priorStrength";
  const { pm, closeOnTime, prepYield } = t.weights;
  if (pm < 0) return "weights.pm";
  if (closeOnTime < 0) return "weights.closeOnTime";
  if (prepYield < 0) return "weights.prepYield";
  const sum = pm + closeOnTime + prepYield; // (pm + closeOnTime) + prepYield, as the SQL twin adds
  if (!Number.isFinite(sum) || !(sum > 0)) return "weights";
  const g = t.gradeValue;
  if (!inRange(g.great, 0, 1)) return "gradeValue.great";
  if (!inRange(g.good, 0, 1)) return "gradeValue.good";
  if (!inRange(g.needs_work, 0, 1)) return "gradeValue.needs_work";
  if (!(g.great >= g.good && g.good >= g.needs_work)) return "gradeValue";
  if (!inRange(t.yieldTolerance, 0.01, 0.5)) return "yieldTolerance";
  if (!inRange(t.closeGraceMinutes, 0, 120)) return "closeGraceMinutes";
  if (!(t.bands.building > 0)) return "bands.building";
  if (!(t.bands.strong < 1)) return "bands.strong";
  if (!(t.bands.building < t.bands.strong)) return "bands";
  if (!Number.isInteger(t.minQualityDaysForLearned) || !inRange(t.minQualityDaysForLearned, 0, 30)) return "minQualityDaysForLearned";
  if (!Number.isInteger(t.windowDays) || !inRange(t.windowDays, 7, 365)) return "windowDays";
  return null;
}

/** True when the value is a complete, in-range `SkillTunables` (the SQL CHECK's twin). */
export function validSkillTunables(value: unknown): value is SkillTunables {
  return tunablesProblem(value) === null;
}

/**
 * The tunables in force at a shop: the shop's row, else the company row, else the defaults. A stored
 * row the validator refuses (it cannot pass the CHECK, so this is defence only) is skipped.
 */
export function resolveTunables(company: unknown, shop: unknown): SkillTunables {
  if (validSkillTunables(shop)) return shop;
  if (validSkillTunables(company)) return company;
  return SKILL_TUNABLE_DEFAULTS;
}

/** Canonical JSON (keys in the declared order), so two equal sets print the same text. */
export function canonicalTunables(t: SkillTunables): string {
  return JSON.stringify({
    priorWhenNoRating: t.priorWhenNoRating, priorStrength: t.priorStrength,
    weights: { pm: t.weights.pm, closeOnTime: t.weights.closeOnTime, prepYield: t.weights.prepYield },
    gradeValue: { great: t.gradeValue.great, good: t.gradeValue.good, needs_work: t.gradeValue.needs_work },
    yieldTolerance: t.yieldTolerance, closeGraceMinutes: t.closeGraceMinutes,
    bands: { building: t.bands.building, strong: t.bands.strong },
    minQualityDaysForLearned: t.minQualityDaysForLearned, windowDays: t.windowDays,
  });
}

/** A short digest of the resolved tunables (FNV-1a over the canonical JSON), for `SkillMatrix.tunablesVersion`. */
export function tunablesDigest(t: SkillTunables): string {
  let h = 0x811c9dc5;
  for (const ch of canonicalTunables(t)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
