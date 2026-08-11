/**
 * CONCURRENCY HARNESS — race-injection battery (sim-2, 2026-08-11).
 *
 * The certainty layer: fire the EXACT-TICK version of collisions the directed
 * crew produces naturally (two prep hands on one item, staggered closers on one
 * instance, the manager confirming while someone still writes), and assert the
 * invariants the council arc promised. Day 1 proved the guards hold under
 * sequential RETRY; this proves them under true SIMULTANEITY — the first real
 * test of flip-first, guarded UPDATE + rowcount, and the silent-UPDATE law.
 *
 * Every scenario: set up state → fireSimultaneous(conflicting writes) → probe
 * the DB for the invariant (exactly one winner / no duplicate / no forked chain
 * / no lost write). Repeatable; becomes a permanent artifact.
 */
import { Session, findUser, fireSimultaneous, makeReport, db, LOC, todayEt } from "./driver.mjs";

async function closingInstance(loc, date) {
  // Resolve the closing template + get-or-create its instance (idempotent route).
  const { data: tmpl } = await db.from("checklist_templates")
    .select("id").eq("type", "closing").eq("location_id", loc).eq("active", true).maybeSingle();
  return tmpl?.id ?? null;
}

async function firstOpenItems(templateId, n) {
  const { data } = await db.from("checklist_template_items")
    .select("id, min_role_level").eq("template_id", templateId)
    .order("display_order", { ascending: true }).limit(n * 3);
  // items a KH (level 4) may complete
  return (data ?? []).filter((i) => (i.min_role_level ?? 0) <= 4).slice(0, n).map((i) => i.id);
}

