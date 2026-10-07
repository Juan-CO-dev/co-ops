import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),detail:vi.fn(),related:vi.fn(),path:""}));
vi.mock("@/lib/session",()=>({requireSessionFromHeaders:mocks.auth}));
vi.mock("@/lib/supabase-server",()=>({getServiceRoleClient:()=>({})}));
vi.mock("@/lib/reports-hub",()=>({REPORTS_HUB_CASH_LEVEL:4,loadReportDetail:mocks.detail}));
vi.mock("@/lib/report-related",()=>({loadReportRelations:mocks.related}));
vi.mock("next/navigation",()=>({usePathname:()=>mocks.path,redirect:(path:string)=>{throw new Error(path);}}));
vi.mock("@/lib/i18n/provider",()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock("@/components/reports-hub/OpeningReportDetail",()=>({OpeningReportDetailView:()=>null}));
vi.mock("@/components/reports-hub/ChecklistReportDetail",()=>({ChecklistReportDetailView:()=>null}));
vi.mock("@/components/reports-hub/CashReportDetail",()=>({CashReportDetailView:()=>null}));
vi.mock("@/components/reports-hub/PmReportDetail",()=>({PmReportDetailView:()=>null}));
vi.mock("@/components/reports-hub/MaintenanceReportDetail",()=>({MaintenanceReportDetailView:()=>null}));
import Page from "@/app/(authed)/reports/[type]/[id]/page";
beforeEach(()=>{
  vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:"me",language:"en"},role:"owner",level:9,locations:[]});
  mocks.related.mockResolvedValue({sameDay:[],previous:[],next:[],baselineHrefs:{}});
});
const context={location:"shop",returnLocation:"all",range:"last30",cursor:"opaque",q:"chips"};
it.each(["opening","closing","am_prep","mid_day","cash","pm","maintenance"])("renders Operations parent and Dashboard on %s, including missing data",async type=>{
  mocks.path=`/reports/${type}/report-id`;
  for(const missing of [false,true]) {
    mocks.detail.mockResolvedValue(missing?null:{kind:type==="closing"||type==="am_prep"||type==="mid_day"?"checklist":type,date:"2026-09-06",items:[]});
    const html=renderToStaticMarkup(await Page({params:Promise.resolve({type,id:"report-id"}),searchParams:Promise.resolve(context)}));
    const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1]!.replaceAll("&amp;","&"),"https://test.invalid"));
    const back=links.find(link=>link.pathname==="/reports/operations");
    expect(back).toBeDefined();expect(back!.searchParams.get("location")).toBe("all");
    expect(back!.searchParams.get("cursor")).toBe("opaque");expect(back!.searchParams.has("returnLocation")).toBe(false);
    expect(links.some(link=>link.pathname==="/dashboard")).toBe(true);
    expect(links.every(link=>link.pathname!==mocks.path)).toBe(true);
    expect(html).toContain("reports.hub.operations");
  }
});
it("keeps escape navigation on cash denial and does not accept an employee all-shops return",async()=>{
  mocks.auth.mockResolvedValue({user:{id:"me",language:"en"},role:"employee",level:3,locations:["shop"]});
  mocks.path="/reports/cash/report-id";
  const html=renderToStaticMarkup(await Page({params:Promise.resolve({type:"cash",id:"report-id"}),searchParams:Promise.resolve(context)}));
  expect(html).toContain("/reports/operations?location=shop");expect(html).toContain("/dashboard?");
  expect(mocks.detail).not.toHaveBeenCalled();expect(mocks.related).not.toHaveBeenCalled();
});
