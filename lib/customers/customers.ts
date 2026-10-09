/**
 * Customer profiles + consent — the authorised boundary (server-only). 0234.
 *
 * Juan 2026-10-07/08 (GO-coops-customer-profiles): profiles for INTERNAL tracking; contact data usable
 * for marketing ONLY where the person opted in, no workarounds; raw email/phone at level 9+ only;
 * managers see stats without contact data; every raw-contact read and every export audited;
 * delete-on-request; Meta export built but OFF until Pete says yes.
 *
 * Every entry point authorises BEFORE any I/O (role floor, then the shop bind), then reads through the
 * service client. Nothing here runs while CUSTOMER_PROFILES is unset, so the app deploys before 0234.
 */
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  CUSTOMER_CONTACT_MIN, CUSTOMER_STATS_MIN, customerShopScope, toStatsDto,
  type CustomerStatsDto, type CustomerViewer,
} from "./access-shared";
import {
  ConsentCsvError, canonicalImportPayload, chunkRows, mergeConsentFiles, parseConsentCsv, summaryFromRpc,
  type ConsentImportSummary,
} from "./consent-shared";
import { marketingCsv, metaAudienceCsv, metaAudienceEnabled, type MarketingSourceRow } from "./exports-core";
import { classifyEmail, normalizeEmail, normalizePhoneE164 } from "./identity-shared";
import { profileStats, type CustomerOrderRow } from "./stats-shared";

export * from "./access-shared";

export function customerProfilesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CUSTOMER_PROFILES === "1";
}

export class CustomerError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "CustomerError";
  }
}

export interface CustomerActor extends CustomerViewer { role: RoleCode }
export interface RequestMeta { ipAddress: string | null; userAgent: string | null }
type Client = Pick<SupabaseClient, "rpc" | "from">;
export interface CustomerDeps { client?: Client; now?: Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
/** Retention: a profile not seen for this long, with no standing opt-in, is erased by the sweep. */
export const RETENTION_MONTHS = 36;

function requireEnabled() { if (!customerProfilesEnabled()) throw new CustomerError(404, "not_enabled"); }
function requireStats(v: CustomerViewer) { if (v.level < CUSTOMER_STATS_MIN) throw new CustomerError(403, "role_insufficient"); }
function requireContact(v: CustomerViewer) { if (v.level < CUSTOMER_CONTACT_MIN) throw new CustomerError(403, "role_insufficient"); }
function requireId(id: unknown): asserts id is string { if (typeof id !== "string" || !UUID.test(id)) throw new CustomerError(400, "invalid_payload"); }

function rpcError(error: { code?: string; message?: string }): never {
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") throw new CustomerError(503, "customers_not_installed");
  const known = ["suggestion_not_found", "suggestion_already_decided", "merge_invalid", "merge_erased", "customer_not_found",
    "consent_import_invalid", "consent_import_future_date", "consent_import_busy", "consent_import_older_than_last",
    "consent_import_mismatch", "consent_import_large_opt_out", "consent_import_incomplete", "consent_import_not_running", "retention_invalid"];
  const code = known.find((k) => error.message?.includes(k));
  if (code) throw new CustomerError(code.endsWith("not_found") ? 404 : 409, code);
  throw new Error(`customers rpc: ${error.message ?? "unknown"}`);
}

async function rpc<T>(sb: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) rpcError(error);
  return data as T;
}

/** The root ids a viewer may see: a person with at least one order at a bound shop (level 8+: all). */
async function assertInScope(sb: Client, viewer: CustomerViewer, customerIds: readonly string[]): Promise<void> {
  const scope = customerShopScope(viewer);
  if (scope === null) return;
  for (const id of customerIds) {
    const members = await memberIds(sb, id);
    const { data, error } = await sb.from("customer_orders").select("id").in("customer_id", members).in("location_id", scope).limit(1);
    if (error) throw new Error(`customer scope: ${error.message}`);
    if (!data || data.length === 0) throw new CustomerError(403, "location_forbidden");
  }
}

/** A person and everyone merged into them. */
async function memberIds(sb: Client, rootId: string): Promise<string[]> {
  const { data, error } = await sb.from("customers").select("id").or(`id.eq.${rootId},merged_into.eq.${rootId}`);
  if (error) throw new Error(`customer members: ${error.message}`);
  return (data ?? []).map((r: { id: string }) => r.id);
}

