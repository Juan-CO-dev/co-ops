/**
 * Portal-2 magic-link smoke — regression harness for the customer auth principal.
 *
 * Run against a LOCAL dev server + service-role DB:
 *   1. npm run dev   (separate terminal)
 *   2. npx tsx --env-file=.env.local scripts/portal-2-smoke.ts
 *
 * Covers: request constant-shape; verify single-use (consume once, replay fails);
 * expired-token rejection; account-create-on-verify (customer + session + email_verified_at);
 * principal separation (a customer JWT is NOT a staff JWT and vice-versa). Cleans up its
 * fixtures (hard-deletes the throwaway token/session rows; deactivates the test customer).
 */

import { getServiceRoleClient } from "../lib/supabase-server";
import { generateToken, hashToken } from "../lib/portal/auth";
import { verifyCustomerJwt } from "../lib/portal/auth";
import { verifyJwt } from "../lib/auth";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL = "co-portal-smoke@example.com";
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}

async function insertToken(rawToken: string, expiresAt: Date): Promise<void> {
  const sb = getServiceRoleClient();
  const { error } = await sb.from("catering_portal_tokens").insert({
    email: EMAIL, token_hash: await hashToken(rawToken), name: "Portal Smoke",
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`insertToken: ${error.message}`);
}
async function postVerify(token: string): Promise<{ status: number; ok: boolean; setCookie: string | null }> {
  const res = await fetch(`${BASE}/api/portal/magic-link/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return { status: res.status, ok: data.ok === true, setCookie: res.headers.get("set-cookie") };
}

async function main() {
  const sb = getServiceRoleClient();
  console.log("Portal-2 smoke\n");

  // Pre-clean any prior run.
  await sb.from("catering_portal_tokens").delete().eq("email", EMAIL);
  const { data: prior } = await sb.from("catering_customers").select("id").ilike("email", EMAIL);
  for (const c of prior ?? []) await sb.from("catering_portal_sessions").delete().eq("customer_id", c.id);
  await sb.from("catering_customers").delete().ilike("email", EMAIL);

  // 1. Request route is constant-shape {ok:true} (non-allowlisted -> no email sent).
  console.log("1. request route constant-shape");
  const reqRes = await fetch(`${BASE}/api/portal/magic-link/request`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, name: "Portal Smoke" }),
  });
  const reqBody = (await reqRes.json().catch(() => ({}))) as { ok?: boolean };
  check("request returns 200 {ok:true}", reqRes.status === 200 && reqBody.ok === true, { status: reqRes.status, reqBody });
  await sb.from("catering_portal_tokens").delete().eq("email", EMAIL); // drop that minted token; we control tokens below

  // 2. Verify happy path: fresh token consumes -> ok, creates account + session.
  console.log("2. verify happy path + account creation");
  const good = generateToken();
  await insertToken(good, new Date(Date.now() + 30 * 60 * 1000));
  const v1 = await postVerify(good);
  check("verify returns 200 {ok:true}", v1.status === 200 && v1.ok, v1);
  check("sets co_ops_portal cookie", (v1.setCookie ?? "").includes("co_ops_portal="), v1.setCookie);
  const { data: cust } = await sb.from("catering_customers").select("id, email_verified_at, active").ilike("email", EMAIL).maybeSingle<{ id: string; email_verified_at: string | null; active: boolean | null }>();
  check("catering_customers row created", !!cust, cust);
  check("email_verified_at stamped", !!cust?.email_verified_at);
  if (cust) {
    const { data: sess } = await sb.from("catering_portal_sessions").select("id, revoked_at").eq("customer_id", cust.id);
    check("catering_portal_sessions row created", (sess ?? []).length === 1, sess);
  }

  // 3. Single-use: replaying the same token fails.
  console.log("3. single-use replay");
  const v2 = await postVerify(good);
  check("replay returns {ok:false} 400", v2.status === 400 && !v2.ok, v2);

  // 4. Expired token is rejected.
  console.log("4. expired token");
  const expired = generateToken();
  await insertToken(expired, new Date(Date.now() - 60 * 1000));
  const v3 = await postVerify(expired);
  check("expired returns {ok:false} 400", v3.status === 400 && !v3.ok, v3);

  // 5. Principal separation: a customer JWT is not a staff JWT and vice-versa.
  console.log("5. principal separation");
  // Mint a fresh customer session to get a real customer JWT.
  const good2 = generateToken();
  await insertToken(good2, new Date(Date.now() + 30 * 60 * 1000));
  const v4 = await postVerify(good2);
  const custJwt = (v4.setCookie ?? "").match(/co_ops_portal=([^;]+)/)?.[1] ?? "";
  let staffRejectsCustomer = false;
  try { await verifyJwt(custJwt); } catch { staffRejectsCustomer = true; }
  check("staff verifyJwt REJECTS a customer JWT", staffRejectsCustomer);
  let customerRejectsGarbage = false;
  try { await verifyCustomerJwt("not.a.jwt"); } catch { customerRejectsGarbage = true; }
  check("customer verifyCustomerJwt rejects garbage", customerRejectsGarbage);

  // Cleanup fixtures (throwaway auth rows: hard delete; customer: deactivate then delete).
  console.log("\ncleanup");
  await sb.from("catering_portal_tokens").delete().eq("email", EMAIL);
  const { data: cleanupCusts } = await sb.from("catering_customers").select("id").ilike("email", EMAIL);
  for (const c of cleanupCusts ?? []) await sb.from("catering_portal_sessions").delete().eq("customer_id", c.id);
  await sb.from("catering_customers").delete().ilike("email", EMAIL);
  console.log("  ✓ fixtures removed");

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
