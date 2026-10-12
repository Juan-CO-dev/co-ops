import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReportSignals, computeReportSignalsBatch, listReports, loadReportDetail, type ReportListItem, type ReportTypeKey } from "@/lib/reports-hub";
import { loadTrendSeries } from "@/lib/reports-trends";
import { composeLastClose, composeReportSummary } from "@/lib/report-summary";
import { reportParDeviation } from "@/lib/report-signals";

type Row = Record<string, unknown>;
function fake(tables: Record<string, Row[]>, failTable?: string) {
  const reads: Array<{table:string; columns:string; rows:Row[]}> = [];
  const client = { from(table:string) {
    let rows = [...(tables[table] ?? [])]; let columns = ""; let start = 0; let end = Infinity;
    const q = {
      select(c:string) { columns=c; return q; },
      eq(k:string,v:unknown) { rows=rows.filter(r=>r[k]===v); return q; },
      match(m:Row) { for(const [k,v] of Object.entries(m)) q.eq(k,v); return q; },
      in(k:string,v:unknown[]) { rows=rows.filter(r=>v.includes(r[k]));return q; },
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
const viewer = { userId: "manager", level: 5, locations: ["shop"] };
const date = "2026-10-06";
const report = (type: ReportTypeKey, id: string, status = "confirmed"): ReportListItem => ({ id, type, status, date, locationId: "shop", submitterName: null });
const prep = { inputs: { onHand: 0, total: 2 }, snapshot: { section: "section", itemName: "Item", parValue: 10, parUnit: "each", specialInstruction: null } };
function data() {
  const templates = [
    { id: "opening", type: "opening", prep_subtype: null },
    { id: "closing", type: "closing", prep_subtype: null },
    { id: "am_prep", type: "prep", prep_subtype: "am_prep" },
    { id: "mid_day", type: "prep", prep_subtype: "mid_day_prep" },
  ];
  const instances = [
    ["open", "opening"], ["am", "am_prep"], ["mid", "mid_day"], ["empty", "closing"], ["optional", "closing"],
  ].map(([id, template_id]) => ({ id, template_id, date, location_id: "shop", status: "auto_finalized", confirmed_by: null, confirmed_at: null }));
  const items = templates.flatMap(t => [
    { id: `${t.id}-active`, template_id: t.id, label: "Active", required: true, active: true },
    { id: `${t.id}-old`, template_id: t.id, label: "Old", required: true, active: false },
    { id: `${t.id}-optional`, template_id: t.id, label: "Optional", required: false, active: true },
    { id: `${t.id}-removed`, template_id: t.id, label: "Removed", required: true, active: false },
  ]);
  const completions = [
    { instance_id: "open", template_item_id: "opening-active", prep_data: { phase1: { ground_truth_count: 0 } } },
    { instance_id: "open", template_item_id: "opening-active", prep_data: { phase2: { over_under_status: "under_prep", opener_prepped: 2 } } },
    { instance_id: "open", template_item_id: "opening-old", prep_data: { phase2: { over_under_status: "over_prep", opener_prepped: 20 } } },
    { instance_id: "am", template_item_id: "am_prep-active", prep_data: prep },
    { instance_id: "mid", template_item_id: "mid_day-active", prep_data: { ...prep, overUnder: { kind: "over" } } },
    { instance_id: "optional", template_item_id: "closing-optional", prep_data: null },
  ].map((r, n) => ({ ...r, id: `completion-${n}`, count_value: null, completed_by: null }));
  return { checklist_instances: instances, checklist_templates: templates, checklist_template_items: items, checklist_completions: completions };
}

it("marks system-finalized reports auto-closed, prefers human confirmation and retains finalized counts", () => {
  const auto = report("closing", "auto", "auto_finalized");
  const human = report("closing", "human");
  expect(composeLastClose([auto], 5).reports.find(r => r.type === "closing")?.state).toBe("auto_closed");
  expect(composeLastClose([auto, human], 5).reports.find(r => r.type === "closing")).toMatchObject({ state: "done", item: human });
  expect(composeLastClose([human, auto], 5).reports.find(r => r.type === "closing")).toMatchObject({ state: "done", item: human });
  expect(composeReportSummary([auto, human])).toMatchObject({ total: 2, finalized: 2, autoClosed: 1 });
});

it("reads persisted final checks and ignores AM prep and malformed outcomes", () => {
  expect(reportParDeviation("opening", { phase2: { over_under_status: "under_prep" } })).toBe("under");
  expect(reportParDeviation("opening", { phase2: { over_under_status: "over_prep" } })).toBe("over");
  expect(reportParDeviation("mid_day", { ...prep, overUnder: { kind: "under" } })).toBe("under");
  expect(reportParDeviation("mid_day", { ...prep, overUnder: { kind: "over" } })).toBe("over");
  expect(reportParDeviation("am_prep", prep)).toBeNull();
  expect(reportParDeviation("opening", { phase2: { over_under_status: "under" } })).toBeNull();
  expect(reportParDeviation("mid_day", prep)).toBeNull();
  expect(reportParDeviation("opening", null)).toBeNull();
});

it("keeps detail/batch/trends signal parity, inactive-item history and completion percentage", async () => {
  const { client } = fake(data());
  const reports = [report("opening", "open"), report("am_prep", "am"), report("mid_day", "mid"), report("closing", "empty"), report("closing", "optional")];
  const batch = await computeReportSignalsBatch(client, reports, new Set(), viewer);
  for (const r of reports) {
    const single = await computeReportSignals(client, { ...r, viewer, tempItemIds: new Set() });
    expect(single.signals).toEqual(batch.get(r.id));
    if (r.id === "am") expect(single.prepValues).toMatchObject([{ par: 10, total: 2 }]);
  }
  expect(batch.get("open")).toMatchObject({ done: 2, total: 2, underPar: 1, overPar: 1, skipped: 0, notStarted: 0 });
  expect(batch.get("am")).toMatchObject({ done: 1, total: 1, underPar: 0, overPar: 0 });
  expect(batch.get("mid")).toMatchObject({ done: 1, total: 1, underPar: 0, overPar: 1 });
  expect(batch.get("empty")).toMatchObject({ done: 0, total: 1, skipped: 0, notStarted: 1 });
  expect(batch.get("optional")).toMatchObject({ done: 0, total: 1, skipped: 1, notStarted: 0 });
  const trend = await loadTrendSeries(client, { viewer, locationId: "shop", granularity: "day", compare: false, today: "2026-10-07" });
  expect(trend.current.find(b => b.key === date)).toMatchObject({ underPar: 1, overPar: 2, skipped: 1, notStarted: 1, completionPct: 67 });
  expect(trend.totals.completion.current).toBe(67);
  expect(composeReportSummary(reports.map(r => ({ ...r, signalSummary: batch.get(r.id) })))).toMatchObject({ signals: { underPar: 1, overPar: 2, skipped: 1, notStarted: 1 } });
});

it("not-started and skipped list filters select different instances", async () => {
  const { client } = fake(data());
  const args = { viewer, locationId: "shop", dateFrom: date, dateTo: date, types: ["closing"] as ReportTypeKey[] };
  expect((await listReports(client, { ...args, signalFilters: { notStarted: true } })).map(r => r.id)).toEqual(["empty"]);
  expect((await listReports(client, { ...args, signalFilters: { skipped: true } })).map(r => r.id)).toEqual(["optional"]);
});

it.each([
  ["open", "opening", "closing"], ["am", "am_prep", "mid_day"], ["mid", "mid_day", "am_prep"], ["empty", "closing", "opening"],
] as const)("refuses wrong detail type for %s and accepts its actual template type", async (id, correct, wrong) => {
  const { client } = fake(data());
  expect(await loadReportDetail(client, { viewer, locationId: "shop", id, type: wrong })).toBeNull();
  expect(await loadReportDetail(client, { viewer, locationId: "shop", id, type: correct })).not.toBeNull();
});
