/**
 * Materialises the shared schedule-structure case file (tests/fixtures/schedule/structure-cases.json)
 * into values. Plain JS so BOTH the vitest TS side (tests/schedule-structure.test.ts) and the 0274
 * PGlite harness (scripts/sql-harness-0274.mjs, Task 13) judge exactly the same inputs — the
 * `valid_schedule_structure` (SQL) ≡ `validScheduleStructure` (TS) twin (plan Task 1).
 *
 * Two bases: `defaults` (no positions — the shipped SCHEDULE_STRUCTURE_DEFAULTS, pinned equal by
 * vitest) and `shop` (the mockup v17 Capitol Hill position set under synthetic ids). A case is a
 * base with `set` applied (dotted paths; `$REG` … tokens expand to the shop's position ids in paths,
 * string values and the expected `key`; the string "__drop__" removes a key; `extra` adds a key),
 * or a `raw` value instead.
 */
import { readFileSync } from "node:fs";

export const CASE_POSITION_IDS = {
  $PREP: "5c000000-0000-4000-8000-000000000001",
  $DISH: "5c000000-0000-4000-8000-000000000002",
  $REG: "5c000000-0000-4000-8000-000000000003",
  $EXPO: "5c000000-0000-4000-8000-000000000004",
  $WALKON: "5c000000-0000-4000-8000-000000000005",
  $WALK: "5c000000-0000-4000-8000-000000000006",
  $BOI: "5c000000-0000-4000-8000-000000000007",
  $THIRD: "5c000000-0000-4000-8000-000000000008",
};

const ALL_FLOOR = ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"];
const crew = (prepHeads, prepUntilQ, setup, service, rush, closeWalk) => ({
  prepHeads, prepUntilQ, prepDishHeads: 1,
  waves: { setup: { heads: setup, atQ: 38 }, service: { heads: service }, rush: { heads: rush, atQ: 46 } },
  close: { registerHeads: 1, walkHeads: closeWalk, prepDishHeads: 1 },
  lineMinHeads: {},
});

/** THE shipped defaults (equal to SCHEDULE_STRUCTURE_DEFAULTS; vitest pins it). */
export const CASE_DEFAULTS = {
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
    keyHolderModAfterQ: null,
  },
  limits: {
    minimumShiftQ: 16, flexMinimumQ: 12, flexUsesPer2w: 1, flexMaxQ: 12, overtimeH: 40,
    managerFloorH: 32, gmMinimumH: 8, agmMinimumH: 8, closingMinutesOverride: null, segmentMinQ: 2, rushShiftMaxQ: 4, maxShiftH: 10.5, salariedStayLonger: true,
  },
  catering: { minHeadcount: 30, extraPrepDishHeads: 1, defaultStartQ: 34, defaultEndQ: 52, leadMinutes: 210 },
  labor: { targetPct: 28, basis: "total", strong: 0.8, watch: 0.65, budgetDeadbandH: 2 },
  roster: { excludedRoles: ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"] },
};

const I = CASE_POSITION_IDS;
const pos = (role, openQ, trimQ, closeQ, allowedRoles = ALL_FLOOR) => ({ role, openQ, trimQ, closeQ, headsBefore: 1, headsAfter: 1, allowedRoles });

/** The mockup v17 Capitol Hill set (times from its defaultStructure.stations, × 4). */
export function shopBase() {
  const s = structuredClone(CASE_DEFAULTS);
  s.positions = {
    [I.$PREP]: pos("prep", 28, 60, 68),
    [I.$DISH]: pos("prep_dish", 28, 68, 84, ["trainee", "employee", "trainer"]),
    [I.$REG]: pos("register", 42, 64, 84),
    [I.$EXPO]: pos("expo", 46, 64, 80),
    [I.$WALKON]: pos("walk_online", 42, 68, 84),
    [I.$WALK]: pos("walk", 42, 68, 84),
    [I.$BOI]: pos("line_other", 38, 56, 56),
    [I.$THIRD]: pos("line_other", 38, 62, 62),
  };
  s.priority = [
    { pair: [I.$DISH, I.$PREP], primary: I.$DISH },
    { pair: [I.$REG, I.$EXPO], primary: I.$REG },
    { pair: [I.$WALKON, I.$WALK], primary: I.$WALKON },
  ];
  for (const t of ["slow", "normal", "busy", "weekend"]) {
    s.crews[t].lineMinHeads = { [I.$REG]: 1, [I.$EXPO]: 0, [I.$WALKON]: 1, [I.$WALK]: 0, [I.$BOI]: 1, [I.$THIRD]: 1 };
  }
  return s;
}

const DROP = "__drop__";
const expand = (text) => Object.entries(I).reduce((t, [token, id]) => t.split(token).join(id), text);
const expandValue = (v) => (typeof v === "string" ? expand(v) : Array.isArray(v) ? v.map(expandValue)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [expand(k), expandValue(x)])) : v);

function setPath(obj, path, value) {
  const parts = expand(path).split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p];
  const last = parts[parts.length - 1];
  if (value === DROP) delete o[last];
  else o[last] = expandValue(value);
}

/** One case → the value both validators judge. */
export function materializeStructureCase(c) {
  if (Object.prototype.hasOwnProperty.call(c, "raw")) return expandValue(structuredClone(c.raw));
  const v = c.base === "shop" ? shopBase() : structuredClone(CASE_DEFAULTS);
  for (const [path, value] of Object.entries(c.set ?? {})) setPath(v, path, value);
  if (c.extra) setPath(v, c.extra.path, c.extra.value);
  return v;
}

/** The key the TS validator names for a case (tokens expanded); null for a valid case. */
export function expectedStructureKey(c) {
  return c.valid ? null : expand(c.key);
}

export function loadStructureCases(path = "tests/fixtures/schedule/structure-cases.json") {
  return JSON.parse(readFileSync(path, "utf8")).cases;
}
