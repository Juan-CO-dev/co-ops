import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReportsPage, loadReportDetail, listReportSkeleton, enrichReportItems, computeReportSignals, isFinalizedReport } from "@/lib/reports-hub";
import { buildSearchCorpus } from "@/lib/reports-search";
import { compareReportTuples } from "@/lib/report-pagination";

import * as maintenance from "@/lib/maintenance";
import { reportIsFinalized } from "@/lib/report-summary";

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
const viewer={userId:"me",level:3,locations:["shop"]};
const instance={id:"shared",location_id:"shop",date:"2026-10-06",template_id:"t",status:"open",confirmed_by:"colleague",confirmed_at:null};
const tables = () => ({
  checklist_instances:[instance], checklist_templates:[{id:"t",type:"opening",prep_subtype:null}],
  checklist_template_items:[{id:"own",template_id:"t",label:"Own item",station:"Kitchen",required:true,active:true}, {id:"other",template_id:"t",label:"Private colleague item",station:"Kitchen",required:true,active:true}],
  checklist_completions:[{id:"c1",instance_id:"shared",template_item_id:"own",completed_by:"me",count_value:2,notes:"own note",prep_data:{phase1:{opener_recount:2}}}, {id:"c2",instance_id:"shared",template_item_id:"other",completed_by:"colleague",count_value:99,notes:"private note",prep_data:{phase2:{opener_prepped:99}}}],
  users:[{id:"me",name:"Me"},{id:"colleague",name:"Private colleague"}], maintenance_equipment:[],
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("operations loader data boundaries",()=>{
  it("shows the true confirmer on an employee's shared report", async () => {
    const data: Record<string,Row[]> = tables();
    data.checklist_instances![0] = {...instance, status:"confirmed", confirmed_by:"colleague", confirmed_at:"2026-10-06T21:00:00Z"};
    const {client} = fake(data);
    const rows = await listReportSkeleton(client,{viewer,locationId:"shop",dateFrom:instance.date,dateTo:instance.date});
    const enriched = await enrichReportItems(client,{viewer,locationId:"shop",dateFrom:instance.date,dateTo:instance.date},rows);
    expect(enriched.find(row=>row.id==="shared")?.submitterName).toBe("Private colleague");
    expect(enriched.find(row=>row.id==="shared")?.submitterName).not.toBe("Me");
  });
  it("throws failed skeleton reads instead of reporting missing activity",async()=>{
    const {client}=fake(tables(),"checklist_instances");
    await expect(listReportSkeleton(client,{viewer,locationId:"shop",dateFrom:instance.date,dateTo:instance.date})).rejects.toThrow("read failed");
  });
  it("own rows only in shared opening details, signals and search",async()=>{
    const {client}=fake(tables());
    const detail=await loadReportDetail(client,{viewer,type:"opening",id:"shared",locationId:"shop"});
    expect(detail?.kind).toBe("opening");
    if(detail?.kind!=="opening") throw new Error("wrong detail");
    expect(detail.items).toHaveLength(1); expect(detail.items[0]?.phase2).toBeNull(); expect(detail.signals.total).toBe(1);expect(detail.signals.skipped).toBe(0);
    expect(JSON.stringify(detail)).not.toContain("Private"); expect(JSON.stringify(detail)).not.toContain("99");
    const corpus=await buildSearchCorpus(client,{viewer,locationId:"shop",items:[{id:"shared",type:"opening",date:instance.date,locationId:"shop",status:"open",submitterName:null},{id:"maintenance-2026-10-06",type:"maintenance",date:instance.date,locationId:"shop",status:"ok",submitterName:null}]});
    expect(JSON.stringify([...corpus])).not.toContain("Private"); expect(JSON.stringify([...corpus])).not.toContain("private note");
  });
  it("refuses cross-shop scope before any data query",async()=>{
    const {client,reads}=fake(tables());
    await expect(loadReportDetail(client,{viewer,type:"opening",id:"shared",locationId:"other"})).rejects.toThrow("report_scope_forbidden");expect(reads).toEqual([]);
  });
  it("maintenance exposes own notes and readings, never a colleague's",async()=>{
    const data:Record<string,Row[]> = tables();
    data.maintenance_equipment=[{id:"fridge",name:"Fridge",kind:"fridge",active:true,location_id:"shop",opening_temp_item_id:"own",closing_temp_item_id:"other",safe_max_f:41}];
    data.maintenance_notes=[{id:"n1",created_by:"me",location_id:"shop",created_at:"2026-10-06T14:00:00Z",equipment_id:"fridge",note:"own note"},{id:"n2",created_by:"colleague",location_id:"shop",created_at:"2026-10-06T14:01:00Z",equipment_id:"fridge",note:"private colleague note"}];
    const {client}=fake(data);
    const result=await loadReportDetail(client,{viewer,type:"maintenance",id:"maintenance-2026-10-06",locationId:"shop"});
    if(result?.kind!=="maintenance") throw new Error("wrong detail");
    expect(result.equipment[0]?.readings.map(r=>r.valueF)).toEqual([2]);
    expect(result.equipment[0]?.notes.map(r=>r.id)).toEqual(["n1"]);
    expect(result.flagCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private colleague");
    expect(JSON.stringify(result)).toContain("own note");
    const corpus=await buildSearchCorpus(client,{viewer,locationId:"shop",items:[{id:"maintenance-2026-10-06",type:"maintenance",date:instance.date,locationId:"shop",status:"ok",submitterName:null}]});
    expect(JSON.stringify([...corpus])).toContain("own note");
    expect(JSON.stringify([...corpus])).not.toContain("private colleague note");
  });
  it("retains unfinished past days, hides unfinished today and employee cash",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const data=tables();data.checklist_instances.push({...instance,id:"today",date:"2026-10-07"});
    const {client}=fake(data);
    const list=await listReportSkeleton(client,{viewer,locationId:"shop",dateFrom:"2026-10-01",dateTo:"2026-10-07"});
    expect(list.map(r=>r.id)).toEqual(["shared"]);expect(list.some(r=>r.type==="cash")).toBe(false);
  });
  it("pages over 100 mixed rows without gaps; enrichment is bounded to candidates",async()=>{
    const data=tables();data.checklist_instances=Array.from({length:120},(_,n)=>({...instance,id:String(n).padStart(3,"0"),template_id:n%2?"t":"t2"}));
    data.checklist_templates.push({id:"t2",type:"closing",prep_subtype:null});
    const {client,reads}=fake(data); const args={viewer:{...viewer,level:4},locationId:"shop",dateFrom:instance.date,dateTo:instance.date};
    const first=await listReportsPage(client,args);
    expect(first.items).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const enriched=reads.filter(r=>r.table==="checklist_instances"&&r.columns==="id, template_id");
    expect(enriched.flatMap(r=>r.rows)).toHaveLength(51); // page plus one existence probe
    expect(enriched.every(r=>r.rows.length<=50)).toBe(true);
    const second=await listReportsPage(client,{...args,cursor:first.nextCursor!});
    const third=await listReportsPage(client,{...args,cursor:second.nextCursor!});
    const all=[...first.items,...second.items,...third.items];expect(all).toHaveLength(120);expect(new Set(all.map(r=>r.id)).size).toBe(120);expect([...all].sort(compareReportTuples)).toEqual(all);expect(third.nextCursor).toBeNull();
    const sparse=await listReportsPage(client,{...args,query:"sparse",match:async rows=>rows.filter(r=>Number(r.id)%30===0)});
    expect(sparse.items).toHaveLength(4);expect(sparse.nextCursor).toBeNull();
  });
});


describe("review regressions", () => {
  it("keeps phase2_complete final for opening and mid-day", () => {
    expect(isFinalizedReport("phase2_complete")).toBe(true);
    for (const type of ["opening", "mid_day"] as const) expect(reportIsFinalized({type,status:"phase2_complete"})).toBe(true);
  });
  it("chunks a 550-instance maintenance window and excludes null-only dates", async () => {
    const data: Record<string,Row[]> = tables();
    data.maintenance_equipment=[{id:"fridge",kind:"fridge",name:"Fridge",active:true,location_id:"shop",opening_temp_item_id:"own",safe_max_f:41}];
    data.checklist_instances=Array.from({length:550},(_,n)=>({...instance,id:`instance-${n}`,date:n===549?"2026-10-05":instance.date}));
    data.checklist_completions=data.checklist_instances.map((r,n)=>({id:`c-${n}`,instance_id:r.id,template_item_id:"own",count_value:n===549?null:50,completed_by:"me"}));
    const {client,reads}=fake(data);
    for (const skeletonOnly of [true,false]) {
      const dates=await maintenance.listMaintenanceReportDates(client,"shop","2026-07-08","2026-10-07","me",skeletonOnly);
      expect(dates).toEqual([{date:instance.date,tempFlags:skeletonOnly?0:1}]);
    }
    expect(reads.filter(r=>r.table==="checklist_completions")).toHaveLength(22);
    expect(reads.filter(r=>r.table==="checklist_instances")).toHaveLength(2);
  });
  it("loads maintenance flags once per enrichment chunk, not per date", async () => {
    const data: Record<string,Row[]> = tables();
    data.maintenance_equipment=[{id:"fridge",kind:"fridge",name:"Fridge",active:true,location_id:"shop",opening_temp_item_id:"own",safe_max_f:41}];
    data.checklist_instances=Array.from({length:25},(_,n)=>({...instance,id:`i${n}`,date:`2026-09-${String(n+1).padStart(2,"0")}`}));
    data.checklist_completions=data.checklist_instances.map((r,n)=>({id:`c${n}`,instance_id:r.id,template_item_id:"own",count_value:n%2?50:30,completed_by:"me"}));
    const {client,reads}=fake(data);
    const bulk=vi.spyOn(maintenance,"listMaintenanceReportDates");
    const detail=vi.spyOn(maintenance,"loadMaintenanceReportDetail");
    const items=data.checklist_instances.map(r=>({id:`maintenance-${r.date}`,date:String(r.date),type:"maintenance" as const,locationId:"shop",status:"ok",submitterId:null,submittedAt:null,submitterName:null}));
    const result=await enrichReportItems(client,{viewer,locationId:"shop",dateFrom:"2026-09-01",dateTo:"2026-09-25"},items);
    expect(bulk).toHaveBeenCalledTimes(1);expect(detail).not.toHaveBeenCalled();
    expect(reads.filter(r=>r.table==="checklist_completions")).toHaveLength(1);
    expect(result.map(r=>r.signalSummary?.tempFlags)).toEqual(items.map((_,n)=>n%2));
  });
  it("employees see their free-text answers in signals and search", async () => {
    const data: Record<string,Row[]> = tables();
    const snapshot={section:"misc",itemName:"Question",parValue:null,parUnit:null,specialInstruction:null};
    data.checklist_completions=data.checklist_completions!.map((r,n)=>({...r,prep_data:{inputs:{freeText:n?"colleague answer":"own answer"},snapshot}}));
    const {client}=fake(data);
    const result=await computeReportSignals(client,{type:"opening",id:"shared",viewer,tempItemIds:new Set()});
    expect(result.checks.map(r=>r.freeText)).toEqual(["own answer"]);
    const corpus=await buildSearchCorpus(client,{viewer,locationId:"shop",items:[{id:"shared",type:"opening",date:instance.date,locationId:"shop",status:"open",submitterName:null}]});
    expect(JSON.stringify([...corpus])).toContain("own answer");expect(JSON.stringify([...corpus])).not.toContain("colleague answer");
  });
  it("PM drafts stay hidden from employees but past drafts and MVP notes remain visible to KH", async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const data: Record<string,Row[]> = tables();
    data.pm_reports=[{id:"draft",location_id:"shop",report_date:instance.date,status:"open",mvp_note:"MVP praise"},{id:"today-draft",location_id:"shop",report_date:"2026-10-07",status:"open"},...["submitted","incomplete_confirmed","auto_finalized"].map(status=>({id:status,location_id:"shop",report_date:"2026-10-07",status,mvp_note:"MVP praise"}))];
    data.pm_employee_evals=data.pm_reports.map(r=>({id:`eval-${r.id}`,pm_report_id:r.id,employee_id:"me",area_to_improve:"own evaluation",note:"private manager note"}));
    const {client}=fake(data);
    const args={locationId:"shop",dateFrom:instance.date,dateTo:"2026-10-07",types:["pm" as const]};
    const employee=await listReportSkeleton(client,{...args,viewer});
    expect(employee.map(r=>r.id).sort()).toEqual(["auto_finalized","incomplete_confirmed","submitted"]);
    expect(await loadReportDetail(client,{viewer,type:"pm",id:"draft",locationId:"shop"})).toBeNull();
    const kh={...viewer,level:4};
    expect((await listReportSkeleton(client,{...args,viewer:kh})).map(r=>r.id)).toContain("draft");
    expect((await listReportSkeleton(client,{...args,viewer:kh})).map(r=>r.id)).not.toContain("today-draft");
    for (const id of ["draft","submitted"]) {
      const detail=await loadReportDetail(client,{viewer:kh,type:"pm",id,locationId:"shop"});
      expect(detail?.kind).toBe("pm");
      if(detail?.kind!=="pm") throw new Error("wrong detail");
      expect(detail.mvpNote).toBe("MVP praise");expect(detail.evals[0]?.note).toBeNull();
    }
    const corpus=await buildSearchCorpus(client,{viewer:kh,locationId:"shop",items:employee});
    expect(JSON.stringify([...corpus])).toContain("MVP praise");expect(JSON.stringify([...corpus])).not.toContain("private manager note");
    const own=await loadReportDetail(client,{viewer,type:"pm",id:"submitted",locationId:"shop"});
    expect(own?.kind).toBe("pm");
    if(own?.kind==="pm") expect(own.mvpNote).toBeNull();
  });
});
