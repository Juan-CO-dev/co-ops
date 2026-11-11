/**
 * Catering inbox phase 1b — THE SOLE SEND BOUNDARY.
 *
 * Nothing else under lib/catering/inbox* or app/api/catering/inbox imports a sender (pinned by
 * tests/catering-inbox-no-send.test.ts). A send needs ALL of: settings mode `live`, the env flag
 * CATERING_INBOX_DELIVERY_ENABLED exactly "1", an explicit CATERING_INBOX_FROM (replies) and EMAIL_FROM_TEAM
 * (escalations), a provider key, and a successful SQL claim (0298) that re-checks eligibility, the handled
 * state, the recipient, the per-thread daily cap and — for a human — the revision, session and access.
 *
 * One claim = one attempt = one idempotency key (`catering-inbox:<draft id>:<attempt>`). An uncertain provider
 * answer is retried ONCE under the SAME key, then recorded `ambiguous` for a human; it is never resent under a
 * new key. Customer replies go from the catering inbox sender with In-Reply-To / References; escalations go to
 * the assignee from team@. Draft links are the plain portal start page (no token), frozen at finalize.
 */
import { randomUUID } from "node:crypto";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { TENANT_NAME } from "@/lib/tenant";
import { configuredOrigin } from "@/lib/landing/host-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { isInboxSchemaMissing } from "./inbox-schema-shared";
import { CateringInboxError, inboxReader, readCateringInboxSettings } from "./inbox";
import { canReadCateringInbox, type InboxReason } from "./inbox-shared";
import { inboxOwnAddresses, type InboxHeaders } from "./inbox-content-shared";
import { inboxAutomatedMessage } from "./inbox-classify-shared";
import { normalizeInboundAddress } from "@/lib/inbound-router-shared";
import {
  buildInboxEscalation, INBOX_MAX_CRON_ATTEMPTS, INBOX_RETRY_BACKOFF_MS, inboxCronEligible, inboxDeliveryConfig, inboxDeliveryOutcome, inboxReplyThreading, inboxStaffUrl,
  renderInboxEscalation, renderInboxReply, type InboxDeliveryConfig, type InboxDeliveryErrorCode, type InboxDeliveryOutcome, type InboxDeliveryState, type Translate,
} from "./inbox-delivery-shared";

type Service = ReturnType<typeof getServiceRoleClient>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_CODES = ["delivery_off", "not_found", "forbidden", "request_conflict", "stale_revision", "invalid_state", "no_draft", "already_sent",
  "needs_review", "delivery_busy", "attempts_exhausted", "not_new", "invalid_recipient", "revalidation_failed", "quote_revalidation_failed", "thread_cap", "invalid_escalation", "invalid_input"] as const;
