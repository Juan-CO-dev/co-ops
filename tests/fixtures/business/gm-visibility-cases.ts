// What GMs can see in the business report: the ONE case file for the row's shape. The SQL validator
// (0349 valid_business_report_gm_visibility) and the TS parser (parseGmVisibility) must agree on every case
// (tests/business-report-visibility-0349-migration.test.ts).
const ON = { report: true, hourly_cost: true, loaded: true, quarters: true, channels: true, people: true, servers: true, compare: true, export: true };
const OFF = { report: false, hourly_cost: false, loaded: false, quarters: false, channels: false, people: false, servers: false, compare: false, export: false };
const without = (k: keyof typeof ON) => { const { [k]: _drop, ...rest } = ON; return rest; };

export const GM_VISIBILITY_CASES: ReadonlyArray<{ name: string; value: unknown; valid: boolean }> = [
  { name: "everything on", value: ON, valid: true },
  { name: "everything off", value: OFF, valid: true },
  { name: "the defaults (fully loaded off)", value: { ...ON, loaded: false }, valid: true },
  { name: "hours and sales only", value: { ...ON, hourly_cost: false, loaded: false }, valid: true },
  { name: "report on, nothing else", value: { ...OFF, report: true }, valid: true },
  { name: "report and one tab", value: { ...OFF, report: true, compare: true }, valid: true },
  { name: "fully loaded on under hourly cost off", value: { ...ON, hourly_cost: false }, valid: false },
  { name: "a tab on under report off", value: { ...OFF, channels: true }, valid: false },
  { name: "downloads on under report off", value: { ...OFF, export: true }, valid: false },
  { name: "hourly cost on under report off", value: { ...OFF, hourly_cost: true }, valid: false },
  { name: "everything but the report", value: { ...ON, report: false }, valid: false },
  { name: "a key missing", value: without("export"), valid: false },
  { name: "the first key missing", value: without("report"), valid: false },
  { name: "an extra key", value: { ...ON, extra: true }, valid: false },
  { name: "a tenth key that is not a switch (cost per person)", value: { ...ON, person_cost: false }, valid: false },
  { name: "a swapped key (labor dollars per 15 minutes instead of compare)", value: { ...without("compare"), quarter_cost: true }, valid: false },
  { name: "a number for a boolean", value: { ...ON, report: 1 }, valid: false },
  { name: "a string for a boolean", value: { ...ON, loaded: "true" }, valid: false },
  { name: "null for a boolean", value: { ...ON, people: null }, valid: false },
  { name: "a nested object for a boolean", value: { ...ON, servers: { on: true } }, valid: false },
  { name: "an array for a boolean", value: { ...ON, quarters: [true] }, valid: false },
  { name: "an empty object", value: {}, valid: false },
  { name: "an array", value: [ON], valid: false },
  { name: "an empty array", value: [], valid: false },
  { name: "a string", value: "report", valid: false },
  { name: "a number", value: 9, valid: false },
  { name: "true", value: true, valid: false },
  { name: "JSON null", value: null, valid: false },
];
