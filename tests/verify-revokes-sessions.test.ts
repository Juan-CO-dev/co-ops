import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync("app/api/auth/verify/route.ts", "utf8");

it("LRA-224 (the 0307 path): the revoke is inside the confirmation's own transaction — after the credential write, before the function returns", () => {
  const sql = readFileSync("supabase/migrations/0307_auth_lockout_reset_hardening.sql", "utf8");
  const fn = sql.slice(sql.indexOf("create function public.auth_email_confirm_consume("));
  const body = fn.slice(0, fn.indexOf("end $$;"));
  const write = body.indexOf("update public.users set password_hash = p_password_hash, email_verified = true");
  const revoke = body.indexOf("update public.sessions set revoked_at = v_now where user_id = v_user and revoked_at is null;");
  expect(write).toBeGreaterThan(-1);
  expect(revoke).toBeGreaterThan(write);
  expect(revoke).toBeLessThan(body.indexOf("return jsonb_build_object("));
  // …and the route signs in only AFTER that function answered, auditing the count it returned
  const post = source.slice(source.indexOf("export async function POST("), source.indexOf("async function legacyVerify("));
  expect(post.indexOf("await sb.rpc(call.fn, call.args)")).toBeLessThan(post.indexOf("return finishVerified({"));
  expect(post).not.toContain("recordSuccessfulAuth(");
  expect(post).toContain("sessionsRevoked: typeof result.sessions_revoked === \"number\" ? result.sessions_revoked : 0,");
});

it("LRA-224 (the pre-0307 path): first-password verification revokes after a successful write and before either success audit/sign-in", () => {
  const legacy = source.slice(source.indexOf("async function legacyVerify("), source.indexOf("async function finishVerified("));
  const revoke = legacy.indexOf("await revokeAllUserSessions(row.user_id)");
  expect(revoke).toBeGreaterThan(legacy.indexOf("if (updateUserErr || !updatedUser)"));
  expect(revoke).toBeLessThan(legacy.indexOf("if (!updatedUser.active)"));
  expect(revoke).toBeLessThan(legacy.indexOf("return finishVerified({"));
  // both of its success audits carry the count: the inactive one inline, the signed-in one through finishVerified
  expect(legacy.match(/sessions_revoked: revokedCount|sessionsRevoked: revokedCount/g)).toHaveLength(2);
});

it("LRA-224: the shared tail audits the verification (with the count) before it signs anyone in", () => {
  const tail = source.slice(source.indexOf("async function finishVerified("));
  expect(tail.indexOf("sessions_revoked: a.sessionsRevoked")).toBeGreaterThan(-1);
  expect(tail.indexOf("sessions_revoked: a.sessionsRevoked")).toBeLessThan(tail.indexOf("await recordSuccessfulAuth("));
});
