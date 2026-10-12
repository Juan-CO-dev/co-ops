import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/midshift", () => ({ operationalNow: () => ({ date: "2026-10-11" }) }));

import SalesPage from "@/app/(authed)/reports/sales/page";
import ChecksPage from "@/app/(authed)/reports/sales/checks/page";
import CateringPage from "@/app/(authed)/reports/sales/catering/page";
import DetailPage from "@/app/(authed)/reports/sales/checks/[checkGuid]/page";
import { SalesUnavailable } from "@/components/reports-hub/SalesParts";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const emptyDaily = { classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [] };
const pages = [SalesPage, ChecksPage, CateringPage];

function unavailable(node: ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(unavailable);
  if (!React.isValidElement(node)) return [];
  if (node.type === SalesUnavailable) return [node];
  return unavailable((node.props as { children?: ReactNode }).children);
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from: () => { throw new Error("optional coverage not available in test"); },
    rpc: async (fn: string, args: { p_location_id: string }) => args.p_location_id === A
      ? { data: null, error: { code: "57014", message: "private RPC payload" } }
      : { data: fn === "sales_report_daily" ? emptyDaily : [], error: null },
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(["en", "es"] as const)("Sales unavailable pages (%s)", (language) => {
  const dictionary = language === "en" ? en : es;
  const expected = dictionary["reports.sales.read_timeout"];
  beforeEach(() => {
    vi.mocked(requireSessionFromHeaders).mockResolvedValue({ user: { id: "viewer", language }, level: 8, locations: [A] } as never);
  });
  it.each(pages)("renders the translated panel from the real loader on %s", async (page) => {
    const panels = unavailable(await page({ searchParams: Promise.resolve({ location: A, range: "last7" }) }));
    expect(panels).toHaveLength(1);
    const html = renderToStaticMarkup(panels[0]);
    expect(html).toContain('role="status"');
    expect(html).toContain(expected);
    expect(html).not.toContain("private RPC payload");
  });
  it("renders the unavailable panel for check detail too", async () => {
    const root = await DetailPage({ params: Promise.resolve({ checkGuid: "c1" }), searchParams: Promise.resolve({ location: A, date: "2026-10-10" }) });
    expect(renderToStaticMarkup(root)).toContain(expected);
  });
  it.each(pages)("contains failure to one shop in the all-shops view on %s", async (page) => {
    const root = await page({ searchParams: Promise.resolve({ location: "all", range: "last7" }) });
    if (!React.isValidElement(root)) throw new Error("missing shop panels");
    const { render } = root.props as { render: (shop: string) => Promise<ReactNode> };
    expect(unavailable(await render(A))).toHaveLength(1);
    expect(unavailable(await render(B))).toHaveLength(0);
  });
});
