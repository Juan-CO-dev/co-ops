/**
 * Quantify RACE2 (sim-2): the non-atomic completion-supersede under two
 * SIMULTANEOUS completers on one item. completeItem's own docstring predicts
 * "two live completions" when its insert+supersede two-phase write interleaves.
 * A single trial is flaky by nature (timing) — this fires the exact-tick double
 * complete on N DISTINCT fresh items and reports the silent-duplicate RATE.
 */
import { Session, findUser, fireSimultaneous, db, LOC, todayEt } from "./driver.mjs";

const N = 20;

async function run() {
  const loc = LOC.EM, date = todayEt();
  const { data: tmpl } = await db.from("checklist_templates")
    .select("id").eq("type", "closing").eq("location_id", loc).eq("active", true).maybeSingle();
  const rosa = await new Session(await findUser(loc, "key_holder"), "4444").login(loc);
  const tommy = await new Session(await findUser(loc, "shift_lead"), "6666").login(loc);
  const inst = await rosa.call("POST", "/api/checklist/instances", { templateId: tmpl.id, locationId: loc, date });
  const instanceId = inst.json?.instance?.id ?? inst.json?.id ?? inst.json?.instanceId;

  const { data: items } = await db.from("checklist_template_items")
    .select("id, expects_count, expects_photo").eq("template_id", tmpl.id)
    .lte("min_role_level", 4).order("display_order").limit(N * 2);
  // plain items only (no count/photo requirement) so the completion needs no extra payload
  const plain = (items ?? []).filter((i) => !i.expects_count && !i.expects_photo).slice(0, N);

  let dupes = 0, surfaced = 0, trials = 0;
  for (const it of plain) {
    const res = await fireSimultaneous([
      () => rosa.call("POST", "/api/checklist/completions", { instanceId, templateItemId: it.id }),
      () => tommy.call("POST", "/api/checklist/completions", { instanceId, templateItemId: it.id }),
    ]);
    const { count: live } = await db.from("checklist_completions")
      .select("*", { count: "exact", head: true })
      .eq("instance_id", instanceId).eq("template_item_id", it.id).is("superseded_at", null).is("revoked_at", null);
    trials++;
    if (live > 1) dupes++;
    if (res.some((r) => r.code === "supersede_failed")) surfaced++;
  }
  console.log(`\nRACE2 QUANTIFIED over ${trials} simultaneous double-completes:`);
  console.log(`  silent duplicate live heads (>1 live, no guard): ${dupes}/${trials} (${Math.round(100 * dupes / trials)}%)`);
  console.log(`  app surfaced supersede_failed guard:             ${surfaced}/${trials}`);
  console.log(dupes ? `  → REAL intermittent race: the two-phase insert+supersede is not atomic under simultaneity.` : `  → not reproduced this run (still timing-dependent; try more trials).`);
}
run().catch((e) => { console.error(e); process.exit(2); });
