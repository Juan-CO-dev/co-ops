/**
 * Migration 0307 (audit wave W07: PINs, lockouts and password resets) — authored, NOT applied. Pins: the house
 * header and gate line; the executable PGlite proof (scripts/sql-harness-0307.mjs); the SQL limits equal the TS
 * ones; the lib's builders name the SQL arguments; the app keeps a pre-0307 path for every function it calls.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_LIMIT, LOCKOUT_MINUTES, reserveAttemptCall } from "@/lib/auth-lockout-shared";
import { extractFunction, normalize } from "../scripts/shop-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0307_auth_lockout_reset_hardening.sql", "utf8"));
const read = (p: string) => normalize(readFileSync(p, "utf8"));
const fnBody = (start: string) => extractFunction(src, start, "$$;");

describe("0307_auth_lockout_reset_hardening", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0307_auth_lockout_reset_hardening"
        && lines[1] === "-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0076 and 0279)."
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-11-16 (schema_migrations version 20261116000001, name '0307_auth_lockout_reset_hardening')", ...rest].join("\n"))).toBe(true);
    expect(src).toMatch(/\nbegin;\n/);
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("the executable proof runs green (PGlite: the stubs, the REAL 0279 and 0076, then 0307)", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0307.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    for (const s of [
      "S0 the preflight refuses without 0076", "S0 the preflight refuses without 0279", "S0 the preflight refuses a drifted 0076 counter",
      "S0 a second apply is refused by the preflight",
      "S1 auth_reserve_attempt: SECURITY DEFINER, search_path pinned, service_role only",
      "S1 increment_failed_login: SECURITY DEFINER, search_path pinned, service_role only",
      "S1 anon cannot EXECUTE auth_reserve_attempt", "S1 authenticated cannot EXECUTE auth_reserve_attempt",
      "B049 an expired lock restarts the count: one wrong PIN after expiry is attempt 1, not a new lock",
      "B049 the fallback counter restarts too: increment_failed_login returns 1 and clears the dead lock",
      "B049 the fallback counter leaves a live lock alone and still counts 2 → 3",
      "B050 thirty reservations in a row: exactly 5 allowed, the 5th sets locked_until, 25 refused, count stays 5",
      "B050 an attempt on a locked account is refused and does NOT move the counter",
      "PASS 0307:",
    ]) expect(out, s).toContain(s);
  }, 260_000);

  it("every function is SECURITY DEFINER with a pinned search_path, revoked from the PostgREST roles and granted to service_role only", () => {
    const created = [...src.matchAll(/\ncreate (?:or replace )?function public\.([a-z_]+)\(/g)].map((m) => m[1]!);
    expect(created.length).toBeGreaterThanOrEqual(2);
    for (const name of created) {
      const body = fnBody(`function public.${name}(`);
      expect(body, name).toMatch(/security definer\s+set search_path = pg_catalog, public/);
      const lineStarting = (prefix: string) => src.split("\n").find((l) => l.startsWith(prefix)) ?? "";
      expect(lineStarting(`revoke all on function public.${name}(`), name).toMatch(/\) from public, anon, authenticated;$/);
      expect(lineStarting(`grant execute on function public.${name}(`), name).toMatch(/\) to service_role;$/);
      // …and the post-apply guard checks that same function
      expect(src, name).toContain(`'public.${name}(`);
    }
    expect(src).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });

  it("B049/B050 the SQL limits equal the TS ones (FAILURE_LIMIT, LOCKOUT_MINUTES)", () => {
    const fn = fnBody("create function public.auth_reserve_attempt(");
    expect(fn).toContain(`v_count >= ${FAILURE_LIMIT} then v_now + interval '${LOCKOUT_MINUTES} minutes'`);
    // the lock is judged on a clock read AFTER the row lock, and a live lock returns before any write
    expect(fn.indexOf("for update")).toBeLessThan(fn.indexOf("v_now := clock_timestamp()"));
    expect(fn.indexOf("'allowed', false")).toBeLessThan(fn.indexOf("update public.users set failed_login_count"));
    expect(fn).toContain("case when v_until is not null then 1 else coalesce(v_count, 0) + 1 end");
  });

  it("B049 the fallback counter keeps 0076's signature and restarts on an expired lock", () => {
    const fn = fnBody("create or replace function public.increment_failed_login(");
    expect(fn).toContain("function public.increment_failed_login(p_user_id uuid)\nreturns integer");
    expect(fn).toContain("case when locked_until is not null and locked_until <= clock_timestamp() then 1");
    expect(fn).toContain("else coalesce(failed_login_count, 0) + 1 end");
  });

  it("the lib's builder names the SQL arguments", () => {
    const call = reserveAttemptCall("u");
    expect(call.fn).toBe("auth_reserve_attempt");
    expect(src).toContain(`create function public.${call.fn}(${Object.keys(call.args).map((k) => `${k} uuid`).join(", ")})`);
  });

  it("the app keeps a pre-0307 path: a missing function falls back, it never fails the sign-in", () => {
    const flows = read("lib/auth-flows.ts");
    const reserve = flows.slice(flows.indexOf("export async function reserveAttempt("), flows.indexOf("export interface ReservedAttempt"));
    expect(reserve).toContain("isMissingRpc(error)");
    expect(reserve).toContain("const state = await isLocked(userId);");
    expect(reserve).toContain("degraded: true");
    expect(reserve).not.toMatch(/throw /);
  });
});
