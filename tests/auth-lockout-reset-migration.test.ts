/**
 * Migration 0307 (audit wave W07: PINs, lockouts and password resets) — authored, NOT applied. Pins: the house
 * header and gate line; the executable PGlite proof (scripts/sql-harness-0307.mjs); the SQL limits equal the TS
 * ones; the lib's builders name the SQL arguments; the app keeps a pre-0307 path for every function it calls.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_LIMIT, LOCKOUT_MINUTES, createSessionCall, passwordResetConsumeCall, reserveAttemptCall } from "@/lib/auth-lockout-shared";
import { setUserCredentialCall } from "@/lib/admin/user-admin-rpc-shared";
import { applyMods, extractFunction, normalize, type Mod } from "../scripts/shop-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0307_auth_lockout_reset_hardening.sql", "utf8"));
const read = (p: string) => normalize(readFileSync(p, "utf8"));
const fnBody = (start: string) => extractFunction(src, start, "$$;");
const m0279 = read("supabase/migrations/0279_user_employment_events.sql");

/**
 * The 0279 writers 0307 re-emits, as [old, new] modifications of 0279's own text: the SQL that ships IS this list
 * applied to 0279 (asserted below), so a reviewer reads the changes, not two whole function bodies.
 */
const REEMITS: Record<string, readonly Mod[]> = {
  admin_user_set_credential: [
    ["create function public.admin_user_set_credential(", "create or replace function public.admin_user_set_credential("],
    ["declare v_revoked integer := 0;\n", "declare v_revoked integer := 0;\n  v_retired integer := 0;  -- 0307\n"],
    [
      "  else update public.users set password_hash = p_hash where id = p_user; end if;\n",
      [
        "  else update public.users set password_hash = p_hash where id = p_user; end if;",
        "  -- 0307 B157: a password set by an admin retires the person's open reset links (an older email must not overwrite it).",
        "  if p_kind = 'password' then",
        "    update public.password_resets set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;",
        "    get diagnostics v_retired = row_count;",
        "  end if;",
        "",
      ].join("\n"),
    ],
    [
      "  return jsonb_build_object('kind', p_kind, 'sessions_revoked', v_revoked);",
      "  return jsonb_build_object('kind', p_kind, 'sessions_revoked', v_revoked, 'reset_links_retired', v_retired);  -- 0307: + reset_links_retired",
    ],
  ],
};

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
      "S1 auth_create_session: SECURITY DEFINER, search_path pinned, service_role only",
      "B051 a mint with the pre-reset hash after admin_user_set_credential → credential_changed",
      "B051 … and no sessions row was inserted (the reset's revoke stands)",
      "B051 a password mint after an email change → credential_changed",
      "B051 a mint with the current hash → one live session, failed_login_count 0, locked_until null, last_login_at set",
      "B051 an inactive account → account_inactive",
      "B051 a correct answer on the fifth reserved attempt signs in and clears the lock it reserved",
      "S1 auth_password_reset_consume: SECURITY DEFINER, search_path pinned, service_role only",
      "S1 admin_user_set_credential: SECURITY DEFINER, search_path pinned, service_role only",
      "S8 admin_user_set_credential takes the ONE gate (user_admin_lock) before any write, and no lock of its own",
      "B156 a reset whose password write fails rolls back the consume — the link is still open, nothing changed",
      "B156 … the same link then succeeds: password written, lockout cleared, link consumed, both sessions revoked",
      "B156 a used link is refused by name → token_consumed", "B156 an expired link is refused by name → token_expired",
      "B156 an unknown link is refused by name → token_invalid",
      "B157 two open links: using T2 retires T1; another person's link untouched", "B157 T1 then → token_consumed",
      "B157 an admin password set retires the person's open reset links, nobody else's",
      "B157 an admin PIN reset leaves the reset link alone",
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

  /** The parameter names of a function as the migration declares them, in order. */
  const sqlParams = (start: string) => {
    const head = src.slice(src.indexOf(start) + start.length);
    return [...head.slice(0, head.indexOf(")\nreturns ")).matchAll(/\b(p_[a-z_]+) [a-z]+/g)].map((m) => m[1]!);
  };

  it("the lib's builders name the SQL arguments", () => {
    const call = reserveAttemptCall("u");
    expect(call.fn).toBe("auth_reserve_attempt");
    expect(src).toContain(`create function public.${call.fn}(${Object.keys(call.args).map((k) => `${k} uuid`).join(", ")})`);
    const mint = createSessionCall({ sessionId: "s", userId: "u", authMethod: "pin", credential: { kind: "pin", hash: "h" }, tokenHash: "t", expiresAt: "e", ipAddress: null, userAgent: null });
    expect(Object.keys(mint.args)).toEqual(sqlParams(`create function public.${mint.fn}(`));
    const reset = passwordResetConsumeCall({ tokenHash: "t", passwordHash: "p" });
    expect(Object.keys(reset.args)).toEqual(sqlParams(`create function public.${reset.fn}(`));
    // the re-emitted 0279 writer keeps the arguments lib/admin/user-admin-rpc-shared.ts sends
    const cred = setUserCredentialCall({ actorId: "a", userId: "u", kind: "pin", hash: "h" });
    expect(Object.keys(cred.args)).toEqual(sqlParams(`create or replace function public.${cred.fn}(`));
  });

  it("each re-emitted 0279 writer is 0279's own text plus exactly the listed 0307 changes — the gate untouched and first", () => {
    for (const [name, mods] of Object.entries(REEMITS)) {
      const original = extractFunction(m0279, `create function public.${name}(`, "end $$;");
      const shipped = extractFunction(src, `create or replace function public.${name}(`, "end $$;");
      expect(shipped, name).toBe(applyMods(original, mods));
      const gate = shipped.search(/public\.user_admin_lock\(p_actor, p_user\)/);
      const firstWrite = shipped.search(/(update|insert into|delete from) public\./);
      expect(gate, name).toBeGreaterThan(-1);
      expect(firstWrite, name).toBeGreaterThan(gate);
      expect(shipped, name).not.toMatch(/pg_advisory_xact_lock|for update/);
    }
  });

  it("B156/B157 the reset function takes the 0279 lock order and does everything in one body", () => {
    const fn = fnBody("create function public.auth_password_reset_consume(");
    const order = [
      "pg_advisory_xact_lock(hashtextextended('user-employment/' || v_user::text, 0))",
      "from public.users where id = v_user for update",
      "from public.password_resets where token_hash = p_token_hash for update",
      "raise exception 'token_consumed'",
      "raise exception 'token_expired'",
      "update public.users set password_hash = p_password_hash, failed_login_count = 0, locked_until = null where id = v_user",
      "update public.password_resets set consumed_at = v_now where user_id = v_user and consumed_at is null",
      "update public.sessions set revoked_at = v_now where user_id = v_user and revoked_at is null",
    ].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // the per-person key is the SAME one 0279's gate takes
    expect(m0279).toContain("perform pg_advisory_xact_lock(hashtextextended('user-employment/' || p_user::text, 0));");
    // the route maps exactly these messages, and falls back only on a missing function
    const route = read("app/api/auth/password-reset/route.ts");
    for (const code of ["token_consumed", "token_expired", "token_invalid"]) {
      expect(fn).toContain(`raise exception '${code}'`);
      expect(route).toContain(`consumeErr.message === "${code}"`);
    }
    expect(route).toContain("if (consumeErr && isMissingRpc(consumeErr)) {");
  });

  it("B051 the mint compares the verified hash under the users row lock, before it inserts, and clears the counters in the same function", () => {
    const fn = fnBody("create function public.auth_create_session(");
    const lock = fn.indexOf("from public.users where id = p_user for update");
    const cas = fn.indexOf("raise exception 'credential_changed'");
    const insert = fn.indexOf("insert into public.sessions");
    const reset = fn.indexOf("update public.users set failed_login_count = 0, locked_until = null, last_login_at = v_now");
    expect(lock).toBeGreaterThan(-1);
    expect(cas).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(cas);
    expect(reset).toBeGreaterThan(insert);
    expect(fn).toContain("v_pin is distinct from p_verified_hash");
    expect(fn).toContain("v_pw is distinct from p_verified_hash");
    expect(fn).toContain("lower(v_email) is distinct from lower(p_login_email)");
    // the app maps exactly this message to CredentialChangedError, and falls back ONLY on a missing function
    const session = read("lib/session.ts");
    expect(session).toContain('if (mintErr.message === "credential_changed") throw new CredentialChangedError();');
    expect(session).toContain("if (!isMissingRpc(mintErr)) {");
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
