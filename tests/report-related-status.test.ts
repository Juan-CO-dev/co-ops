import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks=vi.hoisted(()=>({am:vi.fn(),mid:vi.fn(),cash:vi.fn()}));
vi.mock("@/lib/prep",async original=>({...await original<typeof import("@/lib/prep")>(),loadAmPrepDashboardState:mocks.am,loadMidDayPrepDashboardState:mocks.mid}));
vi.mock("@/lib/cash",async original=>({...await original<typeof import("@/lib/cash")>(),loadCashDashboardState:mocks.cash}));
import { loadReportStatuses } from "@/lib/midshift";
const service={from(table:string){
  let type="";
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="type")type=value;return q;},in:(_key:string,ids:string[])=>{type=ids[0]!;return q;},order:()=>q,limit:()=>q,
    returns:async()=>({data:table==="checklist_templates"?[{id:type}]:[],error:null}),
    maybeSingle:async()=>({data:{id:`${type}-exact`,status:"confirmed",confirmed_at:null,confirmed_by:null},error:null})};
  return q;
}} as unknown as SupabaseClient;
const args={locationId:"shop",date:"2026-09-06",actor:{userId:"manager",role:"key_holder" as const,level:4}};
beforeEach(()=>{
  mocks.am.mockResolvedValue({todayInstance:{id:"am-exact",status:"confirmed",confirmedAt:null},confirmedByName:null});
  mocks.cash.mockResolvedValue({report:{id:"cash-exact",signedAt:null,signedByName:null}});
});
it("carries every source ID and keeps mid-day provenance on the latest completed row",async()=>{
  mocks.mid.mockResolvedValue({instances:[{instanceId:"older-done",status:"confirmed"},{instanceId:"latest-done",status:"phase2_complete"},{instanceId:"newer-open",status:"open"}]});
  const {rows}=await loadReportStatuses(service,args);
  expect(Object.fromEntries(rows.map(row=>[row.key,row.reportId]))).toEqual({opening:"opening-exact",closing:"closing-exact",am_prep:"am-exact",cash:"cash-exact",mid_day:"latest-done"});
  expect(rows.find(row=>row.key==="mid_day")?.progress).toBe("done");
});
it("uses the newest in-progress instance if none is complete, and null for absence",async()=>{
  mocks.mid.mockResolvedValue({instances:[{instanceId:"first-open",status:"open"},{instanceId:"last-open",status:"open"}]});
  expect((await loadReportStatuses(service,args)).rows.find(row=>row.key==="mid_day")).toMatchObject({reportId:"last-open",progress:"in_progress"});
  mocks.mid.mockResolvedValue({instances:[]});
  expect((await loadReportStatuses(service,args)).rows.find(row=>row.key==="mid_day")).toMatchObject({reportId:null,progress:"not_started"});
});
