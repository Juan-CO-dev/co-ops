/**
 * Catering delivery D4 — OFF ADDS NOTHING to /reports/sales/catering (review DELIV4-r2).
 *
 * The REAL page is rendered (the real sales loaders over a fake client, the real delivery loader, the real section).
 * With delivery off, its complete markup must be BYTE-IDENTICAL to the baseline: the same page with the delivery
 * section taken out of the tree — and with it any wrapper that existed only to hold it (an empty wrapper left behind is
 * exactly the defect: markup added to the report while delivery is off).
 * With delivery on, the same page gains the section; when the delivery read fails, the four sales blocks are untouched
 * and the section shows its own line.
 */
import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderStatic } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/midshift", () => ({ operationalNow: () => ({ date: "2026-10-11" }) }));
// The shop tabs are an async server component (a locations read); a static render needs a plain one. Not delivery's.
vi.mock("@/components/reports-hub/ReportShopTabs", () => ({ ReportShopTabs: () => React.createElement("nav", { "data-stub": "shop-tabs" }) }));

import CateringPage from "@/app/(authed)/reports/sales/catering/page";
import { DeliveryEconomicsSection } from "@/components/reports-hub/DeliveryEconomicsSection";
import { TranslationProvider } from "@/lib/i18n/provider";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const emptyDaily = { classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [] };
type Lang = "en" | "es";
/** The page's client pieces (the back link, the range controls) read the app's translation provider, as in the app shell. */
let current: Lang = "en";
/* eslint-disable-next-line react/no-children-prop -- the provider requires children in its props type. */
const renderToStaticMarkup = (node: ReactNode) => renderStatic(React.createElement(TranslationProvider, { initialLanguage: current, children: node }));

/** How many delivery sections the tree holds. */
function count(node: ReactNode): number {
  if (Array.isArray(node)) return node.reduce<number>((n, child) => n + count(child), 0);
  if (!React.isValidElement(node)) return 0;
  if (node.type === DeliveryEconomicsSection) return 1;
  return count((node.props as { children?: ReactNode }).children);
}
/**
 * THE BASELINE: the tree without the delivery section. The section is removed, and so is every ancestor left with no
 * child at all once it is gone (a wrapper that existed only for it). Nothing else is touched.
 */
function withoutDelivery(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(withoutDelivery);
  if (!React.isValidElement(node)) return node;
  if (node.type === DeliveryEconomicsSection) return null;
  const children = (node.props as { children?: ReactNode }).children;
  if (children === undefined || count(children) === 0) return node;
  const kept = React.Children.toArray(withoutDelivery(children));
  if (kept.length === 0) return null; // a wrapper that only held the section
  return React.cloneElement(node as ReactElement<{ children?: ReactNode }>, undefined, ...kept);
}

const page = async (language: Lang = "en") => CateringPage({ searchParams: Promise.resolve({ location: A, range: "last7" }) }).then((root) => {
  void language;
  return root;
});
const as = (language: Lang) => {
  current = language;
  return vi.mocked(requireSessionFromHeaders).mockResolvedValue({ user: { id: "viewer", language, active: true }, role: "moo", level: 8, locations: [A] } as never);
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Sales reads answer (empty); every table read fails — so a delivery read that is attempted FAILS, visibly.
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from: () => { throw new Error("no table reads in this test"); },
    rpc: async (fn: string) => ({ data: fn === "sales_report_daily" ? emptyDaily : [], error: null }),
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["en", "es"] as const)("off adds nothing (%s)", (language) => {
  beforeEach(() => as(language));

  it("DELIVERY_TRACKING unset: the complete page render is byte-identical to the page without the delivery section", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const root = await page(language);
    expect(count(root)).toBe(1); // the section IS mounted; it is what renders nothing
    const off = renderToStaticMarkup(root), baseline = renderToStaticMarkup(withoutDelivery(root));
    expect(off).toBe(baseline);
    // And the page is a real one: its four sales blocks are there.
    expect(off.match(/<section /g)).toHaveLength(4);
    expect(off.length).toBeGreaterThan(1_000);
    expect(off).not.toMatch(/mt-3 min-w-0/);
    expect(vi.mocked(getServiceRoleClient).mock.results.length).toBeGreaterThan(0); // the sales reads ran; delivery asked for nothing
  });

  it("the baseline rule would catch a wrapper left behind (the defect this replaces)", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const root = await page(language);
    // The same tree, with the section put back inside a wrapper of the page's own: off now renders an empty <div>.
    const wrap = (node: ReactNode): ReactNode => {
      if (Array.isArray(node)) return node.map(wrap);
      if (!React.isValidElement(node)) return node;
      if (node.type === DeliveryEconomicsSection) return React.createElement("div", { className: "mt-3 min-w-0" }, node);
      const children = (node.props as { children?: ReactNode }).children;
      return children === undefined ? node : React.cloneElement(node as ReactElement<{ children?: ReactNode }>, undefined, ...React.Children.toArray(wrap(children)));
    };
    const defective = wrap(root);
    expect(renderToStaticMarkup(defective)).toContain('<div class="mt-3 min-w-0"></div>');
    expect(renderToStaticMarkup(defective)).not.toBe(renderToStaticMarkup(withoutDelivery(defective)));
  });

  it("the all-shops view: each shop's panel is byte-identical too", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const root = await CateringPage({ searchParams: Promise.resolve({ location: "all", range: "last7" }) });
    if (!React.isValidElement(root)) throw new Error("missing shop panels");
    const panel = await (root.props as { render: (shop: string) => Promise<ReactNode> }).render(A);
    expect(count(panel)).toBe(1);
    expect(renderToStaticMarkup(panel)).toBe(renderToStaticMarkup(withoutDelivery(panel)));
  });

  it("DELIVERY_TRACKING=1 and the delivery read fails: the section's own line is added, and the four sales blocks are exactly the off page's", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const off = renderToStaticMarkup(await page(language));
    vi.stubEnv("DELIVERY_TRACKING", "1");
    const root = await page(language);
    const on = renderToStaticMarkup(root);
    expect(on).not.toBe(off);
    expect(on.match(/<section /g)).toHaveLength(5);
    expect(on).toContain('<div class="mt-3 min-w-0"><section ');
    expect(on).toContain('role="status"');
    expect(on).toContain(language === "en" ? "Couldn&#x27;t load the delivery numbers." : "No se pudieron cargar los números de entrega.");
    // Take the section out again and the page is the off page, byte for byte: nothing else moved.
    expect(renderToStaticMarkup(withoutDelivery(root))).toBe(off);
  });
});
