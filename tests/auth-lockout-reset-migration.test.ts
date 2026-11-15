/**
 * Migration 0307 (audit wave W07: PINs, lockouts and password resets) — authored, NOT applied. Pins: the house
 * header and gate line; the executable PGlite proof (scripts/sql-harness-0307.mjs); the SQL limits equal the TS
 * ones; the lib's builders name the SQL arguments; the app keeps a pre-0307 path for every function it calls.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMAIL_CONFIRM_CONSUME_REFUSALS, FAILURE_LIMIT, LOCKOUT_MINUTES, PASSWORD_RESET_EXPIRES_HOURS, PASSWORD_RESET_ISSUE_REFUSALS, REAUTH_LIMIT,
  createSessionCall, emailConfirmConsumeCall, emailConfirmIssueCall, passwordResetConsumeCall, passwordResetIssueCall, reserveAttemptCall,
  sessionReauthClearCall, sessionReauthReserveCall,
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
      "S1 session_reauth_reserve: SECURITY DEFINER, search_path pinned, service_role only",
      "S1 session_reauth_clear: SECURITY DEFINER, search_path pinned, service_role only",
      "B159 sessions.reauth_failed_count is NOT NULL DEFAULT 0 (existing sessions start at 0)",
      "B159 five re-check reservations allowed, the sixth refused and the session revoked",
      "B159 a success clears the count",
      "B159 the ACCOUNT is never locked or deactivated by re-checks (the person signs in again)",
      "B159 the count is per session, not per person",
      // review round 1 — P2 #1: reset links are issued under the retirers' locks
      "S1 auth_password_reset_issue: SECURITY DEFINER, search_path pinned, service_role only",
      "R1 (the bug) read → email change → a plain insert: the old address's link sets the password of the account at the new address",
      "R1 read → email change → issue: a request that read the old address is refused → email_changed",
      "R1 … and no reset link was inserted for the old address",
      "R1 an eligible request issues ONE open link, bound to the address on the locked row (returned lowercased)",
      "R1 issue → email change: the change retires the link that was just issued",
      "R1 a link issued for another address is refused by the consumer, retired or not → email_changed",
      "R1 read → admin password set → issue: the request read an older password generation → credential_changed",
      "R1 read → self-service reset → issue: a link can not escape the reset's retirement → credential_changed",
      "R1 … after a reset the person has NO open link (the one used, the others, and none issued late)",
      "R1 a request that read the account after the reset gets its link",
      "R1 read → demotion below manager → issue → role_not_email_auth",
      "R1 read → deactivation → issue → user_inactive",
      "R1 an unconfirmed email gets no reset link → email_not_verified",
      "R1 … and no refused request left a link behind",
      "R1 anything but a sha-256 hex digest is refused (never a raw token) → invalid_payload",
      "R1 an expiry beyond 2 hours is refused → invalid_payload",
      "R1 (control) the lock probe reads NOTHING held for a transaction that only read the row",
      "R1 the issuer holds the per-person advisory lock (0279's key, and only it) and the users row lock to the end of its transaction",
      "R1 anon cannot EXECUTE auth_password_reset_issue → 42501", "R1 authenticated cannot EXECUTE auth_password_reset_issue → 42501",
      // review round 1 — P2 #2: the confirmation is one transaction
      "S1 auth_email_confirm_consume: SECURITY DEFINER, search_path pinned, service_role only",
      "R2 the issuer binds the link to the address it is mailed to",
      "R2 a confirmation writes the password, marks the email confirmed, consumes the link, revokes sessions and retires reset links — together",
      "R2 … and the auto sign-in mints on the hash and the email the confirmation returned",
      "R2 a used link is refused by name → token_consumed",
      "R2 a confirmation whose write fails rolls back the consume — the link is still usable, nothing changed, no session revoked",
      "R2 … the same link then succeeds",
      "R2 confirm → email change → consume: the change retired the link → token_consumed",
      "R2 … the replacement address is NOT confirmed and no password was written",
      "R2 a link mailed to another address is refused, retired or not → email_changed",
      "R2 confirm → demotion below manager → consume → role_not_email_auth",
      "R2 … no password, no confirmation, the link not consumed (the demotion's own session revoke stands)",
      "R2 … promoted again, the SAME link works (a refusal never burns it)",
      "R2 confirm → deactivation → consume → account_inactive",
      "R2 … an inactive account gets no password and no confirmation",
      "R2 an expired link is refused by name → token_expired", "R2 an unknown link is refused by name → token_invalid",
      "R2 a pre-0307 link (no address on it) still confirms an eligible manager",
      "R2 the consumer holds the per-person advisory lock (0279's key, and only it) and the users row lock to the end of its transaction",
      "R2 anon cannot EXECUTE auth_email_confirm_consume → 42501", "R2 authenticated cannot EXECUTE auth_email_confirm_consume → 42501",
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
    const resetIssue = passwordResetIssueCall({ userId: "u", email: "e", seenPasswordHash: "h", tokenHash: "t", expiresAt: "x" });
    expect(Object.keys(resetIssue.args)).toEqual(sqlParams(`create function public.${resetIssue.fn}(`));
    const confirm = emailConfirmConsumeCall({ tokenHash: "t", passwordHash: "p" });
    expect(Object.keys(confirm.args)).toEqual(sqlParams(`create function public.${confirm.fn}(`));
    for (const call of [sessionReauthReserveCall("s"), sessionReauthClearCall("s")]) {
      expect(Object.keys(call.args), call.fn).toEqual(sqlParams(`create function public.${call.fn}(`));
    }
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
      "insert into public.email_verifications (user_id, token_hash, expires_at, issued_email)",
      // review round 1: the link is bound to the address on the LOCKED row
      "values (p_user, p_token_hash, p_expires_at, lower(btrim(v_email)))",
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
    // nothing vouches an email on anyone's behalf: a promoted manager is confirmed only by USING their link —
    // the one function that writes email_verified is the link's own consumer
    for (const name of ["admin_user_set_credential", "admin_user_update_profile", "auth_email_confirm_issue", "auth_password_reset_issue",
      "auth_password_reset_consume"]) {
      expect(fnBody(`function public.${name}(`), name).not.toContain("email_verified = true");
    }
    const writers = [...src.matchAll(/\ncreate (?:or replace )?function public\.([a-z_]+)\(/g)].map((m) => m[1]!)
      .filter((name) => fnBody(`function public.${name}(`).includes("email_verified = true"));
    expect(writers).toEqual(["auth_email_confirm_consume"]);
  });

  it("review round 1: the confirmation is ONE transaction — locks, the link, the PERSON on the locked row, then every write", () => {
    const fn = fnBody("create function public.auth_email_confirm_consume(");
    const order = [
      // the reset consumer's lock order: the per-person key (0279's), the users row, the link row
      "pg_advisory_xact_lock(hashtextextended('user-employment/' || v_user::text, 0))",
      "from public.users where id = v_user for update",
      "from public.email_verifications where token_hash = p_token_hash for update",
      "raise exception 'token_consumed'",
      "raise exception 'token_expired'",
      // eligibility, re-decided under the lock
      "coalesce(public.user_admin_role_level(v_role), 0) < 6 then raise exception 'role_not_email_auth'",
      "(v_issued is not null and v_issued is distinct from lower(btrim(v_email)))",
      "raise exception 'email_changed'",
      "raise exception 'account_inactive'",
      // …and only then the writes, all in this one body
      "update public.users set password_hash = p_password_hash, email_verified = true, email_verified_at = v_now where id = v_user",
      "update public.email_verifications set consumed_at = v_now where user_id = v_user and consumed_at is null",
      "update public.password_resets set consumed_at = v_now where user_id = v_user and consumed_at is null",
      "update public.sessions set revoked_at = v_now where user_id = v_user and revoked_at is null",
    ].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // no write of any kind before the last refusal
    const firstWrite = fn.search(/\n\s*(update|insert into|delete from) public\./);
    expect(firstWrite).toBeGreaterThan(fn.lastIndexOf("raise exception"));
    // every refusal the lib names is raised, and nothing else
    const raised = [...fn.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]!).filter((c) => c !== "invalid_payload");
    expect([...new Set(raised)].sort()).toEqual([...EMAIL_CONFIRM_CONSUME_REFUSALS].sort());
    expect(src).toContain("alter table public.email_verifications add column issued_email text;");
    // the email change and the issuer hold the same two locks (through 0279's gate) around their own link writes
    const profile = fnBody("create or replace function public.admin_user_update_profile(");
    expect(profile.indexOf("perform public.user_admin_lock(p_actor, p_user);")).toBeLessThan(profile.indexOf("update public.email_verifications set consumed_at"));
  });

  it("review round 1: the verify route hashes FIRST, then makes ONE call — its own consume / write survive only as the pre-0307 path", () => {
    const route = read("app/api/auth/verify/route.ts");
    const post = route.slice(route.indexOf("export async function POST("), route.indexOf("async function legacyVerify("));
    const hash = post.indexOf("const passwordHash = await hashPassword(password);");
    const rpc = post.indexOf("await sb.rpc(call.fn, call.args)");
    expect(hash).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(hash);
    // before the hash the handler only READS; it never writes a table itself
    expect(post).not.toMatch(/\.(update|insert|upsert|delete)\(/);
    expect(post).toContain("if (consumeErr && isMissingRpc(consumeErr)) {");
    expect(post).toContain("return legacyVerify(sb, row, passwordHash, now, ipAddress, userAgent);");
    // a failure that is not a named refusal is a 500 that says the link is still usable — and logs no secret
    for (const line of route.split("\n").filter((l) => /console\./.test(l))) expect(line).not.toMatch(/\$\{(token|password|tokenHash|passwordHash)\b/);
    // the sign-in names the hash AND the address the function confirmed
    expect(post).toContain('loginEmail: typeof result.email === "string" && result.email !== "" ? result.email : undefined,');
    const tail = route.slice(route.indexOf("async function finishVerified("));
    expect(tail).toContain("if (!(e instanceof CredentialChangedError)) throw e;");
  });

  it("B159 the re-check counter: one statement decides and counts, the limit equals REAUTH_LIMIT, the account is never touched", () => {
    expect(src).toContain("alter table public.sessions add column reauth_failed_count integer not null default 0\n  constraint sessions_reauth_failed_count_nonneg check (reauth_failed_count >= 0);");
    const reserve = fnBody("create function public.session_reauth_reserve(");
    expect(reserve).toContain(`where id = p_session and revoked_at is null and reauth_failed_count < ${REAUTH_LIMIT}`);
    // the count and the decision are ONE update; the revoke happens only when that update matched nothing
    expect(reserve.indexOf("update public.sessions set reauth_failed_count = reauth_failed_count + 1")).toBeLessThan(reserve.indexOf("if found then return"));
    expect(reserve.indexOf("if found then return")).toBeLessThan(reserve.indexOf("update public.sessions set revoked_at = clock_timestamp() where id = p_session and revoked_at is null"));
    for (const name of ["session_reauth_reserve", "session_reauth_clear"]) {
      const fn = fnBody(`create function public.${name}(`);
      expect(fn, name).not.toMatch(/public\.users|locked_until|failed_login_count/); // never an ACCOUNT lockout
    }
    // the app counts BEFORE it checks, degrades only to "uncounted", and never fails a re-check on a limiter fault
    const lib = read("lib/auth-reauth.ts");
    const fn = lib.slice(lib.indexOf("export async function reserveReauth("), lib.indexOf("/** A correct answer ends the run"));
    expect(fn).toContain("isMissingRpc(error)");
    expect(fn).not.toMatch(/throw /);
    expect(fn).not.toMatch(/allowed: false/);
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
    for (const code of ["token_consumed", "token_expired", "token_invalid", "email_changed"]) {
      expect(fn).toContain(`raise exception '${code}'`);
      expect(route).toContain(`consumeErr.message === "${code}"`);
    }
    expect(route).toContain("if (consumeErr && isMissingRpc(consumeErr)) {");
  });

  it("review round 1: a reset link is ISSUED under the retirers' locks, after re-checking the request's read on the locked row", () => {
    const fn = fnBody("create function public.auth_password_reset_issue(");
    const order = [
      "p_token_hash !~ '^[0-9a-f]{64}$'",
      // the SAME per-person key 0279's gate and the reset consumer take, then the users row
      "pg_advisory_xact_lock(hashtextextended('user-employment/' || p_user::text, 0))",
      "from public.users where id = p_user for update",
      "raise exception 'user_not_found'",
      "lower(btrim(v_email)) is distinct from lower(btrim(p_email)) then raise exception 'email_changed'",
      "raise exception 'user_inactive'",
      "coalesce(public.user_admin_role_level(v_role), 0) < 6 then raise exception 'role_not_email_auth'",
      "raise exception 'email_not_verified'",
      "v_pw is distinct from p_seen_password_hash then raise exception 'credential_changed'",
      "insert into public.password_resets (user_id, token_hash, expires_at, issued_email)",
    ].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // ONE lock of each kind, nothing after the insert but the return: every check precedes the only write
    expect(fn.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(fn.match(/for update/g)).toHaveLength(1);
    expect(fn.match(/\b(update|delete from|insert into) public\./g)).toEqual(["insert into public."]);
    // the level floor is hasEmailAuth's (pinned equal to `level >= 6` above), and the life ceiling admits the app's
    for (const r of Object.values(ROLES)) expect(r.hasEmailAuth, r.code).toBe(r.level >= 6);
    expect(fn).toContain("p_expires_at > v_now + interval '2 hours'");
    expect(PASSWORD_RESET_EXPIRES_HOURS).toBeLessThanOrEqual(2);
    // every refusal the lib names is raised by the function, and nothing else is treated as one
    for (const code of PASSWORD_RESET_ISSUE_REFUSALS) expect(fn, code).toContain(`raise exception '${code}'`);
    const raised = [...fn.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]!).filter((c) => c !== "invalid_payload");
    expect([...new Set(raised)].sort()).toEqual([...PASSWORD_RESET_ISSUE_REFUSALS].sort());
    // every retirer of reset links holds the same two locks: 0279's gate, or the consumer's own pair
    for (const name of Object.keys(REEMITS)) {
      const body = fnBody(`create or replace function public.${name}(`);
      expect(body.indexOf("perform public.user_admin_lock(p_actor, p_user);"), name).toBeLessThan(body.indexOf("update public.password_resets set consumed_at"));
    }
    expect(m0279).toContain("select role, active into v_target_role, v_target_active from public.users where id = p_user for update;");
    // the consumer binds: a link issued for one address never sets the password of the account at another
    const consume = fnBody("create function public.auth_password_reset_consume(");
    expect(consume).toContain("if v_issued is not null and v_issued is distinct from lower(btrim(v_email)) then raise exception 'email_changed'; end if;");
    expect(consume.indexOf("raise exception 'email_changed'")).toBeLessThan(consume.indexOf("update public.users set password_hash"));
    expect(src).toContain("alter table public.password_resets add column issued_email text;");
  });

  it("review round 1: the reset-request route issues ONLY through that function — throttle first, fail closed, the old insert only while 0307 is missing", () => {
    const route = read("app/api/auth/password-reset-request/route.ts");
    const body = route.slice(route.indexOf("export async function POST("));
    const at = (needle: string) => body.indexOf(needle);
    // the rate limit is untouched and still runs before anything is read
    expect(body).toContain("checkAndRecord(`pwreset_email:${normalizedEmail}`, 15 * 60, 3)");
    expect(at("checkAndRecord(")).toBeGreaterThan(-1);
    expect(at("checkAndRecord(")).toBeLessThan(at("getServiceRoleClient()"));
    expect(at("getServiceRoleClient()")).toBeLessThan(at("await sb.rpc(call.fn, call.args)"));
    // exactly ONE plain insert remains, and it sits inside the missing-function branch
    expect(body.match(/\.from\("password_resets"\)/g)).toHaveLength(1);
    const missing = at("if (issueErr && isMissingRpc(issueErr)) {");
    const otherErr = at("} else if (issueErr) {");
    expect(missing).toBeGreaterThan(-1);
    expect(at('.from("password_resets")')).toBeGreaterThan(missing);
    expect(at('.from("password_resets")')).toBeLessThan(otherErr);
    // any other error returns before the send; the mail goes to the address the LOCKED row holds
    const failClosed = body.slice(otherErr, body.indexOf("} else {", otherErr));
    expect(failClosed).toContain("return constantOk();");
    expect(failClosed).not.toMatch(/sendEmail|\.insert\(/);
    expect(otherErr).toBeLessThan(at("await sendEmail("));
    expect(body).toContain("to: mailTo,");
    // never the token, never a hash, in a log line
    for (const line of body.split("\n").filter((l) => /console\./.test(l))) expect(line).not.toMatch(/rawToken|tokenHash|password_hash/);
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

  it("every function the app calls has a pre-0307 path (the file can be applied AFTER the code ships)", () => {
    // function → the file that calls it and names what happens while it is missing
    const callers: Record<string, string> = {
      auth_reserve_attempt: "lib/auth-flows.ts",
      auth_create_session: "lib/session.ts",
      auth_password_reset_consume: "app/api/auth/password-reset/route.ts",
      auth_password_reset_issue: "app/api/auth/password-reset-request/route.ts",
      auth_email_confirm_issue: "lib/admin/email-confirm.ts",
      auth_email_confirm_consume: "app/api/auth/verify/route.ts",
      session_reauth_reserve: "lib/auth-reauth.ts",
      session_reauth_clear: "lib/auth-reauth.ts",
    };
    const created = [...src.matchAll(/\ncreate function public\.([a-z_]+)\(/g)].map((m) => m[1]!);
    expect([...created].sort()).toEqual(Object.keys(callers).sort()); // a new function must name its caller here
    for (const [fn, file] of Object.entries(callers)) expect(read(file), `${fn} in ${file}`).toContain("isMissingRpc(");
    // the three re-emitted functions keep their signatures, so code deployed BEFORE this wave keeps working after the apply
    for (const sig of ["increment_failed_login(p_user_id uuid)", "admin_user_set_credential(p_actor uuid, p_user uuid, p_kind text, p_hash text)",
      "admin_user_update_profile(p_actor uuid, p_user uuid, p_patch jsonb)"]) {
      expect(src).toContain(`create or replace function public.${sig}`);
    }
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
