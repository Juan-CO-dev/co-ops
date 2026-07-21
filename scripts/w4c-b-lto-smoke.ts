/**
 * W4c-b LTO smoke — create/list/validation/cancel against lib/catering/lto.ts.
 * Run: npx tsx --env-file=.env.local scripts/w4c-b-lto-smoke.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createLtoEvent, listLtoEvents, cancelLtoEvent, LtoError } from "@/lib/catering/lto";
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
  const actor = { user: { id: admin.id, role: admin.role } } as unknown as Parameters<typeof createLtoEvent>[0];
  const { data: item } = await sb.from("items").select("id, name").eq("active", true).limit(1).maybeSingle<{ id: string; name: string }>();
  if (!item) { console.log("SKIP: no active item."); return; }

  const start = ymd(new Date());
  const end = ymd(new Date(Date.now() + 2 * 86_400_000));
  const createdEventIds: string[] = [];

  try {
    // (a) create an LTO with a discount
    const { id } = await createLtoEvent(actor, {
      locationId: loc.id, kind: "lto", name: "w4c-smoke LTO", discountBps: 3000, promoPriceCents: null,
      startsOn: start, endsOn: end, note: "smoke",
      items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 10, sourcePipelineId: null }],
    });
    createdEventIds.push(id);
    assert(!!id, "createLtoEvent returns an id");

    // (b) list active includes it
    let active = await listLtoEvents(actor, { locationId: loc.id, activeOnly: true });
    assert(active.some((e) => e.id === id && e.items.length === 1 && e.posPushStatus === "not_pushed"), "active list includes the new LTO with items + not_pushed");

    // (c) validation: a discount with null discountBps is rejected
    let rejected = false;
    try {
      await createLtoEvent(actor, { locationId: loc.id, kind: "discount", name: "bad", discountBps: null, promoPriceCents: null, startsOn: start, endsOn: end, note: null, items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 1, sourcePipelineId: null }] });
    } catch (e) { rejected = e instanceof LtoError && e.code === "discount_needs_bps"; }
    assert(rejected, "discount without bps is rejected (discount_needs_bps)");

    // (d) validation: bad window rejected
    let badWindow = false;
    try {
      await createLtoEvent(actor, { locationId: loc.id, kind: "lto", name: "bad win", discountBps: null, promoPriceCents: null, startsOn: end, endsOn: start, note: null, items: [{ itemId: item.id, menuItemId: null, nameSnapshot: item.name, qty: 1, sourcePipelineId: null }] });
    } catch (e) { badWindow = e instanceof LtoError && e.code === "invalid_window"; }
    assert(badWindow, "end-before-start window is rejected (invalid_window)");

    // (e) cancel flips status; active list no longer returns it
    await cancelLtoEvent(actor, id);
    active = await listLtoEvents(actor, { locationId: loc.id, activeOnly: true });
    assert(!active.some((e) => e.id === id), "cancelled LTO drops out of the active list");

    // (f) cancel again → 404
    let cancel404 = false;
    try { await cancelLtoEvent(actor, id); } catch (e) { cancel404 = e instanceof LtoError && e.status === 404; }
    assert(cancel404, "cancelling an already-cancelled event → 404");

    console.log("\nW4c-b LTO smoke: ALL PASS");
  } finally {
    if (createdEventIds.length) {
      await sb.from("lto_event_items").delete().in("event_id", createdEventIds);
      await sb.from("lto_events").delete().in("id", createdEventIds);
    }
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
