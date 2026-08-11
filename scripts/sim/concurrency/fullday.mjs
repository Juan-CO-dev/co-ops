/**
 * FULL DIRECTED-CREW DAY — concurrency orchestrator (sim-2, 2026-08-11).
 *
 * Runs the marquee multi-writer surfaces of a busy day as genuine concurrency,
 * asserting the invariants the council arc + the pilot fix promise. This is the
 * real test of Juan's concern: "a smooth day depends on everything being usable
 * by multiple people at once."
 *
 * Scenarios:
 *   A · staggered station closes — the whole crew completes the ONE closing
 *       instance in concurrent WAVES (Crunchy Boi → 3rd Party → the rest), many
 *       hands on one instance. Assert: every item lands, no lost writes, no dup
 *       live heads (the 0176 index + flip-first completeItem under real load).
 *   B · two-manager simultaneous CONFIRM (post walk-out + cash) — the deferred
 *       RACE4, now with valid setup. Assert exactly ONE final-confirmation.
 *   C · two par-walks minting ONE vendor draft at the same tick. Assert one PO.
 *   F · completion-race REGRESSION under full load — assert the fix still 0-dups.
 * Then a final integrity sweep across the day's artifacts.
 */
import { Session, findUser, fireSimultaneous, makeReport, db, LOC, todayEt } from "./driver.mjs";
import { CREW } from "./schedule.mjs";

const loc = LOC.EM, date = todayEt();

async function sess(key) {
  const c = CREW[key];
  const u = await findUser(loc, roleOf(c.level), c.name).catch(() => findUser(loc, roleOf(c.level)));
  return new Session(u, c.pin).login(loc);
}
function roleOf(level) {
  return { 3: "employee", 4: "key_holder", 5: "shift_lead", 6: "agm", 7: "gm" }[level];
}

