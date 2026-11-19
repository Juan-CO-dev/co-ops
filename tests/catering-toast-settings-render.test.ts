/**
 * Item 21 PR 5: the settings card renders the truth in en + es (tú): each shop's state, what is installed, what cannot
 * be saved and why (before the press), and the old-orders worklist. Also where it is mounted and who reaches it.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CATERING_TOAST_SETTINGS as OFF, type CateringToastShopCard, type SettingsReadiness } from "@/lib/catering/catering-toast-settings-shared";
import { EMPTY_OLD_ORDERS, type OldOrdersView } from "@/lib/catering/catering-toast-old-orders-shared";

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

describe("orders not matched yet", () => {
  const on = shop({ values: { ...OFF, enabled: true }, updatedAt: "x" });
  const view: OldOrdersView = { state: "ready", orders: 361, ordersMatched: 340, checks: 352, skipped: { blocked: 0, owned: 3, dual_code: 2, out_of_window: 0, two_orders: 4 },
    sample: [{ leadId: "l1", checkGuid: "c1", eventDate: "2026-10-10", valueCents: 45000, businessDate: "2026-10-10", checkTotalCents: 45000, evidence: "toast_origin", amountMismatch: false },
      { leadId: "l2", checkGuid: "c2", eventDate: "2026-10-11", valueCents: null, businessDate: "2026-10-11", checkTotalCents: 30000, evidence: "ring_code", amountMismatch: true }] };

  it("only a shop that is on (with the link step installed) offers it", () => {
    expect(text(render({ shops: [shop()], readiness: READY }))).not.toContain("Orders not matched yet");
    expect(text(render({ shops: [on], readiness: { linkStep: false, automatic: false } }))).not.toContain("Orders not matched yet");
    // Collapsed by default: the header only. Nothing is looked up, and nothing can be linked, before the person asks.
    const html = text(render({ shops: [on], readiness: READY }));
    expect(html).toContain("Orders not matched yet");
    expect(html).not.toContain("Older orders are never linked by themselves.");
    expect(html).not.toContain("Link these");
    // Open, before any search: the explanation and the one button.
    const open = text(render({ shops: [on], readiness: READY, initialOldOrders: { locationId: A, view: EMPTY_OLD_ORDERS("off") } }));
    expect(open).toContain("Older orders are never linked by themselves.");
    expect(open).toContain("Look again");
    expect(open).not.toContain("Link these");
  });

  it("the matches: the counts, a sample, why the rest were left out, and ONE confirm; an unknown amount is said, never $0", () => {
    const html = text(render({ shops: [on], readiness: READY, initialOldOrders: { locationId: A, view } }));
    expect(html).toContain("361 orders are not matched yet. 340 of them have a Toast check we are sure about (352 checks).");
    expect(html).toContain("order $450.00 · Toast check $450.00 on");
    expect(html).toContain("order amount not available · Toast check $300.00 on");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("the amount differs");
    expect(html).toContain("and 350 more");
    expect(html).toContain("3 left out: another order already holds the check.");
    expect(html).toContain("2 left out: the check also carries an ezCater order number.");
    expect(html).toContain("4 left out: two orders point at the same check.");
    expect(html).not.toContain("0 left out");
    expect(html).toContain("Link these 352 checks");
    expect(html).toContain("361 orders");
    const es = text(render({ shops: [on], readiness: READY, initialOldOrders: { locationId: A, view } }, "es"));
    expect(es).toContain("361 pedidos aún no están emparejados. 340 de ellos tienen una cuenta de Toast de la que estamos seguros (352 cuentas).");
    expect(es).toContain("Enlazar estas 352 cuentas");
  });

  it("nothing to confirm = no confirm button", () => {
    const html = text(render({ shops: [on], readiness: READY, initialOldOrders: { locationId: A, view: { ...EMPTY_OLD_ORDERS("ready"), orders: 4 } } }));
    expect(html).toContain("4 orders are not matched yet. 0 of them have a Toast check we are sure about (0 checks).");
    expect(html).not.toContain("Link these");
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
  it("the component never sends the pairs to link: the body is the shop and the skip count", () => {
    const src = readFileSync("components/admin/catering/CateringToastSettings.tsx", "utf8");
    expect(src).toContain('post("/api/admin/catering/toast-settings/old-orders", { locationId: shop.locationId, skip })');
    expect(src).toContain('requestStepUp("B")');
    expect(src).toContain('requestStepUp("A")');
    expect(src).not.toMatch(/useEffect|localStorage|sessionStorage/);
  });
});
