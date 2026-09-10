import { SIM_PERSONAS, SIM_LOCATIONS, assertPersonaRow, personaByEmail } from "../../personas-shared";
import { SIM_APP_ORIGIN } from "../../../../lib/sim-isolation-shared";

// F3's import-safety contract remains valid outside a leased Playwright run.
if (process.env.LRA_RUN_ID) {
const { test, expect, driver, login, selectPersona } = require("../playwright.config") as typeof import("../playwright.config");
test("personas all nine oracle identities and memberships", async ({ contract }) => {
  contract.assertionIds.push("personas.nine-identities", "personas.ten-memberships");
  let count = 0;
  for (const persona of SIM_PERSONAS) {
    const { data: row } = await driver.db.from("users").select("id,email,name,role,active,language").eq("email", persona.email).single();
    expect(Boolean(row)).toBe(true);
    const { data: memberships } = await driver.db.from("user_locations").select("location_id,active").eq("user_id", row.id);
    assertPersonaRow(persona, row, memberships);
    count += memberships.filter((m: { active: boolean }) => m.active).length;
  }
  expect(SIM_PERSONAS.length).toBe(9); expect(count).toBe(10);
});
for (const [alias, code] of [["rosa", "EM"], ["angel", "MEP"]] as const) {
  test(`personas ${alias} real PIN at own shop`, async ({ page, contract }) => {
    contract.assertionIds.push(`personas.${alias}.pin`, `personas.${alias}.language`, `personas.${alias}.shop`);
    await login(page, personaByEmail(`${alias}@sim.co-ops`), code);
    await expect(page.getByRole("heading", { name: new RegExp(SIM_LOCATIONS[code].name) }).first()).toBeVisible();
    await contract.screenshot("outcome");
  });
}
test("personas wrong shop cannot select Rosa for PIN login", async ({ page, contract }) => {
  contract.assertionIds.push("personas.rosa.wrong-shop-refused");
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/users/login-options");
  await selectPersona(page, personaByEmail("rosa@sim.co-ops"), "MEP");
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("button", { name: /Angel Reyes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rosa Delgado/ })).toHaveCount(0);
  expect((await page.context().cookies()).some(cookie => cookie.name === "co_ops_session")).toBe(false);
  await contract.screenshot("refused");
});

