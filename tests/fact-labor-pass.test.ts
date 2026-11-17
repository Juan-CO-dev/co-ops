// Item 2 PR 2c: one bounded LABOR build pass over the week diff (mocked RPCs; no database, no 7shifts,
// no Toast). A raced week is not a failure; every failure is a fixed code; nothing starts past the deadline.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
import { runLaborBuildPass } from "@/lib/facts/labor-facts";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
function fakeSb(rpc: Rpc) {
  return { rpc: vi.fn((name: string, args: Record<string, unknown>) => {
    const call = { abortSignal: () => call, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => rpc(name, args).then(ok, ko) };
    return call;
  }) } as never;
}
const source = (week: string) => ({ week_start: week, built_through: null, floor_day: "2026-07-23", days: [], location_links: [], user_links: [],
  toast_links: [], punches: [], toast_entries: [], wages: [], labor_settings: [], fingerprint: "a".repeat(32) });

describe("runLaborBuildPass", () => {
  it("diffs with the builder version, reads each week's source, writes through the one writer with that read's fingerprint", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const sb = fakeSb(async (name, args) => {
      calls.push({ name, args });
      if (name === "fact_labor_weeks_stale") return { data: [{ week_start: "2026-10-11" }, { week_start: "2026-10-04" }], error: null };
      if (name === "fact_labor_week_source") return { data: source(String(args.p_week_start)), error: null };
      if (args.p_week_start === "2026-10-04") return { data: null, error: { message: "fact_stale" } };
      return { data: {}, error: null };
    });
    const r = await runLaborBuildPass({ deadlineAt: Date.now() + 200_000, sb });
    expect(r).toMatchObject({ stale: 2, built: 1, raced: 1, failed: 0 });
    expect(calls[0]).toEqual({ name: "fact_labor_weeks_stale", args: { p_limit: 200, p_builder_version: LABOR_BUILDER_VERSION } });
    const write = calls.find((c) => c.name === "fact_replace_labor_week")!;
    expect(write.args).toMatchObject({ p_week_start: "2026-10-11", p_fingerprint: "a".repeat(32), p_builder_version: LABOR_BUILDER_VERSION,
      p_quarters: [], p_days: [], p_salaried: [] });
  });
  it("names every failure by a fixed code, never a database message", async () => {
    const sb = fakeSb(async (name, args) => {
      if (name === "fact_labor_weeks_stale") return { data: [{ week_start: "2026-10-11" }, { week_start: "2026-10-04" }], error: null };
      if (name === "fact_labor_week_source") return args.p_week_start === "2026-10-11" ? { data: null, error: { message: "secret" } } : { data: source("2026-10-04"), error: null };
      return { data: null, error: { message: "secret detail" } };
    });
    const r = await runLaborBuildPass({ deadlineAt: Date.now() + 200_000, sb });
    expect(r).toMatchObject({ failed: 2, failures: [{ weekStart: "2026-10-11", error: "fact_source_read_failed" }, { weekStart: "2026-10-04", error: "fact_replace_failed" }] });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("starts no week without a whole week budget before the deadline", async () => {
    const sb = fakeSb(async (name) => name === "fact_labor_weeks_stale" ? { data: [{ week_start: "2026-10-11" }], error: null } : { data: {}, error: null });
    const r = await runLaborBuildPass({ deadlineAt: Date.now() + 1_000, weekTimeoutMs: 60_000, sb });
    expect(r).toMatchObject({ stale: 1, built: 0, leftForNextPass: 1 });
  });
  it("a failed diff throws a fixed code", async () => {
    const sb = fakeSb(async () => ({ data: null, error: { message: "boom" } }));
    await expect(runLaborBuildPass({ deadlineAt: Date.now() + 200_000, sb })).rejects.toThrow("fact_diff_failed");
  });
});
