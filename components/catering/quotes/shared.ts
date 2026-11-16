/**
 * Shared client helpers for the catering quote surface (Wave 1 slice 1E).
 * Same postJson + error-resolver pattern as the pipeline/customer surfaces.
 */

import type { TranslationKey } from "@/lib/i18n/types";

export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string };

export async function postJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    if (res.ok) {
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* empty */
      }
      return { ok: true, data };
    }
    let code = "generic";
    try {
      const parsed = (await res.json()) as { code?: string };
      if (typeof parsed.code === "string") code = parsed.code;
    } catch {
      /* opaque */
    }
    return { ok: false, code };
  } catch {
    return { ok: false, code: "generic" };
  }
}

const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "quote_lines_outdated", // B7c 0251: a page loaded before the line kinds — reload
  "not_found",
  "invalid_payload",
  "unknown_item",
  "catering_owned_item_refused",
  "location_access_denied",
  "mixed_concerns",
  "not_current",
  "invalid_status",
  "step_up_required",
  "step_up_stale",
  "not_due",
  "status_changed", // guarded setQuoteStatus 409 (stale read) — actionable, not generic
  "quote_expired", // expired→accepted block — needs a revision, not a retry
  "payments_unreconciled", // send/accept held: earlier payments are not on this revision yet — retry
  "delivery_unavailable", // self-serve delivery accept: no active zone at the shop (Juan 2026-11-15)
  "below_delivery_minimum", // self-serve delivery accept: under the zone's minimum
  "delivery_fee_changed", // self-serve delivery accept: the zones moved since the order was placed
  "invalid_customer", // a client outside the actor's shops (or gone) — pick another client
  "not_expired", // resend-with-new-expiry on a quote that has not lapsed — Send does that
  "invalid_expiry", // resend: the new expiry is not a future date within the allowed window
  "lead_location_mismatch", // W05/B011: the picked lead is at another shop (or gone) — match the shop or the lead
  "generic",
]);

export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `catering.quotes.error.${code}` as TranslationKey;
  }
  return "catering.quotes.error.generic" as TranslationKey;
}

/** Step-up codes the send route returns when a fresh password re-confirm is needed. */
export function isStepUpCode(code: string): boolean {
  return code === "step_up_required" || code === "step_up_stale";
}

/**
 * Which decision buttons a quote's detail view offers (audit W01/B004). A customer's self-serve
 * order lands as 'submitted' (lib/portal/draft.ts submitDraft) and waits on staff, so it must be
 * decidable exactly like a 'sent' staff quote — setQuoteStatus already accepts submitted → accepted
 * / declined. "Send" stays draft/sent only (sendQuote refuses any other status).
 */
export function quoteDetailActions(q: { status: string; isExpired: boolean }, canWrite: boolean): { sendable: boolean; decidable: boolean } {
  return {
    sendable: canWrite && (q.status === "draft" || q.status === "sent") && !q.isExpired,
    decidable: canWrite && (q.status === "sent" || q.status === "submitted") && !q.isExpired,
  };
}
