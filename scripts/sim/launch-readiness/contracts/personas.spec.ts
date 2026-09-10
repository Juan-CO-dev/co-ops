import { SIM_PERSONAS, SIM_LOCATIONS, assertPersonaRow, personaByEmail } from "../../personas-shared";

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
  const promote = await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", body: JSON.stringify({ role: "owner" }) });
  expect([401, 403], "personas.grants.self-promote-refused").toContain(promote.status);
  const { data: after } = await driver.db.from("users").select("role,active").eq("id", maya.id).single();
  expect(after.role, "personas.grants.self-promote-refused").toBe("employee"); expect(after.active).toBe(true);
  for (const body of [{ active: false }, { pin_hash: "x" }, { password_hash: "x" }, { locked_until: null }]) {
    expect([401, 403], `personas.grants.self-promote-refused ${Object.keys(body)[0]}`).toContain((await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", body: JSON.stringify(body) })).status);
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
  const pref = await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", body: JSON.stringify({ language: flip }) });
  expect(pref.status, "personas.grants.self-preference-allowed").toBe(200);
  expect((await pref.json())[0]?.language, "personas.grants.self-preference-allowed").toBe(flip);
  expect((await rest(maya.jwt, `users?id=eq.${maya.id}`, { method: "PATCH", body: JSON.stringify({ language: maya.language }) })).status).toBe(200);
});

}
