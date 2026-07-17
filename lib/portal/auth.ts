/**
 * Customer portal JWT primitives — Portal-2 customer principal.
 *
 * A catering customer is a `catering_customers` contact, NEVER a staff `users`
 * row. This principal rides its OWN cookie (`co_ops_portal`) + its OWN JWT and
 * must never satisfy a staff check (nor vice-versa). Three load-bearing guards
 * keep the principals separated — do NOT weaken any:
 *   1. Distinct issuer "co-ops-portal" (staff lib/auth.ts uses "co-ops"), so a
 *      staff token fails jwtVerify's issuer check here and a customer token
 *      fails it on the staff side.
 *   2. verifyCustomerJwt hard-rejects any payload without `customer_id`
 *      (belt-and-suspenders on top of the issuer split).
 *   3. NO `role` claim. The portal is service-role + app-layer only and never
 *      forwards this cookie to a Supabase authenticated client — so the token
 *      must NOT be a usable PostgREST token. PostgREST ignores `iss`; a `role:
 *      "authenticated"` claim would make a customer cookie a signature-valid DB
 *      token (with current_user_id() = NULL, satisfying any USING(true) policy).
 *      Omitting `role` closes that footgun.
 *
 * Key material: same AUTH_JWT_SECRET as staff, hex-decoded to match Supabase's
 * HS256 key bytes (see lib/auth.ts getJwtKey).
 */

import { SignJWT, jwtVerify } from "jose";
export { generateToken, hashToken } from "@/lib/auth";

const JWT_ALG = "HS256";
const JWT_ISSUER = "co-ops-portal";
const JWT_EXP = "30d";
export const PORTAL_COOKIE_NAME = "co_ops_portal";

function getJwtKey(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET is not set");
  return Buffer.from(secret, "hex"); // hex-decoded to match Supabase's HS256 key bytes
}

export interface CustomerJwtClaims {
  customer_id: string;
  email: string;
  session_id: string;
}

export interface VerifiedCustomerJwt extends CustomerJwtClaims {
  iat: number;
  exp: number;
  iss: string;
}

export async function signCustomerJwt(claims: CustomerJwtClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXP)
    .sign(getJwtKey());
}

export async function verifyCustomerJwt(token: string): Promise<VerifiedCustomerJwt> {
  const { payload } = await jwtVerify(token, getJwtKey(), {
    issuer: JWT_ISSUER,
    algorithms: [JWT_ALG],
  });
  if (!payload.customer_id) throw new Error("not a customer token"); // hard reject staff tokens
  return payload as unknown as VerifiedCustomerJwt;
}
