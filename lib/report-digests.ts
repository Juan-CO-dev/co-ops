/**
 * Report digests — the server I/O (service-role reads, Resend, audit, ops alerts). Builds the
 * DigestIO the engine runs on (lib/report-digests-engine.ts) and exposes the two entry points:
 *   runDigestTick()                       — /api/cron/digest-tick (the desktop pinger, 03-22 ET)
 *   runClosingDigests(locationId, day)    — after() in /api/checklist/confirm for a closing
 * Pure rules live in lib/report-digests-shared.ts and lib/report-digests-compose.ts.
 *
 * SENDER (risk R1): digests go out FROM teamFrom() (EMAIL_FROM_TEAM, else EMAIL_FROM). While
 * EMAIL_FROM is still onboarding@resend.dev, Resend 422s every recipient except the account owner;
 * that is a 'failed' row + an immediate ops alert, never a silent loss. The switch ships OFF.
 */
import "server-only";
import { createHash } from "node:crypto";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail, teamFrom } from "@/lib/email";
import { appUrl } from "@/lib/email-templates/_layout";
import { DEFAULT_OPS_ALERT_EMAIL } from "@/lib/jobs-registry";
import { easternBoundary, easternDay } from "@/lib/job-watch";
import { listReports } from "@/lib/reports-hub";
import { selectAllRows } from "@/lib/supabase-paginate";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";
import { serverT } from "@/lib/i18n/server";
import { isTaskType, type TaskType } from "@/lib/assignments-shared";
import {
  addDays,
  parseDigestSettings,
  type DigestDirectory,
  type DigestSettings,
  type RecipientOverride,
  type SendLogRow,
} from "@/lib/report-digests-shared";
import type { CateringFacts, CateringLeadFact, ShopDayFacts } from "@/lib/report-digests-compose";
import {
  runClosingDigestsWith,
  runDigestTickWith,
  type DigestAlert,
  type DigestIO,
  type DigestRunSummary,
  type SendStore,
} from "@/lib/report-digests-engine";
import { packageIO } from "@/lib/report-package";

type Sb = ReturnType<typeof getServiceRoleClient>;

const auditBase = { actorId: null, actorRole: null, resourceId: null, ipAddress: null, userAgent: null } as const;

/** The system viewer for report reads: level 8 sees every shop and the cash numbers (KH+). */
const SYSTEM_VIEWER = { userId: "00000000-0000-0000-0000-000000000000", level: 8 };
const FINALIZED_CLOSING = ["confirmed", "incomplete_confirmed", "auto_finalized"];

/** Preview mode delivers here: DIGEST_PREVIEW_EMAIL, else the ops alert address (Juan). */
export function digestPreviewAddress(): string {
  return process.env.DIGEST_PREVIEW_EMAIL?.trim() || process.env.OPS_ALERT_EMAIL?.trim() || DEFAULT_OPS_ALERT_EMAIL;
}

export async function loadDigestSettings(sb: Sb): Promise<DigestSettings> {
  const { data, error } = await sb.from("report_settings").select("key, value");
  if (error) throw new Error(`report_settings: ${error.message}`);
  return parseDigestSettings((data ?? []) as Array<{ key: string; value: unknown }>);
}

interface RecipientRow {
  id: string; kind: "internal" | "external"; user_id: string | null; email: string | null; display_name: string;
  active: boolean; catering_digest: boolean; shop_digest: boolean; location_ids: string[] | null;
}

export function mapOverride(r: RecipientRow): RecipientOverride {
  return {
    id: r.id, kind: r.kind, userId: r.user_id, email: r.email, displayName: r.display_name, active: r.active,
    cateringDigest: r.catering_digest, shopDigest: r.shop_digest, locationIds: r.location_ids,
  };
}

