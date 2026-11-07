import "server-only";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ingestInboundReceipt } from "@/lib/email-receipts";
import { fetchInboundContent } from "@/lib/inbound-fetch";
import { selectAllRows } from "@/lib/supabase-paginate";
import { inboundAddresses, normalizeInboundAddress, resolveInboundRoute, INBOUND_MAX_ATTEMPTS, inboundRetryDelayMs, inboundErrorCode, type InboundErrorCode, type InboundAddressRule } from "@/lib/inbound-router-shared";
type ServiceClient = ReturnType<typeof getServiceRoleClient>;
interface InboundRow {
  id: string; provider_email_id: string; from_address: string | null; subject: string | null;
  to_addresses: string[]; cc_addresses: string[]; received_for: string[];
  lane: "vendor_receipt" | "catering" | "noise"; location_id: string | null;
  route_reason: string; fetch_attempts: number; received_at: string;
}
/** First I/O: unique provider email claim, before routing or content retrieval. */
export async function recordInboundMessage(data: Record<string, unknown>, sb = getServiceRoleClient()) {
  if (typeof data.email_id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.email_id)) throw new Error("invalid_email_id");
  const receivedAt = typeof data.created_at === "string" && Number.isFinite(Date.parse(data.created_at))
    ? new Date(data.created_at).toISOString() : new Date().toISOString();
  const { data: row, error } = await sb.from("inbound_messages").upsert({
    provider: "resend", provider_email_id: data.email_id,
    message_id: typeof data.message_id === "string" ? data.message_id.slice(0, 1000) : null,
    from_address: normalizeInboundAddress(data.from), to_addresses: inboundAddresses(data.to),
    cc_addresses: inboundAddresses(data.cc), received_for: inboundAddresses(data.received_for),
    subject: typeof data.subject === "string" ? data.subject.slice(0, 2000) : null,
    lane: "noise", route_reason: "unresolved", content_state: "pending", received_at: receivedAt, next_attempt_at: new Date().toISOString(),
  }, { onConflict: "provider_email_id", ignoreDuplicates: true }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error("inbound_ledger_failed");
  return row ? { duplicate: false as const, id: row.id } : { duplicate: true as const };
}
async function addressRules(sb: ServiceClient): Promise<InboundAddressRule[]> {
  const [shops, aliases] = await Promise.all([
    selectAllRows<{ id: string; receipt_email_address: string | null }>((from, to) =>
      sb.from("locations").select("id, receipt_email_address").eq("active", true).order("id").range(from, to)),
    selectAllRows<InboundAddressRule>((from, to) =>
      sb.from("inbound_address_aliases").select("address, lane, location_id").eq("active", true).order("id").range(from, to)),
  ]);
  const active = new Set(shops.map(s => s.id));
  return [
    ...shops.filter(s => s.receipt_email_address).map(s => ({ address: s.receipt_email_address!, location_id: s.id, lane: "vendor_receipt" as const, primary: true })),
    ...aliases.filter(a => a.lane === "catering" || (a.location_id && active.has(a.location_id))),
  ];
}
/** Conditional five-minute lease; failed or interrupted work remains sweepable. */
export async function processInboundMessage(id: string, sb = getServiceRoleClient()): Promise<"fetched" | "skipped" | "failed" | "blocked_config" | "busy"> {
  const now = new Date().toISOString();
  const { data: row, error } = await sb.from("inbound_messages").select("*").eq("id", id)
    .in("content_state", ["pending", "failed", "blocked_config"]).lt("fetch_attempts", INBOUND_MAX_ATTEMPTS)
    .lte("next_attempt_at", now).maybeSingle<InboundRow>();
  if (error) throw new Error("inbound_read_failed");
  if (!row) return "busy";
  const token = randomUUID();
  const attempt = row.fetch_attempts + 1;
  const { data: claimed, error: claimError } = await sb.from("inbound_messages").update({
    lease_token: token, next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
  }).eq("id", id).eq("fetch_attempts", row.fetch_attempts).lte("next_attempt_at", now)
    .in("content_state", ["pending", "failed", "blocked_config"]).select("id").maybeSingle();
  if (claimError) throw new Error("inbound_claim_failed");
  if (!claimed) return "busy";
  async function save(values: Record<string, unknown>) {
    const { error: e, count } = await sb.from("inbound_messages").update(values, { count: "exact" }).eq("id", id).eq("lease_token", token);
    if (e || count !== 1) throw new Error("inbound_state_write_failed");
  }
  let stage: InboundErrorCode = "routing";
  try {
    // Freeze resolved address provenance across retries and later config edits.
    const route = row.route_reason === "unresolved"
      ? resolveInboundRoute([...row.to_addresses, ...row.cc_addresses, ...row.received_for], await addressRules(sb))
      : { lane: row.lane, location_id: row.location_id, route_reason: row.route_reason };
    stage = "ledger";
    await save(route);
    if (route.lane !== "vendor_receipt") {
      await save({ content_state: "skipped", last_error: null, lease_token: null });
      return "skipped";
    }
    // Storage/receipt INSERT may have committed before the final ledger update failed.
    // Repair that link without depending on provider content retention or downloading twice.
    const existing = await sb.from("email_receipts").select("id").eq("inbound_message_id", row.id).maybeSingle<{ id: string }>();
    if (existing.error) throw new Error("inbound_receipt_lookup_failed");
    if (existing.data) {
      await save({ content_state: "fetched", fetch_attempts: attempt, email_receipt_id: existing.data.id, last_error: null, lease_token: null });
      return "fetched";
    }
    stage = "provider_error";
    const content = await fetchInboundContent(row.provider_email_id);
    stage = "ledger";
    const receipt = await ingestInboundReceipt({ ...content, toAddress: null, fromAddress: row.from_address, subject: row.subject,
      externalId: `resend:${row.provider_email_id}`, inboundMessageId: row.id, addressLocationId: route.location_id, receivedAt: row.received_at });
    await save({ content_state: "fetched", fetch_attempts: attempt, email_receipt_id: receipt.receiptId, last_error: null, lease_token: null });
    return "fetched";
  } catch (error) {
    // Provider errors may contain signed URLs or PII. Persist only a closed failure code.
    const code = inboundErrorCode(error, stage);
    const blocked = code === "provider_auth";
    await save({ content_state: blocked ? "blocked_config" : "failed", last_error: code, lease_token: null,
      fetch_attempts: blocked ? row.fetch_attempts : attempt,
      next_attempt_at: new Date(Date.now() + (blocked ? 15 * 60_000 : inboundRetryDelayMs(attempt))).toISOString() });
    if (!blocked && attempt === INBOUND_MAX_ATTEMPTS) {
      await audit({ actorId: null, actorRole: null, action: "inbound.retries_exhausted",
        resourceTable: "inbound_messages", resourceId: id, metadata: { attempts: attempt, error_code: code },
        ipAddress: null, userAgent: null });
    }
    return blocked ? "blocked_config" : "failed";
  }
}
/** Bounded concurrent fetches; reserve a full fetch+storage window before starting. */
export async function sweepInboundMessages(sb = getServiceRoleClient(), deadline = Date.now() + 140_000) {
  if (!process.env.RESEND_INBOUND_SECRET || !process.env.RESEND_API_KEY) return { swept: 0, failed: 0 };
  const { data, error } = await sb.from("inbound_messages").select("id").in("content_state", ["pending", "failed", "blocked_config"])
    .lt("fetch_attempts", INBOUND_MAX_ATTEMPTS).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true }).limit(25).returns<Array<{ id: string }>>();
  if (error) throw new Error("inbound_sweep_failed");
  let failed = 0;
  let swept = 0;
  let cursor = 0;
  async function worker() {
    while (Date.now() + 60_000 <= deadline) {
      const row = data?.[cursor++];
      if (!row) break;
      swept++;
      try {
        const outcome = await processInboundMessage(row.id, sb);
        if (outcome === "failed" || outcome === "blocked_config") failed++;
      } catch { failed++; }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { swept, failed };
}