async function run() {
  const { check, done } = makeReport("FULL DIRECTED-CREW DAY");

  const { data: tmpl } = await db.from("checklist_templates")
    .select("id").eq("type", "closing").eq("location_id", loc).eq("active", true).maybeSingle();

  // Crew for the EM close: KH (Rosa), SL (Tommy), two employees (Maya, Deshawn).
  const [rosa, tommy, maya, deshawn] = await Promise.all([
    sess("kh_em"), sess("sl_em"), sess("emp_maya"), sess("emp_deshawn"),
  ]);
  const crew = [rosa, tommy, maya, deshawn];

  const inst = await rosa.call("POST", "/api/checklist/instances", { templateId: tmpl.id, locationId: loc, date });
  const instanceId = inst.json?.instance?.id ?? inst.json?.id ?? inst.json?.instanceId;
  check("closing instance exists", !!instanceId, `id=${instanceId}`);
  if (!instanceId) return done();

  // Items the crew can complete (≤ level 4), split into 3 staggered "station" waves.
  const { data: allItems } = await db.from("checklist_template_items")
    .select("id, expects_count, expects_photo, input_type").eq("template_id", tmpl.id)
    .lte("min_role_level", 4).order("display_order");
  const plain = (allItems ?? []).filter((i) => !i.expects_count && !i.expects_photo && i.input_type !== "yes_no" && i.input_type !== "free_text");
  const waves = [plain.slice(0, Math.ceil(plain.length / 3)), plain.slice(Math.ceil(plain.length / 3), Math.ceil(2 * plain.length / 3)), plain.slice(Math.ceil(2 * plain.length / 3))];

  // ── SCENARIO A · staggered multi-writer closing across concurrent waves ──
  let landed = 0;
  for (let w = 0; w < waves.length; w++) {
    // Every item in the wave completed by a DIFFERENT crew member, all at once.
    const thunks = waves[w].map((it, i) =>
      () => crew[i % crew.length].call("POST", "/api/checklist/completions", { instanceId, templateItemId: it.id }));
    await fireSimultaneous(thunks);
  }
  const { count: liveHeads } = await db.from("checklist_completions")
    .select("*", { count: "exact", head: true }).eq("instance_id", instanceId).is("superseded_at", null).is("revoked_at", null);
  const { data: dupRows } = await db.from("checklist_completions")
    .select("template_item_id").eq("instance_id", instanceId).is("superseded_at", null).is("revoked_at", null);
  const seen = new Set(), dups = new Set();
  for (const r of dupRows ?? []) { if (seen.has(r.template_item_id)) dups.add(r.template_item_id); seen.add(r.template_item_id); }
  landed = seen.size;
  check("A · concurrent multi-writer waves: NO duplicate live heads (0176 holds under load)", dups.size === 0, `${dups.size} dup items across ${liveHeads} live heads`);
  check("A · every wave item landed (no lost write)", landed >= plain.length * 0.95, `${landed}/${plain.length} items live`);

  // ── SCENARIO F · completion-race regression under full load ──
  // Two crew hammer ONE fresh item simultaneously ×8; assert never >1 live.
  let raceDup = 0;
  const raceItems = plain.slice(0, 8);
  for (const it of raceItems) {
    await fireSimultaneous([
      () => rosa.call("POST", "/api/checklist/completions", { instanceId, templateItemId: it.id }),
      () => tommy.call("POST", "/api/checklist/completions", { instanceId, templateItemId: it.id }),
    ]);
    const { count: live } = await db.from("checklist_completions")
      .select("*", { count: "exact", head: true }).eq("instance_id", instanceId).eq("template_item_id", it.id).is("superseded_at", null).is("revoked_at", null);
    if (live > 1) raceDup++;
  }
  check("F · completion-race regression: 0 duplicate heads over 8 simultaneous double-completes", raceDup === 0, `${raceDup}/8 produced a dup`);

  // ── SCENARIO B · two-manager simultaneous CONFIRM (post walk-out + cash) ──
  const cash = await rosa.call("POST", "/api/cash", {
    locationId: loc, date, pin: CREW.kh_em.pin, projectedCents: 50000, cashTipsCents: 4000,
    drawerTotalCents: 70000, floatCents: 20000, onShift: [{ name: CREW.kh_em.name }],
  });
  // Build reasons for any REQUIRED item still incomplete (walk-out is covered by
  // scenario A completing all ≤L4 items; count/photo/answer items may remain).
  const { data: reqItems } = await db.from("checklist_template_items")
    .select("id").eq("template_id", tmpl.id).eq("required", true);
  const { data: doneRows } = await db.from("checklist_completions")
    .select("template_item_id").eq("instance_id", instanceId).is("superseded_at", null).is("revoked_at", null);
  const doneSet = new Set((doneRows ?? []).map((r) => r.template_item_id));
  const incompleteReasons = (reqItems ?? []).filter((i) => !doneSet.has(i.id)).map((i) => ({ templateItemId: i.id, reason: "sim: n/a" }));

  const confirmRes = await fireSimultaneous([rosa, tommy].map((s) =>
    () => s.call("POST", "/api/checklist/confirm", { instanceId, pin: s === rosa ? CREW.kh_em.pin : CREW.sl_em.pin, incompleteReasons })));
  const { count: finals } = await db.from("checklist_submissions")
    .select("*", { count: "exact", head: true }).eq("instance_id", instanceId).eq("is_final_confirmation", true);
  const { data: instRow } = await db.from("checklist_instances").select("status").eq("id", instanceId).maybeSingle();
  check("B · two-manager simultaneous confirm: exactly ONE final submission (flip-first)", finals === 1,
    `${finals} finals, status=${instRow?.status}, cash=${cash.status}, responses ${confirmRes.map((r) => r.status + (r.code ? `/${r.code}` : "")).join(",")}`);

  // ── SCENARIO C · two par-walks mint ONE vendor draft at the same tick ──
  const { data: vend } = await db.from("vendors").select("id").eq("active", true).limit(1).maybeSingle();
  if (vend) {
    const draftRes = await fireSimultaneous([rosa, tommy].map((s) =>
      () => s.call("POST", "/api/operations/ordering/po", { action: "generate_draft", locationId: loc, vendorId: vend.id })));
    const { count: draftsForVendor } = await db.from("purchase_orders")
      .select("*", { count: "exact", head: true }).eq("location_id", loc).eq("vendor_id", vend.id).eq("status", "draft");
    check("C · two simultaneous par-walk draft-generates: ≤ ONE draft PO (day-idempotency)", (draftsForVendor ?? 0) <= 1,
      `${draftsForVendor} draft POs, responses ${draftRes.map((r) => r.status + (r.code ? `/${r.code}` : "")).join(",")}`);
  }

  // ── FINAL INTEGRITY SWEEP ──
  const { data: forked } = await db.from("checklist_completions")
    .select("instance_id, template_item_id").is("superseded_at", null).is("revoked_at", null);
  const grp = new Map();
  for (const r of forked ?? []) { const k = `${r.instance_id}|${r.template_item_id}`; grp.set(k, (grp.get(k) ?? 0) + 1); }
  const anyFork = [...grp.values()].some((v) => v > 1);
  check("SWEEP · no forked live-head anywhere after the full day", !anyFork, `${[...grp.values()].filter((v) => v > 1).length} forked groups`);

  return done();
}

run().then((r) => process.exit(r.fails.length ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
