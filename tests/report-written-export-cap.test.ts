import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-server", () => ({getServiceRoleClient:vi.fn()}));
vi.mock("@/lib/written-reports", () => ({listWrittenReports:vi.fn()}));
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listWrittenReports, type WrittenReportListItem } from "@/lib/written-reports";
import { loadExportTable, operationsFilters } from "@/lib/report-export";
import type { AuthContext } from "@/lib/session";

const location = "aaaaaaaa-0000-4000-8000-00000000000a";
const auth = {user:{id:"viewer",language:"en"},role:"gm",level:7,locations:[location]} as AuthContext;
beforeEach(() => {
  vi.clearAllMocks();
  const query = {select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:location,code:"SHOP",name:"Shop"},error:null})};
  vi.mocked(getServiceRoleClient).mockReturnValue({from:()=>query} as never);
});
it.each([1999,2000,2001])("written export handles %i rows without silent truncation", async total => {
  let offset = 0;
  vi.mocked(listWrittenReports).mockImplementation(async (_client, params) => {
    expect(params.cursor).toBe(offset ? String(offset) : undefined);
    const reports = Array.from({length:Math.min(50,total-offset)},(_,i):WrittenReportListItem=>({
      id:String(offset+i),locationId:location,submittedAt:"2026-10-07T12:00:00Z",submittedBy:"staff",submittedByName:"Ana",submittedByRole:"employee",
      body:"Test report",title:null,category:null,editCount:0,lastEditedAt:null,visibilityMinLevel:2,relatedTable:null,relatedId:null,canEdit:false,
    }));
    offset += reports.length;
    return {reports,nextCursor:offset<total ? String(offset) : null};
  });
  const result = loadExportTable(auth,"written",{location,range:"last7"},new Date("2026-10-08T12:00:00Z"));
  if (total > 2000) await expect(result).rejects.toMatchObject({status:413,code:"export_too_large"});
  else expect((await result).rows).toHaveLength(total);
  expect(listWrittenReports).toHaveBeenCalledTimes(40);
});
it("passes the not-started filter through to exports", () => {
  expect(operationsFilters({sf_notStarted:"true"},7).signals).toEqual({notStarted:true});
});
