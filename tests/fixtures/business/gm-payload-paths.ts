// Business report access: what a GM's serialized report may hold, WRITTEN BY HAND (never imported from lib/).
// tests/business-report-gm-payload.test.ts runs the real loader under every coherent setting and fails by name on a
// path that is not here, on a path of a group that is off, and on a group that is on but missing.
// `x[]` = each element of x. A leaf path is in the base or in exactly ONE group.
const LABOR = ["days[].labor", "weeks[].labor", "total.labor"];
const under = (prefixes: string[], keys: string[]) => prefixes.flatMap((p) => keys.map((k) => `${p}.${k}`));
const CUT = ["key", "label", "provider", "cents", "checks", "amountMissing", "unassigned"];

/** In every report a GM gets: identity, the range, what the report holds, sales, hours, net sales, rushes, targets. */
export const BASE = [
  "locationId",
  "range.range", "range.from", "range.to", "range.days", "range.shortened", "range.empty", "range.previous.from", "range.previous.to",
  "range.lastYear", "range.lastYear.from", "range.lastYear.to", "range.lastYearReason",
  "access.report", "access.hourlyCost", "access.loaded", "access.quarters", "access.channels", "access.people", "access.servers", "access.compare",
  "access.export", "access.personCost", "access.quarterCost",
  "days[].date", "days[].cuts",
  ...under(["days[].sales"], ["date", "coverage", "checks", "toastChecksCents", "toastAmountMissing", "toastNetCents", "ezcaterCents", "ezcaterOrders", "ezcaterMissing",
    "refundCents", "totalCents", "giftCardCents", "ezcaterLinkedCents"]),
  // Labor HOURS and net sales (and why they are not final): never labor money.
  ...under(LABOR, ["state", "minutes", "otMinutes", "denominator", "denominator.cents", "denominator.state", "hoursUnverified"]),
  "days[].largeChecks.checks", "days[].largeChecks.cents",
  "days[].rush", ...under(["days[].rush"], ["state", "uncompared", "untimed", "baselineUntimed", "windows[].startAt", "windows[].endAt", "windows[].quarters",
    "windows[].checks", "windows[].cents", "windows[].baselineChecks", "windows[].baselineCents"]),
  "weeks[].weekStart", "weeks[].from", "weeks[].to", "weeks[].target", "weeks[].loadedTarget",
  ...under(["total.sales"], ["totalCents", "toastChecksCents", "toastNetCents", "ezcaterCents", "refundCents", "coverage"]),
  "total.target", "total.loadedTarget",
  // The 15-minute grid's two keys and its reason are always there (null / "not_shared" when the grid is not).
  "quarters", "quartersUnassigned", "quartersReason",
  "largeChecks.checks", "largeChecks.cents",
  ...under(["rushRule"], ["multiplier", "historyWeeks", "minHistory", "minChecks", "minBaselineChecks", "minRunQuarters"]),
];

/** The switch (snake_case, as saved) that puts each group in a GM's report. `null` = never a GM's, whatever is saved. */
export const GROUPS: Record<string, { switch: string | null; paths: string[] }> = {
  hourlyCost: { switch: "hourly_cost", paths: under(LABOR, ["pureHourlyCents", "otPremiumCents", "pct", "tone", "wageEstimated"]) },
  loaded: { switch: "loaded", paths: under(LABOR, ["loadedState", "salariedCents", "burdenCents", "fullyLoadedCents", "loadedPct", "loadedTone", "burdenEstimated",
    "salaryEstimated", "salaryGaps"]) },
  quarters: { switch: "quarters", paths: [
    ...under(["quarters[]"], ["date", "quarterStartAt", "wallQuarter", "fold", "toastCents", "checks", "amountMissing", "laborMinutes", "basis", "tone"]),
    ...under(["quartersUnassigned[]"], ["date", "toastCents", "checks", "amountMissing"])] },
  channels: { switch: "channels", paths: [...under(["channels.included[]"], CUT), ...under(["channels.excluded[]"], CUT)] },
  people: { switch: "people", paths: under(["people[]"], ["personKey", "label", "source", "payClass", "minutes", "otMinutes", "weeksSuppressed"]) },
  servers: { switch: "servers", paths: under(["servers[]"], CUT) },
  // MoO / Owner / CGS only (PERSON_COST_MIN, QUARTER_COST_MIN): no setting opens these for a GM.
  personCost: { switch: null, paths: ["people[].straightCostCents"] },
  quarterCost: { switch: null, paths: ["quarters[].straightCents", "quarters[].pct"] },
};
/** The top-level keys a group's lists live under: absent (channels, people, servers) or null (the grid) when off. */
export const LIST_KEYS: Record<string, string[]> = { channels: ["channels"], people: ["people"], servers: ["servers"], quarters: ["quarters", "quartersUnassigned"] };