const dictionaries: Record<"en" | "es", Record<string, string>> = { en, es };
const translator = (language: "en" | "es"): Translate => (key, params) =>
  (dictionaries[language][key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match);

interface ClaimResult {
  message_id: string; revision: number; replayed: boolean; refused?: string; draft_id: string; kind: "reply" | "escalation"; attempt: number;
  token: string; recipient: string; idempotency_key: string; language: "en" | "es"; template_key: string; params: Record<string, string>;
  preview_text: string; subject: string; message_id_header: string | null; references_header: string | null;
}
export interface DeliveryResult { message_id: string; revision: number; draft_id: string | null; attempt: number; state: InboxDeliveryState | "replayed" }

function claimError(error: { message: string }): CateringInboxError {
  if (isInboxSchemaMissing(error)) return new CateringInboxError(503, "inbox_unavailable");
  const code = CLAIM_CODES.find(c => error.message === c);
  return new CateringInboxError(code === "forbidden" ? 403 : code === "not_found" ? 404 : code === "invalid_input" || code === "invalid_escalation" ? 500 : code ? 409 : 500, code ?? "write_failed");
}

/** The configured switches, or the named refusal. Read once per request / run. */
async function deliveryConfig(sb: Service): Promise<{ config: InboxDeliveryConfig; liveSince: string | null }> {
  const settings = await readCateringInboxSettings(sb);
  return { config: inboxDeliveryConfig(settings.mode, { CATERING_INBOX_DELIVERY_ENABLED: process.env.CATERING_INBOX_DELIVERY_ENABLED, CATERING_INBOX_FROM: process.env.CATERING_INBOX_FROM,
    EMAIL_FROM_TEAM: process.env.EMAIL_FROM_TEAM, RESEND_API_KEY: process.env.RESEND_API_KEY }), liveSince: settings.live_since };
}

async function ownAddresses(sb: Service): Promise<ReadonlySet<string>> {
  const [aliases, locations] = await Promise.all([
    selectAllRows<{ address: string; active: boolean }>((from, to) => sb.from("inbound_address_aliases").select("address,active").eq("active", true).order("id").range(from, to)),
    selectAllRows<{ receipt_email_address: string | null }>((from, to) => sb.from("locations").select("receipt_email_address").order("id").range(from, to)),
  ]);
  return inboxOwnAddresses({ aliases, receiptAddresses: locations.map(row => row.receipt_email_address), emailFrom: process.env.EMAIL_FROM,
    emailFromTeam: process.env.EMAIL_FROM_TEAM, legacyAddresses: process.env.CATERING_LEGACY_ADDRESSES, inboxFrom: process.env.CATERING_INBOX_FROM });
}

interface DeliverArgs {
  sb: Service; config: Extract<InboxDeliveryConfig, { ok: true }>; own: ReadonlySet<string>; messageId: string; kind: "reply" | "escalation";
  trigger: "human" | "cron"; actor?: AuthContext; actorRole?: AuthContext["user"]["role"]; expectedRevision?: number; requestId: string;
  escalation?: { language: "en" | "es"; params: Record<string, string>; preview_text: string } | null;
}

/** One attempt, end to end: loop guard → claim → render → send (≤ 2 provider calls, one key) → finish → audit. */
async function deliverOne(args: DeliverArgs): Promise<DeliveryResult> {
  const { sb, config } = args;
  const message = await sb.from("catering_inbound_messages").select("sender_address,headers").eq("id", args.messageId)
    .maybeSingle<{ sender_address: string | null; headers: InboxHeaders }>();
  if (isInboxSchemaMissing(message.error)) throw new CateringInboxError(503, "inbox_unavailable");
  if (message.error) throw new CateringInboxError(500, "read_failed");
  if (!message.data) throw new CateringInboxError(404, "not_found");
  const sender = normalizeInboundAddress(message.data.sender_address ?? "");
  // Loop guards from phase 1, re-checked before anything is claimed: own addresses, auto-replies, bounces, list mail.
  if (args.kind === "reply" && (!sender || args.own.has(sender) || inboxAutomatedMessage(message.data.headers ?? {}, sender))) throw new CateringInboxError(409, "invalid_recipient");
  const claim = await sb.rpc("claim_catering_inbox_delivery", {
    p_message_id: args.messageId, p_kind: args.kind, p_trigger: args.trigger, p_actor_id: args.actor?.user.id ?? null, p_session_id: args.actor?.session.id ?? null,
    p_expected_revision: args.expectedRevision ?? null, p_request_id: args.requestId, p_escalation: args.escalation ?? null,
  });
  if (claim.error) throw claimError(claim.error);
  const claimed = claim.data as ClaimResult;
  if (claimed.replayed) return { message_id: claimed.message_id, revision: claimed.revision, draft_id: null, attempt: 0, state: "replayed" };
  if (claimed.refused) throw new CateringInboxError(409, claimed.refused);
  if (args.trigger === "human" && args.actor) {
    await audit({ actorId: args.actor.user.id, actorRole: args.actorRole ?? args.actor.user.role, action: "catering.inbox.send", resourceTable: "catering_inbox_drafts", resourceId: claimed.draft_id,
      metadata: { request_id: args.requestId, message_id: claimed.message_id, attempt: claimed.attempt, revision: claimed.revision }, ipAddress: null, userAgent: null });
  }
  const recipient = normalizeInboundAddress(claimed.recipient);
  const t = translator(claimed.language);
  let outcome: InboxDeliveryOutcome | { outcome: "failed"; code: "invalid_recipient" };
  if (recipient === null || args.own.has(recipient)) outcome = { outcome: "failed", code: "invalid_recipient" };
  else {
    const mail = claimed.kind === "reply" ? renderInboxReply({ templateKey: claimed.template_key, params: claimed.params, previewText: claimed.preview_text, translate: t })
      : renderInboxEscalation({ previewText: claimed.preview_text, translate: t });
    const threading = claimed.kind === "reply" ? inboxReplyThreading({ "message-id": claimed.message_id_header ?? undefined, references: claimed.references_header ?? undefined }) : {};
    const send = () => sendEmail({ to: recipient!, from: claimed.kind === "reply" ? config.replyFrom : config.teamFrom, subject: mail.subject, html: mail.html, text: mail.text,
      idempotencyKey: claimed.idempotency_key, ...threading });
    let mapped = inboxDeliveryOutcome(await send());
    // Uncertain once → the SAME key again (the provider de-duplicates); still uncertain, or a conflict on that key → a
    // person. Uncertainty is never downgraded to `failed` here, so no later attempt can mint a new key over it.
    if (mapped.outcome === "ambiguous" && mapped.code === "provider_uncertain") mapped = inboxDeliveryOutcome(await send());
    outcome = mapped;
  }
  const finish = await sb.rpc("finish_catering_inbox_delivery", { p_draft_id: claimed.draft_id, p_token: claimed.token, p_outcome: outcome.outcome,
    p_provider_id: outcome.outcome === "sent" ? outcome.providerId : null, p_error_code: outcome.outcome === "sent" ? null : outcome.code });
  const finished = finish.error ? null : (finish.data as { revision: number });
  const state: InboxDeliveryState = finished ? outcome.outcome : "ambiguous";
  const action: AuditAction = state === "sent" ? "catering.inbox.delivery_sent" : state === "failed" ? "catering.inbox.delivery_failed" : "catering.inbox.delivery_ambiguous";
  await audit({ actorId: null, actorRole: null, action, resourceTable: "catering_inbox_drafts", resourceId: claimed.draft_id,
    metadata: { message_id: claimed.message_id, kind: claimed.kind, trigger: args.trigger, attempt: claimed.attempt,
      ...(outcome.outcome === "sent" ? { provider_id: outcome.providerId } : { error_code: outcome.code satisfies InboxDeliveryErrorCode }),
      ...(finished ? {} : { finish_failed: true }) }, ipAddress: null, userAgent: null });
  return { message_id: claimed.message_id, revision: finished?.revision ?? claimed.revision, draft_id: claimed.draft_id, attempt: claimed.attempt, state };
}

export interface InboxSendInput { expectedRevision: number; requestId: string }
/** The human "Send draft": Tier B at the route; here the fresh role / membership read, the switches, then one attempt. */
export async function sendCateringInboxDraft(ctx: AuthContext, id: string, input: InboxSendInput): Promise<DeliveryResult> {
  const actor = await inboxReader(ctx);
  if (!UUID.test(id) || !UUID.test(input.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new CateringInboxError(400, "invalid_payload");
  const sb = getServiceRoleClient();
  const { config } = await deliveryConfig(sb);
  if (!config.ok) throw new CateringInboxError(config.code === "delivery_off" ? 409 : 503, config.code);
  const row = await sb.from("catering_inbound_messages").select("location_id").eq("id", id).maybeSingle();
  if (isInboxSchemaMissing(row.error)) throw new CateringInboxError(503, "inbox_unavailable");
  if (row.error) throw new CateringInboxError(500, "read_failed");
  if (!row.data || !canReadCateringInbox(actor, row.data.location_id)) throw new CateringInboxError(404, "not_found");
  return deliverOne({ sb, config, own: await ownAddresses(sb), messageId: id, kind: "reply", trigger: "human", actor: ctx, actorRole: actor.role,
    expectedRevision: input.expectedRevision, requestId: input.requestId });
}

export interface DeliveryRun { ran: boolean; reason?: string; replies: RunCounts; escalations: RunCounts; swept: number }
export interface RunCounts { attempted: number; sent: number; failed: number; ambiguous: number; skipped: number }
const counts = (): RunCounts => ({ attempted: 0, sent: 0, failed: 0, ambiguous: 0, skipped: 0 });
/** Page size and the keyset page budget per lane per tick: ineligible predecessors (handled, exhausted, already
 *  notified) never pin the queue, because the walk advances past them by id instead of re-reading the same head. */
export const RUN_PAGE = 25;
export const RUN_PAGES = 10;
/** Walk a lane by keyset on `id`, up to RUN_PAGES pages of RUN_PAGE rows; `visit` returns false to stop (deadline). */
async function walk<T extends { id: string }>(page: (after: string | null) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  visit: (rows: T[]) => Promise<boolean>): Promise<void> {
  let after: string | null = null;
  for (let n = 0; n < RUN_PAGES; n++) {
    const result = await page(after);
    if (isInboxSchemaMissing(result.error)) throw new CateringInboxError(503, "inbox_unavailable");
    if (result.error) throw new CateringInboxError(500, "read_failed");
    const rows = result.data ?? [];
    if (rows.length === 0 || !(await visit(rows)) || rows.length < RUN_PAGE) return;
    after = rows[rows.length - 1]!.id;
  }
}
/** Expired claims (holder never reported) → ambiguous/lease_expired in SQL, one audit row each. Never resends. */
async function sweepExpiredClaims(sb: Service): Promise<number> {
  const swept = await sb.rpc("sweep_catering_inbox_delivery", { p_limit: RUN_PAGE });
  if (swept.error) throw claimError(swept.error);
  const rows = (Array.isArray(swept.data) ? swept.data : []) as Array<{ draft_id: string; message_id: string; kind: string; attempt: number; trigger: string | null }>;
  for (const row of rows) {
    await audit({ actorId: null, actorRole: null, action: "catering.inbox.delivery_ambiguous", resourceTable: "catering_inbox_drafts", resourceId: row.draft_id,
      metadata: { message_id: row.message_id, kind: row.kind, trigger: row.trigger, attempt: row.attempt, error_code: "lease_expired" satisfies InboxDeliveryErrorCode, swept: true }, ipAddress: null, userAgent: null });
  }
  return rows.length;
}

/** The cron worker: NEW eligible arrivals only (0298's `not_new` guards the SQL side too), bounded, deadline-aware. */
export async function runCateringInboxDelivery(input: { now?: Date; deadlineMs?: number; service?: Service } = {}): Promise<DeliveryRun> {
  const sb = input.service ?? getServiceRoleClient();
  const now = input.now ?? new Date();
  // The deadline is wall-clock (the route's budget); `now` only drives eligibility math.
  const deadline = Date.now() + (input.deadlineMs ?? 90_000);
  const run: DeliveryRun = { ran: false, replies: counts(), escalations: counts(), swept: 0 };
  const { config, liveSince } = await deliveryConfig(sb);
  if (!config.ok || !liveSince) return { ...run, reason: config.ok ? "not_live" : config.code };
  run.ran = true;
  run.swept = await sweepExpiredClaims(sb);
  const own = await ownAddresses(sb);
  const tally = (bucket: RunCounts, state: DeliveryResult["state"]) => { if (state === "sent" || state === "failed" || state === "ambiguous") bucket[state] += 1; else bucket.skipped += 1; };
  const attempt = async (bucket: RunCounts, args: Omit<DeliverArgs, "sb" | "config" | "own" | "trigger" | "requestId">) => {
    if (Date.now() > deadline) { bucket.skipped += 1; return; }
    bucket.attempted += 1;
    try { tally(bucket, (await deliverOne({ sb, config, own, trigger: "cron", requestId: randomUUID(), ...args })).state); }
    catch (error) {
      if (error instanceof CateringInboxError && error.status === 503) throw error;
      if (!(error instanceof CateringInboxError)) console.error("[catering-inbox] delivery attempt failed", error instanceof Error ? error.message : "unknown");
      bucket.skipped += 1;
    }
  };
  // Replies: unsent or failed reply drafts finalized since the live switch. Exhaustion and backoff are filtered in SQL
  // where the shape allows (two lanes: fresh drafts; failed under the attempt cap and past the backoff); a handled
  // message's untouched draft (the claim refuses `invalid_state`) is passed by the keyset walk, never re-read first.
  type ReplyRow = { id: string; message_id: string; delivery_state: InboxDeliveryState; delivery_attempt: number; delivery_attempted_at: string | null };
  const backoffBefore = new Date(now.getTime() - INBOX_RETRY_BACKOFF_MS).toISOString();
  const replyLane = (lane: "draft" | "failed") => (after: string | null) => {
    let q = sb.from("catering_inbox_drafts").select("id,message_id,delivery_state,delivery_attempt,delivery_attempted_at").eq("kind", "reply")
      .eq("delivery_state", lane).gte("created_at", liveSince);
    if (lane === "failed") q = q.lt("delivery_attempt", INBOX_MAX_CRON_ATTEMPTS).lt("delivery_attempted_at", backoffBefore);
    if (after) q = q.gt("id", after);
    return q.order("id").limit(RUN_PAGE).returns<ReplyRow[]>();
  };
  for (const lane of ["draft", "failed"] as const) {
    await walk(replyLane(lane), async rows => {
      for (const draft of rows) {
        if (!inboxCronEligible(draft, now.getTime())) { run.replies.skipped += 1; continue; }
        if (Date.now() > deadline) return false;
        await attempt(run.replies, { messageId: draft.message_id, kind: "reply" });
      }
      return true;
    });
  }
  // Escalations: messages a person must answer, arrived since the live switch, with an assignee. Already-notified,
  // exhausted or ambiguous ones are passed by the walk; the per-page draft lookup decides.
  type PendingRow = { id: string; assigned_to: string; reason: InboxReason | null; subject: string; sender_address: string | null; location_id: string | null };
  const assignees = new Map<string, "en" | "es">();
  await walk((after: string | null) => {
    let q = sb.from("catering_inbound_messages").select("id,assigned_to,reason,subject,sender_address,location_id")
      .eq("disposition", "needs_human").gte("recorded_at", liveSince).not("assigned_to", "is", null);
    if (after) q = q.gt("id", after);
    return q.order("id").limit(RUN_PAGE).returns<PendingRow[]>();
  }, async rows => {
    const existing = await sb.from("catering_inbox_drafts").select("message_id,delivery_state,delivery_attempt,delivery_attempted_at").eq("kind", "escalation").in("message_id", rows.map(m => m.id))
      .returns<Array<{ message_id: string; delivery_state: InboxDeliveryState; delivery_attempt: number; delivery_attempted_at: string | null }>>();
    if (existing.error) throw new CateringInboxError(500, "read_failed");
    const byMessage = new Map((existing.data ?? []).map(d => [d.message_id, d]));
    for (const m of rows) {
      const state = byMessage.get(m.id);
      if (!m.reason || (state && !inboxCronEligible(state, now.getTime()))) { run.escalations.skipped += 1; continue; }
      if (Date.now() > deadline) return false;
      if (!assignees.has(m.assigned_to)) {
        const user = await sb.from("users").select("language").eq("id", m.assigned_to).maybeSingle<{ language: string | null }>();
        if (user.error) throw new CateringInboxError(500, "read_failed");
        assignees.set(m.assigned_to, user.data?.language === "es" ? "es" : "en");
      }
      const language = assignees.get(m.assigned_to)!;
      const envelope = state ? null : buildInboxEscalation({ language, tenantName: TENANT_NAME, inboxUrl: inboxStaffUrl(configuredOrigin(process.env.STAFF_ORIGIN)?.origin ?? process.env.NEXT_PUBLIC_APP_URL),
        reason: m.reason, sender: m.sender_address, subject: m.subject, translate: translator(language) });
      await attempt(run.escalations, { messageId: m.id, kind: "escalation", escalation: envelope });
    }
    return true;
  });
  return run;
}
