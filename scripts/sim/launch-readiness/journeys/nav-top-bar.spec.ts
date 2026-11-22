/**
 * Nav PR 9: the signed-in top bar journey (plan r2 8.3 P1-P4; lead rulings r1 "Testing gate", r2 "Carried forward").
 *
 * A PRE-MERGE GATE run by CC (headless) on the reviewed build, `cold-empty`, production mode, 375 px only
 * (projects `phone375-en` / `phone375-es`). Existing personas only (marcus GM both shops, rosa KH es EM, angel KH en MEP);
 * the SMM and MoO personas are a sim write that needs Juan's word (Q7), so the SMM is proven in CI by unit serialization
 * only (tests/nav-top-bar-payload.test.ts), never here. Nothing in this file is CI evidence.
 *
 * P1 the row's set: open / Tab / Escape / Ctrl+K / backdrop / scroll on five page families, "All pages" = the same sheet.
 * P2 stacking and arbitration: the sheet above page bars; the PIN dialog refuses Ctrl+K and keeps its digits; the idle
 *    warning (forced with the page clock, no env change) suspends the sheet and "Stay signed in" brings it back.
 * P3 step-up (production build, cold router cache): the bar's background requests keep a Tier A unlock inside admin;
 *    leaving admin clears it. R4: does BackLink's prefetch of /dashboard clear it on the hub? RECORDED, not judged here.
 * P4 search: an old name finds the page; a forbidden page is absent; people only after two characters and the debounce.
 *
 * The Tier A state is read with a NO-WRITE probe: POST /api/admin/catalog/menu-item/<nil uuid>/toast with an invalid body.
 * That route checks the session (an admin path, which keeps the flag), the role, then `assertStepUp(ctx, "A")` BEFORE it
 * reads the body: locked = 403 `step_up_required`; unlocked = the body's 400. Nothing is written either way.
 * The unlock is the same POST /api/auth/step-up the password prompt sends; the password comes from the parent-only control
 * SIM_NAV_PASSWORD_MARCUS (never in .env.sim, never in the app or contender environment), and tracing is paused around it.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, login } from "../playwright.config";
import { SIM_LOCATIONS, personaByEmail, type LocationCode, type SimPersona } from "../../personas-shared";
import { SIM_APP_ORIGIN } from "../../../../lib/sim-isolation-shared";
import en from "../../../../lib/i18n/en.json";
import es from "../../../../lib/i18n/es.json";

type Language = "en" | "es";
type Key = keyof typeof en;
const text = (lang: Language, key: Key, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (lang === "es" ? es : en)[key]);
const shopUrl = (path: string, code: LocationCode) => `${path}?location=${SIM_LOCATIONS[code].id}`;
const NIL = "00000000-0000-4000-8000-000000000000";
const TIER_A_PROBE = `/api/admin/catalog/menu-item/${NIL}/toast`;

const sheet = (page: Page) => page.locator("[data-co-nav-sheet]");
const goToButton = (page: Page) => page.locator("[data-co-goto-button]");
const search = (page: Page) => page.locator("[data-co-goto-search]");
const marker = (contract: { assertionIds: string[] }) => (id: string) => { if (!contract.assertionIds.includes(id)) contract.assertionIds.push(id); };

async function openByButton(page: Page) {
  await goToButton(page).click();
  await expect(sheet(page), "nav.p1.open").toBeVisible();
  await expect(search(page), "nav.p1.search-focused").toBeFocused();
}
/** Open Go to unless it is already open (a language change refreshes the page under an open sheet). */
async function ensureOpen(page: Page) {
  if (await sheet(page).isVisible()) return;
  await openByButton(page);
}
async function focusInsideSheet(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = document.querySelector("[data-co-nav-sheet]");
    return !!s && !!document.activeElement && s.contains(document.activeElement);
  });
}

/** P1 on one page: button, Tab trap, Escape + focus return, Ctrl+K, backdrop, scroll unchanged. */
async function p1On(page: Page, lang: Language) {
  await expect(goToButton(page), "nav.p1.labels").toHaveAttribute("aria-label", text(lang, "nav.goto.open_aria"));
  await expect(page.locator("[data-co-top-bar]"), "nav.p1.labels").toHaveAttribute("aria-label", text(lang, "nav.topbar.aria"));
  await page.evaluate(() => window.scrollTo(0, 120));
  const before = await page.evaluate(() => window.scrollY);
  await openByButton(page);
  await expect(search(page), "nav.p1.labels").toHaveAttribute("placeholder", text(lang, "nav.goto.search_placeholder"));
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
    expect(await focusInsideSheet(page), "nav.p1.tab-trap").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet(page), "nav.p1.escape").toHaveCount(0);
  await expect(goToButton(page), "nav.p1.focus-return").toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(sheet(page), "nav.p1.ctrl-k").toBeVisible();
  await page.keyboard.press("Escape");
  // The backdrop exists only beside the drawer (from 640 px); at 375 px the sheet is full height by design (spec 4.2).
  const phone = page.viewportSize()!;
  await page.setViewportSize({ width: 800, height: phone.height });
  await goToButton(page).click();
  await page.locator("[data-co-nav-backdrop]").click({ position: { x: 20, y: 200 } });
  await expect(sheet(page), "nav.p1.backdrop").toHaveCount(0);
  await page.setViewportSize(phone);
  expect(await page.evaluate(() => window.scrollY), "nav.p1.scroll").toBe(before);
}

