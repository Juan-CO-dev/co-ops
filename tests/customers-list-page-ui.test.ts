import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { parseListParams, type CustomerListSearchParams } from "@/lib/customers/list-params-shared";
import CustomersPage from "@/app/admin/customers/page";

const state = vi.hoisted(() => ({ level: 7, language: "en" as "en" | "es", enabled: true }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: state.level, locations: ["shop"], user: { id: "viewer", language: state.language } }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
vi.mock("@/lib/customers/customers", () => ({
  CUSTOMER_CONTACT_MIN: 9, CUSTOMER_STATS_MIN: 7,
  customerProfilesEnabled: () => state.enabled,
  loadCustomerList: async (_viewer: unknown, raw: CustomerListSearchParams) => ({
    profiles: [{ id: "customer", name: "Fixture Guest", isGuest: true, visits: 6, spendCents: null, avgOrderCents: null, lastOrder: "2026-10-01", cards: 2, cateringOrders: 1, shops: ["shop"] }],
    total: 120, page: 2, pageSize: 50, params: parseListParams(raw, state.level),
  }),
  loadCustomerSummary: async () => ({ people: 100, reachable: 80, regulars: 10, lapsed: 4, bothShops: 3, catering: 8, guests: 20, guestsLinked: 2 }),
  loadCustomerShops: async () => [{ id: "shop", name: "Fixture Shop" }],
  loadSuggestions: async () => [{ id: "suggestion", confidence: 0.8, reasons: ["same_shop"], a: { id: "a", name: "Hidden Suggestion" }, b: { id: "b", name: "Other Suggestion" } }],
}));

beforeEach(() => { state.level = 7; state.language = "en"; state.enabled = true; });
afterEach(() => { vi.useRealTimers(); });
async function render(raw: CustomerListSearchParams = { sort: "spend", min_visits: "5", guests: "1", q: "Fixture", page: "2" }) {
  const page = await CustomersPage({ searchParams: Promise.resolve(raw) });
  // TranslationProvider requires children in its props type (same server-render pattern as the UI spine).
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: state.language, children: page }));
}

it("renders stats with unknown spend, named shops, and collapsed suggestions", async () => {
  const html = await render();
  expect(html).toContain("Fixture Shop"); expect(html).toContain("Marketplace guest");
  expect(html).toContain('aria-label="Unknown"'); expect(html).not.toContain("$0.00");
  expect(html).toContain("Likely same person (1)"); expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("Hidden Suggestion"); expect(html).toContain("lg:hidden"); expect(html).toContain("table-fixed");
});

it.each([7, 8, 9])("gates shop/contact controls and summary at level %s", async (level) => {
  state.level = level; const html = await render();
  expect(html.includes('name="location"')).toBe(level >= 8);
  expect(html.includes('name="reachable"')).toBe(level >= 9);
  expect(html.includes('name="opted_in"')).toBe(level >= 9);
  expect(html.includes("Reachable: 80")).toBe(level >= 9);
});

it("preserves all applied filters in pagination and resets other filters on summary chips", async () => {
  const html = await render();
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
  const next = hrefs.map((h) => new URL(h, "http://localhost")).find((u) => u.searchParams.get("page") === "3")!;
  expect(Object.fromEntries(next.searchParams)).toMatchObject({ sort: "spend", min_visits: "5", guests: "1", q: "Fixture" });
  expect(hrefs).toContain("/admin/customers?segment=regulars");
});

it("renders Spanish labels and prevents lower-level access", async () => {
  state.language = "es"; expect(await render()).toContain("Visitas mínimas");
  state.level = 6; await expect(render()).rejects.toThrow("redirect:/admin");
});

it("keeps the feature-disabled state free of list controls", async () => {
  state.enabled = false; expect(await render()).not.toContain('name="sort"');
});

it("measures days since last order on the Eastern calendar near UTC midnight", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));
  expect(await render()).toContain("0 day(s) ago");
});

it("displays the URL spend threshold as dollars", async () => {
  expect(await render({ min_spend_cents: "12345" })).toContain('value="123.45"');
});
