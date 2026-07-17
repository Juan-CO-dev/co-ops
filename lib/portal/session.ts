/**
 * Customer portal session lifecycle — Portal-2 customer principal.
 *
 * Parallel to staff lib/session.ts, but for catering customers. A customer
 * session rides the `co_ops_portal` cookie, lasts 30 days, has NO idle
 * timeout (consumer UX), and no step-up. It mirrors the staff dual
 * verification: JWT signature/exp (verifyCustomerJwt) AND
 * `token_hash === hashToken(rawCookieJwt)` for the session row — the second
 * check is the forgery guard against an AUTH_JWT_SECRET leak (a forged JWT
 * passes signature verification but matches no stored hash).
 *
 * Node-runtime only (next/headers + service-role client); the portal tables
 * are deny-all to end-users, so all reads/writes go through service role.
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { signCustomerJwt, verifyCustomerJwt, hashToken, PORTAL_COOKIE_NAME, type CustomerJwtClaims } from "./auth";

const SESSION_DAYS = 30;

export interface PortalContext { customerId: string; email: string; sessionId: string }

function cookieOpts(maxAgeSeconds: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

export async function createCustomerSession(customerId: string, email: string, ctx?: { ip?: string | null; ua?: string | null }) {
  const sb = getServiceRoleClient();
  const sessionId = crypto.randomUUID();
  const jwt = await signCustomerJwt({ customer_id: customerId, email, session_id: sessionId } satisfies CustomerJwtClaims);
  const tokenHash = await hashToken(jwt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
  const { error } = await sb.from("catering_portal_sessions").insert({
    id: sessionId, customer_id: customerId, token_hash: tokenHash,
    last_activity_at: now.toISOString(), expires_at: expiresAt.toISOString(),
    ip_address: ctx?.ip ?? null, user_agent: ctx?.ua ?? null,
  });
  if (error) throw new Error(`createCustomerSession: ${error.message}`);
  await sb.from("catering_customers").update({ last_portal_login_at: now.toISOString() }).eq("id", customerId);
  return { sessionId, jwt, cookieName: PORTAL_COOKIE_NAME, cookieMaxAgeSeconds: SESSION_DAYS * 86400 };
}

async function requireCore(rawJwt: string | null): Promise<PortalContext | { denied: true }> {
  if (!rawJwt) return { denied: true };
  let claims; try { claims = await verifyCustomerJwt(rawJwt); } catch { return { denied: true }; }
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("catering_portal_sessions").select("*").eq("id", claims.session_id).maybeSingle<{ id: string; customer_id: string; token_hash: string; expires_at: string; revoked_at: string | null }>();
  if (error || !row) return { denied: true };
  if ((await hashToken(rawJwt)) !== row.token_hash) return { denied: true }; // forgery guard
  if (row.revoked_at) return { denied: true };
  if (new Date(row.expires_at) <= new Date()) return { denied: true };
  await sb.from("catering_portal_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", row.id);
  return { customerId: row.customer_id, email: claims.email, sessionId: row.id };
}

export async function requireCustomerSession(req: NextRequest): Promise<PortalContext | NextResponse> {
  const raw = req.cookies.get(PORTAL_COOKIE_NAME)?.value ?? null;
  const r = await requireCore(raw);
  if ("denied" in r) { const res = NextResponse.json({ error: "unauthorized" }, { status: 401 }); res.cookies.set(PORTAL_COOKIE_NAME, "", cookieOpts(0)); return res; }
  return r;
}

export async function getCustomerFromHeaders(): Promise<PortalContext | null> {
  const raw = (await nextCookies()).get(PORTAL_COOKIE_NAME)?.value ?? null;
  const r = await requireCore(raw);
  return "denied" in r ? null : r;
}

export async function revokeCustomerSession(sessionId: string) {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("catering_portal_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessionId).is("revoked_at", null).select("id");
  if (error) throw new Error(`revokeCustomerSession: ${error.message}`);
  return { rowsAffected: data?.length ?? 0 };
}

export function applyPortalCookie(res: NextResponse, s: { cookieName: string; jwt: string; cookieMaxAgeSeconds: number }) {
  res.cookies.set(s.cookieName, s.jwt, cookieOpts(s.cookieMaxAgeSeconds)); return res;
}
export function clearPortalCookie(res: NextResponse) { res.cookies.set(PORTAL_COOKIE_NAME, "", cookieOpts(0)); return res; }

export async function ipFromHeaders(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await nextHeaders();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), ua: h.get("user-agent") };
}