interface CustomerRow { id: string; full_name: string | null; masked_channels: string[]; merged_into: string | null; erased_at: string | null }

async function statsFor(sb: Client, viewer: CustomerViewer, ids: readonly string[]): Promise<CustomerStatsDto[]> {
  if (ids.length === 0) return [];
  const scope = customerShopScope(viewer);
  const { data: people, error: pe } = await sb.from("customers").select("id,full_name,masked_channels,merged_into,erased_at").in("id", [...ids]);
  if (pe) throw new Error(`customers: ${pe.message}`);
  const orders = await selectAllRows<CustomerOrderRow & { customer_id: string }>((from, to) => {
    let q = sb.from("customer_orders").select("customer_id,business_date,channel,total_cents,items,location_id").in("customer_id", [...ids]);
    if (scope) q = q.in("location_id", scope);
    return q.order("id").range(from, to);
  });
  const { data: consent, error: ce } = await sb.from("customer_consent_current").select("customer_id,status").eq("channel", "email").in("customer_id", [...ids]);
  if (ce) throw new Error(`consent: ${ce.message}`);
  const { data: cards, error: ke } = await sb.from("customer_cards").select("customer_id").in("customer_id", [...ids]);
  if (ke) throw new Error(`cards: ${ke.message}`);
  const byId = new Map((people ?? []).map((p: CustomerRow) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p || p.merged_into) return [];
    const s = profileStats(orders.filter((o) => o.customer_id === id));
    const status = (consent ?? []).find((c: { customer_id: string }) => c.customer_id === id)?.status;
    return [toStatsDto({
      id, name: p.full_name, visits: s.visits, spendCents: s.spendCents, firstOrder: s.firstOrder, lastOrder: s.lastOrder,
      avgDaysBetween: s.avgDaysBetween, channels: s.channels, favourites: s.favourites, maskedChannels: p.masked_channels ?? [],
      emailMarketing: status === "opted_in" || status === "opted_out" ? status : "unknown",
      cards: (cards ?? []).filter((c: { customer_id: string }) => c.customer_id === id).length,
    })];
  });
}

// ── Manager surfaces (level 7+, shop-bound) ──────────────────────────────────────────────────────

export async function loadProfilePage(viewer: CustomerViewer, args: { search?: string; page?: number }, deps: CustomerDeps = {}) {
  requireEnabled();
  requireStats(viewer);
  const search = typeof args.search === "string" && args.search.trim() ? args.search.trim().slice(0, 80) : null;
  const page = Number.isInteger(args.page) && (args.page as number) > 0 ? (args.page as number) : 1;
  const sb = deps.client ?? getServiceRoleClient();
  const rows = await rpc<{ customer_id: string; full_name: string | null; last_order: string; total_rows: number }[]>(sb, "customer_profile_page", {
    p_location_ids: customerShopScope(viewer), p_search: search, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const profiles = await statsFor(sb, viewer, rows.map((r) => r.customer_id));
  return { profiles, total: Number(rows[0]?.total_rows ?? 0), page, pageSize: PAGE_SIZE, search };
}

export async function loadProfile(viewer: CustomerViewer, customerId: string, deps: CustomerDeps = {}) {
  requireEnabled();
  requireStats(viewer);
  requireId(customerId);
  const sb = deps.client ?? getServiceRoleClient();
  await assertInScope(sb, viewer, [customerId]);
  const [profile] = await statsFor(sb, viewer, [customerId]);
  if (!profile) throw new CustomerError(404, "customer_not_found");
  return profile;
}

export interface SuggestionDto { id: string; confidence: number; reasons: string[]; a: { id: string; name: string | null }; b: { id: string; name: string | null } }

export async function loadSuggestions(viewer: CustomerViewer, deps: CustomerDeps = {}): Promise<SuggestionDto[]> {
  requireEnabled();
  requireStats(viewer);
  const sb = deps.client ?? getServiceRoleClient();
  const { data, error } = await sb.from("customer_merge_suggestions").select("id,customer_a,customer_b,confidence,reasons")
    .eq("status", "open").order("confidence", { ascending: false }).limit(50);
  if (error) throw new Error(`suggestions: ${error.message}`);
  const rows = (data ?? []) as { id: string; customer_a: string; customer_b: string; confidence: number; reasons: string[] }[];
  const ids = [...new Set(rows.flatMap((r) => [r.customer_a, r.customer_b]))];
  if (ids.length === 0) return [];
  const { data: people, error: pe } = await sb.from("customers").select("id,full_name").in("id", ids);
  if (pe) throw new Error(`customers: ${pe.message}`);
  const names = new Map((people ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));
  const out: SuggestionDto[] = [];
  for (const r of rows) {
    try { await assertInScope(sb, viewer, [r.customer_a, r.customer_b]); } catch (e) { if (e instanceof CustomerError) continue; throw e; }
    out.push({ id: r.id, confidence: Number(r.confidence), reasons: r.reasons,
      a: { id: r.customer_a, name: names.get(r.customer_a) ?? null }, b: { id: r.customer_b, name: names.get(r.customer_b) ?? null } });
  }
  return out;
}

async function suggestionPair(sb: Client, id: string) {
  const { data, error } = await sb.from("customer_merge_suggestions").select("customer_a,customer_b").eq("id", id).maybeSingle();
  if (error) throw new Error(`suggestion: ${error.message}`);
  if (!data) throw new CustomerError(404, "suggestion_not_found");
  return data as { customer_a: string; customer_b: string };
}

export async function confirmMerge(actor: CustomerActor, args: { suggestionId: string; keep: string }, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireStats(actor);
  requireId(args.suggestionId);
  requireId(args.keep);
  const sb = deps.client ?? getServiceRoleClient();
  const pair = await suggestionPair(sb, args.suggestionId);
  await assertInScope(sb, actor, [pair.customer_a, pair.customer_b]);
  const result = await rpc<{ kept: string; merged: string; changed: boolean }>(sb, "customer_merge", {
    p_actor_id: actor.userId, p_suggestion_id: args.suggestionId, p_keep: args.keep });
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.merge_confirm", resourceTable: "customers", resourceId: result.kept,
    metadata: { suggestion_id: args.suggestionId, merged: result.merged, changed: result.changed }, ...meta });
  return result;
}

