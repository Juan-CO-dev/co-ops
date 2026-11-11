import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { isInboxSchemaMissing } from "./inbox-schema-shared";
import { CateringInboxError, canChangeCateringInboxMode, readCateringInboxSettings, type InboxSettings } from "./inbox";
import { INBOX_MODES, type InboxMode } from "./inbox-delivery-shared";

/** Owner / CGS flip off | shadow | live (0298 `set_catering_inbox_mode`: role re-read, live session, revision-checked).
 *  No sender here: switching to live sends nothing by itself — the worker and the Send button send, each behind the
 *  env flag as well. Audited `catering.inbox.delivery_mode_change` (destructive: a human changed the kitchen's config). */
export async function setCateringInboxMode(ctx: AuthContext, input: { mode: InboxMode; expectedRevision: number }): Promise<InboxSettings & { changed: boolean }> {
  if (!ctx.user.active || !canChangeCateringInboxMode(ctx.user.role)) throw new CateringInboxError(403, "forbidden");
  if (!INBOX_MODES.includes(input.mode) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new CateringInboxError(400, "invalid_payload");
  const sb = getServiceRoleClient();
  const before = await readCateringInboxSettings(sb);
  const { data, error } = await sb.rpc("set_catering_inbox_mode", { p_actor_id: ctx.user.id, p_session_id: ctx.session.id, p_mode: input.mode, p_expected_revision: input.expectedRevision });
  if (isInboxSchemaMissing(error)) throw new CateringInboxError(503, "inbox_unavailable");
  if (error) {
    const code = ["forbidden", "stale_revision", "invalid_input"].find(c => error.message === c);
    throw new CateringInboxError(code === "forbidden" ? 403 : code === "stale_revision" ? 409 : 500, code ?? "write_failed");
  }
  const result = data as { mode: InboxMode; revision: number; live_since: string | null; changed: boolean };
  if (result.changed) {
    await audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: "catering.inbox.delivery_mode_change", resourceTable: "catering_inbox_settings", resourceId: null,
      metadata: { from: before.mode, to: result.mode, revision: result.revision, live_since: result.live_since }, ipAddress: null, userAgent: null });
  }
  return { mode: result.mode, revision: result.revision, live_since: result.live_since, changed: result.changed };
}
