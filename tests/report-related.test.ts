import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadReportRelations, relatedReportHref } from "@/lib/report-related";
import { OpeningReportDetailView } from "@/components/reports-hub/OpeningReportDetail";
import { PmReportDetailView } from "@/components/reports-hub/PmReportDetail";
import type { OpeningReportDetail, PmReportDetail } from "@/lib/reports-hub";
import { ReportReference, RelatedReports } from "@/components/reports-hub/RelatedReports";

type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>, failTable?: string) {
  const reads: Array<{table:string; columns:string; rows:Row[]}> = [];
  const client = { from(table:string) {
    let rows = [...(tables[table] ?? [])]; let columns = ""; let start = 0; let end = Infinity;
    const q = {
      select(c:string) { columns=c; return q; },
      eq(k:string,v:unknown) { rows=rows.filter(r=>r[k]===v); return q; },
      match(m:Row) { for(const [k,v] of Object.entries(m)) q.eq(k,v); return q; },
      in(k:string,v:unknown[]) { if (k === "instance_id" || table === "checklist_instances") expect(v.length).toBeLessThanOrEqual(50); if (k === "id" && table === "checklist_instances") expect(v.some(id=>String(id).startsWith("maintenance-"))).toBe(false); rows=rows.filter(r=>v.includes(r[k]));return q; },
      is(k:string,v:unknown) { rows=rows.filter(r=>(r[k]??null)===v);return q; },
      gte(k:string,v:string) {rows=rows.filter(r=>String(r[k])>=v);return q;},
      lte(k:string,v:string) {rows=rows.filter(r=>String(r[k])<=v);return q;},
      lt(k:string,v:string) {rows=rows.filter(r=>String(r[k])<v);return q;},
      not(k:string,op:string,v:unknown) { expect(op).toBe("is"); rows=rows.filter(r=>(r[k]??null)!==v);return q; },
      or(filter:string) {
        const match = /^status\.in\.\(([^)]+)\),report_date\.lt\.(.+)$/.exec(filter);
        if (!match) throw new Error(`Unsupported OR: ${filter}`);
        rows=rows.filter(r=>match[1]!.split(",").includes(String(r.status)) || String(r.report_date)<match[2]!);
        return q;
      }, order() {return q;}, limit(n:number) {end=n-1;return q;}, returns() {return q;},
      range(a:number,b:number) {start=a;end=b;return q;},
      maybeSingle() {return Promise.resolve({data:rows[0]??null,error:null});},
      then(resolve:(v:unknown)=>unknown) { const data=rows.slice(start,end===Infinity?undefined:end+1).map(r=>Object.fromEntries(columns.split(",").map(k=>[k.trim(),r[k.trim()]]))); reads.push({table,columns,rows:data}); return Promise.resolve(resolve({data,error:table===failTable?{message:"read failed"}:null})); },
    }; return q;
  }} as unknown as SupabaseClient;
  return { client, reads };
}

