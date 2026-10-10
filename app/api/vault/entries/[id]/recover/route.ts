import type { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recoverPersonalSecret, recoverPreviousSecret } from "@/lib/vault";
import { guardVaultRequest, isObjectBody, revealGate, vaultErrorResponse } from "@/lib/vault-route";
import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

/**
 * POST { pin, mode: "owner" | "previous" } → { secret, version, autoHideSeconds, recorded: true }.
 *   owner    — level 9+ recovers someone's PERSONAL entry (recorded; the owner is notified).
 *   previous — level 8+ recovers a SHARED entry's previous secret inside 30 days (recorded; management notified).
 * Same gate as a reveal: hourly slot, then the actor's PIN for this request.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/entries/${id}/recover`, { mutating: true });
  if (vr instanceof Response) return vr;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isObjectBody(parsed)) return jsonError(400, "invalid_payload");
  if (parsed.mode !== "owner" && parsed.mode !== "previous") return jsonError(400, "invalid_payload", { field: "mode" });
  const gate = await revealGate(parsed, vr);
  if (gate instanceof Response) return gate;
  try {
    const recover = parsed.mode === "owner" ? recoverPersonalSecret : recoverPreviousSecret;
    const r = await recover(getServiceRoleClient(), vr.actor, id, { burst: gate.burst }, vr.meta);
    return jsonOk({ secret: r.secret, version: r.version, autoHideSeconds: VAULT_AUTO_HIDE_SECONDS, recorded: r.recorded });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
