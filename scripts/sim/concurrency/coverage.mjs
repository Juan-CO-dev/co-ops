/**
 * CONCURRENCY HARNESS — authority-coverage hunt (sim-2, 2026-08-11).
 *
 * The headline test Juan's shift model demands: at every hour, does someone
 * with enough role-level exist to DO or AUTHORIZE every task that must happen
 * then? The authority baton passes GM/AGM (early) → SL (midday) → KH (close),
 * and KHs close the store ALONE. So every close-critical action must clear the
 * role floor of the HIGHEST role reliably present at that hour.
 *
 * Method: probe each close-critical write as an actual KH session (level 4 —
 * the lone closer) and as an AGM session (level 6). A KH 403 on a close-time
 * action is a COVERAGE GAP candidate (or an intended manager-ritual — Juan
 * rules). We assert against the KNOWN floors (grounded from lib/) and confirm
 * the live app enforces them, then map to the schedule.
 *
 * Static seed hypotheses (from lib/ floors, pre-grounded):
 *   counts read+write = AGM+ (6)      → KH closing alone CANNOT count
 *   PO reconcile      = AGM+ (6)      → KH CANNOT reconcile an evening invoice
 *   closing confirm   = dynamic: max item min_role_level in the checklist
 *                                    → if any closing item is >KH, the lone
 *                                      closer CANNOT confirm the close (P1 shape)
 *   cash report / receive / par-walk / pm report = KH+ (4)  → KH ok
 */
import { Session, findUser, makeReport, db, LOC, todayEt } from "./driver.mjs";

// Who reliably holds the baton at each block (Juan's model).
const SCHEDULE = [
  { block: "open 7-11", topRole: "gm/agm", topLevel: 7 },
  { block: "midday 11-16", topRole: "agm/sl", topLevel: 6 },
  { block: "afternoon 16-19", topRole: "sl/kh", topLevel: 5 },
  { block: "close 19-20:30", topRole: "kh", topLevel: 4 }, // the lone closer
];

// close-critical actions × the role floor the app enforces × when they must run.
const ACTIONS = [
  { key: "cash_report", floor: 4, mustRunBy: "close 19-20:30", note: "KH signs the drawer" },
  { key: "closing_confirm", floor: "dynamic", mustRunBy: "close 19-20:30", note: "KH confirms the close" },
  { key: "physical_count", floor: 6, mustRunBy: "close 19-20:30", note: "closing/variance count" },
  { key: "po_reconcile", floor: 6, mustRunBy: "afternoon 16-19", note: "evening invoice reconcile" },
  { key: "receive_delivery", floor: 4, mustRunBy: "midday 11-16", note: "truck at the door" },
  { key: "par_walk_order", floor: 4, mustRunBy: "midday 11-16", note: "reorder walk" },
  { key: "pm_report", floor: 4, mustRunBy: "afternoon 16-19", note: "manager wrap-up" },
];

const LEVEL = { employee: 3, key_holder: 4, shift_lead: 5, agm: 6, gm: 7 };

async function run() {
  const { check, done } = makeReport("COVERAGE-GAP HUNT");
  const loc = LOC.EM;

  // Grounded floors → schedule coverage analysis (static, no server needed first).
  console.log("\n── Authority-vs-schedule analysis (grounded floors) ──");
  for (const a of ACTIONS) {
    const blk = SCHEDULE.find((s) => s.block === a.mustRunBy);
    if (a.floor === "dynamic") {
      // Resolve the real closing-confirm floor from the sim's closing template items.
      const { data: rows, error } = await db
        .from("checklist_template_items")
        .select("min_role_level, checklist_templates!inner(type, location_id)")
        .eq("checklist_templates.type", "closing")
        .eq("checklist_templates.location_id", loc);
      if (error) { check(`resolve closing-confirm floor`, false, error.message); continue; }
      const maxFloor = Math.max(0, ...(rows ?? []).map((r) => r.min_role_level ?? 0));
      const gap = maxFloor > blk.topLevel;
      check(
        `closing_confirm floor (${maxFloor}) ≤ lone-closer level (${blk.topLevel})`,
        !gap,
        gap
          ? `⚠ COVERAGE GAP: a closing item requires level ${maxFloor} but the KH who closes is level ${blk.topLevel} — the lone closer cannot confirm the close`
          : `ok — every closing item ≤ KH`,
      );
    } else {
      const gap = a.floor > blk.topLevel;
      check(
        `${a.key} floor (${a.floor}) ≤ top role at "${a.mustRunBy}" (${blk.topLevel})`,
        !gap,
        gap ? `⚠ COVERAGE GAP: ${a.note} needs level ${a.floor}, top role present is ${blk.topLevel}` : `ok`,
      );
    }
  }

  // LIVE enforcement probes — confirm the app actually gates as grounded (a
  // floor that's documented but not enforced is its own finding).
  console.log("\n── Live enforcement probes (KH session) ──");
  const khUser = await findUser(loc, "key_holder", "Rosa Delgado").catch(() => null)
    ?? await findUser(loc, "key_holder");
  const kh = await new Session(khUser, "4444").login(loc);

  // KH → counts write should 403 (floor 6). Confirms the gap is real & enforced.
  const cRes = await kh.call("POST", "/api/operations/counts", { locationId: loc, note: null, lines: [] });
  check("KH physical_count is gated (expect 403 forbidden)", cRes.status === 403,
    `got ${cRes.status} ${cRes.code ?? ""} — ${cRes.status === 403 ? "gap CONFIRMED enforced" : "unexpected; investigate"}`);

  // KH → receiving form load should be allowed (floor 4).
  const rRes = await kh.call("GET", `/api/operations/receiving/template?location=${loc}&vendorId=`);
  check("KH receiving is permitted (not 403)", rRes.status !== 403, `got ${rRes.status}`);

  return done();
}

run().then((r) => process.exit(r.fails.length ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
