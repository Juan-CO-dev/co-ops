/**
 * W21/B027: the real reader behind `priorAmPrep` reads the AM prep instance dated the day BEFORE the
 * pulse's operational date (the list today's opening consumes), across every AM prep template version
 * the shop has ever had (a retired version still holds yesterday's report), and never turns a failed
 * read into "not started".
 *
 * W21 r2: the lookup must stay correct and bounded however many versions the shop accumulates — no
 * unpaginated version read (PostgREST caps a response at 1000 rows) and no id list on the request
 * line. The fake below is data-backed: it applies eq / in / embedded-`!inner` filters, the 1000-row
 * cap, order and limit, and records the request line each query would send.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("not used"); } }));

import { loadPriorAmPrepStatus } from "@/lib/midshift";
import { defaultPulseDeps, type PulseCtx } from "@/lib/pulse/sections";
import type { AuthContext } from "@/lib/session";

const LOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MAX_ROWS = 1000;
/** A conservative request-line budget (common proxy / server defaults sit at 8 KB). */
const MAX_REQUEST_LINE = 4000;

type Tmpl = { id: string; location_id: string; type: string; prep_subtype: string | null; active: boolean };
type Inst = { id: string; template_id: string; location_id: string; date: string; status: string; created_at: string };
type Row = Record<string, unknown>;

