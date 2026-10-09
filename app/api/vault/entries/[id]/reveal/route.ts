import type { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { revealVaultSecret } from "@/lib/vault";
import { guardVaultRequest, isObjectBody, revealGate, vaultErrorResponse } from "@/lib/vault-route";
import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

/**
 * POST { pin } → { secret, version, autoHideSeconds, recorded }.
 * PIN step-up on EVERY reveal (verified in this request, after the hourly slot is taken). Shared:
 * recorded + management notified before the secret is returned. Personal (owner): neither.
 * The response carries exactly these four keys; the client hides the secret after autoHideSeconds.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/entries/${id}/reveal`, { mutating: true });
  if (vr instanceof Response) return vr;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isObjectBody(parsed)) return jsonError(400, "invalid_payload");
  const gate = await revealGate(parsed, vr);
  if (gate instanceof Response) return gate;
  try {
    const r = await revealVaultSecret(getServiceRoleClient(), vr.actor, id, { burst: gate.burst }, vr.meta);
    return jsonOk({ secret: r.secret, version: r.version, autoHideSeconds: VAULT_AUTO_HIDE_SECONDS, recorded: r.recorded });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
