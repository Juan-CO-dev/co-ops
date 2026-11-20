/**
 * Item 21 PR 5: the settings card renders the truth in en + es (tú): each shop's state, what is installed, what cannot
 * be saved and why (before the press), and "match older orders". Also where it is mounted and who reaches it.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CATERING_TOAST_SETTINGS as OFF, type CateringToastShopCard, type SettingsReadiness } from "@/lib/catering/catering-toast-settings-shared";
import { EMPTY_BACKFILL_STATUS, type BackfillRun, type BackfillStatus } from "@/lib/catering/catering-toast-backfill-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { CateringToastSettings } = await import("@/components/admin/catering/CateringToastSettings");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shop = (o: Partial<CateringToastShopCard> = {}): CateringToastShopCard => ({ locationId: A, name: "First Shop", values: OFF, updatedAt: null, ...o });
const READY: SettingsReadiness = { linkStep: true, automatic: true };
const render = (props: Parameters<typeof CateringToastSettings>[0], language: "en" | "es" = "en") => renderToStaticMarkup(
  createElement(TranslationProvider, { initialLanguage: language } as never,
    createElement(StepUpProvider, { unlocked: false, unlockedAt: null } as never, createElement(CateringToastSettings, props)))).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the settings card, en + es", () => {
  it("a shop with no row is Off and says what that means; a shop that is on says what is switched on", () => {
    const html = text(render({ shops: [shop(), shop({ locationId: B, name: "Second Shop", updatedAt: "2026-11-19T12:00:00+00:00",
      values: { ...OFF, enabled: true, ringCodeEnabled: true, autoLinkEnabled: true, originAutoLinkEnabled: true, autoLinkFromDate: "2026-11-19" } })], readiness: READY }));
    expect(html).toContain("First Shop");
    expect(html).toContain("Catering orders are not checked against Toast at this shop.");
    expect(html).toContain("Orders not rung in Toast are listed · each order gets a ring code · links by ring code and by Toast order from");
    const es = text(render({ shops: [shop()], readiness: READY }, "es"));
    expect(es).toContain("En esta tienda los pedidos de catering no se comprueban con Toast.");
    expect(es).toContain("Desactivado");
  });

  it("what is not installed is said once, above the shops", () => {
    expect(text(render({ shops: [shop()], readiness: { linkStep: false, automatic: false } }))).toContain("Linking Toast checks is not installed yet, so a shop cannot be turned on.");
    const partly = text(render({ shops: [shop()], readiness: { linkStep: true, automatic: false } }));
    expect(partly).toContain("Automatic linking and ring codes are not installed yet. You can turn a shop on");
    expect(partly).not.toContain("so a shop cannot be turned on");
    expect(text(render({ shops: [shop()], readiness: READY }))).not.toContain("not installed yet");
  });

  it("the form: five switches, the start date, the tolerance, and Save disabled until something changed", () => {
    const html = render({ shops: [shop()], readiness: READY, initialOpen: A });
    expect(html.match(/role="switch"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(5);
    for (const label of ["Check catering orders against Toast", "Give each order a ring code", "Link by ring code by itself", "Link orders that came from Toast by themselves",
      "List orders that came from Toast when they are not linked", "Link by itself from this event date", "When does an amount count as different?", "Saving asks for your password."]) {
      expect(text(html)).toContain(label);
    }
    expect(html).toContain('aria-label="Check catering orders against Toast at First Shop"');
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toContain('value="50"'); // $50.00
    expect(html).toContain('value="15"'); // 15%
    const es = render({ shops: [shop()], readiness: READY, initialOpen: A }, "es");
    expect(text(es)).toContain("Dar a cada pedido un código para Toast");
    expect(es).toContain('aria-label="Comprobar los pedidos de catering con Toast en First Shop"');
  });

  it("a row that cannot be saved says why before the press (the writer's own rule)", () => {
    const stuck = shop({ updatedAt: "x", values: { ...OFF, enabled: true, autoLinkEnabled: true, autoLinkFromDate: "2026-11-19" } });
    const html = text(render({ shops: [stuck], readiness: { linkStep: true, automatic: false }, initialOpen: A }));
    expect(html).toContain("Automatic linking and ring codes are not installed yet. Turn those switches off to save.");
    expect(text(render({ shops: [stuck], readiness: READY, initialOpen: A }))).not.toContain("Turn those switches off to save.");
  });

  it("every control is 44 px with items-center, and rows wrap on a phone", () => {
    const html = render({ shops: [shop({ values: { ...OFF, enabled: true }, updatedAt: "x" })], readiness: READY, initialOpen: A });
    for (const control of html.match(/<(button|input)[^>]*>/g) ?? []) {
      if (/aria-controls="[^"]*"[^>]*aria-expanded|aria-expanded="[^"]*"[^>]*aria-controls/.test(control) && !/min-h-\[44px\]/.test(control)) continue; // CollapsibleSection's own header (its own pin)
      expect([control.slice(0, 60), /min-h-\[44px\]/.test(control) && /items-center/.test(control)]).toEqual([control.slice(0, 60), true]);
    }
    expect(html).not.toMatch(/whitespace-nowrap|overflow-x-auto|truncate/);
    expect(html).toContain("flex flex-wrap items-center");
  });
});

describe("match older orders", () => {
  const auto = shop({ values: { ...OFF, enabled: true, originAutoLinkEnabled: true, autoLinkFromDate: "2025-10-01" }, updatedAt: "x" });
  const status: BackfillStatus = { state: "ready", startDate: "2025-10-01", unmatched: 361, fromStart: 340, beforeStart: 21 };

  it("offered only where it can run: the shop is on, an automatic switch and its date are saved, and the reconciler is installed", () => {
    expect(text(render({ shops: [shop()], readiness: READY }))).not.toContain("Match older orders");
    expect(text(render({ shops: [shop({ values: { ...OFF, enabled: true }, updatedAt: "x" })], readiness: READY }))).not.toContain("Match older orders");
    expect(text(render({ shops: [auto], readiness: { linkStep: true, automatic: false } }))).not.toContain("Match older orders");
    // Collapsed by default: the header only. Nothing is counted, and nothing can be run, before the person asks.
    const html = text(render({ shops: [auto], readiness: READY }));
    expect(html).toContain("Match older orders");
    expect(html).not.toContain("Automatic linking only looks at the last nine days.");
    expect(html).not.toContain("Match orders from");
  });

  it("open: what it does, the counts split at the start date, and ONE button that names the date", () => {
    const html = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status } }));
    expect(html).toContain("Automatic linking only looks at the last nine days.");
    expect(html).toContain("361 not matched");
    expect(html).toContain("361 booked orders have no Toast check linked. 340 are from");
    expect(html).toContain("and can be matched now. 21 are older and stay as suggestions.");
    expect(html.match(/Match orders from/g)).toHaveLength(1);
    expect(html).toContain("Count again");
    const es = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status } }, "es"));
    expect(es).toContain("361 pedidos confirmados no tienen una cuenta de Toast enlazada. 340 son del");
    expect(es).toContain("Emparejar pedidos desde el");
  });

  it("nothing the backfill may reach = no run button; a shop that lost its switch says why", () => {
    const none = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status: { ...status, fromStart: 0, beforeStart: 361 } } }));
    expect(none).toContain("0 are from");
    expect(none).not.toContain("Match orders from");
    const lost = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status: EMPTY_BACKFILL_STATUS("no_switch") } }));
    expect(lost).toContain("Turn on automatic linking and save a start date first.");
    expect(lost).not.toContain("Match orders from");
  });
});

describe("review PORTAL5-r2: how a run ended is never lost to the count that follows it", () => {
  const auto = shop({ values: { ...OFF, enabled: true, originAutoLinkEnabled: true, autoLinkFromDate: "2025-10-01" }, updatedAt: "x" });
  const status: BackfillStatus = { state: "ready", startDate: "2025-10-01", unmatched: 300, fromStart: 280, beforeStart: 20 };
  const stopped: BackfillRun = { phase: "linked", added: 61, pending: 0, skipped: { owned: 2 }, finished: false, error: "settings_unavailable" };

  it("a run that stopped after linking some says so beside a count that loaded fine: an alert, the number linked, the reason, and a way on", () => {
    const html = render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status, run: stopped } });
    const plain = text(html);
    expect(plain).toContain("The run stopped before it finished. 61 checks were linked before it stopped.");
    expect(plain).toContain("These settings could not be loaded right now. Try again in a minute.");
    expect(html).toMatch(/role="alert"[^>]*>\s*<p>The run stopped before it finished/);
    expect(plain).toContain("Stopped early");
    expect(plain).toContain("300 booked orders have no Toast check linked.");
    expect(plain).toContain("Go on matching orders from");
    // Never the green "Done": the run did not finish.
    expect(plain).not.toContain("Done. 61 checks linked.");
    expect(plain).toContain("2: another order already holds the check.");
    const es = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status, run: stopped } }, "es"));
    expect(es).toContain("El proceso se detuvo antes de terminar. Se enlazaron 61 cuentas antes de detenerse.");
  });

  it("a timeout is named and says nothing is lost; a finished run is the only one that says Done", () => {
    const timed = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status, run: { ...stopped, added: 0, skipped: {}, error: "backfill_timeout" } } }));
    expect(timed).toContain("The run stopped before it finished. 0 checks were linked before it stopped.");
    expect(timed).toContain("That step took too long and was stopped. Nothing is lost");
    const done = text(render({ shops: [auto], readiness: READY, initialBackfill: { locationId: A, status, run: { ...stopped, finished: true, error: null } } }));
    expect(done).toContain("Done. 61 checks linked.");
    expect(done).not.toContain("The run stopped");
    expect(done).not.toContain("Stopped early");
  });

  it("the count's own handler cannot touch the run's outcome (two facts, two states)", () => {
    const src = readFileSync("components/admin/catering/CateringToastSettings.tsx", "utf8");
    const check = src.slice(src.indexOf("  async function check() {"), src.indexOf("  async function start_() {"));
    expect(check).toContain("setStatusError(");
    expect(check).not.toMatch(/setRun\(|setProgress\(/);
    const start = src.slice(src.indexOf("  async function start_() {"), src.indexOf("  const skipped = run ?"));
    expect(start).not.toContain("setStatusError(");
    // The run's outcome is set from the loop's own return value, before the count is refreshed.
    expect(start.indexOf("setRun(await runBackfillLoop(")).toBeLessThan(start.indexOf("await check();"));
  });
});

describe("where it is mounted, and for whom", () => {
  it("the page binds the three roles and renders the card only when the settings are installed", () => {
    const page = readFileSync("app/admin/catering/toast/page.tsx", "utf8");
    expect(page).toContain('if (!canManageCateringToastSettings(auth.role)) redirect("/admin/catering");');
    expect(page.indexOf("canManageCateringToastSettings(auth.role)")).toBeLessThan(page.indexOf("loadCateringToastSettings(auth)"));
    expect(page).toContain('view.state === "not_installed"');
    const hub = readFileSync("app/admin/catering/page.tsx", "utf8");
    expect(hub).toContain('{canManageCateringToastSettings(auth.user.role) && <Link href="/admin/catering/toast"');
  });
  it("the component decides nothing about the older orders: it posts the shop and the date cursor the server handed back", () => {
    const src = readFileSync("components/admin/catering/CateringToastSettings.tsx", "utf8");
    expect(src).toContain('post("/api/admin/catering/toast-settings/backfill", { locationId: shop.locationId, cursor })');
    // The loop itself is the shared, pure one (tests/catering-toast-settings-shared.test.ts runs it).
    expect(src).toContain("setRun(await runBackfillLoop(async (cursor) => {");
    expect(src).toContain('requestStepUp("B")');
    expect(src).toContain('requestStepUp("A")');
    expect(src).not.toMatch(/useEffect|localStorage|sessionStorage|orderGuid|checkGuid|leadId/);
  });
});