const args = {viewer:{userId:"me",level:3,locations:["shop"]},locationId:"shop",date:"2026-09-06",type:"opening" as const,id:"current",context:{location:"shop",returnLocation:"all",range:"last30",q:"free text",cursor:"opaque"}};
const tables = () => ({
  checklist_instances:[
    {id:"current",template_id:"opening",location_id:"shop",date:args.date,status:"confirmed"},
    {id:"previous",template_id:"opening",location_id:"shop",date:"2026-09-05",status:"confirmed"},
    {id:"next",template_id:"opening",location_id:"shop",date:"2026-09-07",status:"confirmed"},
    {id:"shared",template_id:"closing",location_id:"shop",date:args.date,status:"confirmed"},
    {id:"private",template_id:"closing",location_id:"shop",date:args.date,status:"confirmed"},
    {id:"other-shop",template_id:"closing",location_id:"other",date:args.date,status:"confirmed"},
  ],
  checklist_templates:[{id:"opening",type:"opening"},{id:"closing",type:"closing"}],
  checklist_completions:["current","previous","shared"].map(instance_id=>({id:instance_id,instance_id,completed_by:"me"})),
  cash_reports:[{id:"cash",location_id:"shop",report_date:args.date,signed_at:"2026-09-06T20:00:00Z"}],
  pm_reports:[{id:"own-pm",location_id:"shop",report_date:args.date,status:"submitted"},{id:"other-pm",location_id:"shop",report_date:args.date,status:"submitted"}],
  pm_employee_evals:[{id:"eval",pm_report_id:"own-pm",employee_id:"me"}],
});
describe("related report authorization",()=>{
  it("includes employee participation only, own PM evaluation, and no cash",async()=>{
    const {client}=fake(tables());
    const result=await loadReportRelations(client,args);
    expect(result.sameDay.map(r=>r.id).sort()).toEqual(["own-pm","shared"]);
    expect(result.previous.map(r=>r.id)).toEqual(["previous"]);
    expect(result.next).toEqual([]);
    const html=renderToStaticMarkup(createElement(RelatedReports,{relations:result,language:"en"}));
    expect(html).toContain('/reports/closing/shared?');
    expect(html).not.toContain('private');
    expect(html).not.toContain('/reports/cash/');
  });
  it("includes all authorized shop reports for managers and preserves list context",async()=>{
    const result=await loadReportRelations(fake(tables()).client,{...args,viewer:{...args.viewer,level:4}});
    expect(result.sameDay.map(r=>r.id).sort()).toEqual(["cash","other-pm","own-pm","private","shared"]);
    expect(result.next.map(r=>r.id)).toEqual(["next"]);
    const href=new URL(result.sameDay[0]!.href,"https://test.invalid");
    expect(Object.fromEntries(href.searchParams)).toEqual(args.context);
    expect(href.pathname).not.toContain('current');
  });
  it("does not manufacture unavailable baseline links",async()=>{
    const result=await loadReportRelations(fake(tables()).client,{...args,baselineIds:["missing-source"]});
    expect(result.baselineHrefs).toEqual({});
    expect(renderToStaticMarkup(createElement(ReportReference,{children:"Baseline"}))).toBe("<span>Baseline</span>");
  });
  it("refuses another shop before querying and propagates read failures",async()=>{
    await expect(loadReportRelations(fake(tables()).client,{...args,locationId:"other"})).rejects.toThrow();
    await expect(loadReportRelations(fake(tables(),"checklist_instances").client,args)).rejects.toThrow("read failed");
  });
  it("binds links to the report shop and escapes query and path values",()=>{
    const href=relatedReportHref({type:"closing",id:"a/b"},"shop",{location:"all",q:"a&b"});
    expect(href).toBe("/reports/closing/a%2Fb?location=shop&q=a%26b");
  });
});

it("links an exact older baseline only for its participants, never an arbitrary prior report",async()=>{
  const data:Record<string,Row[]>=tables();
  data.checklist_instances!.push({id:"frozen-source",template_id:"prep",location_id:"shop",date:"2026-08-01",status:"confirmed"});
  data.checklist_templates!.push({id:"prep",type:"prep",prep_subtype:"am_prep"});
  const denied=await loadReportRelations(fake(data).client,{...args,baselineIds:["frozen-source"]});
  expect(denied.baselineHrefs).toEqual({});
  data.checklist_completions!.push({id:"source-participation",instance_id:"frozen-source",completed_by:"me"});
  const allowed=await loadReportRelations(fake(data).client,{...args,baselineIds:["frozen-source"]});
  expect(allowed.baselineHrefs["frozen-source"]).toContain("/reports/am_prep/frozen-source?");
});
it("renders baseline and PM report references as links only when supplied authorized targets",()=>{
  const opening:OpeningReportDetail={kind:"opening",date:args.date,status:"confirmed",isRecountNoPriorSubmission:false,noPriorDataReason:null,
    signals:{done:1,total:1,skipped:0,tempFlags:0,underPar:0,overPar:0,cashOverShortCents:null},
    items:[{station:"Kitchen",label:"Count",done:true,byName:null,countValue:null,note:null,isTempFlag:false,baseline:{closerCount:3,par:4,sourceInstanceId:"source"},openerRecount:null,groundTruth:null,prepNeed:null,resolution:"section_verify",photoId:null,inputType:null,phase2:null}]};
  const href="/reports/am_prep/source?location=shop";
  const openingPlain=renderToStaticMarkup(createElement(OpeningReportDetailView,{detail:opening,language:"en"}));
  const openingLink=renderToStaticMarkup(createElement(OpeningReportDetailView,{detail:opening,language:"en",baselineHrefs:{source:href}}));
  expect(openingPlain).not.toContain('href=');expect(openingLink).toContain("Baseline: AM Prep count");expect(openingLink).toContain(`href="${href}"`);
  const pm:PmReportDetail={kind:"pm",date:args.date,locationId:"shop",status:"submitted",submittedByName:null,submittedAt:null,mvpUserId:null,mvpName:null,mvpNote:null,evals:[],gradientTally:[],wrapUp:[],reportProgress:[{key:"am_prep",reportId:"source",progress:"done",doneAt:null}]};
  expect(renderToStaticMarkup(createElement(PmReportDetailView,{detail:pm,language:"en"}))).not.toContain('href=');
  expect(renderToStaticMarkup(createElement(PmReportDetailView,{detail:pm,language:"en",relatedReports:[{type:"am_prep",id:"wrong",date:args.date,href:"/reports/am_prep/wrong?location=shop"},{type:"am_prep",id:"source",date:args.date,href}]}))).toContain(`href="${href}"`);
});