export async function dismissMerge(actor: CustomerActor, args: { suggestionId: string }, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireStats(actor);
  requireId(args.suggestionId);
  const sb = deps.client ?? getServiceRoleClient();
  const pair = await suggestionPair(sb, args.suggestionId);
  await assertInScope(sb, actor, [pair.customer_a, pair.customer_b]);
  await rpc<boolean>(sb, "customer_merge_dismiss", { p_actor_id: actor.userId, p_suggestion_id: args.suggestionId });
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.merge_dismiss", resourceTable: "customer_merge_suggestions",
    resourceId: args.suggestionId, metadata: { customer_a: pair.customer_a, customer_b: pair.customer_b }, ...meta });
  return { ok: true };
}

// ── Level 9+ surfaces ────────────────────────────────────────────────────────────────────────────

export interface ContactDto { emails: string[]; phones: string[] }

/** One audited reveal of a profile's raw contact. */
export async function revealContact(actor: CustomerActor, customerId: string, meta: RequestMeta, deps: CustomerDeps = {}): Promise<ContactDto> {
  requireEnabled();
  requireContact(actor);
  requireId(customerId);
  const sb = deps.client ?? getServiceRoleClient();
  const members = await memberIds(sb, customerId);
  if (members.length === 0) throw new CustomerError(404, "customer_not_found");
  const { data, error } = await sb.from("customer_identifiers").select("kind,value").in("customer_id", members).order("kind").order("value");
  if (error) throw new Error(`identifiers: ${error.message}`);
  const rows = (data ?? []) as { kind: "email" | "phone"; value: string }[];
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.contact_read", resourceTable: "customers", resourceId: customerId,
    metadata: { emails: rows.filter((r) => r.kind === "email").length, phones: rows.filter((r) => r.kind === "phone").length }, ...meta });
  return { emails: rows.filter((r) => r.kind === "email").map((r) => r.value), phones: rows.filter((r) => r.kind === "phone").map((r) => r.value) };
}