function uuid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${h}`;
}

function fakeDb(data: { templates: Tmpl[]; instances: Inst[] }, fail?: { table: string; message: string }) {
  const calls: Array<{ table: string; select: string; ops: Array<[string, unknown[]]>; requestLine: string }> = [];
  return {
    calls,
    from(table: string) {
      const entry = { table, select: "", ops: [] as Array<[string, unknown[]]>, requestLine: "" };
      calls.push(entry);
      const run = (): { data: unknown; error: { message: string } | null } => {
        const parts = [`select=${entry.select}`];
        for (const [m, a] of entry.ops) {
          if (m === "eq") parts.push(`${a[0]}=eq.${String(a[1])}`);
          if (m === "in") parts.push(`${a[0]}=in.(${(a[1] as unknown[]).join(",")})`);
          if (m === "order") parts.push(`order=${a[0]}`);
          if (m === "limit") parts.push(`limit=${a[0]}`);
          if (m === "range") parts.push(`offset=${a[0]}`);
        }
        entry.requestLine = `GET /rest/v1/${table}?${parts.join("&")}`;
        if (fail && fail.table === table) return { data: null, error: { message: fail.message } };
        const embed = /checklist_templates!inner/.test(entry.select);
        let rows: Row[] = table === "checklist_templates"
          ? data.templates.map((t) => ({ ...t }))
          : data.instances.map((i) => ({ ...i, ...(embed ? { checklist_templates: data.templates.find((t) => t.id === i.template_id) ?? null } : {}) }));
        if (embed) rows = rows.filter((r) => r.checklist_templates != null);
        for (const [m, a] of entry.ops) {
          const col = String(a[0]);
          const get = (r: Row) => {
            if (!col.includes(".")) return r[col];
            const [rel, c] = col.split(".");
            return (r[rel!] as Row | null)?.[c!];
          };
          if (m === "eq") rows = rows.filter((r) => get(r) === a[1]);
          if (m === "in") rows = rows.filter((r) => (a[1] as unknown[]).includes(get(r)));
        }
        const ord = entry.ops.find(([m]) => m === "order");
        if (ord) {
          const asc = (ord[1][1] as { ascending?: boolean } | undefined)?.ascending !== false;
          const c = String(ord[1][0]);
          rows.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1));
        }
        const range = entry.ops.find(([m]) => m === "range");
        if (range) rows = rows.slice(Number(range[1][0]), Number(range[1][1]) + 1);
        rows = rows.slice(0, MAX_ROWS);
        const lim = entry.ops.find(([m]) => m === "limit");
        if (lim) rows = rows.slice(0, Number(lim[1][0]));
        return { data: rows, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = (s: string) => { entry.select = s; return q; };
      for (const m of ["eq", "in", "order", "limit", "range", "returns"]) q[m] = (...args: unknown[]) => { entry.ops.push([m, args]); return q; };
      q.maybeSingle = async () => {
        const r = run();
        if (r.error) return r;
        const rows = r.data as Row[];
        if (rows.length > 1) return { data: null, error: { message: "maybeSingle: multiple rows" } };
        return { data: rows[0] ?? null, error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
      return q;
    },
  };
}

const amTmpl = (id: string, active: boolean, location_id = LOC): Tmpl => ({ id, location_id, type: "prep", prep_subtype: "am_prep", active });
const inst = (id: string, template_id: string, status: string, date = "2026-10-08", created_at = "2026-10-08T22:00:00Z", location_id = LOC): Inst =>
  ({ id, template_id, location_id, date, status, created_at });

describe("loadPriorAmPrepStatus (B027)", () => {
  it("yesterday's report on a since-retired version A, with replacement B now active → done, not a false alert (r1)", async () => {
    const db = fakeDb({ templates: [amTmpl("tA", false), amTmpl("tB", true)], instances: [inst("iA", "tA", "confirmed")] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "iA", date: "2026-10-08", progress: "done" });
  });
  it("only counts AM prep at this shop on that date: other subtypes, other shops and other days are ignored", async () => {
    const db = fakeDb({
      templates: [amTmpl("t1", true), { ...amTmpl("tMid", true), prep_subtype: "mid_day_prep" }, { id: "tOpen", location_id: LOC, type: "opening", prep_subtype: null, active: true }, amTmpl("tOther", true, OTHER)],
      instances: [
        inst("iMid", "tMid", "confirmed"), inst("iOpen", "tOpen", "confirmed"),
        inst("iOther", "tOther", "confirmed", "2026-10-08", "2026-10-08T22:00:00Z", OTHER),
        inst("iDay", "t1", "confirmed", "2026-10-07"),
      ],
    });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: null, date: "2026-10-08", progress: "not_started" });
  });
  it("only retired versions and no report that day → null (the shop no longer runs AM prep)", async () => {
    const db = fakeDb({ templates: [amTmpl("tA", false)], instances: [] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toBeNull();
  });
  it("no instance that day → not started, no id; an open one → in progress", async () => {
    const none = fakeDb({ templates: [amTmpl("t1", true)], instances: [] });
    expect(await loadPriorAmPrepStatus(none as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: null, date: "2026-10-08", progress: "not_started" });
    const open = fakeDb({ templates: [amTmpl("t1", true)], instances: [inst("i2", "t1", "open")] });
    expect(await loadPriorAmPrepStatus(open as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "i2", date: "2026-10-08", progress: "in_progress" });
  });
  it("a duplicate day-instance degrades to the newest, never a throw", async () => {
    const db = fakeDb({ templates: [amTmpl("t1", true)], instances: [inst("iOld", "t1", "open", "2026-10-08", "2026-10-08T20:00:00Z"), inst("iNew", "t1", "confirmed", "2026-10-08", "2026-10-08T23:00:00Z")] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "iNew", date: "2026-10-08", progress: "done" });
  });
  it("a shop with no AM prep template → null (nothing to flag)", async () => {
    const db = fakeDb({ templates: [], instances: [] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toBeNull();
  });
  it("r2: past 1000 versions, yesterday's report on version #1400 is still found, and every request line stays bounded", async () => {
    const templates = Array.from({ length: 1500 }, (_, n) => amTmpl(uuid(n), n === 1499));
    const db = fakeDb({ templates, instances: [inst("iDeep", uuid(1400), "confirmed")] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "iDeep", date: "2026-10-08", progress: "done" });
    for (const c of db.calls) expect(c.requestLine.length).toBeLessThan(MAX_REQUEST_LINE);
  });
  it("r2: past 1000 versions with no report that day → not started (the active version is not lost behind the cap)", async () => {
    const templates = Array.from({ length: 1500 }, (_, n) => amTmpl(uuid(n), n === 1499));
    const db = fakeDb({ templates, instances: [] });
    expect(await loadPriorAmPrepStatus(db as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: null, date: "2026-10-08", progress: "not_started" });
    for (const c of db.calls) expect(c.requestLine.length).toBeLessThan(MAX_REQUEST_LINE);
  });
  it("read errors throw, never a fake 'not started'", async () => {
    const t = fakeDb({ templates: [amTmpl("t1", true)], instances: [] }, { table: "checklist_templates", message: "down" });
    await expect(loadPriorAmPrepStatus(t as never, { locationId: LOC, date: "2026-10-08" })).rejects.toThrow(/checklist_templates/);
    const i = fakeDb({ templates: [amTmpl("t1", true)], instances: [] }, { table: "checklist_instances", message: "down" });
    await expect(loadPriorAmPrepStatus(i as never, { locationId: LOC, date: "2026-10-08" })).rejects.toThrow(/checklist_instances/);
  });
  it("the pulse wiring asks for YESTERDAY's operational date", async () => {
    const db = fakeDb({ templates: [amTmpl("t1", true)], instances: [inst("iY", "t1", "confirmed", "2026-10-31"), inst("iT", "t1", "open", "2026-11-01")] });
    const auth = { user: { id: "me", role: "gm", language: "en" }, session: {}, role: "gm", level: 7, locations: [LOC] } as unknown as AuthContext;
    const ctx: PulseCtx = { auth, locationId: LOC, date: "2026-11-01", now: new Date("2026-11-01T15:00:00Z") };
    expect(await defaultPulseDeps(db as never).priorAmPrep(ctx)).toEqual({ reportId: "iY", date: "2026-10-31", progress: "done" });
  });
});
