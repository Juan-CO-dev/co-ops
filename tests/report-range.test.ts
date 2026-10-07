import { describe, it, expect } from "vitest";
import { parseReportRange, reportTimestampBounds, validReportDate } from "@/lib/report-range";
import { canReadScopedReport } from "@/lib/report-scope";
import { compareReportTuples, decodeReportCursor, encodeReportCursor } from "@/lib/report-pagination";
describe("report contracts", () => {
  it.each([
    ["today","2026-10-07","2026-10-07"], ["yesterday","2026-10-06","2026-10-06"],
    ["last7","2026-10-01","2026-10-07"], ["last30","2026-09-08","2026-10-07"],
    ["this_month","2026-10-01","2026-10-07"], ["last_month","2026-09-01","2026-09-30"],
  ])("resolves %s", (range,from,to)=>{ expect(parseReportRange({range},"2026-10-07")).toMatchObject({from,to}); });
  it("bounds reversed dates and the fall-back day",()=>{
    expect(parseReportRange({from:"2026-10-06",to:"2026-10-01"},"2026-10-07")).toMatchObject({from:"2026-10-01",to:"2026-10-01"});
    expect(reportTimestampBounds("2026-11-01","2026-11-01")).toEqual({start:"2026-11-01T04:00:00.000Z",end:"2026-11-02T05:00:00.000Z"});
  });
  it("rejects normalized impossible dates and accepts leap days", () => { expect(validReportDate("2026-02-30")).toBe(false); expect(validReportDate("2024-02-29")).toBe(true); });
  it("caps day to 92 inclusive and compares disjoint equal periods", () => { const r = parseReportRange({from:"2020-01-01",to:"2026-10-07",cmp:"1"},"2026-10-07"); expect(r.from).toBe("2026-07-08"); expect(r.previous.to).toBe("2026-07-07"); expect(r.compare).toBe(true); });
  it("compares this month with prior month to date", () => { expect(parseReportRange({range:"this_month"},"2026-10-07").previous).toEqual({from:"2026-09-01",to:"2026-09-07"}); });
  it("uses independent midnights across DST", () => { expect(reportTimestampBounds("2026-03-08","2026-03-08")).toEqual({start:"2026-03-08T05:00:00.000Z",end:"2026-03-09T04:00:00.000Z"}); });
  it("retains a year of monthly buckets", () => { expect(parseReportRange({from:"2020-01-01"},"2026-10-07","month").from).toBe("2025-11-01"); });
  it("does not authorize a forged all-shop selection", () => { expect(canReadScopedReport({userId:"u",level:7,locations:["a"]},"b")).toBe(false); expect(canReadScopedReport({userId:"u",level:8,locations:[]},"b")).toBe(true); expect(canReadScopedReport({userId:"u",level:8},"all")).toBe(false); });
  it("compares types before ids and rejects stale cursors", () => { const a = {date:"2026-10-06",type:"opening" as const,id:"z",locationId:"a"}; const b = {...a,type:"closing" as const,id:"a"}; expect(compareReportTuples(a,b)).toBeLessThan(0); expect(decodeReportCursor(encodeReportCursor(a,"x"),"y")).toBeNull(); });
});