export async function loadDigestDirectory(sb: Sb): Promise<{ dir: DigestDirectory; locations: Array<{ id: string; name: string }> }> {
  const [users, memberships, overrides, locations] = await Promise.all([
    selectAllRows<{ id: string; name: string; email: string | null; role: string; language: string | null; active: boolean }>((from, to) =>
      sb.from("users").select("id, name, email, role, language, active").order("id").range(from, to)),
    selectAllRows<{ user_id: string; location_id: string }>((from, to) =>
      sb.from("user_locations").select("user_id, location_id").eq("active", true).order("user_id").order("location_id").range(from, to)),
    selectAllRows<RecipientRow>((from, to) =>
      sb.from("report_recipients").select("id, kind, user_id, email, display_name, active, catering_digest, shop_digest, location_ids").order("id").range(from, to)),
    selectAllRows<{ id: string; name: string }>((from, to) =>
      sb.from("locations").select("id, name").eq("active", true).order("name").order("id").range(from, to)),
  ]);
  return {
    dir: {
      users,
      memberships: memberships.map((m) => ({ userId: m.user_id, locationId: m.location_id })),
      overrides: overrides.map(mapOverride),
      locationIds: locations.map((l) => l.id),
    },
    locations,
  };
}

async function loadSendLog(sb: Sb, days: string[]): Promise<SendLogRow[]> {
  return selectAllRows<SendLogRow>((from, to) =>
    sb.from("report_digest_sends")
      .select("recipient_ref, kind, business_day, location_id, revision, mode, outcome, skip_reason, attempted_at")
      .in("business_day", days).order("id").range(from, to));
}

async function loadFinalizedClosings(sb: Sb, days: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(days.map((d) => [d, new Set<string>()]));
  const { data: templates, error: tErr } = await sb.from("checklist_templates").select("id").eq("type", "closing");
  if (tErr) throw new Error(`closing templates: ${tErr.message}`);
  const ids = (templates ?? []).map((t: { id: string }) => t.id);
  if (ids.length === 0) return out;
  const rows = await selectAllRows<{ location_id: string; date: string }>((from, to) =>
    sb.from("checklist_instances").select("location_id, date").in("template_id", ids).in("date", days)
      .in("status", FINALIZED_CLOSING).order("id").range(from, to));
  for (const r of rows) out.get(r.date)?.add(r.location_id);
  return out;
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return n ?? 0;
}

export async function loadShopDayFacts(sb: Sb, location: { id: string; name: string }, day: string): Promise<ShopDayFacts> {
  const [reports, deliveries, tosses, storeRunsPending, tasks] = await Promise.all([
    listReports(sb, { viewer: SYSTEM_VIEWER, locationId: location.id, dateFrom: day, dateTo: day }),
    selectAllRows<{ match_state: string; receipt_url: string | null }>((from, to) =>
      sb.from("vendor_deliveries").select("match_state, receipt_url").eq("location_id", location.id).eq("delivery_date", day).order("id").range(from, to)),
    count(sb.from("prep_batch_sessions").select("instance_id", { count: "exact", head: true })
      .eq("location_id", location.id).eq("business_date", day).gt("tossed_qty", 0), "tosses"),
    count(sb.from("vendor_items").select("id", { count: "exact", head: true })
      .eq("location_id", location.id).eq("pending_review", true).eq("active", true), "store runs"),
    selectAllRows<{ report_type: string }>((from, to) =>
      sb.from("report_assignments").select("report_type").eq("location_id", location.id).eq("operational_date", day).eq("active", true).order("id").range(from, to)),
  ]);
  return {
    location, day, reports,
    receiving: {
      deliveries: deliveries.length,
      discrepant: deliveries.filter((d) => d.match_state === "discrepant").length,
      missingReceipt: deliveries.filter((d) => !d.receipt_url).length,
    },
    tosses, storeRunsPending,
    tasks: [...new Set(tasks.map((t) => t.report_type).filter((x): x is TaskType => isTaskType(x)))],
  };
}

