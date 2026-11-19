// Board two labor views PR 1: every leaf path of the serialized `laborViews` a money viewer (GM own shop, MoO+)
// may receive. Shop totals per day and per strip line; nothing per person, no wage, no rate. An unknown path
// fails tests/schedule-labor-views-e2e.test.ts. `x[]` = each element of x (or an array of scalars).
const FIGURE = [
  "minutes", "hourlyMinutes", "otMinutes", "straightCents", "otPremiumCents", "pureHourlyCents", "salariedCents", "burdenCents", "fullyLoadedCents",
  // PR 3 (the heads maths): the burden % is the shop's setting (never a wage); the hourly minutes are hours.
  "burdenPct",
  "sales.basis", "sales.cents", "pureHourlyPct", "pureHourlyTone", "fullyLoadedPct", "fullyLoadedTone", "otState",
  "rateEstimated", "burdenEstimated", "salaryProjected", "salaryGaps", "reasons[]",
] as const;
const under = (prefix: string, keys: readonly string[]) => keys.map((k) => `${prefix}.${k}`);

export const BOARD_LABOR_VIEW_PATHS: readonly string[] = [
  ".state", ".targets.hourlyPct", ".targets.loadedPct",
  ...under(".days[]", ["date", "kind", ...FIGURE]),
  ".strip.actual", ...under(".strip.actual", ["days", ...FIGURE]),
  ".strip.projected", ...under(".strip.projected", ["days", ...FIGURE]),
  ".strip.notSettledDays", ".strip.noScheduleDays",
];

// PR 3: with the labor views ON, every key path of a money viewer's WHOLE serialized board is one of: the AGM's reviewed
// paths (tests/fixtures/schedule/agm-board-paths.ts), `laborViews` (above), or one of these, reviewed one by one. An
// unknown path fails tests/schedule-board-labor-views.test.ts; a listed path nothing emits fails it too.
/** A GM (and up): hours per hour, and the labor card's DAY figures (the allowance, the day's salaries, the day's blended
 * straight wage, the max hours, the verdict). Nothing per hour or per window in dollars or %. */
export const GM_VIEWS_BOARD_EXTRA_PATHS: readonly string[] = [
  ".days[].hoursByHour[].hour", ".days[].hoursByHour[].hours",
  ".days[].labor.maxLaborCents", ".days[].labor.salariedDayCents", ".days[].labor.blendedWageCents", ".days[].labor.maxHours",
  ".days[].labor.lines[].params.salesCents", ".days[].labor.lines[].params.burdenPct", ".days[].labor.lines[].params.salariedDayCents",
  ".days[].labor.lines[].params.allowanceCents", ".days[].labor.lines[].params.premiumCents", ".days[].labor.lines[].params.wageCents",
  ".days[].labor.lines[].params.projectedCents", ".days[].labor.lines[].params.diffCents",
  ".days[].labor.lines[].params.maxLaborCents", ".days[].labor.lines[].params.minCostCents",
];
/** MoO / Owner / CGS only (`canSeeSubDayLaborMoney`): straight-time % per hour, the forecast $ per hour, and the labor
 * card's per-window intermediates. A GM's board carries NONE of these with the views on. */
export const SUB_DAY_VIEWS_BOARD_EXTRA_PATHS: readonly string[] = [
  ".days[].laborByHour[].hour", ".days[].laborByHour[].pct", ".days[].laborByHour[].tone",
  ".days[].centsByHour[].hour", ".days[].centsByHour[].cents",
  ".days[].labor.windows[].demandShare", ".days[].labor.windows[].spreadHeads", ".days[].labor.windows[].onMin",
  ".days[].labor.windows[].shortQuarters", ".days[].labor.windows[].overQuarters",
];
