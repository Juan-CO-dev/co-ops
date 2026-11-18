// Board two labor views PR 1: every leaf path of the serialized `laborViews` a money viewer (GM own shop, MoO+)
// may receive. Shop totals per day and per strip line; nothing per person, no wage, no rate. An unknown path
// fails tests/schedule-labor-views-e2e.test.ts. `x[]` = each element of x (or an array of scalars).
const FIGURE = [
  "minutes", "otMinutes", "straightCents", "otPremiumCents", "pureHourlyCents", "salariedCents", "burdenCents", "fullyLoadedCents",
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
