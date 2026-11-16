/**
 * W21/B027: the real reader behind `priorAmPrep` reads the AM prep instance dated the day BEFORE the
 * pulse's operational date (the list today's opening consumes), across every AM prep template version
 * the shop has ever had (a retired version still holds yesterday's report), and never turns a failed
 * read into "not started".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("not used"); } }));

import { loadPriorAmPrepStatus } from "@/lib/midshift";
import { defaultPulseDeps, type PulseCtx } from "@/lib/pulse/sections";
import type { AuthContext } from "@/lib/session";

const LOC = "11111111-1111-4111-8111-111111111111";
type Result = { data: unknown; error: { message: string } | null };

function fakeClient(results: { templates: Result; instance: Result }) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  return {
    calls,
    from(table: string) {
      const entry = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(entry);
      const base = table === "checklist_templates" ? results.templates : results.instance;
      // Honour an `active` filter on templates the way PostgREST would, so a reader that narrows to
      // active versions really loses the retired one in these tests.
      const result = (): Result => {
        const activeEq = entry.ops.find(([m, a]) => m === "eq" && a[0] === "active");
        if (table !== "checklist_templates" || !activeEq || !Array.isArray(base.data)) return base;
        return { ...base, data: (base.data as Array<{ active?: boolean }>).filter((t) => t.active === activeEq[1][1]) };
      };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit", "returns"]) q[m] = (...args: unknown[]) => { entry.ops.push([m, args]); return q; };
      q.maybeSingle = async () => result();
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
  };
}
const op = (c: { ops: Array<[string, unknown[]]> }, name: string) => c.ops.filter(([m]) => m === name).map(([, a]) => a);

describe("loadPriorAmPrepStatus (B027)", () => {
  it("reads that day's newest instance across every AM prep template version, active or retired", async () => {
    const c = fakeClient({ templates: { data: [{ id: "t1", active: true }, { id: "t2", active: false }], error: null }, instance: { data: { id: "i1", status: "confirmed" }, error: null } });
    const r = await loadPriorAmPrepStatus(c as never, { locationId: LOC, date: "2026-10-08" });
    expect(r).toEqual({ reportId: "i1", date: "2026-10-08", progress: "done" });
    const [tmpl, inst] = c.calls;
    expect(op(tmpl!, "eq")).toEqual(expect.arrayContaining([["location_id", LOC], ["type", "prep"], ["prep_subtype", "am_prep"]]));
    // Never narrowed to active: Path A versioning retires the version yesterday's report was filed on.
    expect(op(tmpl!, "eq")).not.toEqual(expect.arrayContaining([["active", true]]));
    expect(op(inst!, "in")).toEqual([["template_id", ["t1", "t2"]]]);
    expect(op(inst!, "eq")).toEqual(expect.arrayContaining([["location_id", LOC], ["date", "2026-10-08"]]));
  });
  it("yesterday's report on a since-retired version A, with replacement B now active → done, not a false alert (r1)", async () => {
    const c = fakeClient({
      templates: { data: [{ id: "tA", active: false }, { id: "tB", active: true }], error: null },
      instance: { data: { id: "iA", status: "confirmed" }, error: null },
    });
    expect(await loadPriorAmPrepStatus(c as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "iA", date: "2026-10-08", progress: "done" });
    expect(op(c.calls[1]!, "in")).toEqual([["template_id", ["tA", "tB"]]]);
  });
  it("only retired versions and no report that day → null (the shop no longer runs AM prep)", async () => {
    const c = fakeClient({ templates: { data: [{ id: "tA", active: false }], error: null }, instance: { data: null, error: null } });
    expect(await loadPriorAmPrepStatus(c as never, { locationId: LOC, date: "2026-10-08" })).toBeNull();
  });
  it("no instance that day → not started, no id; an open one → in progress", async () => {
    const none = fakeClient({ templates: { data: [{ id: "t1", active: true }], error: null }, instance: { data: null, error: null } });
    expect(await loadPriorAmPrepStatus(none as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: null, date: "2026-10-08", progress: "not_started" });
    const open = fakeClient({ templates: { data: [{ id: "t1", active: true }], error: null }, instance: { data: { id: "i2", status: "open" }, error: null } });
    expect(await loadPriorAmPrepStatus(open as never, { locationId: LOC, date: "2026-10-08" })).toEqual({ reportId: "i2", date: "2026-10-08", progress: "in_progress" });
  });
  it("a shop with no AM prep template → null (nothing to flag), without reading instances", async () => {
    const c = fakeClient({ templates: { data: [], error: null }, instance: { data: null, error: null } });
    expect(await loadPriorAmPrepStatus(c as never, { locationId: LOC, date: "2026-10-08" })).toBeNull();
    expect(c.calls.map((x) => x.table)).toEqual(["checklist_templates"]);
  });
  it("read errors throw, never a fake 'not started'", async () => {
    const t = fakeClient({ templates: { data: null, error: { message: "down" } }, instance: { data: null, error: null } });
    await expect(loadPriorAmPrepStatus(t as never, { locationId: LOC, date: "2026-10-08" })).rejects.toThrow(/checklist_templates/);
    const i = fakeClient({ templates: { data: [{ id: "t1", active: true }], error: null }, instance: { data: null, error: { message: "down" } } });
    await expect(loadPriorAmPrepStatus(i as never, { locationId: LOC, date: "2026-10-08" })).rejects.toThrow(/checklist_instances/);
  });
  it("the pulse wiring asks for YESTERDAY's operational date", async () => {
    const c = fakeClient({ templates: { data: [{ id: "t1", active: true }], error: null }, instance: { data: null, error: null } });
    const auth = { user: { id: "me", role: "gm", language: "en" }, session: {}, role: "gm", level: 7, locations: [LOC] } as unknown as AuthContext;
    const ctx: PulseCtx = { auth, locationId: LOC, date: "2026-11-01", now: new Date("2026-11-01T15:00:00Z") };
    expect(await defaultPulseDeps(c as never).priorAmPrep(ctx)).toEqual({ reportId: null, date: "2026-10-31", progress: "not_started" });
    expect(op(c.calls[1]!, "eq")).toEqual(expect.arrayContaining([["date", "2026-10-31"]]));
  });
});
