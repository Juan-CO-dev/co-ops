// V3-C-2 v1 rehearsal on the SIM (CC, 2026-09-20): stage -> idempotent stage -> stale under a human edit -> superseded -> fresh stage
// -> apply the remaining price -> replay -> re-stage shows nothing left. Real PFG Izzy MAIN export against the post-seed-38 catalog.
// Run from the repo root: node --env-file=.env.sim --conditions react-server --import tsx scripts/sim/rehearsals/2026-09-20-v3c2-vendor-import.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { stageVendorImport, applyVendorImport, loadImportBatch, VendorImportError } from "@/lib/vendor-import";
import { observationKey, planDigest, planFromDecisions } from "@/lib/vendor-import-shared/match";
import type { Decision, Observation } from "@/lib/vendor-import-shared/model";
import type { AuthContext } from "@/lib/session";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("jepgzucrvklhqpthowsc"), "SIM ONLY");
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const one = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> => { const { data, error } = await q; if (error || !data) throw new Error(error?.message ?? "no row"); return data; };
  const out: Record<string, unknown> = {};
  const skipAll = (observations: readonly Observation[]): Record<string, Decision> => Object.fromEntries(observations.map(o => [observationKey(o), "skip" as Decision]));
  const summary = (o: Observation) => ({ row: o.source_row, item: o.row.item_no, description: o.row.description, kind: o.kind, reason: o.reason, proposed: o.proposed });

  const vendor = await one(sb.from("vendors").select("id,name").eq("name", "PFG").single<{ id: string; name: string }>());
  const marcus = await one(sb.from("users").select("id,email,name,role").ilike("email", "marcus@sim.co-ops").single<{ id: string; email: string; name: string; role: string }>());
  // Applying is an owner-level act (level 9); the sim roster has no owner, so the rehearsal promotes Marcus for this run. The suite restore puts the roster back.
  await one(sb.from("users").update({ role: "owner" }).eq("id", marcus.id).select("id").single());
  const ctx = { user: { ...marcus, role: "owner" }, session: {}, role: "owner", level: 9, locations: [] } as unknown as AuthContext;
  const file = { name: "list-izzy-main-2026-09-18.csv", text: readFileSync("docs/seed/source/vendor-exports/pfg/list-izzy-main-2026-09-18.csv", "utf8") };

  // 1. Stage, and stage again: one batch, one digest.
  const v1 = await stageVendorImport(ctx, vendor.id, file);
  const changing = v1.observations.filter(o => o.kind === "price" || o.kind === "pack" || o.kind === "item_number");
  out.stage1 = { batch: v1.batch.id, status: v1.batch.status, adapter: v1.batch.adapter, exported_at: v1.batch.exported_at, row_count: v1.batch.row_count,
    counts: v1.batch.report.counts, reasons: v1.batch.report.reasons, needs_person: v1.batch.report.needs_person.length, ignored_rows: v1.batch.report.ignored_rows,
    observations: v1.observations.length, default_ops: v1.ops.length, digest: v1.expectedDigest, changing: changing.map(summary) };
  for (const o of changing.filter(o => o.kind === "price")) {
    const was = (v1.beforeState[observationKey(o)] as { unit_price?: number }).unit_price;
    // A proposed price is a vendor move, never a basis artifact (the first rehearsal wrote 2.25 -> 80.30 for Butter).
    if (was) assert.ok(Math.abs(o.proposed!.unit_price! - was) / was < 0.5, `row ${o.source_row}: ${was} -> ${o.proposed!.unit_price} is a basis artifact`);
  }
  const v1b = await stageVendorImport(ctx, vendor.id, file);
  assert.equal(v1b.batch.id, v1.batch.id, "same file -> same batch"); assert.equal(v1b.expectedDigest, v1.expectedDigest, "same file -> same digest");
  out.stage1_again = "same batch + digest";
  const prices = changing.filter(o => o.kind === "price").sort((a, b) => a.source_row - b.source_row);
  assert.ok(prices.length >= 2, "at least two real price moves in the export");

  // 2. A human edits a price under the staged batch -> apply refuses, the batch retires, the same file stages fresh.
  const edited = prices[0]!;
  await one(sb.from("vendor_price_history").insert({ vendor_item_id: edited.match.sku_id, unit_price: (edited.proposed!.unit_price! + 0.5).toFixed(2), effective_date: new Date().toISOString().slice(0, 10), recorded_by: marcus.id, source: "manual", source_note: "v3c2 rehearsal: human edit under a staged batch" }).select("id").single());
  const d1 = skipAll(v1.observations); for (const p of prices) d1[observationKey(p)] = "accept";
  const ops1 = planFromDecisions(v1.observations, d1, v1.beforeState);
  assert.equal(ops1.length, prices.length);
  let stale: unknown = null;
  try { await applyVendorImport(ctx, vendor.id, v1.batch.id, d1, await planDigest(ops1, v1.beforeState)); } catch (e) { stale = e instanceof VendorImportError ? { status: e.status, code: e.code } : String(e); }
  assert.deepEqual(stale, { status: 409, code: "stale_before_state" });
  const v1row = await one(sb.from("vendor_import_batches").select("status").eq("id", v1.batch.id).single<{ status: string }>());
  assert.equal(v1row.status, "superseded");
  const untouched = await one(sb.from("vendor_price_history").select("id").eq("source", "vendor_import")) as { id: string }[];
  assert.equal(untouched.length, 0, "a refused apply writes nothing");
  const v2 = await stageVendorImport(ctx, vendor.id, file);
  assert.notEqual(v2.batch.id, v1.batch.id); assert.equal(v2.batch.status, "staged");
  const editedNow = v2.observations.find(o => o.source_row === edited.source_row)!;
  assert.equal(editedNow.kind, "needs_person"); assert.equal(editedNow.reason, "stale_price_evidence");
  out.stale = { refused: stale, batch1: v1row.status, edited_row: summary(editedNow), batch2: v2.batch.id, counts2: v2.batch.report.counts };

  // 3. Apply what is left through the RPC; replay; audit.
  const remaining = v2.observations.filter(o => o.kind === "price");
  assert.ok(remaining.length >= 1, "a price move left to apply");
  const d2 = skipAll(v2.observations); for (const p of remaining) d2[observationKey(p)] = "accept";
  const ops2 = planFromDecisions(v2.observations, d2, v2.beforeState);
  const digest2 = await planDigest(ops2, v2.beforeState);
  const skus = remaining.map(p => p.match.sku_id!);
  type PriceRow = { id: string; vendor_item_id: string; unit_price: string; effective_date: string; source: string };
  const priceRows = async () => await one(sb.from("vendor_price_history").select("id,vendor_item_id,unit_price,effective_date,source").in("vendor_item_id", skus).order("effective_date", { ascending: false }).order("recorded_at", { ascending: false }).order("id", { ascending: false })) as PriceRow[];
  const before = await priceRows();
  const r1 = await applyVendorImport(ctx, vendor.id, v2.batch.id, d2, digest2);
  const after = await priceRows();
  assert.equal(after.length, before.length + remaining.length, "one new price row per accepted move");
  for (const p of remaining) {
    const latest = after.find(r => r.vendor_item_id === p.match.sku_id)!;
    assert.equal(Number(latest.unit_price), p.proposed!.unit_price, `latest price for ${p.row.description}`);
    assert.equal(latest.effective_date, p.proposed!.effective_date); assert.equal(latest.source, "vendor_import");
  }
  out.apply = { ops: r1.ops.map(o => ({ action: o.action, source_row: o.source_row, new_ids: o.new_ids.length })), non_atomic: r1.non_atomic,
    accepted: remaining.map(p => ({ ...summary(p), before: (v2.beforeState[observationKey(p)] as { unit_price?: number }).unit_price })) };
  const r2 = await applyVendorImport(ctx, vendor.id, v2.batch.id, d2, digest2);
  assert.deepEqual(r2, r1, "replay returns the stored result");
  assert.equal((await priceRows()).length, after.length, "replay writes nothing");
  out.replay = "same result, no new rows";
  assert.equal((await loadImportBatch(ctx, vendor.id, v2.batch.id)).batch.status, "applied");
  const audit = await one(sb.from("audit_log").select("action").eq("metadata->>batch_id", v2.batch.id)) as { action: string }[];
  const staged = await one(sb.from("audit_log").select("action,resource_id").eq("action", "vendor.import_staged")) as { action: string; resource_id: string }[];
  out.audit = { per_batch: audit.map(a => a.action).sort(), staged_batches: staged.map(s => s.resource_id).sort() };

  // 4. The same file again: an applied batch never blocks a fresh stage, and nothing is left to write.
  const v3 = await stageVendorImport(ctx, vendor.id, file);
  assert.notEqual(v3.batch.id, v2.batch.id); assert.equal(v3.batch.status, "staged");
  assert.equal(v3.ops.length, 0, "nothing left to write");
  out.stage3 = { batch: v3.batch.id, counts: v3.batch.report.counts, reasons: v3.batch.report.reasons, default_ops: v3.ops.length };
  console.log("REHEARSAL OK\n" + JSON.stringify(out, null, 2));
}
main().catch(e => { console.error("REHEARSAL FAILED", e); process.exit(1); });