// 0198 (LRA-001 + LRA-214): the PostgREST roles hold COLUMN grants on users. Real persona JWTs as bearers
// against the sim's PostgREST, never the app: a level-3 employee cannot promote herself, a GM cannot read a hash,
// and the one self-editable preference still writes — proving the grant is narrow in BOTH directions.
test("personas column grants: self-promotion refused, hashes unreadable, preference still writable (0198)", async ({ contract }) => {
  contract.assertionIds.push("personas.grants.self-promote-refused", "personas.grants.hash-unreadable", "personas.grants.self-preference-allowed");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(Boolean(url && anon), "sim PostgREST origin + anon key in the runner env").toBe(true);
  const bearer = async (alias: string, code: "EM" | "MEP") => {
    const persona = personaByEmail(`${alias}@sim.co-ops`);
    const { data: row } = await driver.db.from("users").select("id,name,role,language").eq("email", persona.email).single();
    const pin = process.env[`SIM_PIN_${alias.toUpperCase()}`]; expect(Boolean(pin), `SIM_PIN_${alias.toUpperCase()}`).toBe(true);
    const session = new driver.Session({ id: row.id, name: row.name, role: row.role }, pin);
    await session.login(SIM_LOCATIONS[code].id);
    const jwt = String(session.cookie).split("; ").find((c: string) => c.startsWith("co_ops_session="))!.slice("co_ops_session=".length);
    return { id: row.id as string, role: row.role as string, language: row.language as string, jwt };
  };
  const rest = (jwt: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: anon!, authorization: `Bearer ${jwt}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const maya = await bearer("maya", "EM"), marcus = await bearer("marcus", "EM");
  expect(maya.role).toBe("employee"); expect(marcus.role).toBe("gm");

  // LRA-214: PATCH own role → refused by the column grant (PostgREST 401/403), row untouched.
  // return=minimal: the ONLY privilege exercised is UPDATE on the named column (a representation would also need SELECT on every column).
  const minimal = { prefer: "return=minimal" };
  const promote = await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", headers: minimal, body: JSON.stringify({ role: "owner" }) });
  expect([401, 403], "personas.grants.self-promote-refused").toContain(promote.status);
  const { data: after } = await driver.db.from("users").select("role,active").eq("id", maya.id).single();
  expect(after.role, "personas.grants.self-promote-refused").toBe("employee"); expect(after.active).toBe(true);
  for (const body of [{ active: false }, { pin_hash: "x" }, { password_hash: "x" }, { locked_until: null }]) {
    expect([401, 403], `personas.grants.self-promote-refused ${Object.keys(body)[0]}`).toContain((await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", headers: minimal, body: JSON.stringify(body) })).status);
  }

  // LRA-001: a GM token cannot select either hash — for anyone, including itself.
  for (const column of ["pin_hash", "password_hash"]) {
    const read = await rest(marcus.jwt, `users?select=id,${column}&limit=1`, { method: "GET" });
    expect([401, 403], `personas.grants.hash-unreadable ${column}`).toContain(read.status);
    expect(await read.text(), "personas.grants.hash-unreadable").not.toMatch(/\$2[aby]\$|hmac2\$/);
  }
  const safe = await rest(marcus.jwt, `users?select=id,name,role&limit=1`, { method: "GET" });
  expect(safe.status, "personas.grants.hash-unreadable: safe columns still readable").toBe(200);

  // Positive control: the self-editable preference still writes through the same bearer, then is restored.
  const flip = maya.language === "es" ? "en" : "es";
  // Positive control asks for exactly the granted columns back — the shape /api/users/me/language uses (`.select("id, language")`).
  const pref = await rest(maya.jwt, `users?id=eq.${maya.id}&select=id,language`, { method: "PATCH", body: JSON.stringify({ language: flip }) });
  expect(pref.status, "personas.grants.self-preference-allowed").toBe(200);
  expect((await pref.json())[0]?.language, "personas.grants.self-preference-allowed").toBe(flip);
  expect((await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", headers: minimal, body: JSON.stringify({ language: maya.language }) })).status).toBe(204);
});


// 0200 (LRA-013): current_user_id() is session-bound. The SAME staff JWT that reads its own users row through
// PostgREST reads NOTHING after the app revokes the session — the curl path dies with the session, not with the
// token's 12-hour expiry.
test("personas session-bound helper: a revoked JWT is nobody to RLS on the PostgREST path (0200)", async ({ contract }) => {
  contract.assertionIds.push("personas.session.live-token-reads-self", "personas.session.revoked-token-reads-nothing", "personas.session.revoked-token-app-401");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(Boolean(url && anon)).toBe(true);
  const persona = personaByEmail("luis@sim.co-ops");
  const { data: row } = await driver.db.from("users").select("id,name,role").eq("email", persona.email).single();
  const pin = process.env.SIM_PIN_LUIS; expect(Boolean(pin), "SIM_PIN_LUIS").toBe(true);
  const session = new driver.Session({ id: row.id, name: row.name, role: row.role }, pin);
  await session.login(SIM_LOCATIONS.MEP.id);
  const cookie = String(session.cookie);
  const jwt = cookie.split("; ").find((c: string) => c.startsWith("co_ops_session="))!.slice("co_ops_session=".length);
  const rest = (path: string) => fetch(`${url}/rest/v1/${path}`, { headers: { apikey: anon!, authorization: `Bearer ${jwt}` } });
  // Live: the token resolves to Luis and users_read_self returns exactly his row.
  const live = await rest(`users?select=id&id=eq.${row.id}`);
  expect(live.status, "personas.session.live-token-reads-self").toBe(200);
  expect(await live.json(), "personas.session.live-token-reads-self").toEqual([{ id: row.id }]);
  // Revoke through the real app (logout), not the oracle.
  const logout = await fetch(`${SIM_APP_ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie, origin: SIM_APP_ORIGIN }, redirect: "manual" });
  expect([200, 204, 302, 303, 307], "logout").toContain(logout.status);
  const { data: stored } = await driver.db.from("sessions").select("revoked_at").eq("id", String((session.claims as { session_id: string }).session_id)).single();
  expect(stored.revoked_at, "session revoked in the oracle").not.toBeNull();
  // Same unexpired JWT: RLS now resolves nobody — no rows, not an error (the token is still a valid bearer).
  const dead = await rest(`users?select=id&id=eq.${row.id}`);
  expect(dead.status, "personas.session.revoked-token-reads-nothing").toBe(200);
  expect(await dead.json(), "personas.session.revoked-token-reads-nothing").toEqual([]);
  // And the app path refuses it outright (dual verification, unchanged).
  const app = await fetch(`${SIM_APP_ORIGIN}/api/users/me/language`, { method: "PATCH", headers: { cookie, origin: SIM_APP_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ language: "en" }), redirect: "manual" });
  expect([401, 307], "personas.session.revoked-token-app-401").toContain(app.status);
});

}
