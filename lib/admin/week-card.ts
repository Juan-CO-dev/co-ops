/**
 * "This week in CO-OPS" — the admin hub's weekly card, READS (B11a-admin). SERVER-ONLY,
 * service-role, read-only. The pure shaping, the people rule and every "what does this
 * number mean" decision live in lib/admin/week-card-shared.ts (re-exported below).
 *
 * WHERE EACH NUMBER COMES FROM (schema verified live 2026-10-15; source table wherever a
 * row IS the thing, audit_log only where no table fits):
 *
 *   people            user_locations active AT THE VIEWER'S SHOPS → those members' audit_log
 *                                rows (actor_id), minus failed/refused sign-ins (no table
 *                                records "used the app") → users.role (band)
 *   checklists        checklist_instances created in window × checklist_templates
 *                                (type + prep_subtype), status → finished / system-closed
 *   lines ticked      checklist_completions completed in window, completed_by NOT NULL,
 *                                live (not superseded, not revoked), not auto-completed;
 *                                shop via an !inner embed of the instance, filtered to the
 *                                viewer's shops IN the query
 *   PM reports        pm_reports submitted_at in window, not superseded
 *   cash reports      cash_reports created_at in window, not superseded
 *   orders placed     purchase_orders placed_at in window
 *   deliveries        vendor_deliveries created_at in window
 *   counts            sku_count_events created_at in window, active
 *   leads / quotes    catering_pipeline / catering_quotes created_at in window; created_by
 *                                NOT NULL = a person, NULL = the scan / the customer
 *   ezCater arrived   ezcater_orders created_at in window
 *   ezCater sync      ezcater_orders last_attempt_at in window, last_sync_error set or not
 *   Toast pulls       toast_capture_runs started_at in window: the ET days it actually RAN
 *                                OK (from started_at, never the business_date it pulled — a
 *                                backfill is one day of running) + failed runs. The pull runs
 *                                all day, so a raw run count is noise
 *   depletion         audit_log `toast_depletion.materialize` (resource_id = the shop),
 *                                distinct metadata.business_date — the job's own event; the
 *                                ledger table holds one row per SKU, not per run
 *
 * LOCATION BIND (Astra r1 P2): the columns are the ACTIVE locations the viewer may read under
 * the report grant (`canReadReportLocation`: level 8+ every shop, else their own memberships),
 * and every shop-owned read is scoped to those shops IN THE QUERY — `.in("location_id", …)`,
 * the completions' instance embed, `user_locations` by location, and audit_log by the members
 * of those shops — so a GM's request never fetches another shop's rows. Two reads stay
 * global on purpose: `locations` (the column list itself, filtered by the grant before use)
 * and `checklist_templates` (type + prep_subtype only — LABELS for the instances already
 * scoped above, never counted on their own). The one audit read that is not member-scoped is
 * the all-shops viewer's (level 8+), who may read every shop: the approved people rule
 * counts a person with no membership in that viewer's overall line only.
 *
 * Every read pages past PostgREST's 1000-row cap; id lists are chunked so no request line
 * grows with the business. Fails LOUD (throws) — the hub catches it and renders without the
 * card (an ops signal must never take down the admin hub), never a half-read card dressed as
 * the truth.
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
 * The completions' instance embed. `checklist_completions` has exactly ONE FK to
 * `checklist_instances` (`checklist_completions_instance_id_fkey`, verified live); it is
 * named anyway, per the service-role embed law (AGENTS.md, Database & RLS). Parity with the
 * two-step read it replaced, checked by SQL on prod 2026-10-15: 196 live person-ticked lines
 * at one shop, 0 at the other, identical either way.
 */
const COMPLETION_INSTANCE_EMBED = "checklist_instances!checklist_completions_instance_id_fkey!inner(location_id)";

/** A to-one embed arrives as an object; the untyped client's inference says array — accept both. */
type EmbeddedInstance = { location_id: string } | Array<{ location_id: string }> | null;

function embeddedLocation(e: EmbeddedInstance): string | null {
  if (e == null) return null;
  return Array.isArray(e) ? (e[0]?.location_id ?? null) : e.location_id;
}

/**
 * Load the card for this viewer. Returns null when the viewer can read no active shop
 * (nothing to put in a column).
 */
