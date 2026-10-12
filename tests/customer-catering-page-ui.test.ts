import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import CateringAccountsPage from "@/app/admin/customers/catering/page";
import { parseCateringParams } from "@/lib/customers/catering-accounts-shared";
import type { CustomerListSearchParams } from "@/lib/customers/list-params-shared";

const state = vi.hoisted(() => ({ level: 7, language: "en" as "en" | "es", enabled: true, empty: false }));
const shop = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: state.level, locations: [shop], user: { id: "viewer", language: state.language } }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/customers/customers", () => ({
  CUSTOMER_STATS_MIN: 7, CUSTOMER_ALL_SHOPS_MIN: 8,
  customerProfilesEnabled: () => state.enabled,
  loadCustomerShops: async () => [{ id: shop, name: "Fixture Shop" }],
  loadCateringAccounts: async (_viewer: unknown, raw: CustomerListSearchParams) => ({
    today: "2026-10-12", params: parseCateringParams(raw, state.level), total: state.empty ? 0 : 120, pages: state.empty ? 1 : 3,
    summary: { accounts: 120, repeat: 20, quiet: 3, spendCents: null },
    rows: state.empty ? [] : [{ id: "account", name: "Fixture Account", orders: 3, spendCents: null, avgOrderCents: null,
      firstOrder: "2026-01-01", lastOrder: "2026-07-01", sources: ["toast", "catering", "ezcater"], shops: [shop], allVisits: 6, quiet: true }],
  }),
}));

beforeEach(() => { state.level = 7; state.language = "en"; state.enabled = true; state.empty = false; });
async function render(raw: CustomerListSearchParams = { page: "2" }) {
  return renderToStaticMarkup(await CateringAccountsPage({ searchParams: Promise.resolve(raw) }));
}

it.each([7, 8, 9])("gates the shop selector at level %s", async (level) => {
  state.level = level;
  const html = await render({ location: shop });
  expect(html.includes('name="location"')).toBe(level >= 8);
  expect(html).toContain("Catering accounts");
});

it("renders named accounts, shops, all three sources and unknown money", async () => {
  const html = await render();
  expect(html).toContain('href="/admin/customers/account"');
  expect(html).toContain("Fixture Account"); expect(html).toContain("Fixture Shop");
  expect(html).toContain("Toast"); expect(html).toContain("Catering desk"); expect(html).toContain("ezCater");
  expect(html).toContain('aria-label="Unknown"'); expect(html).not.toContain("$0.00");
  expect(html).toContain("103 day(s) ago");
  expect(html).toContain("All visits"); expect(html).toContain("Repeat accounts: 20");
});

it("retains quiet, location and sort on both pagination links", async () => {
  state.level = 8;
  const html = await render({ page: "2", quiet: "1", location: shop, sort: "orders" });
  const pages = [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1]!.replaceAll("&amp;", "&"), "http://localhost"))
    .filter((url) => url.searchParams.has("page"));
  expect(pages).toHaveLength(2);
  expect(pages.map((url) => url.searchParams.get("page"))).toEqual(["1", "3"]);
  for (const url of pages) expect(Object.fromEntries(url.searchParams)).toMatchObject({ quiet: "1", location: shop, sort: "orders" });
});

it("uses wrapping phone cards and a desktop-only fixed table", async () => {
  const html = await render();
  expect(html).toContain('class="hidden lg:block"'); expect(html).toContain("table-fixed");
  expect(html).toContain('class="space-y-3 lg:hidden"'); expect(html).toContain("co-card min-w-0");
  expect(html).toContain("[overflow-wrap:anywhere]"); expect(html).toContain("grid min-w-0 grid-cols-2");
  expect(html).not.toContain("overflow-x-auto");
});

it("renders Spanish and the empty state", async () => {
  state.language = "es";
  const html = await render();
  expect(html).toContain("Cuentas de catering"); expect(html).toContain("Todas las visitas");
  expect(html).not.toContain("customers.catering.");
  state.empty = true;
  expect(await render()).toContain("Ninguna cuenta de catering coincide con estos filtros.");
});

it("redirects below level 7 and when the feature is disabled", async () => {
  state.level = 6; await expect(render()).rejects.toThrow("redirect:/admin");
  state.level = 7; state.enabled = false;
  await expect(render()).rejects.toThrow("redirect:/admin/customers");
});
