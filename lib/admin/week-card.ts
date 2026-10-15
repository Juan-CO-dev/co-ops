/**
 * "This week in CO-OPS" — the admin hub's weekly card, READS (B11a-admin). SERVER-ONLY,
 * service-role, read-only. The pure shaping, the people rule and every "what does this
 * number mean" decision live in lib/admin/week-card-shared.ts (re-exported below).
 *
 * WHERE EACH NUMBER COMES FROM (schema verified live 2026-10-15; source table wherever a
 * row IS the thing, audit_log only where no table fits):
 *
 *   people            audit_log  actor_id NOT NULL, minus failed/refused sign-ins
 *                                (no table records "used the app") → users.role (band)
 *                                → user_locations active (the shop columns)
 *   checklists        checklist_instances created in window × checklist_templates
 *                                (type + prep_subtype), status → finished / system-closed
 *   lines ticked      checklist_completions completed in window, completed_by NOT NULL,
 *                                live (not superseded, not revoked), not auto-completed;
 *                                shop via the instance
 *   PM reports        pm_reports submitted_at in window, not superseded
 *   cash reports      cash_reports created_at in window, not superseded
 *   orders placed     purchase_orders placed_at in window
 *   deliveries        vendor_deliveries created_at in window
 *   counts            sku_count_events created_at in window, active
 *   leads / quotes    catering_pipeline / catering_quotes created_at in window; created_by
 *                                NOT NULL = a person, NULL = the scan / the customer
 *   ezCater arrived   ezcater_orders created_at in window
 *   ezCater sync      ezcater_orders last_attempt_at in window, last_sync_error set or not
 *   Toast pulls       toast_capture_runs started_at in window: distinct business_date
 *                                with an OK run (of the window's 7 ET days) + failed runs.
 *                                The pull runs all day, so a raw run count is noise
 *   depletion         audit_log `toast_depletion.materialize` (resource_id = the shop),
 *                                distinct metadata.business_date — the job's own event; the
 *                                ledger table holds one row per SKU, not per run
 *
 * LOCATION BIND: the columns are the ACTIVE locations the viewer may read under the report
 * grant (`canReadReportLocation`: level 8+ every shop, else their own memberships), and
 * every source read is `.in("location_id", columns)` — a GM never receives another shop's
 * rows. Every read pages past PostgREST's 1000-row cap; id lists are chunked so no request
 * line grows with the business.
 *
 * Fails LOUD (throws) — the hub catches it and renders without the card (an ops signal must
 * never take down the admin hub), never a half-read card dressed as the truth.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { canReadReportLocation, REPORT_ALL_LOCATIONS_LEVEL, type LocationActor } from "@/lib/locations";
import { isRoleCode, ROLES } from "@/lib/roles";
import {
  actionCountsAsUse,
  buildWeekCard,
  weekBusinessDays,
  weekWindowStart,
  type WeekActor,
  type WeekCard,
} from "@/lib/admin/week-card-shared";

export * from "@/lib/admin/week-card-shared";

/** ≤ 100 uuids per `.in()` ≈ 3.8 KB — well under the 8 KB request-line budget. */
const ID_CHUNK = 100;

