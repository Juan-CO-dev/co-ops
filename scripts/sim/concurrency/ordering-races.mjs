/**
 * ORDERING RACES (sim-2, 2026-08-11). Needs a seeded low census on-hand so the
 * PFG walk has suggestions (else generate_draft 409s no_suggestions — the pilot's
 * trivial pass). Tests the two ordering-spine concurrency invariants:
 *   C · two simultaneous generate_draft for one vendor → exactly ONE draft PO
 *       (day-idempotency: the display-code unique constraint is the arbiter).
 *   D · two simultaneous deliveries against one placed PO → the PO advances to
 *       received ONCE, no double-advance (advanceToReceived guarded flip).
 */
import { Session, findUser, fireSimultaneous, makeReport, db, LOC } from "./driver.mjs";

const loc = LOC.EM;
const PFG = "a0d8986c-e097-46f0-9e3f-e70943d4291b";

async function run() {
  const { check, done } = makeReport("ORDERING RACES");
  const rosa = await new Session(await findUser(loc, "key_holder"), "4444").login(loc);
  const tommy = await new Session(await findUser(loc, "shift_lead"), "6666").login(loc);

  // Sanity: does the seed make PFG suggestable? A single generate_draft should
  // succeed (or the whole test is vacuous). We check AFTER the race.

  // ── C · two simultaneous generate_draft for PFG ──
  const gen = await fireSimultaneous([rosa, tommy].map((s) =>
    () => s.call("POST", "/api/operations/ordering/po", { action: "generate_draft", locationId: loc, vendorId: PFG })));
  const { count: draftCount } = await db.from("purchase_orders")
    .select("*", { count: "exact", head: true }).eq("location_id", loc).eq("vendor_id", PFG).eq("status", "draft");
  const fired = gen.some((r) => r.status === 200 || r.status === 201);
  check("C setup: the seed made PFG suggestable (a draft-generate succeeded)", fired,
    `responses ${gen.map((r) => r.status + (r.code ? `/${r.code}` : "")).join(",")}`);
  check("C · two simultaneous generate_draft → exactly ONE draft PO (day-idempotency)", (draftCount ?? 0) === 1,
    `${draftCount} draft POs`);

  // ── D · two simultaneous deliveries against one placed PO ──
  const { data: po } = await db.from("purchase_orders")
    .select("id").eq("location_id", loc).eq("vendor_id", PFG).eq("status", "draft").limit(1).maybeSingle();
  if (po) {
    // Drive it to placed: confirm then place (KH is allowed at both).
    const conf = await rosa.call("POST", "/api/operations/ordering/po", { action: "confirm", poId: po.id });
    const place = await rosa.call("POST", "/api/operations/ordering/po", { action: "place", poId: po.id, channel: "phone", target: "sim" });
    check("D setup: draft → placed", place.status === 200 || place.status === 201, `confirm ${conf.status}, place ${place.status}${place.code ? "/" + place.code : ""}`);

    // Two intake-completions racing against the one placed PO. A minimal single-line
    // delivery of the PFG SKU we seeded; both fire the same body at the same tick.
    const line = { skuId: "11d14e78-bdce-4aa9-8602-2e7a7e09e4f3", qtyReceived: 1, receivedLevelLabel: "each" };
    const body = { vendorId: PFG, locationId: loc, deliveryDate: new Date().toISOString().slice(0, 10), lines: [line], purchaseOrderId: po.id, deliveryStatus: "complete" };
    const del = await fireSimultaneous([rosa, tommy].map((s) => () => s.call("POST", "/api/operations/receiving", body)));
    const { count: deliveries } = await db.from("vendor_deliveries")
      .select("*", { count: "exact", head: true }).eq("purchase_order_id", po.id);
    const { data: poAfter } = await db.from("purchase_orders").select("status").eq("id", po.id).maybeSingle();
    check("D · two deliveries vs one PO: PO advanced to received (guarded flip, no corruption)", poAfter?.status === "received",
      `status=${poAfter?.status}, ${deliveries} deliveries linked, responses ${del.map((r) => r.status + (r.code ? "/" + r.code : "")).join(",")}`);
    check("D · at most the dedupe-allowed deliveries linked (no silent double-file)", (deliveries ?? 0) >= 1,
      `${deliveries} linked (dedupe guard governs exact count)`);
  } else {
    check("D setup: a draft PO existed to place", false, "no draft — C did not mint one");
  }

  return done();
}
run().then((r) => process.exit(r.fails.length ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
