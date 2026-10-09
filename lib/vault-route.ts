import "server-only";
/**
 * Password vault — the route handlers' shared front door. Keeps every /api/vault route on one shape:
 *   CSRF (state-changing) → session → VAULT_ENABLED → actor → body → lib → VaultError mapping.
 * The REVEAL GATE lives here too: take the hourly slot FIRST (a PIN guess costs an attempt), then
 * verify the actor's PIN for THIS request. No PIN, no reveal; wrong PIN, no reveal.
 */
import { NextResponse, type NextRequest } from "next/server";
import { extractIp, jsonError } from "@/lib/api-helpers";
import { verifyActorPin } from "@/lib/auth-flows";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession, type AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { takeRevealSlot, type VaultRequestMeta, type VaultServerActor } from "@/lib/vault";
import { VaultCryptoError } from "@/lib/vault-crypto";
import { vaultEnabled } from "@/lib/vault-flag";
import { VaultError, type RevealCapVerdict } from "@/lib/vault-shared";

export interface VaultRequest {
  ctx: AuthContext;
  actor: VaultServerActor;
  meta: VaultRequestMeta;
}

/** Session + switch (+ CSRF for state-changing requests). Returns the response to send when refused. */
export async function guardVaultRequest(req: NextRequest, path: string, opts: { mutating: boolean }): Promise<VaultRequest | NextResponse> {
  if (opts.mutating) {
    const denied = assertSameOrigin(req);
    if (denied) return denied;
  }
  const ctx = await requireSession(req, path);
  if (ctx instanceof Response) return ctx;
  if (!vaultEnabled()) return jsonError(404, "not_enabled");
  return {
    ctx,
    actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level, locations: ctx.locations, name: ctx.user.name },
    meta: { ipAddress: extractIp(req), userAgent: req.headers.get("user-agent") },
  };
}

/**
 * The reveal gate: slot, then PIN. Returns the cap verdict (its burst flag rides on the record) or
 * the refusal to send. The PIN string is read once and never stored or logged.
 */
export async function revealGate(body: Record<string, unknown>, vr: VaultRequest): Promise<RevealCapVerdict | NextResponse> {
  if (typeof body.pin !== "string" || body.pin.length === 0) return jsonError(400, "invalid_payload", { field: "pin" });
  const service = getServiceRoleClient();
  let verdict: RevealCapVerdict;
  try {
    verdict = await takeRevealSlot(service, vr.actor);
  } catch (e) {
    return vaultErrorResponse(e);
  }
  if (!(await verifyActorPin(vr.actor.userId, body.pin))) return jsonError(401, "pin_invalid");
  return verdict;
}

/** VaultError → its status/code (the message IS the code: nothing from the vault enters a response body). */
export function vaultErrorResponse(e: unknown): NextResponse {
  if (e instanceof VaultError) return jsonError(e.status, e.code, e.field ? { field: e.field } : {});
  if (e instanceof VaultCryptoError) return jsonError(503, "vault_unavailable");
  return jsonError(500, "internal_error");
}

export function isObjectBody(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