/** Delete-on-request intake: find the person by the address/number they gave us. Audited either way. */
export async function lookupByContact(actor: CustomerActor, query: string, meta: RequestMeta, deps: CustomerDeps = {}): Promise<{ customerId: string | null }> {
  requireEnabled();
  requireContact(actor);
  const email = normalizeEmail(query);
  const phone = email ? null : normalizePhoneE164(query);
  if (!email && !phone) throw new CustomerError(400, "invalid_contact");
  const sb = deps.client ?? getServiceRoleClient();
  const { data, error } = await sb.from("customer_identifiers").select("customer_id").eq("kind", email ? "email" : "phone").eq("value", email ?? phone).maybeSingle();
  if (error) throw new Error(`lookup: ${error.message}`);
  let customerId: string | null = (data as { customer_id: string } | null)?.customer_id ?? null;
  if (customerId) {
    const { data: c } = await sb.from("customers").select("id,merged_into").eq("id", customerId).maybeSingle();
    customerId = (c as { merged_into: string | null } | null)?.merged_into ?? customerId;
  }
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.contact_lookup", resourceTable: "customers", resourceId: customerId,
    metadata: { kind: email ? "email" : "phone", found: customerId !== null }, ...meta });
  return { customerId };
}

export async function eraseCustomer(actor: CustomerActor, customerId: string, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireContact(actor);
  requireId(customerId);
  const sb = deps.client ?? getServiceRoleClient();
  const result = await rpc<{ customer_id: string; changed: boolean; identifiers_deleted?: number }>(sb, "customer_erase", {
    p_actor_id: actor.userId, p_customer_id: customerId, p_reason: "delete_request" });
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.erase", resourceTable: "customers", resourceId: result.customer_id,
    metadata: { reason: "delete_request", changed: result.changed, identifiers_deleted: result.identifiers_deleted ?? 0 }, ...meta });
  return result;
}

export function retentionCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  return d;
}

export async function runRetention(actor: CustomerActor, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireContact(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const cutoff = retentionCutoff(deps.now ?? new Date()).toISOString();
  let erased = 0;
  for (let batch = 0; batch < 10; batch++) {
    const r = await rpc<{ erased: number }>(sb, "customer_retention_sweep", { p_actor_id: actor.userId, p_cutoff: cutoff, p_limit: 200 });
    erased += r.erased;
    if (r.erased < 200) break;
  }
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.retention_sweep", resourceTable: "customers", resourceId: null,
    metadata: { cutoff, erased, months: RETENTION_MONTHS }, ...meta });
  return { erased, cutoff };
}

// ── Consent import (Toast Web Marketing CSV) ─────────────────────────────────────────────────────

export const CONSENT_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export async function importConsentCsv(
  actor: CustomerActor,
  args: { files: { name: string; text: string }[]; exportDate: string; allowLargeOptOut: boolean },
  meta: RequestMeta,
  deps: CustomerDeps = {},
): Promise<ConsentImportSummary & { invalid: number; duplicates: number; explicitStatus: boolean }> {
  requireEnabled();
  requireContact(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.exportDate) || Number.isNaN(Date.parse(`${args.exportDate}T00:00:00Z`))) throw new CustomerError(400, "invalid_export_date");
  if (args.files.length === 0 || args.files.length > 10) throw new CustomerError(400, "invalid_payload");
  if (args.files.reduce((n, f) => n + f.text.length, 0) > CONSENT_IMPORT_MAX_BYTES) throw new CustomerError(413, "csv_too_large");
  let merged;
  try { merged = mergeConsentFiles(args.files.map((f) => parseConsentCsv(f.text))); }
  catch (e) { if (e instanceof ConsentCsvError) throw new CustomerError(400, e.code); throw e; }
  const sha = createHash("sha256").update(canonicalImportPayload(merged.rows, merged.explicitStatus, args.exportDate), "utf8").digest("hex");
  const chunks = chunkRows(merged.rows);
  const sb = deps.client ?? getServiceRoleClient();
  const begun = await rpc<{ import_id: string; state: "started" | "resumed" | "completed" }>(sb, "customer_consent_import_begin", {
    p_actor_id: actor.userId, p_source: "toast_csv_import", p_rows_sha256: sha, p_export_date: args.exportDate,
    p_explicit_status: merged.explicitStatus, p_chunk_count: chunks.length });
  if (begun.state !== "completed") {
    for (const [i, chunk] of chunks.entries()) {
      await rpc(sb, "customer_consent_import_chunk", { p_actor_id: actor.userId, p_import_id: begun.import_id, p_chunk_index: i, p_rows: chunk });
    }
  }
  const finished = summaryFromRpc(await rpc<Record<string, unknown>>(sb, "customer_consent_import_finish", {
    p_actor_id: actor.userId, p_import_id: begun.import_id, p_allow_large_opt_out: args.allowLargeOptOut }));
  if (!finished.replay) {
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.consent_import", resourceTable: "customer_consent_imports",
      resourceId: finished.importId, metadata: { source: "toast_csv_import", export_date: args.exportDate, files: args.files.length,
        rows: finished.rowsTotal, new_opt_ins: finished.newOptIns, opt_outs: finished.optOuts, unchanged: finished.unchanged,
        stale: finished.stale, suppressed: finished.suppressed, new_customers: finished.newCustomers, baseline: finished.baseline,
        masked: finished.masked + merged.masked, consent_basis: "toast_list_explicit_opt_in",
        explicit_status: merged.explicitStatus, invalid: merged.invalid, rows_sha256: sha }, ...meta });
  }
  // Relay addresses dropped by the parser count with the ones SQL refused.
  return { ...finished, masked: finished.masked + merged.masked, invalid: merged.invalid, duplicates: merged.duplicates, explicitStatus: merged.explicitStatus };
}

