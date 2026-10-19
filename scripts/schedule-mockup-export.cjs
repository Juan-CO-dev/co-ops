/**
 * Read-only export of Juan's approved mockup v17 sample week, for the validator parity pin
 * (Scheduling Phase 2, plan Task 3 Step 2). Runs the page script in `vm` — the technique of the
 * mockup's own harness (schedule-invariants.test.cjs) — with DOM drawing replaced, and refuses if the
 * page's boot marker moved. Writes to stdout:
 *   - the sample week's shifts, `defaultStructure`, the shop day, `today`, the people (role, leader
 *     setting, cover preferences, work type, days off, salaried / visitor);
 *   - for each negative control of the mockup harness, the shifts it judged AND the mockup's own
 *     `checkInvariants` messages on them, so the parity test compares SUBJECTS, not totals.
 * Run once; the JSON is committed and its header names the source file's SHA-256. The app never
 * imports the mockup.
 *
 *   node scripts/schedule-mockup-export.cjs C:/co/share/schedule-board/schedule-board.html > tests/fixtures/schedule/mockup-v17-week.json
 */
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const path = require("node:path");

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/schedule-mockup-export.cjs <schedule-board.html>");
  process.exit(2);
}
const html = fs.readFileSync(source, "utf8");
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error("no <script> in the mockup");
let script = match[1].replace(/function render\(\)\{[^\n]*\}/, "function render(){}");

const harness = `
const plain = (v) => JSON.parse(JSON.stringify(v));
const baseline = shifts.map(cloneShift);
const controls = {};
{ // (c)+(d): the short Owner shift on Prep/Dishwasher (the mockup harness's first negative control).
  const changed = baseline.find(s => s.day === 2 && s.position !== 'mod');
  const short = {...cloneShift(changed), id: 99999, person: 'pete', start: 70, end: 72, position: 'prepDish', segments: [{position: 'prepDish', start: 70, end: 72}]};
  controls.short_pete = { added: plain([short]), messages: checkInvariants([...baseline, short]) };
}
{ // (g): Dani ("Opens only") extended to scheduled out on Manager on duty.
  const forbidden = cloneShift(baseline.find(s => s.person === 'dani' && s.day >= 2));
  forbidden.end = scheduledOut() * 4; forbidden.segments = [{position: 'mod', start: forbidden.start, end: forbidden.end}];
  controls.g_dani = { list: plain([forbidden]), messages: checkInvariants([forbidden]) };
}
{ // (h): the primary Walk-ins / Online removed wherever a secondary Walk-ins slot overlaps.
  const secondary = baseline.find(s => s.day >= 2 && segmentsOf(s).some(g => g.position === secondaryFor('walk')));
  const q = segmentsOf(secondary).find(g => g.position === secondaryFor('walk')).start;
  const removed = baseline.filter(s => s.day === secondary.day && segmentsOf(s).some(g => g.position === primaryFor('walk') && g.start <= q && g.end > q));
  const withoutPrimary = baseline.filter(s => !removed.includes(s));
  controls.h_without_primary = { removedIds: removed.map(s => s.id), messages: checkInvariants(withoutPrimary) };
}
{ // (i): Alex (GM) on Walk-ins with an unmarked reason.
  const manager = cloneShift(baseline.find(s => s.person === 'alex' && s.day >= 2));
  manager.segments = [{position: 'walk', start: manager.start, end: manager.end, reason: 'Unmarked cover'}]; manager.position = 'walk';
  controls.i_alex = { list: plain([manager]), messages: checkInvariants([manager]) };
}
__export.value = {
  today, days, shopDay: plain(shopDay), scheduledOutQ: scheduledOut() * 4, checklistMinutes: structure.limits.checklistMinutes,
  revenue: plain(revenue), defaultStructure: plain(defaultStructure), priorityPairs: plain(priorityPairs),
  people: people.map(p => ({ id: p.id, role: p.role, workType: p.workType, alsoAllowed: plain(p.alsoAllowed), off: plain(p.off),
    leaderShift: leaderShifts[p.id] ?? null, coverPreferences: p.coverPreferences ? plain(p.coverPreferences) : null,
    salaried: !!p.salary, visitor: !!p.visitor, hourly: !!p.wage, flexDay: p.flexDay })),
  shifts: plain(baseline),
  sampleProblems: checkInvariants(baseline),
  controls,
};
`;
const marker = "renderShopDay();renderStructure();renderStaffSettings();render();\n  if(window.matchMedia";
if (!script.includes(marker)) throw new Error("Page boot marker changed — re-verify the mockup before exporting");
script = script.replace(marker, harness + "\n  if(window.matchMedia");
const element = () => ({ addEventListener() {}, classList: { toggle() {} }, querySelector() { return element(); }, querySelectorAll() { return []; },
  set textContent(v) {}, get textContent() { return ""; }, set innerHTML(v) {}, get innerHTML() { return ""; } });
const __export = { value: null };
vm.runInNewContext(script, { console, structuredClone, __export, document: { getElementById: () => element(), querySelector: () => element() },
  window: { matchMedia: () => ({ matches: false }) }, setTimeout, clearTimeout });
if (!__export.value) throw new Error("the export harness did not run");

const out = {
  _header: {
    source: path.basename(source),
    sha256,
    exportedBy: "scripts/schedule-mockup-export.cjs",
    note: "Read-only vm export of mockup v17 (Scheduling Phase 2 Task 3). Regenerate only when Juan approves a new mockup, with a written reason.",
  },
  ...__export.value,
};
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