async function run() {
  const { check, done } = makeReport("RACE-INJECTION BATTERY");
  const loc = LOC.EM;
  const date = todayEt();
  const templateId = await closingInstance(loc, date);
  if (!templateId) { console.log("no active closing template — aborting"); return done(); }

  // Two staggered closers (KH + SL), both write to the ONE closing instance.
  const rosa = await new Session(await findUser(loc, "key_holder"), "4444").login(loc);
  const tommy = await new Session(await findUser(loc, "shift_lead"), "6666").login(loc);

  // Ensure today's closing instance exists (idempotent get-or-create).
  const inst = await rosa.call("POST", "/api/checklist/instances", { templateId, locationId: loc, date });
  const instanceId = inst.json?.instance?.id ?? inst.json?.id ?? inst.json?.instanceId;
  check("closing instance get-or-create", !!instanceId, `id=${instanceId ?? "MISSING"} (status ${inst.status})`);
  if (!instanceId) return done();

  // ── RACE 1 · idempotent get-or-create under simultaneity ──
  // Two people open the closing page at the same instant → must NOT mint two instances.
  const dupThunks = [rosa, tommy].map((s) => () => s.call("POST", "/api/checklist/instances", { templateId, locationId: loc, date }));
  await fireSimultaneous(dupThunks);
  const { count: instCount } = await db.from("checklist_instances")
    .select("*", { count: "exact", head: true }).eq("template_id", templateId).eq("date", date).eq("location_id", loc);
  check("RACE1 get-or-create: exactly ONE instance after simultaneous opens", instCount === 1, `found ${instCount}`);

  // ── RACE 2 · two people complete the SAME item at the same tick ──
  // Invariant (completeItem's own contract): ≤1 LIVE completion per item, kept
  // by supersession. The docstring PREDICTS the failure this race forces: the
  // insert+supersede is a non-atomic two-phase write, so two simultaneous
  // completers can both insert-then-find-no-prior → two live heads. We capture
  // whether the app SURFACED its documented `supersede_failed` guard or produced
  // the duplicate silently.
  const items = await firstOpenItems(templateId, 4);
  if (items.length) {
    const item = items[0];
    const r2 = await fireSimultaneous([
      () => rosa.call("POST", "/api/checklist/completions", { instanceId, templateItemId: item }),
      () => tommy.call("POST", "/api/checklist/completions", { instanceId, templateItemId: item }),
    ]);
    const { count: liveDupes } = await db.from("checklist_completions")
      .select("*", { count: "exact", head: true })
      .eq("instance_id", instanceId).eq("template_item_id", item).is("superseded_at", null).is("revoked_at", null);
    const surfaced = r2.some((x) => x.code === "supersede_failed");
    check("RACE2 same-item double-complete: ≤1 LIVE completion (no duplicate chain head)", liveDupes <= 1,
      `${liveDupes} live; app ${surfaced ? "SURFACED supersede_failed (guard fired)" : "did NOT surface a guard (silent dup)"} — responses ${r2.map((x) => x.status + (x.code ? `/${x.code}` : "")).join(",")}`);
  } else {
    check("RACE2 setup: KH-completable items exist", false, "none found");
  }

  // ── RACE 3 · two people complete DIFFERENT items simultaneously (no lost write) ──
  if (items.length >= 3) {
    await fireSimultaneous([
      () => rosa.call("POST", "/api/checklist/completions", { instanceId, templateItemId: items[1] }),
      () => tommy.call("POST", "/api/checklist/completions", { instanceId, templateItemId: items[2] }),
    ]);
    const { count: bothLanded } = await db.from("checklist_completions")
      .select("*", { count: "exact", head: true })
      .eq("instance_id", instanceId).in("template_item_id", [items[1], items[2]]).is("superseded_at", null);
    check("RACE3 different-item parallel writes: BOTH landed (no lost write)", bothLanded === 2, `${bothLanded}/2 present`);
  }

  // ── RACE 4 · two simultaneous CONFIRMS on one instance (the flip-first race) ──
  // VALID SETUP (the pilot's earlier attempt fed an unconfirmable instance):
  // (1) file cash as the closer (closing confirm requires cash_deposit), (2) build
  // an incomplete-reason for EVERY required-and-incomplete item so confirm is
  // legitimately reachable, (3) race two confirms at the same tick. Council claim:
  // exactly one final submission, no orphan reasons, status ends (incomplete_)confirmed.
  const cash = await rosa.call("POST", "/api/cash", {
    locationId: loc, date, pin: "4444", projectedCents: 50000, cashTipsCents: 5000,
    drawerTotalCents: 70000, floatCents: 20000, onShift: [{ name: "Rosa Delgado" }],
  });
  check("RACE4 setup: cash filed (closing confirm precondition)", cash.status === 200 || cash.status === 201, `cash ${cash.status} ${cash.code ?? ""}`);

  const { data: reqItems } = await db.from("checklist_template_items")
    .select("id").eq("template_id", templateId).eq("required", true).lte("min_role_level", 4);
  const { data: doneRows } = await db.from("checklist_completions")
    .select("template_item_id").eq("instance_id", instanceId).is("superseded_at", null).is("revoked_at", null);
  const doneSet = new Set((doneRows ?? []).map((r) => r.template_item_id));
  const incompleteReasons = (reqItems ?? []).filter((i) => !doneSet.has(i.id))
    .map((i) => ({ templateItemId: i.id, reason: "sim: not applicable today" }));

  const confirmThunks = [rosa, tommy].map((s) =>
    () => s.call("POST", "/api/checklist/confirm", { instanceId, pin: s === rosa ? "4444" : "6666", incompleteReasons }));
  const confirmRes = await fireSimultaneous(confirmThunks);
  const wins = confirmRes.filter((r) => r.status === 200).length;
  const { count: finals } = await db.from("checklist_submissions")
    .select("*", { count: "exact", head: true }).eq("instance_id", instanceId).eq("is_final_confirmation", true);
  const { count: reasonRows } = await db.from("checklist_incomplete_reasons")
    .select("*", { count: "exact", head: true }).eq("instance_id", instanceId);
  const { data: instRow } = await db.from("checklist_instances").select("status").eq("id", instanceId).maybeSingle();
  check("RACE4 double-confirm: exactly ONE final-confirmation submission (flip-first held)", finals === 1,
    `${finals} final subs, ${wins} HTTP-200 winners, status=${instRow?.status}, responses ${confirmRes.map((r) => r.status + (r.code ? `/${r.code}` : "")).join(",")}`);
  check("RACE4 double-confirm: no DUPLICATE reason rows (retry-idempotence held)", (reasonRows ?? 0) <= incompleteReasons.length,
    `${reasonRows} reason rows for ${incompleteReasons.length} incomplete items`);
  check("RACE4 double-confirm: status ends confirmed, not corrupted", ["confirmed", "incomplete_confirmed"].includes(instRow?.status), `status=${instRow?.status}`);

  return done();
}

run().then((r) => process.exit(r.fails.length ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