interface LeadRow {
  id: string; contact_name: string; company: string | null; event_date: string | null; time_window: string | null;
  headcount: number | null; stage: string; lead_source: string | null; location_id: string | null; created_at: string;
  follow_up_date: string | null; external_ref: string | null; delivery_address: string | null; estimated_revenue_cents: number | null;
}
const LEAD_SELECT = "id, contact_name, company, event_date, time_window, headcount, stage, lead_source, location_id, created_at, follow_up_date, external_ref, delivery_address, estimated_revenue_cents";

export async function loadCateringFacts(sb: Sb, today: string, now: Date): Promise<CateringFacts> {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const y = operationalDayUtcRange(yesterday);
  const leads = new Map<string, LeadRow>();
  const add = (rows: LeadRow[]) => { for (const r of rows) leads.set(r.id, r); };
  const leadsQuery = () => sb.from("catering_pipeline").select(LEAD_SELECT);

  const [events, lostEvents] = await Promise.all([
    Promise.all([
      selectAllRows<LeadRow>((from, to) => leadsQuery().gte("event_date", yesterday).lte("event_date", tomorrow).order("id").range(from, to)),
      selectAllRows<LeadRow>((from, to) => leadsQuery().gte("created_at", y.startIso).lt("created_at", y.endExclusiveIso).order("id").range(from, to)),
      selectAllRows<LeadRow>((from, to) => leadsQuery().in("stage", ["inquiry", "quote_sent"]).lt("follow_up_date", today).order("id").range(from, to)),
    ]),
    selectAllRows<{ pipeline_id: string }>((from, to) =>
      sb.from("catering_pipeline_events").select("pipeline_id").eq("to_stage", "lost")
        .gte("created_at", y.startIso).lt("created_at", y.endExclusiveIso).order("id").range(from, to)),
  ]);
  for (const rows of events) add(rows);
  const lostIds = [...new Set(lostEvents.map((e) => e.pipeline_id))];
  const missingLost = lostIds.filter((id) => !leads.has(id));
  if (missingLost.length > 0) add(await selectAllRows<LeadRow>((from, to) => leadsQuery().in("id", missingLost).order("id").range(from, to)));

  const leadIds = [...leads.keys()];
  const accepted = new Map<string, { id: string; total_cents: number; is_delivery: boolean; version: number }>();
  const due = new Map<string, number>();
  const prep = new Map<string, number>();
  if (leadIds.length > 0) {
    const quotes = await selectAllRows<{ id: string; pipeline_id: string; total_cents: number; is_delivery: boolean; version: number }>((from, to) =>
      sb.from("catering_quotes").select("id, pipeline_id, total_cents, is_delivery, version").in("pipeline_id", leadIds)
        .eq("status", "accepted").is("superseded_at", null).order("id").range(from, to));
    for (const q of quotes) {
      const prev = accepted.get(q.pipeline_id);
      if (!prev || q.version > prev.version) accepted.set(q.pipeline_id, q);
    }
    const quoteIds = [...accepted.values()].map((q) => q.id);
    const pipelineByQuote = new Map([...accepted].map(([pid, q]) => [q.id, pid]));
    const [payments, demand] = await Promise.all([
      quoteIds.length === 0 ? Promise.resolve([]) : selectAllRows<{ quote_id: string; amount_cents: number }>((from, to) =>
        sb.from("catering_payments").select("quote_id, amount_cents").in("quote_id", quoteIds).eq("status", "due").order("id").range(from, to)),
      selectAllRows<{ pipeline_id: string }>((from, to) =>
        sb.from("catering_prep_demand").select("pipeline_id").in("pipeline_id", leadIds).in("status", ["reserved", "consumed"]).order("id").range(from, to)),
    ]);
    for (const p of payments) {
      const pid = pipelineByQuote.get(p.quote_id);
      if (pid) due.set(pid, (due.get(pid) ?? 0) + p.amount_cents);
    }
    for (const d of demand) prep.set(d.pipeline_id, (prep.get(d.pipeline_id) ?? 0) + 1);
  }

  const [sentYesterday, openQuotes, refunds] = await Promise.all([
    selectAllRows<{ id: string; location_id: string; total_cents: number }>((from, to) =>
      sb.from("catering_quotes").select("id, location_id, total_cents").gte("sent_at", y.startIso).lt("sent_at", y.endExclusiveIso).order("id").range(from, to)),
    selectAllRows<{ id: string; location_id: string; expires_at: string | null }>((from, to) =>
      sb.from("catering_quotes").select("id, location_id, expires_at").eq("status", "sent").is("superseded_at", null).order("id").range(from, to)),
    selectAllRows<{ quote_id: string; amount_cents: number }>((from, to) =>
      sb.from("catering_payments").select("quote_id, amount_cents").eq("status", "refunded")
        .gte("paid_at", y.startIso).lt("paid_at", y.endExclusiveIso).order("id").range(from, to)),
  ]);
  const refundQuoteIds = [...new Set(refunds.map((r) => r.quote_id))];
  const refundLoc = new Map<string, string>();
  if (refundQuoteIds.length > 0) {
    const { data, error } = await sb.from("catering_quotes").select("id, location_id").in("id", refundQuoteIds);
    if (error) throw new Error(`refund quotes: ${error.message}`);
    for (const q of (data ?? []) as Array<{ id: string; location_id: string }>) refundLoc.set(q.id, q.location_id);
  }

  const facts: CateringLeadFact[] = [...leads.values()].map((l) => {
    const q = accepted.get(l.id);
    return {
      id: l.id, contactName: l.contact_name, company: l.company, eventDate: l.event_date, timeWindow: l.time_window,
      headcount: l.headcount, stage: l.stage, leadSource: l.lead_source, locationId: l.location_id,
      createdDay: etCalendarDate(l.created_at), followUpDate: l.follow_up_date, externalRef: l.external_ref,
      isDelivery: !!l.delivery_address?.trim() || !!q?.is_delivery,
      valueCents: q?.total_cents ?? l.estimated_revenue_cents ?? 0,
      dueCents: due.get(l.id) ?? 0,
      prepLines: prep.has(l.id) ? prep.get(l.id)! : null,
    };
  });
  return {
    today, leads: facts, lostYesterdayIds: lostIds,
    quotesSentYesterday: sentYesterday.map((q) => ({ id: q.id, locationId: q.location_id, totalCents: q.total_cents })),
    openQuotes: openQuotes.filter((q) => !q.expires_at || Date.parse(q.expires_at) > now.getTime()).map((q) => ({ id: q.id, locationId: q.location_id })),
    refundsYesterday: refunds.map((r) => ({ locationId: refundLoc.get(r.quote_id) ?? null, amountCents: r.amount_cents })),
  };
}

