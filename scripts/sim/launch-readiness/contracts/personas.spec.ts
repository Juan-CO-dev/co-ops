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
}
