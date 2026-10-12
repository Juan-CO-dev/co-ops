import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: vi.fn() }));
vi.mock("@/lib/midshift", () => ({ operationalNow: () => ({ date: "2026-10-11" }) }));
vi.mock("@/lib/sales-reports", async (original) => ({
  ...await original<typeof import("@/lib/sales-reports")>(),
  loadSalesLatestCapture: vi.fn(), loadSalesBreakdown: vi.fn(), loadSalesCheckPage: vi.fn(), loadSalesCatering: vi.fn(),
}));
import SalesPage from "@/app/(authed)/reports/sales/page";
import ChecksPage from "@/app/(authed)/reports/sales/checks/page";
import CateringPage from "@/app/(authed)/reports/sales/catering/page";
import { RangeCaption } from "@/components/reports-hub/SalesParts";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadSalesBreakdown, loadSalesCatering, loadSalesCheckPage, loadSalesLatestCapture, SalesReportError, toCheckRow } from "@/lib/sales-reports";

const SHOP = "aaaaaaaa-0000-4000-8000-00000000000a";
const SERVER = "bbbbbbbb-0000-4000-8000-00000000000b";
function captions(node: ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(captions);
  if (!React.isValidElement(node)) return [];
  return node.type === RangeCaption ? [node] : captions((node.props as { children?: ReactNode }).children);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.mocked(requireSessionFromHeaders).mockResolvedValue({ user: { id: "viewer", language: "en" }, level: 7, locations: [SHOP] } as never);
  vi.mocked(loadSalesLatestCapture).mockResolvedValue("2026-10-11T16:30:00Z");
  vi.mocked(loadSalesBreakdown).mockResolvedValue([]);
  vi.mocked(loadSalesCheckPage).mockResolvedValue({ rows: [], nextCursor: null, cursorReset: false });
  vi.mocked(loadSalesCatering).mockRejectedValue(new SalesReportError(503, "sales_reads_timeout"));
});
afterEach(() => vi.unstubAllGlobals());

describe("Today captions", () => {
  it.each([SalesPage, ChecksPage, CateringPage])("passes actual capture time on %s, even when catering numbers fail", async (page) => {
    const root = await page({ searchParams: Promise.resolve({ location: SHOP, range: "today", view: "items" }) });
    expect(loadSalesLatestCapture).toHaveBeenCalledWith(expect.objectContaining({ level: 7 }), { locationId: SHOP, businessDate: "2026-10-11" });
    expect(captions(root)).toHaveLength(1);
    expect(renderToStaticMarkup(captions(root)[0])).toContain("12:30 PM");
  });
  it.each([SalesPage, ChecksPage, CateringPage])("does not load a Today capture for a historical range on %s", async (page) => {
    await page({ searchParams: Promise.resolve({ location: SHOP, range: "last7", view: "items" }) });
    expect(loadSalesLatestCapture).not.toHaveBeenCalled();
  });
  it("keeps the no-capture caption when the optional read returns null", async () => {
    vi.mocked(loadSalesLatestCapture).mockResolvedValue(null);
    const root = await ChecksPage({ searchParams: Promise.resolve({ location: SHOP, range: "today" }) });
    expect(renderToStaticMarkup(captions(root)[0])).toContain("nothing captured yet");
  });
});

describe("Server drill chip", () => {
  it("reads its first name from the scoped page rather than a URL label", async () => {
    vi.mocked(loadSalesCheckPage).mockResolvedValue({ rows: [toCheckRow({ business_date: "2026-10-10", check_guid: "check", server_guid: SERVER, server_name: "Ana", amount_cents: 1200 })], nextCursor: null, cursorReset: false });
    const root = await ChecksPage({ searchParams: Promise.resolve({ location: SHOP, range: "last7", server: SERVER, serverName: "Wrong Name" }) });
    // Inspect plain children without rendering the unrelated async navigation components.
    const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node)
      ? text((node.props as { children?: ReactNode }).children) : typeof node === "string" ? node : "";
    expect(text(root)).toContain("Server: Ana");
    expect(text(root)).not.toContain("Wrong Name");
  });
});