/** The Tier A state through the no-write probe. */
async function tierA(context: BrowserContext): Promise<"locked" | "unlocked"> {
  const res = await context.request.post(TIER_A_PROBE, {
    headers: { origin: SIM_APP_ORIGIN, "content-type": "text/plain" },
    data: "not json",
    failOnStatusCode: false,
  });
  const body = await res.json().catch(() => ({})) as { code?: string };
  if (res.status() === 403 && body.code === "step_up_required") return "locked";
  expect([400, 404, 422].includes(res.status()), `nav.p3.probe: unexpected ${res.status()} ${body.code ?? ""}`).toBe(true);
  return "unlocked";
}
async function unlock(context: BrowserContext) {
  const password = process.env.SIM_NAV_PASSWORD_MARCUS;
  if (!password) throw new Error("SIM_NAV_PASSWORD_MARCUS required (parent-only control): P3 / R4 cannot run without it");
  try { await context.tracing.stop(); } catch { /* not recording */ }
  try {
    const res = await context.request.post("/api/auth/step-up", {
      headers: { origin: SIM_APP_ORIGIN, "content-type": "application/json" },
      data: { password, catalogWindow: true },
      failOnStatusCode: false,
    });
    if (!res.ok()) throw new Error("step-up refused");
  } finally {
    try { await context.tracing.start({ screenshots: true, snapshots: true, sources: false }); } catch { /* already recording */ }
  }
}

const PERSONAS: Record<Language, Array<{ alias: string; code: LocationCode; teammate: string }>> = {
  en: [{ alias: "marcus", code: "EM", teammate: "Maya" }, { alias: "angel", code: "MEP", teammate: "Luis" }],
  es: [{ alias: "rosa", code: "EM", teammate: "Maya" }],
};
const langOf = () => (test.info().project.metadata as { locale?: Language }).locale ?? "en";

