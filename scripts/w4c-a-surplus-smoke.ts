/**
 * W4c-a surplus smoke — seeds released catering_prep_demand rows and asserts the 72h classifier +
 * churn exclusion. Run: npx tsx --env-file=.env.local scripts/w4c-a-surplus-smoke.ts
 * Seeds prep-demand directly (item refs) so classification is testable without catering recipes.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCateringSurplus, PREP_START_LEAD_DAYS } from "@/lib/catering/surplus";
import { getRoleLevel, type RoleCode } from "@/lib/roles";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("SKIP: no active location."); return; }
  const { data: u } = await sb.from("users").select("id, role").order("id").limit(50).returns<Array<{ id: string; role: string }>>();
  const admin = (u ?? []).find((x) => getRoleLevel(x.role as RoleCode) >= 6);
  if (!admin) { console.log("SKIP: no level>=6 user."); return; }
  const actor = { user: { id: admin.id, role: admin.role } } as unknown as Parameters<typeof loadCateringSurplus>[0];

  const { data: item } = await sb.from("items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!item) { console.log("SKIP: no active item."); return; }

  const needDate = ymd(new Date(Date.now() + 10 * 86_400_000));
  const createdIds: string[] = [];
  const pipelineIds: string[] = [];
  const quoteIds: string[] = [];

  async function seedLead(): Promise<{ pipelineId: string; quoteId: string }> {
    const { data: lead, error: le } = await sb.from("catering_pipeline")
      .insert({ contact_name: "w4c-smoke", stage: "lost", location_id: loc!.id, event_date: needDate, lead_source: "smoke", created_by: null })
      .select("id").single<{ id: string }>();
    if (le) throw new Error(`seed lead: ${le.message}`);
    pipelineIds.push(lead.id);
    const { data: q, error: qe } = await sb.from("catering_quotes")
      .insert({ root_id: null, version: 1, pipeline_id: lead.id, location_id: loc!.id, status: "draft", origin: "self_serve", event_date: needDate, is_delivery: false, created_by: null })
      .select("id").single<{ id: string }>();
    if (qe) throw new Error(`seed quote: ${qe.message}`);
    quoteIds.push(q.id);
    return { pipelineId: lead.id, quoteId: q.id };
  }

  async function seedReleased(pipelineId: string, quoteId: string, releasedAt: string, status = "released"): Promise<string> {
    const { data, error } = await sb.from("catering_prep_demand")
      .insert({ pipeline_id: pipelineId, quote_id: quoteId, location_id: loc!.id, need_date: needDate,
        item_id: item!.id, menu_item_id: null, choice_package_item_id: null, portion: null, qty: 5,
        status, released_at: status === "released" ? releasedAt : null, created_by: null })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`seed demand: ${error.message}`);
    createdIds.push(data.id);
    return data.id;
  }

  try {
    const from = ymd(new Date(Date.now() - 86_400_000));
    const to = ymd(new Date(Date.now() + 30 * 86_400_000));

    // (a) released now, need 10 days out (far out) → raw_sku classification (daysOut >= 3).
    const A = await seedLead();
    await seedReleased(A.pipelineId, A.quoteId, new Date(Date.now()).toISOString());
    let days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    let all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === A.pipelineId);
    // With no catering recipe on the item, raw_sku flatten yields 0 SKU lines — expected;
    // the classification decision is asserted: NO prep-grain line for a far-out release.
    assert(all.every((l) => l.kind === "raw_sku"), "far-out release (>=3d) classifies raw_sku (no prep-grain lines)");
    assert(all.every((l) => l.daysOut >= PREP_START_LEAD_DAYS), "far-out daysOut >= PREP_START_LEAD_DAYS");

    // (b) released 1 day before need (inside window) → prep-grain line present.
    const B = await seedLead();
    const bReleased = new Date(new Date(`${needDate}T00:00:00Z`).getTime() - 1 * 86_400_000).toISOString();
    await seedReleased(B.pipelineId, B.quoteId, bReleased);
    days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === B.pipelineId);
    assert(all.length >= 1 && all.every((l) => l.kind === "prep"), "inside-window release (<3d) classifies prep-grain");
    assert(all.some((l) => l.refKind === "item"), "prep-grain surplus resolves the item ref");

    // (c) churn: a lead with BOTH a released and a reserved row is excluded.
    const C = await seedLead();
    await seedReleased(C.pipelineId, C.quoteId, new Date().toISOString());
    await seedReleased(C.pipelineId, C.quoteId, "", "reserved");
    days = await loadCateringSurplus(actor, { locationId: loc.id, from, to });
    all = days.flatMap((d) => d.lines).filter((l) => l.pipelineId === C.pipelineId);
    assert(all.length === 0, "re-confirm churn (has a reserved row) is excluded from surplus");

    console.log("\nW4c-a surplus smoke: ALL PASS");
  } finally {
    if (createdIds.length) await sb.from("catering_prep_demand").delete().in("id", createdIds);
    if (quoteIds.length) await sb.from("catering_quotes").delete().in("id", quoteIds);
    if (pipelineIds.length) await sb.from("catering_pipeline").delete().in("id", pipelineIds);
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
