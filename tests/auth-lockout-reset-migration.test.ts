/**
 * Migration 0307 (audit wave W07: PINs, lockouts and password resets) — authored, NOT applied. Pins: the house
 * header and gate line; the executable PGlite proof (scripts/sql-harness-0307.mjs); the SQL limits equal the TS
 * ones; the lib's builders name the SQL arguments; the app keeps a pre-0307 path for every function it calls.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FAILURE_LIMIT, LOCKOUT_MINUTES, createSessionCall, emailConfirmIssueCall, passwordResetConsumeCall, reserveAttemptCall,
} from "@/lib/auth-lockout-shared";
import { EMAIL_CONFIRM_RPC_ERRORS } from "@/lib/admin/email-confirm-shared";
import { ROLES } from "@/lib/roles";
import { setUserCredentialCall, updateUserProfileCall } from "@/lib/admin/user-admin-rpc-shared";
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
        "  -- 0307 B158: a manager's reset also ends the lockout — the person can sign in with the new credential at once.",
        "  update public.users set failed_login_count = 0, locked_until = null where id = p_user;",
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
  admin_user_update_profile: [
    ["create function public.admin_user_update_profile(", "create or replace function public.admin_user_update_profile("],
    ["  v_email_changed boolean := false;\n", "  v_email_changed boolean := false;\n  v_retired integer := 0;  -- 0307\n"],
    [
      "  if v_email_changed then\n",
      [
        "  if v_email_changed then",
        "    -- 0307 B052: a reset link mailed to the OLD address must not set the password of the account at the new one.",
        "    update public.password_resets set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;",
        "    get diagnostics v_retired = row_count;",
        "    -- 0307 B053: nor may a \"confirm your email\" link mailed to the old address confirm the new one.",
        "    update public.email_verifications set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;",
        "",
      ].join("\n"),
    ],
    [
      "  return jsonb_build_object('fields', to_jsonb(v_fields), 'email_changed', v_email_changed, 'sessions_revoked', v_revoked);",
      "  return jsonb_build_object('fields', to_jsonb(v_fields), 'email_changed', v_email_changed, 'sessions_revoked', v_revoked,\n    'reset_links_retired', v_retired);  -- 0307: + reset_links_retired",
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
      "B158 a GM's PIN reset clears locked_until and failed_login_count; the new PIN signs in at once",
      "B158 a GM's password set clears the lockout too",
      "B158 a refused reset (a peer, never below the actor) clears nothing → forbidden",
      "S1 admin_user_update_profile: SECURITY DEFINER, search_path pinned, service_role only",
      "S8 admin_user_update_profile takes the ONE gate (user_admin_lock) before any write, and no lock of its own",
      "B052 an email change retires the person's open reset links; a name-only edit and another person's link are untouched",
      "B052 the old address's link can no longer set the password → token_consumed",
      "B052 a taken email is still refused and retires nothing → email_taken",
      "S1 auth_email_confirm_issue: SECURITY DEFINER, search_path pinned, service_role only",
      "B053 the backfill vouches exactly the stranded level-6+ rows (an email on file, any active state), nobody below 6, nobody without an email",
      "B053 the backfill writes ONE destructive audit row (actor_context migration_apply) naming the ids it vouched",
      "B053 with nobody stranded the backfill writes no audit row",
      "B053 (the bug) promotion shift_lead → agm leaves email_verified false: manager sign-in is refused",
      "B053 promotion shift_lead→agm of a person with an email → one open confirmation link, the address returned lowercased",
      "B053 a resend retires the older link: one live link at a time",
      "B053 an email change retires the confirmation link mailed to the old address",
      "B053 a confirmed email gets no further link → email_already_confirmed",
      "B053 a GM cannot send a link to a manager at a shop they do not manage → target_outside_shop",
      "B053 an AGM cannot send a link (GM and up only) → forbidden",
      "B053 anything but a sha-256 hex digest is refused (never a raw token) → invalid_payload",
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
    const issue = emailConfirmIssueCall({ actorId: "a", userId: "u", tokenHash: "h", expiresAt: "e" });
    expect(Object.keys(issue.args)).toEqual(sqlParams(`create function public.${issue.fn}(`));
    const profile = updateUserProfileCall({ actorId: "a", userId: "u", patch: {} });
    expect(Object.keys(profile.args)).toEqual(sqlParams(`create or replace function public.${profile.fn}(`));
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

  it("B053 the issuer sits behind the ONE gate, stores a hash, keeps one live link, and its level floor is hasEmailAuth's", () => {
    const fn = fnBody("create function public.auth_email_confirm_issue(");
    const order = [
      "p_token_hash !~ '^[0-9a-f]{64}$'",
      "v_ctx := public.user_admin_lock(p_actor, p_user);",
      "raise exception 'email_confirm_not_available'",
      "raise exception 'email_required'",
      "raise exception 'email_already_confirmed'",
      "update public.email_verifications set consumed_at = v_now where user_id = p_user and consumed_at is null;",
      "insert into public.email_verifications (user_id, token_hash, expires_at)",
    ].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fn).not.toMatch(/pg_advisory_xact_lock|for update/); // the gate holds the locks; no lock of its own
    // the SQL floor (< 6 refused) is exactly lib/roles.ts hasEmailAuth
    expect(fn).toContain("coalesce((v_ctx ->> 'target_level')::integer, 0) < 6");
    for (const r of Object.values(ROLES)) expect(r.hasEmailAuth, r.code).toBe(r.level >= 6);
    // every named refusal the lib maps is raised by the function
    for (const code of Object.keys(EMAIL_CONFIRM_RPC_ERRORS)) expect(fn, code).toContain(`raise exception '${code}'`);
  });

  it("B053 the backfill vouches level-6+ people with an email only, writes its own audit row, and is checked after apply", () => {
    const start = src.indexOf("-- ── 8. EXISTING ROWS");
    const block = src.slice(start, src.indexOf("-- ── POST-APPLY", start));
    expect(block).toContain("update public.users set email_verified = true, email_verified_at = clock_timestamp()");
    expect(block).toContain("where not coalesce(email_verified, false) and email is not null and btrim(email) <> ''");
    expect(block).toContain("and coalesce(public.user_admin_role_level(role), 0) >= 6");
    expect(block).not.toMatch(/\bactive\b\s*(=|is)/); // deliberately not filtered on active
    expect(block).toContain("'user.email_vouch_backfill', 'users', null, true,");
    expect(block).toContain("'actor_context', 'migration_apply'");
    expect(src).toContain("raise exception '0307: the B053 backfill left an unverified level-6+ email';");
    // no function in this file sets email_verified: a promoted manager is confirmed only by using their link
    for (const name of ["admin_user_set_credential", "admin_user_update_profile", "auth_email_confirm_issue"]) {
      expect(fnBody(`function public.${name}(`), name).not.toContain("email_verified = true");
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
