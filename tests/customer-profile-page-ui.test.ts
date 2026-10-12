import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import CustomerProfilePage from "@/app/admin/customers/[id]/page";

const state = vi.hoisted(() => ({ level: 7, language: "en" as "en" | "es", expanded: false, enabled: true, load: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: state.level, locations: ["shop-a"], user: { id: "viewer", language: state.language } }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/customers/customers", () => ({ CUSTOMER_STATS_MIN: 7, CUSTOMER_CONTACT_MIN: 9, CustomerError: class extends Error {},
  customerProfilesEnabled: () => state.enabled, loadProfileDetail: (...args: unknown[]) => state.load(...args) }));
vi.mock("@/components/admin/customers/CustomerContactPanel", () => ({ CustomerContactPanel: ({ customerId }: { customerId: string }) =>
  createElement("div", { "data-contact-panel": customerId }, "Contact panel marker") }));
vi.mock("@/components/admin/customers/RevokeLinkButton", () => ({ RevokeLinkButton: () => createElement("button", {}, "Revoke marker") }));
vi.mock("@/components/ui/CollapsibleSection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/CollapsibleSection")>();
  return { CollapsibleSection: (props: Parameters<typeof actual.CollapsibleSection>[0]) =>
    createElement(actual.CollapsibleSection, { ...props, defaultOpen: state.expanded }) };
});

const fixture = () => ({ profile: { id: "customer", name: "Fixture".repeat(40), visits: 2, spendCents: null, firstOrder: "2026-09-01",
  lastOrder: "2026-10-01", avgDaysBetween: 30, cards: 1, emailMarketing: "unknown", maskedChannels: ["DoorDash"],
  favourites: [{ name: "Sandwich", qty: 2 }], channels: [{ channel: "third_party", visits: 2 }] },
  isGuest: true, today: "2026-10-01",
  months: Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7), visits: 1, spendCents: null })),
  shops: [{ locationId: "shop-a", visits: 1, spendCents: null, lastOrder: "2026-10-01" }, { locationId: "shop-b", visits: 1, spendCents: null, lastOrder: "2026-09-01" }],
  shopNames: [{ id: "shop-a", name: "Fixture North Shop" }, { id: "shop-b", name: "Fixture South Shop" }],
  catering: { orders: 1, spendCents: null, lastOrder: "2026-09-01" },
  history: { rows: [{ date: "2026-10-01", locationId: "shop-a", channel: "catering", source: "ezcater", totalCents: null,
    items: [{ name: "HistoryItem".repeat(40), qty: 2 }], moreItems: 3 }], total: 51, page: 2, pages: 3 },
  links: { outgoing: [{ id: "link-out", confidence: 0.8, reasons: ["same_shop"], person: null }],
    incoming: [{ id: "link-in", confidence: 0.9, reasons: ["same_shop"], person: { id: "guest", name: "Hidden guest fixture" },
      stats: { visits: 1, spendCents: null, firstOrder: "2026-09-01", lastOrder: "2026-09-01" } }] } });

beforeEach(() => {
  state.level = 7; state.language = "en"; state.expanded = false; state.enabled = true;
  state.load.mockReset().mockResolvedValue(fixture());
});
afterEach(() => { vi.useRealTimers(); });
async function render(page = "2") {
  const element = await CustomerProfilePage({ params: Promise.resolve({ id: "customer" }), searchParams: Promise.resolve({ page }) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: state.language, children: element }));
}

it("renders unknown money, masked guest identity, named shops and twelve accessible month bars", async () => {
  const html = await render();
  expect(html).toContain("Marketplace guest"); expect(html).toContain("DoorDash"); expect(html).toContain("Fixture".repeat(40));
  expect(html).toContain("Fixture North Shop"); expect(html).toContain("Fixture South Shop");
  expect(html).toContain('aria-label="Unknown"'); expect(html).not.toContain("$0.00");
  const bars = [...html.matchAll(/role="img" aria-label="([^"]+)"/g)];
  expect(bars).toHaveLength(12);
  expect(bars.every((bar) => bar[1]!.includes("Unknown"))).toBe(true);
  expect(html).toContain('href="/admin/customers/catering"');
  expect(html).not.toMatch(/mailto:|tel:|fixture@example|1202555/);
});

it("keeps links and order history collapsed by default with path-preserving pagination", async () => {
  const html = await render();
  for (const id of ["customer-probable", "customer-guests", "customer-history"]) expect(html).toContain(`aria-expanded="false" aria-controls="${id}"`);
  expect(html).not.toContain("Hidden guest fixture"); expect(html).not.toContain("HistoryItem");
  expect(html).toContain('href="/admin/customers/customer?page=1"'); expect(html).toContain('href="/admin/customers/customer?page=3"');
  expect(state.load).toHaveBeenCalledWith({ userId: "viewer", level: 7, locations: ["shop-a"] }, "customer", { page: 2 });
});

it("counts a merged guest once while preserving each advisory link's revoke control", async () => {
  state.level = 9; state.expanded = true;
  const detail = fixture();
  detail.links.outgoing = [];
  detail.links.incoming.push({ ...detail.links.incoming[0]!, id: "second-link" });
  state.load.mockResolvedValue(detail);
  const html = await render();
  expect(html).toContain("Probably also orders on DoorDash (1)");
  expect(html.match(/Revoke marker/g)).toHaveLength(2);
});

it.each([7, 8, 9])("shows reveal and revoke controls only at level nine (viewer %s)", async (level) => {
  state.level = level; state.expanded = true;
  const html = await render();
  expect(html.includes('data-contact-panel="customer"')).toBe(level >= 9);
  expect(html.includes("Revoke marker")).toBe(level >= 9);
  expect(html).toContain('href="/admin/customers/guest"');
  expect(html).toContain("A customer at another shop");
  expect(html).toContain("lg:hidden"); expect(html).toContain("table-fixed");
  expect(html).toContain("[overflow-wrap:anywhere]"); expect(html).toContain("min-w-0");
  expect(html).toContain("HistoryItem".repeat(40));
  expect(html).not.toContain("$0.00");
});

it("uses the loader's ET date for recency instead of the render clock's UTC date", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));
  expect(await render()).toContain("0 day(s) ago");
});

it("renders Spanish without unresolved translation keys", async () => {
  state.language = "es"; state.expanded = true;
  const html = await render();
  expect(html).toMatch(/visitas/i); expect(html).not.toMatch(/customers\.(profile|history|catering|link)\./);
  expect(html).not.toContain("Visits by month");
});

it("gates lower levels and disabled profiles before loading, and normalizes malformed pages", async () => {
  state.level = 6; await expect(render()).rejects.toThrow("redirect:/admin"); expect(state.load).not.toHaveBeenCalled();
  state.level = 7; state.enabled = false; await expect(render()).rejects.toThrow("redirect:/admin/customers"); expect(state.load).not.toHaveBeenCalled();
  state.enabled = true; await render("1bad"); expect(state.load).toHaveBeenLastCalledWith(expect.anything(), "customer", { page: 1 });
});
