/**
 * One-shot step-up grants (catalog Phase 1, 0257; Astra r1 P1-1). SERVER-ONLY (service role).
 *
 * The always-prompt catalog acts — retire a product, delete a recipe, deactivate a SKU — accept
 * neither the edit window nor a "fresh" shared unlock. The step-up POST mints a grant for ONE
 * (action, target), bound to the session and the user, valid 120 s; the destructive route
 * consumes it with ONE conditional UPDATE. Postgres re-checks the WHERE under the row lock, so a
 * concurrent second consume matches 0 rows: single use is a property of the statement, not of a
 * read-then-write. A refused consume spends nothing.
 * Consuming FIRST is deliberate: a grant is spent even if the action then fails (not found,
 * a lib refusal) — that is what makes replay impossible; re-entering a password is acceptable.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { grantExpiresAt, type GrantAction, type StepUpPurpose } from "@/lib/admin/step-up-shared";

export async function mintStepUpGrant(args: {
  sessionId: string;
  userId: string;
  purpose: StepUpPurpose;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const { error } = await getServiceRoleClient()
    .from("step_up_grants")
    .insert({
      session_id: args.sessionId,
      user_id: args.userId,
      action: args.purpose.action,
      target_id: args.purpose.targetId,
      created_at: now.toISOString(),
      expires_at: grantExpiresAt(now).toISOString(),
      consumed_at: null,
    });
  if (error) throw new Error(`mintStepUpGrant: ${error.message}`);
}

export type GrantResult = { ok: true } | { ok: false; code: "step_up_grant_required" };

export async function consumeStepUpGrant(
  ctx: AuthContext,
  action: GrantAction,
  targetId: string,
  now: Date = new Date(),
): Promise<GrantResult> {
  const nowIso = now.toISOString();
  const { data, error } = await getServiceRoleClient()
    .from("step_up_grants")
    .update({ consumed_at: nowIso })
    .eq("session_id", ctx.session.id)
    .eq("user_id", ctx.user.id)
    .eq("action", action)
    .eq("target_id", targetId)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("id");
  if (error) throw new Error(`consumeStepUpGrant: ${error.message}`);
  return (data?.length ?? 0) > 0 ? { ok: true } : { ok: false, code: "step_up_grant_required" };
}
