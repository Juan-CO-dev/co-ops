// Item 1 PR B (phase 1, recovery only — plan r3 §4.5 step 3): `ezcater-shadow-backfill --links-only`
// rebuilds links (pass 2 + reconcile_ezcater_toast) and NEVER records a comparison, so it never asks
// for capture coverage and may include tomorrow (the early-ring D+1 date).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseShadowArgs, runShadowBackfill } from "../scripts/ezcater-shadow-backfill";
import { materializeEzcaterShadow } from "@/lib/ezcater/pass2";
import { loadReconciledSalesWindow } from "@/lib/ezcater/depletion";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

vi.mock("@/lib/ezcater/pass2", () => ({ materializeEzcaterShadow: vi.fn() }));
vi.mock("@/lib/ezcater/depletion", () => ({ loadReconciledSalesWindow: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase-paginate", () => ({ selectAllRows: vi.fn() }));
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(materializeEzcaterShadow).mockResolvedValue({ processed: 1, failed: 0, deferred: false });
  vi.mocked(selectAllRows).mockResolvedValue([{ id: "o1", event_date: "2026-10-08" }, { id: "o2", event_date: "2026-10-09" }] as never);
  rpc.mockReturnValue({ abortSignal: async () => ({ error: null }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from: vi.fn() } as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe("--links-only", () => {
  it("parses as a flag; default stays the normal comparison mode", () => {
    expect(parseShadowArgs(["--from", "2026-10-08", "--to", "2026-10-09"])).toMatchObject({ linksOnly: false, execute: false });
    expect(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-09", "--expect", "2", "--execute"]))
      .toEqual({ execute: true, from: "2026-10-08", to: "2026-10-09", expect: 2, linksOnly: true });
  });
  it("accepts tomorrow (ET) as the last event date", () => {
    const tomorrow = etYmdMinusDays(etCalendarDate(new Date().toISOString()), -1);
    expect(parseShadowArgs(["--links-only", "--from", etYmdMinusDays(tomorrow, 7), "--to", tomorrow])).toMatchObject({ to: tomorrow, linksOnly: true });
  });
  it("keeps the dry run read-only and says which mode it would run", async () => {
    expect(await runShadowBackfill(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-09"])))
      .toEqual({ dryRun: true, linksOnly: true, orders: 2, from: "2026-10-08", to: "2026-10-09" });
    expect(materializeEzcaterShadow).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rebuilds pass 2 then reconcile per date and never reads coverage or records a comparison", async () => {
    const result = await runShadowBackfill(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-09", "--expect", "2", "--execute"]));
    expect(result).toMatchObject({ dryRun: false, linksOnly: true, orders: 2 });
    expect(vi.mocked(materializeEzcaterShadow).mock.calls.map((c) => [c[0], c[1]])).toEqual([["2026-10-08", "2026-10-08"], ["2026-10-09", "2026-10-09"]]);
    expect(rpc.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["reconcile_ezcater_toast", { p_from: "2026-10-08", p_to: "2026-10-08" }],
      ["reconcile_ezcater_toast", { p_from: "2026-10-09", p_to: "2026-10-09" }],
    ]);
    expect(loadReconciledSalesWindow).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some((c) => c[0] === "record_ezcater_reconciled_comparison")).toBe(false);
  });
  it.each([
    ["failed", { processed: 1, failed: 1, deferred: false }],
    ["deferred", { processed: 0, failed: 0, deferred: true }],
    ["skipped", { processed: 0, failed: 0, deferred: false, skipped: "ezcater_schema_missing" }],
  ])("stops on a %s pass 2 before reconciling that date", async (_label, outcome) => {
    vi.mocked(materializeEzcaterShadow).mockResolvedValueOnce(outcome as never);
    await expect(runShadowBackfill(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-09", "--expect", "2", "--execute"])))
      .rejects.toThrow("shadow_backfill_incomplete");
    expect(rpc).not.toHaveBeenCalled();
    expect(materializeEzcaterShadow).toHaveBeenCalledTimes(1);
  });
  it("stops when reconcile_ezcater_toast fails", async () => {
    rpc.mockReturnValue({ abortSignal: async () => ({ error: { message: "x" } }) });
    await expect(runShadowBackfill(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-08", "--expect", "2", "--execute"])))
      .rejects.toThrow("ezcater_reconcile_failed");
  });
  it("still refuses a wrong --expect before writing anything", async () => {
    await expect(runShadowBackfill(parseShadowArgs(["--links-only", "--from", "2026-10-08", "--to", "2026-10-09", "--expect", "3", "--execute"])))
      .rejects.toThrow("shadow_expected_count_mismatch");
    expect(materializeEzcaterShadow).not.toHaveBeenCalled();
  });
});

describe("normal mode is unchanged", () => {
  it("still reads coverage and records the comparison, and prints nothing per date", async () => {
    vi.mocked(loadReconciledSalesWindow).mockResolvedValue({ rows: [], coverage: { source: "capture", hasGaps: false, degraded: false, byLocation: {} } } as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runShadowBackfill(parseShadowArgs(["--from", "2026-10-08", "--to", "2026-10-08", "--expect", "2", "--execute"])))
      .toEqual({ dryRun: false, orders: 2, runs: [{ date: "2026-10-08", processed: 1, failed: 0, deferred: false }] });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["reconcile_ezcater_toast", "record_ezcater_reconciled_comparison"]);
    expect(log).not.toHaveBeenCalled();
    expect(await runShadowBackfill(parseShadowArgs(["--from", "2026-10-08", "--to", "2026-10-09"]))).toEqual({ dryRun: true, orders: 2, from: "2026-10-08", to: "2026-10-09" });
    log.mockRestore();
  });
});
