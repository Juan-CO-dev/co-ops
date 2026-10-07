import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

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
});
