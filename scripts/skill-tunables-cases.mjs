/**
 * Materialises the shared skill-tunables case file (tests/fixtures/skill-tunables-cases.json) into
 * values. Plain JS so BOTH the vitest TS side (tests/people-skill-tunables.test.ts) and the 0270
 * PGlite harness (scripts/sql-harness-0270.mjs) build exactly the same inputs.
 *
 * The defaults here are the SQL harness's starting point; vitest pins them equal to
 * SKILL_TUNABLE_DEFAULTS, so the two can never drift.
 */
import { readFileSync } from "node:fs";

export const CASE_DEFAULTS = {
  priorWhenNoRating: 0.5,
  priorStrength: 6,
  weights: { pm: 0.6, closeOnTime: 0.2, prepYield: 0.2 },
  gradeValue: { great: 1, good: 0.6, needs_work: 0.2 },
  yieldTolerance: 0.15,
  closeGraceMinutes: 15,
  bands: { building: 0.45, strong: 0.75 },
  minQualityDaysForLearned: 3,
  windowDays: 90,
};

const DROP = "__drop__";

function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p];
  const last = parts[parts.length - 1];
  if (value === DROP) delete o[last];
  else o[last] = value;
}

/** One case → the value both validators judge. */
export function materializeTunablesCase(c) {
  if (Object.prototype.hasOwnProperty.call(c, "raw")) return structuredClone(c.raw);
  const v = structuredClone(CASE_DEFAULTS);
  for (const [path, value] of Object.entries(c.set ?? {})) setPath(v, path, value);
  if (c.extra) setPath(v, c.extra.path, c.extra.value);
  return v;
}

export function loadTunablesCases(path = "tests/fixtures/skill-tunables-cases.json") {
  return JSON.parse(readFileSync(path, "utf8")).cases;
}