export function supabaseSendStore(sb: Sb): SendStore {
  return {
    async claim(row) {
      const { data, error } = await sb.from("report_digest_sends").insert({ ...row, outcome: "claimed" }).select("id").single<{ id: string }>();
      if (error) {
        if ((error as { code?: string }).code === "23505") return "duplicate";
        throw new Error(`digest claim: ${error.message}`);
      }
      return { id: data.id };
    },
    async finish(id, patch) {
      const { data, error } = await sb.from("report_digest_sends")
        .update({ ...patch, completed_at: new Date().toISOString() })
        .eq("id", id).eq("outcome", "claimed").select("id");
      if (error) throw new Error(`digest finish: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async skip(row) {
      const { error } = await sb.from("report_digest_sends").insert({ ...row, outcome: "skipped", completed_at: new Date().toISOString() });
      if (error) throw new Error(`digest skip: ${error.message}`);
    },
  };
}

/**
 * The ops alert, job-watch shaped (one bilingual email to OPS_ALERT_EMAIL + a cron.failure row
 * with job digest-<kind>), claimed once per detector × kind × business day × ET day through the
 * same atomic RPC job-watch uses. Fails closed on a claim error (no duplicate storm) but never
 * throws: the failed send row and digest-watch remain the record.
 */
export async function alertDigestProblem(sb: Sb, a: DigestAlert, now: Date): Promise<boolean> {
  try {
    const etDay = easternDay(now);
    const claim = await sb.rpc("portal_rate_limit_hit", {
      p_bucket_key: `${a.detector}:${a.kind}:${a.day}:${etDay}`,
      p_window_start: easternBoundary(etDay, 0).toISOString(),
      p_max: 1,
    });
    if (claim.error || claim.data !== true) return false;
    const params = { kind: a.kind, day: a.day, n: a.missing?.length ?? 0, refs: (a.missing ?? []).slice(0, 10).join(", "), ref: a.ref ?? "", error: a.error ?? "" };
    const messages = (["en", "es"] as const).map((language) => ({
      subject: serverT(language, a.detector === "digest-send" ? "digestWatch.send_failed_subject" : "digestWatch.subject", params),
      body: serverT(language, a.detector === "digest-send" ? "digestWatch.send_failed_body" : "digestWatch.body", params),
    }));
    const text = messages.map((m) => m.body).join("\n\n");
    let emailError: string | null = null;
    const sent = await sendEmail({
      to: process.env.OPS_ALERT_EMAIL?.trim() || DEFAULT_OPS_ALERT_EMAIL, from: teamFrom(),
      subject: messages[0]!.subject, text,
      html: `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n\n", "</p><p>")}</p>`,
    });
    if ("error" in sent) emailError = sent.error.slice(0, 500);
    await audit({ ...auditBase, action: "cron.failure", resourceTable: "report_digest_sends", metadata: {
      job: `digest-${a.kind}`, detector: a.detector, business_day: a.day,
      missing: a.missing ?? null, recipient_ref: a.ref ?? null, error: a.error ?? null, email_error: emailError,
    } });
    return true;
  } catch {
    return false;
  }
}

