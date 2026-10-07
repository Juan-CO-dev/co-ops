import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { decodeReportCursor, encodeReportCursor } from "@/lib/report-pagination";

const mocks=vi.hoisted(()=>({auth:vi.fn(),page:vi.fn(),service:vi.fn()}));
vi.mock("@/lib/session",()=>({requireSessionFromHeaders:mocks.auth}));
vi.mock("@/lib/supabase-server",()=>({getServiceRoleClient:mocks.service}));
vi.mock("@/lib/reports-hub",async original=>({...await original<typeof import("@/lib/reports-hub")>(),listReportsPage:mocks.page}));
vi.mock("@/components/trends/TrendShopPanels",()=>({TrendShopPanels:()=>null}));
vi.mock("@/components/nav/BackLink",()=>({BackLink:()=>null}));
vi.mock("@/components/reports-hub/ReportRangeControls",()=>({ReportRangeControls:()=>null}));
vi.mock("@/components/reports-hub/ReportFilterBar",()=>({ReportFilterBar:()=>null}));
vi.mock("@/components/reports-hub/ReportList",()=>({ReportList:()=>null}));

import ReportsPage from "@/app/(authed)/reports/operations/page";
import { ReportList } from "@/components/reports-hub/ReportList";

function detailContext(node: React.ReactNode): string | undefined {
  if (Array.isArray(node)) return node.map(detailContext).find(value => value !== undefined);
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { context?: string; children?: React.ReactNode };
  return node.type === ReportList ? props.context : detailContext(props.children);
}

function links(node: React.ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!React.isValidElement(node)) return [];
  const props=node.props as {href?:string;children?:React.ReactNode};
  return [...(props.href?[props.href]:[]),...links(props.children)];
}

describe("all-shop operations pagination",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({user:{id:"owner",language:"en"},role:"owner",level:9,locations:[]});
    mocks.service.mockReturnValue({from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})})});
    mocks.page.mockImplementation(async (_service:unknown,args:{locationId:string;cursor?:string})=>({items:[],nextCursor:`next-${args.locationId}`}));
  });

  it("keeps location=all and each other panel's cursor while paging independently",async()=>{
    const root=await ReportsPage({searchParams:Promise.resolve({location:"all",cursor_shopA:"a-50",cursor_shopB:"b-50"})});
    if(!React.isValidElement(root)) throw new Error("missing panels");
    const render=(root.props as {render:(id:string)=>Promise<React.ReactNode>}).render;
    const a=await render("shopA");
    const b=await render("shopB");
    expect(mocks.page.mock.calls.map(call=>[call[1].locationId,call[1].cursor])).toEqual([["shopA","a-50"],["shopB","b-50"]]);
    const nextA=links(a).find(href=>href.includes("cursor_shopA=next-shopA"));
    const nextB=links(b).find(href=>href.includes("cursor_shopB=next-shopB"));
    expect(nextA).toBeTruthy();expect(nextB).toBeTruthy();
    expect(new URL(nextA!,"http://local").searchParams.get("location")).toBe("all");
    expect(new URL(nextA!,"http://local").searchParams.get("cursor_shopB")).toBe("b-50");
    expect(new URL(nextB!,"http://local").searchParams.get("cursor_shopA")).toBe("a-50");
  });

  it("returns from a detail to the same valid cursor page without binding the cursor to itself", async () => {
    const last = { type: "closing" as const, id: "last", date: "2026-09-06", locationId: "shopA" };
    mocks.page.mockImplementation(async (_service: unknown, args: { context: string }) => ({
      items: [], nextCursor: encodeReportCursor(last, args.context),
    }));
    const initialParams = { location: "shopA", range: "custom", from: "2026-09-01", to: "2026-09-07", type: "closing", returnLocation: "all" };
    const initial = await ReportsPage({ searchParams: Promise.resolve(initialParams) });
    const nextHref = links(initial).find(href => href.includes("cursor="));
    expect(nextHref).toBeDefined();
    const nextParams = Object.fromEntries(new URL(nextHref!, "http://local").searchParams);
    // A shop detail consumes the immediate-parent marker. It isn't a filter
    // and must not invalidate a list cursor when returning from that detail.
    delete nextParams.returnLocation;
    const next = await ReportsPage({ searchParams: Promise.resolve(nextParams) });
    const args = mocks.page.mock.calls[1]![1];
    expect(decodeReportCursor(args.cursor, args.context)).toEqual(last);
    const detail = new URLSearchParams(detailContext(next));
    expect(detail.get("cursor")).toBe(nextParams.cursor);
    expect(detail.get("type")).toBe("closing");
  });
});
