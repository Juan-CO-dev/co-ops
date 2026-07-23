/**
 * Tenant identity (T0 boundary law — env owns IDENTITY; see AGENTS.md
 * "Tenant vocabulary"). Client-safe: pure constants, zero I/O.
 *
 * NEXT_PUBLIC_ values inline at build time, so they're readable on both the
 * server (emails, metadata) and the client. Defaults are the CO pilot's
 * values — the live deployment needs no env change; a future tenant sets the
 * vars at Vercel project creation.
 */
export const TENANT_NAME = process.env.NEXT_PUBLIC_TENANT_NAME ?? "Compliments Only";