function buildIO(now: Date): DigestIO {
  const sb = getServiceRoleClient();
  return {
    now,
    baseUrl: appUrl(),
    previewTo: digestPreviewAddress(),
    settings: () => loadDigestSettings(sb),
    directory: () => loadDigestDirectory(sb),
    sendLog: (days) => loadSendLog(sb, days),
    finalizedClosings: (days) => loadFinalizedClosings(sb, days),
    shopFacts: (location, day) => loadShopDayFacts(sb, location, day),
    cateringFacts: (today) => loadCateringFacts(sb, today, now),
    async expireStaleClaims() {
      const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
      const { data, error } = await sb.from("report_digest_sends")
        .update({ outcome: "failed", error: "stale_claim", completed_at: now.toISOString() })
        .eq("outcome", "claimed").lt("attempted_at", cutoff).select("id");
      if (error) throw new Error(`stale claims: ${error.message}`);
      return (data ?? []).length;
    },
    store: supabaseSendStore(sb),
    sendEmail: (m) => sendEmail({ ...m, from: teamFrom() }),
    sha: (content) => createHash("sha256").update(content).digest("hex"),
    alert: (a) => alertDigestProblem(sb, a, now),
    // Exports PR: the scheduled CSV/PDF package (Pete at close; the accountant once enabled).
    packages: packageIO(sb, now),
    async recordRun(summary: DigestRunSummary) {
      await audit({ ...auditBase, action: "digest.run", resourceTable: "report_digest_sends", metadata: { ...summary } });
    },
  };
}

/** The pinger tick. Throws on a read failure (the route records cron.failure); null when OFF. */
export async function runDigestTick(now: Date = new Date()): Promise<DigestRunSummary | null> {
  return runDigestTickWith(buildIO(now));
}

/**
 * The closing hook. NEVER throws: it runs inside after() beside the sales pull, and the tick
 * reconciles anything it misses (a closing finalized with no sent row is sent on the next tick).
 */
export async function runClosingDigests(locationId: string, day: string): Promise<void> {
  try {
    await runClosingDigestsWith(buildIO(new Date()), locationId, day);
  } catch (error) {
    console.error("[digests] closing hook failed; the next digest-tick reconciles:", error instanceof Error ? error.message : String(error));
  }
}