/**
 * Cancel a half-applied import (r1 BC-036): a wrong file that hit the opt-out-wave guard, or a run that
 * died. Its events were pending and now never count; nothing is deleted. A corrected file can then begin.
 */
export async function cancelConsentImport(actor: CustomerActor, importId: string, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireContact(actor);
  requireId(importId);
  const sb = deps.client ?? getServiceRoleClient();
  const r = await rpc<{ import_id: string; changed: boolean; neutralised_events?: number }>(sb, "customer_consent_import_cancel", {
    p_actor_id: actor.userId, p_import_id: importId });
  if (r.changed) {
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.consent_import_cancel", resourceTable: "customer_consent_imports",
      resourceId: importId, metadata: { neutralised_events: r.neutralised_events ?? 0 }, ...meta });
  }
  return { changed: r.changed };
}

export interface ConsentOverview {
  imports: { id: string; exportDate: string; createdAt: string; status: string; baseline: boolean; newOptIns: number; optOuts: number; rowsTotal: number }[];
  newlyOptedIn: { customerId: string; name: string | null; optedInAt: string; previous: string; hadOrders: boolean }[];
  optedIn: number;
  metaEnabled: boolean;
}

export async function loadConsentOverview(viewer: CustomerViewer, deps: CustomerDeps = {}): Promise<ConsentOverview> {
  requireEnabled();
  requireContact(viewer);
  const sb = deps.client ?? getServiceRoleClient();
  const { data: imports, error } = await sb.from("customer_consent_imports")
    .select("id,export_date,created_at,status,is_baseline,new_opt_ins,opt_outs,rows_total").order("created_at", { ascending: false }).limit(10);
  if (error) rpcError(error);
  const since = new Date((deps.now ?? new Date()).getTime() - 30 * 86_400_000).toISOString();
  const newly = await rpc<{ customer_id: string; full_name: string | null; opted_in_at: string; previous_status: string; had_orders: boolean }[]>(
    sb, "customer_newly_opted_in", { p_since: since, p_limit: 200 });
  const { count, error: ce } = await sb.from("customer_consent_current").select("customer_id", { count: "exact", head: true })
    .eq("channel", "email").eq("status", "opted_in");
  if (ce) throw new Error(`consent count: ${ce.message}`);
  return {
    imports: ((imports ?? []) as { id: string; export_date: string; created_at: string; status: string; is_baseline: boolean; new_opt_ins: number; opt_outs: number; rows_total: number }[])
      .map((r) => ({ id: r.id, exportDate: r.export_date, createdAt: r.created_at, status: r.status, baseline: r.is_baseline, newOptIns: r.new_opt_ins, optOuts: r.opt_outs, rowsTotal: r.rows_total })),
    newlyOptedIn: newly.map((r) => ({ customerId: r.customer_id, name: r.full_name, optedInAt: r.opted_in_at, previous: r.previous_status, hadOrders: r.had_orders })),
    optedIn: count ?? 0,
    metaEnabled: metaAudienceEnabled(),
  };
}

// ── Exports (level 9+, audited, opted-in only, no override) ──────────────────────────────────────

export type CustomerExportKind = "marketing_email" | "meta_audience";

async function marketingRows(sb: Client, channel: "email" | "sms"): Promise<MarketingSourceRow[]> {
  return selectAllRows<MarketingSourceRow>((from, to) => sb.rpc("customer_marketing_export", { p_channel: channel }).range(from, to));
}

