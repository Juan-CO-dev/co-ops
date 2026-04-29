/**
 * Auth primitives — Phase 2.
 *
 * Stateless. No DB. Pure crypto + JWT primitives. lib/session.ts handles the
 * DB-bound session lifecycle on top of these.
 *
 * Design locks (Phase 2 Session 1 + 2):
 *   - bcryptjs cost 12 for both PIN and password (cross-platform, edge-safe pure JS).
 *   - PINs peppered with AUTH_PIN_PEPPER, passwords with AUTH_PASSWORD_PEPPER.
 *   - 4-digit PINs for all roles (matches Toast/7shifts punch-in convention).
 *   - Lockout: fixed 5 failures / 15 min → 15-min lock; no escalation.
 *   - JWT: HS256 via jose, signed with AUTH_JWT_SECRET interpreted as hex
 *     (Buffer.from(secret, "hex") — Supabase Management API hex-decodes the
 *     HS256 secret on key creation, so we must produce matching bytes).
 *   - Hard expiration ceiling: 12h. Idle timeout (10 min) is enforced by
 *     lib/session.ts via last_activity_at, not by the JWT.
 *   - PostgREST reserves the `role` claim for the Postgres role to switch into
 *     ('authenticated'). Our app role lives in `app_role`.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import bcrypt from "bcryptjs";
import type { RoleCode } from "./roles";

const BCRYPT_COST = 12;
const JWT_ALG = "HS256";
const JWT_EXP = "12h";
const JWT_ISSUER = "co-ops";

function getJwtKey(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET is not set");
  return Buffer.from(secret, "hex");
}

function getPinPepper(): string {
  const p = process.env.AUTH_PIN_PEPPER;
  if (!p) throw new Error("AUTH_PIN_PEPPER is not set");
  return p;
}

function getPasswordPepper(): string {
  const p = process.env.AUTH_PASSWORD_PEPPER;
  if (!p) throw new Error("AUTH_PASSWORD_PEPPER is not set");
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIN + password (bcrypt with peppers)
// ─────────────────────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(getPinPepper() + pin, BCRYPT_COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(getPinPepper() + pin, hash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(getPasswordPepper() + password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(getPasswordPepper() + password, hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT
// ─────────────────────────────────────────────────────────────────────────────

export interface AppJwtClaims {
  user_id: string;
  app_role: RoleCode;
  role_level: number;
  locations: string[];
  session_id: string;
  /** Required by PostgREST as the database role to switch into. */
  role: "authenticated";
}

export interface VerifiedJwt extends AppJwtClaims {
  iat: number;
  exp: number;
  iss: string;
}

export async function signJwt(claims: AppJwtClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXP)
    .sign(getJwtKey());
}

export async function verifyJwt(token: string): Promise<VerifiedJwt> {
  const { payload } = await jwtVerify(token, getJwtKey(), {
    issuer: JWT_ISSUER,
    algorithms: [JWT_ALG],
  });
  return payload as unknown as VerifiedJwt;
}

/** True when verifyJwt's rejection is due to expiration (vs malformed/tampered). */
export function isJwtExpired(err: unknown): boolean {
  return err instanceof joseErrors.JWTExpired;
}

// ─────────────────────────────────────────────────────────────────────────────
// Random tokens for email verification + password reset
// ─────────────────────────────────────────────────────────────────────────────

/** 32 random bytes → 64-char lowercase hex. Edge-safe (Web Crypto). */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a token, lowercase hex. Used for at-rest token storage. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