it("keeps a PM reference plain when the actual source is absent even if another same-type report is readable",()=>{
  const pm:PmReportDetail={kind:"pm",date:args.date,locationId:"shop",status:"submitted",submittedByName:null,submittedAt:null,mvpUserId:null,mvpName:null,mvpNote:null,evals:[],gradientTally:[],wrapUp:[],reportProgress:[{key:"mid_day",reportId:"actual",progress:"done",doneAt:null}]};
  const html=renderToStaticMarkup(createElement(PmReportDetailView,{detail:pm,language:"en",relatedReports:[{type:"mid_day",id:"wrong",date:args.date,href:"/reports/mid_day/wrong"}]}));
  expect(html).not.toContain('href=');
});


import { ChecklistReportDetailView } from "@/components/reports-hub/ChecklistReportDetail";
import { loadReportDetail } from "@/lib/reports-hub";
it.each([3,4])("closing inline references use stored IDs and authorized targets at L%s", async level => {
  const refs = ["am_prep", "opening", "mid_day", "cash", "pm"] as const;
  const data:Record<string,Row[]> = {
    checklist_instances:[{id:"closing",template_id:"closing",date:args.date,status:"confirmed",location_id:"shop"}],
    checklist_templates:[{id:"closing",type:"closing"}],
    checklist_template_items:refs.map(type=>({id:type,template_id:"closing",station:"Closing Manager",label:type,active:true,input_type:null})),
    checklist_completions:refs.map(type=>({id:type,instance_id:"closing",template_item_id:type,completed_by:"me",auto_complete_meta:{reportInstanceId:type+"-id"}})),
  };
  const detail = await loadReportDetail(fake(data).client,{viewer:{...args.viewer,level},type:"closing",id:"closing",locationId:"shop"});
  expect(detail?.kind).toBe("checklist");
  if (detail?.kind !== "checklist") throw new Error("missing detail");
  expect(detail.items.map(item=>item.reportInstanceId)).toEqual(refs.map(type=>type+"-id"));
  const relatedReports = refs.filter(type=>level>=4 || type!=="cash").map(type=>({type,id:type+"-id",date:args.date,href:`/reports/${type}/${type}-id`}));
  const html=renderToStaticMarkup(createElement(ChecklistReportDetailView,{detail,language:"en",relatedReports}));
  for(const type of refs) expect(html.includes(`href="/reports/${type}/${type}-id"`)).toBe(level>=4 || type!=="cash");
  expect(html).toContain("cash");
  const unrelated = renderToStaticMarkup(createElement(ChecklistReportDetailView,{detail,language:"en",relatedReports:[{type:"am_prep",id:"wrong-id",date:args.date,href:"/reports/am_prep/wrong-id"}]}));
  expect(unrelated).not.toContain('href=');
});
it("same-label report links show the stored submission time in the operational timezone",async()=>{
  const data:Record<string,Row[]>=tables();
  data.checklist_templates!.push({id:"mid",type:"prep",prep_subtype:"mid_day_prep"});
  for(const [id,time] of [["first","18:15"],["second","20:30"]]) data.checklist_instances!.push({id,template_id:"mid",location_id:"shop",date:args.date,status:"phase2_complete",confirmed_at:`2026-09-06T${time}:00Z`});
  const relations=await loadReportRelations(fake(data).client,{...args,viewer:{...args.viewer,level:4}});
  const html=renderToStaticMarkup(createElement(RelatedReports,{relations,language:"en"}));
  expect(html).toContain("Mid-Day Prep 2:15 PM");
  expect(html).toContain("Mid-Day Prep 4:30 PM");
});

it("historical references without submission times remain distinguishable", () => {
  const sameDay = ["first","second"].map(id=>({type:"mid_day" as const,id,date:args.date,href:`/reports/mid_day/${id}`}));
  const html=renderToStaticMarkup(createElement(RelatedReports,{relations:{sameDay,previous:[],next:[],baselineHrefs:{}},language:"en"}));
  expect(html).toContain("Mid-Day Prep (1)");
  expect(html).toContain("Mid-Day Prep (2)");
});