function chunks<T>(xs: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Read every row of a chunked `.in()` lookup, paging each chunk. */
async function selectByIds<T>(
  ids: readonly string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
): Promise<T[]> {
  const parts = await Promise.all(chunks(ids).map((c) => selectAllRows<T>((from, to) => build(c, from, to))));
  return parts.flat();
}

/**
 * Load the card for this viewer. Returns null when the viewer can read no active shop
 * (nothing to put in a column).
 */
export async function loadWeekCard(actor: LocationActor & { level: number }, now: Date = new Date()): Promise<WeekCard | null> {
  const sb = getServiceRoleClient();
  const since = weekWindowStart(now);

  const { data: locRows, error: locErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (locErr) throw new Error(`loadWeekCard locations: ${locErr.message}`);
  const shops = (locRows ?? []).filter((l) => canReadReportLocation(actor, l.id));
  if (shops.length === 0) return null;
  const shopIds = shops.map((s) => s.id);

  const [
    auditActors,
    instances,
    templates,
    completions,
    pmReports,
    cashReports,
    orders,
    deliveries,
    countEvents,
    leads,
    quotes,
    ezArrived,
    ezSyncs,
    toastRuns,
    depletion,
  ] = await Promise.all([
    selectAllRows<{ actor_id: string; action: string }>((from, to) =>
      sb.from("audit_log").select("actor_id, action")
        .not("actor_id", "is", null).gte("occurred_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ id: string; location_id: string; template_id: string; status: string; dropped_at: string | null }>((from, to) =>
      sb.from("checklist_instances").select("id, location_id, template_id, status, dropped_at")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ id: string; type: string; prep_subtype: string | null }>((from, to) =>
      sb.from("checklist_templates").select("id, type, prep_subtype")
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ instance_id: string }>((from, to) =>
      sb.from("checklist_completions").select("instance_id")
        .gte("completed_at", since).not("completed_by", "is", null)
        .is("superseded_at", null).is("revoked_at", null).is("auto_complete_meta", null)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string }>((from, to) =>
      sb.from("pm_reports").select("location_id")
        .in("location_id", shopIds).gte("submitted_at", since).is("superseded_at", null)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string }>((from, to) =>
      sb.from("cash_reports").select("location_id")
        .in("location_id", shopIds).gte("created_at", since).is("superseded_at", null)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string }>((from, to) =>
      sb.from("purchase_orders").select("location_id")
        .in("location_id", shopIds).gte("placed_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string }>((from, to) =>
      sb.from("vendor_deliveries").select("location_id")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string }>((from, to) =>
      sb.from("sku_count_events").select("location_id")
        .in("location_id", shopIds).gte("created_at", since).eq("active", true)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string | null; created_by: string | null; lead_source: string | null }>((from, to) =>
      sb.from("catering_pipeline").select("location_id, created_by, lead_source")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string | null; created_by: string | null }>((from, to) =>
      sb.from("catering_quotes").select("location_id, created_by")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string | null }>((from, to) =>
      sb.from("ezcater_orders").select("location_id")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string | null; last_sync_error: string | null }>((from, to) =>
      sb.from("ezcater_orders").select("location_id, last_sync_error")
        .in("location_id", shopIds).gte("last_attempt_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ location_id: string; status: string; business_date: string | null }>((from, to) =>
      sb.from("toast_capture_runs").select("location_id, status, business_date")
        .in("location_id", shopIds).gte("started_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ resource_id: string | null; business_date: string | null }>((from, to) =>
      sb.from("audit_log").select("resource_id, business_date:metadata->>business_date")
        .eq("action", "toast_depletion.materialize").in("resource_id", shopIds).gte("occurred_at", since)
        .order("id", { ascending: true }).range(from, to)),
  ]);

  // People: distinct actors whose week includes real use → their role + memberships.
  const actorIds = [...new Set(auditActors.filter((r) => actionCountsAsUse(r.action)).map((r) => r.actor_id))];
  const [users, memberships] = await Promise.all([
    selectByIds<{ id: string; role: string }>(actorIds, (c, from, to) =>
      sb.from("users").select("id, role").in("id", c).order("id", { ascending: true }).range(from, to)),
    selectByIds<{ user_id: string; location_id: string }>(actorIds, (c, from, to) =>
      sb.from("user_locations").select("user_id, location_id").in("user_id", c).eq("active", true)
        .order("user_id", { ascending: true }).order("location_id", { ascending: true }).range(from, to)),
  ]);
  const roleOf = new Map(users.map((u) => [u.id, u.role]));
  const memberOf = new Map<string, string[]>();
  for (const m of memberships) memberOf.set(m.user_id, [...(memberOf.get(m.user_id) ?? []), m.location_id]);
  const actors: WeekActor[] = actorIds.map((id) => {
    const role = roleOf.get(id);
    return { userId: id, level: role != null && isRoleCode(role) ? ROLES[role].level : null, locationIds: memberOf.get(id) ?? [] };
  });

  // Lines ticked: the shop lives on the instance. Instances may predate the window, so look
  // them up by id (chunked) rather than reusing the in-window instance read — still bound to
  // the viewer's shops, so another shop's line resolves to no column at all.
  const instanceIds = [...new Set(completions.map((c) => c.instance_id))];
  const instanceShop = await selectByIds<{ id: string; location_id: string }>(instanceIds, (c, from, to) =>
    sb.from("checklist_instances").select("id, location_id").in("id", c).in("location_id", shopIds)
      .order("id", { ascending: true }).range(from, to));
  const shopOfInstance = new Map(instanceShop.map((i) => [i.id, i.location_id]));

  const templateOf = new Map(templates.map((t) => [t.id, t]));

  return buildWeekCard({
    since,
    shops,
    allShopsViewer: actor.level >= REPORT_ALL_LOCATIONS_LEVEL,
    actors,
    checklists: instances.flatMap((i) => {
      const t = templateOf.get(i.template_id);
      return t ? [{ locationId: i.location_id, type: t.type, prepSubtype: t.prep_subtype, status: i.status, dropped: i.dropped_at != null }] : [];
    }),
    lineLocations: completions.flatMap((c) => {
      const loc = shopOfInstance.get(c.instance_id);
      return loc ? [loc] : [];
    }),
    pmReportLocations: pmReports.map((r) => r.location_id),
    cashReportLocations: cashReports.map((r) => r.location_id),
    orderLocations: orders.map((r) => r.location_id),
    deliveryLocations: deliveries.map((r) => r.location_id),
    countLocations: countEvents.map((r) => r.location_id),
    leads: leads.map((l) => ({ locationId: l.location_id, createdBy: l.created_by, leadSource: l.lead_source })),
    quotes: quotes.map((q) => ({ locationId: q.location_id, createdBy: q.created_by })),
    ezcaterArrivedLocations: ezArrived.map((e) => e.location_id),
    ezcaterSyncs: ezSyncs.map((e) => ({ locationId: e.location_id, hasError: e.last_sync_error != null })),
    businessDays: weekBusinessDays(now),
    toastRuns: toastRuns.map((r) => ({ locationId: r.location_id, status: r.status, businessDate: r.business_date })),
    depletionRuns: depletion.map((d) => ({ locationId: d.resource_id, businessDate: d.business_date })),
  });
}