test.describe("nav top bar", () => {
  test("P1: open, Tab, Escape, Ctrl+K and backdrop on five page families; All pages is the same sheet", async ({ page, contract }) => {
    const mark = marker(contract);
    for (const id of ["nav.p1.open", "nav.p1.search-focused", "nav.p1.tab-trap", "nav.p1.escape", "nav.p1.focus-return", "nav.p1.ctrl-k",
      "nav.p1.backdrop", "nav.p1.scroll", "nav.p1.labels", "nav.p1.all-pages"]) mark(id);
    expect(process.env.LRA_FIXTURE).toBe("cold-empty");
    for (const { alias, code } of PERSONAS[langOf()]) {
      const persona: SimPersona = personaByEmail(`${alias}@sim.co-ops`);
      const lang = persona.language;
      await page.context().clearCookies();
      await login(page, persona, code);
      // The Dashboard: the bar, and "All pages" opens THE SAME sheet.
      await page.goto(shopUrl("/dashboard", code));
      await p1On(page, lang);
      await page.locator("[data-dashboard-all-pages]").click();
      await expect(sheet(page), "nav.p1.all-pages").toHaveCount(1);
      await expect(search(page), "nav.p1.all-pages").toBeFocused();
      await page.keyboard.press("Escape");
      await contract.screenshot(`p1-dashboard-${alias}`);
      for (const path of ["/operations/closing", "/ordering", "/reports", ...(persona.role === "gm" ? ["/admin/skus"] : [])]) {
        await page.goto(path === "/reports" || path === "/admin/skus" ? path : shopUrl(path, code));
        await p1On(page, lang);
        await contract.screenshot(`p1-${path.replaceAll("/", "_")}-${alias}`);
      }
    }
  });

  test("P2: stacking above page bars; the PIN dialog and the idle warning win", async ({ page, contract }) => {
    const mark = marker(contract);
    for (const id of ["nav.p2.above-bars", "nav.p2.pin-refuses", "nav.p2.pin-digits", "nav.p2.idle-suspends", "nav.p2.idle-resumes"]) mark(id);
    const { alias, code } = PERSONAS[langOf()].find((p) => p.alias !== "marcus") ?? PERSONAS[langOf()][0]!;
    const persona = personaByEmail(`${alias}@sim.co-ops`), lang = persona.language;
    // The page clock lets the idle warning show without a short idle limit in the sim env.
    await page.clock.install();
    await login(page, persona, code);
    for (const path of ["/operations/closing", "/ordering"]) {
      await page.goto(shopUrl(path, code));
      await page.keyboard.press("Control+k");
      await expect(sheet(page)).toBeVisible();
      const box = (await sheet(page).locator(":scope > div").last().boundingBox())!;
      for (const [x, y] of [[box.x + 2, box.y + 2], [box.x + box.width - 2, box.y + 2], [box.x + 2, box.y + box.height - 2], [box.x + box.width - 2, box.y + box.height - 2]] as const) {
        const inside = await page.evaluate(([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return !!el && !!el.closest("[data-co-nav-sheet]");
        }, [x, y] as const);
        expect(inside, `nav.p2.above-bars ${path} (${Math.round(x)},${Math.round(y)})`).toBe(true);
      }
      await page.keyboard.press("Escape");
    }
    // The closing checklist's PIN dialog: reasons for every incomplete required line, then Continue.
    await page.goto(shopUrl("/operations/closing", code));
    await page.getByRole("button", { name: text(lang, "closing.review.button_incomplete"), exact: true })
      .or(page.getByRole("button", { name: text(lang, "closing.review.button_complete"), exact: true })).first().click();
    for (const box of await page.getByPlaceholder(text(lang, "closing.review.reason_placeholder")).all()) await box.fill("sim nav journey");
    await page.getByRole("button", { name: text(lang, "closing.review.continue"), exact: true }).click();
    const pinDialog = page.locator('[aria-labelledby="pin-confirm-title"]');
    await expect(pinDialog).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(sheet(page), "nav.p2.pin-refuses").toHaveCount(0);
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await expect(pinDialog.getByLabel(text(lang, "auth.pin_modal.pin_entry_aria", { entered: 2, total: 4 }), { exact: true }), "nav.p2.pin-digits").toBeVisible();
    await page.keyboard.press("Escape"); // cancels the PIN dialog: nothing is confirmed
    await expect(pinDialog).toHaveCount(0);
    // The idle warning over an open sheet: the sheet suspends; "Stay signed in" brings it back.
    await page.keyboard.press("Control+k");
    await expect(sheet(page)).toBeVisible();
    // The sim's idle limit is the server's; step the page clock 10 s at a time until the warning shows (never past it).
    const stay = page.getByRole("button", { name: text(lang, "auth.idle.stay"), exact: true });
    for (let i = 0; i < 6 * 60 && !(await stay.isVisible()); i++) await page.clock.fastForward(10_000);
    await expect(stay, "nav.p2.idle-suspends").toBeVisible();
    await expect(sheet(page), "nav.p2.idle-suspends").toBeHidden();
    const vp = page.viewportSize()!;
    const centre = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[aria-labelledby="idle-warning-title"]') !== null, [vp.width / 2, vp.height / 2] as const);
    expect(centre, "nav.p2.idle-suspends: the warning is on top").toBe(true);
    await expect(stay, "nav.p2.idle-suspends: focused").toBeFocused();
    await stay.click();
    await expect(sheet(page), "nav.p2.idle-resumes").toBeVisible();
    await expect(search(page), "nav.p2.idle-resumes").toBeFocused();
  });

  test("P3: step-up survives inside admin and clears on leaving; R4 recorded", async ({ page, browser, contract }) => {
    test.skip(langOf() !== "en", "P3 runs once, as marcus (en)");
    const mark = marker(contract);
    for (const id of ["nav.p3.probe", "nav.p3.kept-inside-admin", "nav.p3.cleared-on-leaving", "nav.r4.recorded"]) mark(id);
    const marcus = personaByEmail("marcus@sim.co-ops");
    await login(page, marcus, "EM");
    await page.goto("/admin/skus");
    expect(await tierA(page.context()), "nav.p3.probe: locked before the password").toBe("locked");
    await unlock(page.context());
    expect(await tierA(page.context()), "nav.p3.probe: unlocked after it").toBe("unlocked");
    // The bar's background requests, all on an admin page.
    await openByButton(page);
    const people = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/nav/people");
    await search(page).fill("Ma");
    expect((await people).status(), "nav.p3.kept-inside-admin: people searched").toBe(200);
    await page.keyboard.press("Escape");
    const bell = page.locator("[data-co-bell]");
    if (await bell.count()) {
      await bell.click();
      const markAll = page.getByRole("button", { name: text("en", "notifications.sheet.mark_all_read_aria"), exact: true });
      if (await markAll.count()) await markAll.click();
      await page.keyboard.press("Escape");
    }
    await openByButton(page);
    const lang1 = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/users/me/language");
    await page.getByRole("radio", { name: text("en", "user_menu.language.aria_select", { language: text("en", "user_menu.language.es") }) }).click();
    expect((await lang1).ok()).toBe(true);
    await ensureOpen(page);
    const lang2 = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/users/me/language");
    await page.getByRole("radio", { name: text("es", "user_menu.language.aria_select", { language: text("es", "user_menu.language.en") }) }).click();
    expect((await lang2).ok()).toBe(true);
    await ensureOpen(page);
    await page.locator('[data-co-goto-entry="vendors"]').click();
    await page.waitForURL((u) => u.pathname === "/admin/vendors");
    expect(await tierA(page.context()), "nav.p3.kept-inside-admin").toBe("unlocked");
    // Leaving admin: the bar's Dashboard link renders a non-admin page, which clears the unlock.
    await page.locator("[data-co-dashboard-link]").click();
    await page.waitForURL((u) => u.pathname === "/dashboard");
    await openByButton(page);
    await page.locator('[data-co-goto-entry="skus"]').click();
    await page.waitForURL((u) => u.pathname === "/admin/skus");
    expect(await tierA(page.context()), "nav.p3.cleared-on-leaving").toBe("locked");

    // R4 (plan 6.4): a FRESH context (cold router cache) on the production build. Unlock, soft-navigate to the hub
    // (/admin, whose registry BackLink points at /dashboard), keep it in view 3 s, record any /dashboard prefetch, probe.
    const fresh = await browser.newContext({ viewport: page.viewportSize()!, locale: "en-US" });
    const r4 = await fresh.newPage();
    await contract.trackPage(r4);
    await login(r4, marcus, "EM");
    await r4.goto("/admin/skus");
    await unlock(fresh);
    const dashboardRequests: string[] = [];
    r4.on("request", (req) => {
      const u = new URL(req.url());
      if (u.pathname === "/dashboard") dashboardRequests.push(`${req.method()} ${u.pathname}${u.search} rsc=${req.headers()["rsc"] ?? ""} prefetch=${req.headers()["next-router-prefetch"] ?? ""}`);
    });
    await r4.locator('a[href="/admin"]').first().click(); // the admin page's BackLink to the hub: a soft navigation
    await r4.waitForURL((u) => u.pathname === "/admin");
    await expect(r4.locator('a[href="/dashboard"]').first()).toBeInViewport();
    await r4.waitForTimeout(3_000);
    const state = await tierA(fresh);
    test.info().annotations.push({ type: "nav.r4", description: JSON.stringify({ buildId: contract.manifest.buildId ?? null, dashboardRequests, tierAAfterHub: state }) });
    await fresh.close();
  });

  test("P4: search finds old names, never a forbidden page, and people only after two characters", async ({ page, contract }) => {
    const mark = marker(contract);
    for (const id of ["nav.p4.old-name", "nav.p4.forbidden-absent", "nav.p4.people-debounced"]) mark(id);
    for (const { alias, code, teammate } of PERSONAS[langOf()].filter((p) => p.alias !== "marcus")) {
      const persona = personaByEmail(`${alias}@sim.co-ops`);
      await page.context().clearCookies();
      await login(page, persona, code);
      await page.goto(shopUrl("/dashboard", code));
      await openByButton(page);
      await search(page).fill("inventory audit");
      await expect(page.locator('[data-co-goto-results] [data-co-goto-entry="counts"]'), "nav.p4.old-name").toBeVisible();
      await search(page).fill("user management");
      await expect(page.locator('[data-co-goto-entry="users"]'), "nav.p4.forbidden-absent").toHaveCount(0);
      const peopleRequests: number[] = [];
      page.on("request", (req) => { if (new URL(req.url()).pathname === "/api/nav/people") peopleRequests.push(Date.now()); });
      await search(page).fill("");
      await search(page).pressSequentially(teammate.slice(0, 1));
      await page.waitForTimeout(600);
      expect(peopleRequests, "nav.p4.people-debounced: none for one character").toEqual([]);
      const typed = Date.now();
      await search(page).pressSequentially(teammate.slice(1, 2));
      await expect(page.locator("[data-co-people]").getByText(new RegExp(teammate)), "nav.p4.people-debounced").toBeVisible();
      expect(peopleRequests.length, "nav.p4.people-debounced: one request").toBe(1);
      expect(peopleRequests[0]! - typed, "nav.p4.people-debounced: after the 250 ms quiet").toBeGreaterThanOrEqual(240);
      await page.keyboard.press("Escape");
    }
  });
});
