/**
 * Unit spine — current_user_id() is SESSION-BOUND (0200, LRA-013) and the password-reset route revokes
 * through the throwing helper (LRA-216).
 *
 * A staff JWT is a valid PostgREST bearer, and PostgREST never consults sessions; before 0200 a revoked but
 * unexpired token kept every RLS policy open for up to 12 h on the curl path. 0200 makes the helper every policy
 * calls resolve the JWT's session_id against public.sessions (not revoked, not expired, same user). Source pins over
 * the LATEST migration that defines the helper, so a rewrite cannot drop a predicate silently; and over the reset
 * route, so a failed "assume compromise" revocation can never again be reported as 0 revoked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const DEFINES = "FUNCTION public.current_user_id()";
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const latest = (() => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => new RegExp(`CREATE OR REPLACE ${DEFINES.replace(/[()]/g, "\\$&")}`, "i").test(read(`${MIGRATIONS}/${f}`)));
  expect(defining.length).toBeGreaterThan(0);
  const file = defining[defining.length - 1]!;
  const src = read(`${MIGRATIONS}/${file}`);
  const start = src.search(new RegExp(`CREATE OR REPLACE ${DEFINES.replace(/[()]/g, "\\$&")}`, "i"));
  const end = src.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return { file, body: src.slice(start, end).replace(/--[^\n]*/g, "") };
})();

describe("current_user_id() is session-bound (0200)", () => {
  it("is defined last by 0200 or later", () => {
    expect(latest.file >= "0200").toBe(true);
  });

  it("resolves through public.sessions with BOTH lifecycle predicates and the user binding", () => {
    expect(latest.body).toMatch(/FROM\s+public\.sessions\s+s/i);
    expect(latest.body).toMatch(/s\.id\s*=\s*NULLIF\(current_setting\('request\.jwt\.claims', true\)::jsonb ->> 'session_id', ''\)::uuid/);
    expect(latest.body).toMatch(/s\.user_id\s*=\s*NULLIF\(current_setting\('request\.jwt\.claims', true\)::jsonb ->> 'user_id', ''\)::uuid/);
    expect(latest.body).toMatch(/s\.revoked_at IS NULL/);
    expect(latest.body).toMatch(/s\.expires_at > now\(\)/);
    expect(latest.body).toMatch(/SELECT\s+s\.user_id/i);
  });

  it("keeps the helper STABLE, SECURITY DEFINER, search_path pinned", () => {
    expect(latest.body).toMatch(/\bSTABLE\b/);
    expect(latest.body).toMatch(/SECURITY DEFINER/);
    expect(latest.body).toMatch(/SET search_path TO 'pg_catalog', 'public'/);
  });
});

describe("password reset revokes through the throwing helper (LRA-216)", () => {
  const route = read("app/api/auth/password-reset/route.ts");
  it("calls revokeAllUserSessions instead of a bare sessions update", () => {
    expect(route).toMatch(/await revokeAllUserSessions\(/);
    expect(route).not.toMatch(/from\("sessions"\)\s*\n?\s*\.update\(\{\s*revoked_at/);
  });
});