export async function exportCustomers(actor: CustomerActor, kind: CustomerExportKind, meta: RequestMeta, deps: CustomerDeps = {}): Promise<{ filename: string; csv: string; count: number }> {
  requireEnabled();
  if (actor.level < CUSTOMER_CONTACT_MIN || (kind === "meta_audience" && !metaAudienceEnabled())) {
    const code = actor.level < CUSTOMER_CONTACT_MIN ? "role_insufficient" : "meta_export_off";
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.export_refused", resourceTable: "customers", resourceId: null,
      metadata: { kind, code }, ...meta });
    throw new CustomerError(403, code);
  }
  const sb = deps.client ?? getServiceRoleClient();
  const date = (deps.now ?? new Date()).toISOString().slice(0, 10);
  if (kind === "marketing_email") {
    const { csv, count } = marketingCsv(await marketingRows(sb, "email"));
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.export_marketing", resourceTable: "customers", resourceId: null,
      metadata: { kind, rows: count }, ...meta });
    return { filename: `marketing-opted-in-${date}.csv`, csv, count };
  }
  const { csv, count } = metaAudienceCsv(await marketingRows(sb, "email"), await marketingRows(sb, "sms"));
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.export_meta_audience", resourceTable: "customers", resourceId: null,
    metadata: { kind, rows: count, hashed: "sha256", uploaded: false }, ...meta });
  return { filename: `meta-audience-hashed-${date}.csv`, csv, count };
}

// ── Catering + ezCater links (level 9+ on demand) ────────────────────────────────────────────────

export async function linkCateringOrders(actor: CustomerActor, meta: RequestMeta, deps: CustomerDeps = {}) {
  requireEnabled();
  requireContact(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const catering = await selectAllRows<{ id: string; location_id: string; order_date: string; amount_cents: number | null; catering_customers: unknown }>(
    (from, to) => sb.from("catering_orders").select("id,location_id,order_date,amount_cents,catering_customers!inner(name,email,phone)").order("id").range(from, to));
  const ez = await selectAllRows<{ id: string; location_id: string; event_date: string | null; total_cents: number | null; ezcater_order_contacts: unknown }>(
    (from, to) => sb.from("ezcater_orders").select("id,location_id,event_date,total_cents,ezcater_order_contacts(contact)").order("id").range(from, to));
  const rows = [
    ...catering.map((o) => cateringRow("catering", o.id, o.location_id, o.order_date, o.amount_cents, contactOf(one(o.catering_customers)))),
    ...ez.filter((o) => o.event_date).map((o) => {
      const c = one(one(o.ezcater_order_contacts)?.contact);
      return cateringRow("ezcater", o.id, o.location_id, o.event_date!, o.total_cents, contactOf(c));
    }),
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  let linked = 0;
  let skipped = 0;
  for (const chunk of chunkRows(rows, 500)) {
    if (chunk.length === 0) continue;
    const r = await rpc<{ linked: number; skipped: number }>(sb, "customer_link_catering", { p_rows: chunk });
    linked += r.linked;
    skipped += r.skipped;
  }
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "customer.catering_link", resourceTable: "customer_orders", resourceId: null,
    metadata: { linked, skipped, candidates: rows.length }, ...meta });
  return { linked, skipped };
}

/** PostgREST embeds arrive as an object or a one-element array depending on the FK shape. */
function one(x: unknown): Record<string, unknown> | null {
  const v = Array.isArray(x) ? x[0] : x;
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function contactOf(c: Record<string, unknown> | null) {
  if (!c) return null;
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : null);
  return { name: s("name"), email: s("email"), phone: s("phone") };
}

function cateringRow(kind: "catering" | "ezcater", id: string, locationId: string, date: string, totalCents: number | null,
  contact: { name: string | null; email: string | null; phone: string | null } | null) {
  if (!contact) return null;
  const e = classifyEmail(contact.email);
  const email = e.kind === "ok" ? e.email : null;
  const phone = normalizePhoneE164(contact.phone ?? "");
  if (!email && !phone) return null;
  return { kind, order_id: id, location_id: locationId, business_date: date.slice(0, 10), total_cents: totalCents,
    email, phone, full_name: contact.name?.trim().slice(0, 200) || null,
    contact_masked: e.kind === "masked", masked_channel: e.kind === "masked" ? kind : null };
}