export async function loadWeekCard(actor: LocationActor & { level: number }, now: Date = new Date()): Promise<WeekCard | null> {
  const sb = getServiceRoleClient();
  const since = weekWindowStart(now);
  const allShopsViewer = actor.level >= REPORT_ALL_LOCATIONS_LEVEL;

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
    memberships,
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
    selectAllRows<{ user_id: string; location_id: string }>((from, to) =>
      sb.from("user_locations").select("user_id, location_id")
        .in("location_id", shopIds).eq("active", true)
        .order("user_id", { ascending: true }).order("location_id", { ascending: true }).range(from, to)),
    selectAllRows<{ id: string; location_id: string; template_id: string; status: string; dropped_at: string | null }>((from, to) =>
      sb.from("checklist_instances").select("id, location_id, template_id, status, dropped_at")
        .in("location_id", shopIds).gte("created_at", since)
        .order("id", { ascending: true }).range(from, to)),
    // Global by design: labels (type + prep_subtype) for the shop-scoped instances above.
    selectAllRows<{ id: string; type: string; prep_subtype: string | null }>((from, to) =>
      sb.from("checklist_templates").select("id, type, prep_subtype")
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ checklist_instances: EmbeddedInstance }>((from, to) =>
      sb.from("checklist_completions").select(`id, ${COMPLETION_INSTANCE_EMBED}`)
        .in("checklist_instances.location_id", shopIds)
        .gte("completed_at", since).not("completed_by", "is", null)
        .is("superseded_at", null).is("revoked_at", null).is("auto_complete_meta", null)
        .order("id", { ascending: true }).range(from, to)
        .returns<Array<{ checklist_instances: EmbeddedInstance }>>()),
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
    selectAllRows<{ location_id: string; status: string; started_at: string | null }>((from, to) =>
      sb.from("toast_capture_runs").select("location_id, status, started_at")
        .in("location_id", shopIds).gte("started_at", since)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<{ resource_id: string | null; business_date: string | null }>((from, to) =>
      sb.from("audit_log").select("resource_id, business_date:metadata->>business_date")
        .eq("action", "toast_depletion.materialize").in("resource_id", shopIds).gte("occurred_at", since)
        .order("id", { ascending: true }).range(from, to)),
  ]);

  // People. Eligible actors come from the memberships AT THE VIEWER'S SHOPS, read BEFORE any
  // audit activity: a shop-bound viewer's audit read is `.in("actor_id", members)` (chunked).
  // Only the all-shops viewer reads the window's actors unfiltered — they may read every shop,
  // and the approved rule shows them people with no membership in the overall line.
  const memberOf = new Map<string, string[]>();
  for (const m of memberships) memberOf.set(m.user_id, [...(memberOf.get(m.user_id) ?? []), m.location_id]);
  const memberIds = [...memberOf.keys()];
  const auditActors = allShopsViewer
    ? await selectAllRows<{ actor_id: string; action: string }>((from, to) =>
        sb.from("audit_log").select("actor_id, action")
          .not("actor_id", "is", null).gte("occurred_at", since)
          .order("id", { ascending: true }).range(from, to))
    : await selectByIds<{ actor_id: string; action: string }>(memberIds, (c, from, to) =>
        sb.from("audit_log").select("actor_id, action")
          .in("actor_id", c).gte("occurred_at", since)
          .order("id", { ascending: true }).range(from, to));
  const actorIds = [...new Set(auditActors.filter((r) => actionCountsAsUse(r.action)).map((r) => r.actor_id))];
  const users = await selectByIds<{ id: string; role: string }>(actorIds, (c, from, to) =>
    sb.from("users").select("id, role").in("id", c).order("id", { ascending: true }).range(from, to));
  const roleOf = new Map(users.map((u) => [u.id, u.role]));
  const actors: WeekActor[] = actorIds.map((id) => {
    const role = roleOf.get(id);
    return { userId: id, level: role != null && isRoleCode(role) ? ROLES[role].level : null, locationIds: memberOf.get(id) ?? [] };
  });

  const templateOf = new Map(templates.map((t) => [t.id, t]));

  return buildWeekCard({
    since,
    shops,
    allShopsViewer,
    actors,
    checklists: instances.flatMap((i) => {
      const t = templateOf.get(i.template_id);
      return t ? [{ locationId: i.location_id, type: t.type, prepSubtype: t.prep_subtype, status: i.status, dropped: i.dropped_at != null }] : [];
    }),
    lineLocations: completions.flatMap((c) => {
      const loc = embeddedLocation(c.checklist_instances);
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
    toastRuns: toastRuns.map((r) => ({ locationId: r.location_id, status: r.status, startedAt: r.started_at })),
    depletionRuns: depletion.map((d) => ({ locationId: d.resource_id, businessDate: d.business_date })),
  });
}
