import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { mintAndSendPortalLink, META_CONTINUATION_TTL_MIN } from "@/lib/portal/magic-link";
import type { DraftIntake } from "@/lib/portal/draft";
import type { MetaMappedIntake } from "./intake-shared";

/**
 * The ONE "finish your order" email after a Meta lead is CREATED (build 2, A1–A3, A6).
 *
 * Order of operations, each step a named ledger transition:
 *   1. meta_lead_email_claim — SQL parks the row as needs_human/email_unknown BEFORE any token or
 *      provider call (a crash from here on is an honest unknown) and refuses a second email to the
 *      same address inside 24 h (`capped`). An attached / needs_human lead is never claimable.
 *   2. Sender preflight — no provider key / sender → `suppressed` (configuration), nothing minted.
 *   3. mintAndSendPortalLink — the portal's own mint + send, with: a 72 h token whose intake carries
 *      the mapped DraftIntake + pipelineId, the form's language, the Resend idempotency key
 *      `meta-lead-email:<leadgen_id>`, two IDENTICAL in-process tries at most, and delivery
 *      preflight (allowlist / portal identity off → `suppressed` before minting, so a dead send never
 *      retires the customer's live portal link). The magic_link_email rate limit → `capped`.
 *   4. meta_lead_email_result — ONE update: sent (confirmed provider id + token → the lead returns
 *      to created), failed, unknown (token kept: the link may have landed), capped, suppressed;
 *      every branch clears the intake snapshot in the same write as the token (A9).
 * Nothing here re-mints or resends. The runbook owns the manual requeue.
 */
export type ContinuationState = "sent" | "failed" | "unknown" | "capped" | "suppressed" | "not_claimable";

type Client = ReturnType<typeof getServiceRoleClient>;

function senderConfigured(): boolean {
  if (process.env.SIM_MODE && process.env.SIM_EMAIL_CAPTURE_DIR) return true;
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendMetaContinuation(sb: Client, args: {
  leadgenId: string; pipelineId: string; locationId: string; language: "en" | "es"; intake: MetaMappedIntake;
}): Promise<ContinuationState> {
  const claim = await sb.rpc("meta_lead_email_claim", { p_leadgen_id: args.leadgenId });
  if (claim.error || typeof claim.data?.claimed !== "boolean") throw new Error("meta_email_claim_failed");
  if (!claim.data.claimed) return claim.data.reason === "capped" ? "capped" : "not_claimable";

  let state: Exclude<ContinuationState, "not_claimable">;
  let tokenId: string | null = null;
  let providerId: string | null = null;
  if (!senderConfigured()) {
    state = "suppressed";
  } else {
    const draft: DraftIntake = {
      locationId: args.locationId, contactName: args.intake.contactName, email: args.intake.contactEmail,
      company: args.intake.company, eventDate: args.intake.eventDate, headcount: args.intake.headcount,
      isDelivery: args.intake.isDelivery, contactPhone: args.intake.contactPhone, pipelineId: args.pipelineId,
    };
    const outcome = await mintAndSendPortalLink({
      email: args.intake.contactEmail, name: args.intake.contactName, intake: draft,
      ttlMinutes: META_CONTINUATION_TTL_MIN, language: args.language,
      idempotencyKey: `meta-lead-email:${args.leadgenId}`, tries: 2, via: "meta_lead_form",
      preflightDelivery: true, linkQuery: { lang: args.language, ttl: `${META_CONTINUATION_TTL_MIN / 60}h` },
    });
    switch (outcome.kind) {
      case "sent": state = "sent"; tokenId = outcome.tokenId; providerId = outcome.providerId; break;
      case "unknown": state = "unknown"; tokenId = outcome.tokenId; break;
      case "failed": state = "failed"; tokenId = outcome.tokenId; break;
      case "throttled": state = "capped"; break;
      case "suppressed": state = "suppressed"; tokenId = outcome.tokenId; break;
      default: state = "failed"; // invalid_email / insert_failed: nothing minted
    }
  }
  const result = await sb.rpc("meta_lead_email_result", {
    p_leadgen_id: args.leadgenId, p_email_state: state, p_portal_token_id: tokenId, p_provider_id: providerId,
  });
  if (result.error || result.data !== true) throw new Error("meta_email_result_failed");
  return state;
}
