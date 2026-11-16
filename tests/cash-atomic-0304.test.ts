/**
 * W03/B041 — the cash edit-window check runs INSIDE the write transaction (migration 0304).
 *
 * The bug: `submitCashReport` read the closing status, then wrote cash_reports in separate round
 * trips. A manager's confirm (or release_overdue_closings) committing in between let the edit
 * supersede the finalized night's deposit. 0304 re-emits `submit_cash_report_atomic`: it locks the
 * day's closing instance FOR SHARE, re-checks the status, then supersedes (compare-and-set), inserts
 * and back-points in ONE transaction. lib/cash.ts calls it, and falls back to the direct writes only
 * while the function is missing (0304 not applied yet).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { audit } from "@/lib/audit";
import { cashAtomicRpcArgs, submitCashReport } from "@/lib/cash";
import { CASH_LOCKING_CLOSING_STATUSES } from "@/lib/cash-shared";

// W03 follow-up: below GM a cash date must be inside the current business week (Mon–Sun, ET), so the
// key holder filing 2026-11-10 here runs at a fixed instant in that week, not the machine's clock.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-12T17:00:00.000Z")); });
afterAll(() => { vi.useRealTimers(); });

const SQL = readFileSync("supabase/migrations/0304_cash_report_closing_lock.sql", "utf8");
const lower = SQL.toLowerCase();

const ARGS = {
  locationId: "loc-1", date: "2026-11-10",
  actor: { userId: "kh-1", role: "key_holder" as const, level: 4, locations: ["loc-1"] },
  projectedCents: 50_000, drawerTotalCents: 60_000, floatCents: 20_000,
  countMethod: "denomination" as const, denominations: { "2000": 30 },
  cashTipsCents: 500, onShift: [{ userId: null, name: "Ana" }], overShortNote: "ok",
  toastProjected: { cents: 49_000, asOf: "2026-11-11T02:00:00.000Z" },
};

type RpcAnswer = { data?: unknown; error?: { code?: string; message: string } | null };

/** Fake client: an open closing instance for the day; the RPC answers per scenario; records every write. */
function fakeService(rpcAnswer: RpcAnswer) {
  const writes: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const chain = (table: string, kind: string) => {
    const done = () => {
      if (table === "checklist_instances") return Promise.resolve({ data: [{ status: "open" }], error: null });
      if (table === "cash_reports" && kind === "insert") return Promise.resolve({ data: { id: "direct-1" }, error: null });
      return Promise.resolve({ data: null, error: null, count: 1 });
    };
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, or: () => b, order: () => b, limit: () => b,
      maybeSingle: done, single: done, then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done().then(ok, bad),
    };
    return b;
  };
  const service = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      insert: () => { writes.push(`${table}.insert`); return chain(table, "insert"); },
      update: () => { writes.push(`${table}.update`); return chain(table, "update"); },
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcAnswer.data ?? null, error: rpcAnswer.error ?? null });
    },
  };
  return { service: service as never, writes, rpcCalls };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("submitCashReport writes through 0304's transactional writer (B041)", () => {
  it("calls submit_cash_report_atomic with the server's totals (no template id — the SQL locks every closing instance), and writes nothing directly", async () => {
    const { service, writes, rpcCalls } = fakeService({ data: [{ new_id: "new-1", superseded_id: "old-1" }] });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-1" });
    expect(writes).toEqual([]);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.name).toBe("submit_cash_report_atomic");
    expect(rpcCalls[0]!.args).toMatchObject({
      p_location_id: "loc-1", p_report_date: "2026-11-10",
      p_drawer_total_cents: 60_000, p_float_cents: 20_000,
      p_deposit_cents: 40_000, p_over_short_cents: -10_000, // computeCashTotals, never the client
      p_denominations: { "2000": 30 }, p_toast_projected_cents: 49_000, p_toast_projected_as_of: "2026-11-11T02:00:00.000Z",
      p_actor_id: "kh-1",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cash_report.supersede", resourceId: "new-1", metadata: expect.objectContaining({ superseded: "old-1" }),
    }));
  });

  it("a first submit audits as cash_report.submit", async () => {
    const { service } = fakeService({ data: [{ new_id: "new-1", superseded_id: null }] });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-1" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cash_report.submit", metadata: expect.objectContaining({ superseded: null }) }));
  });

  it("sends no template id: the in-transaction gate cannot be disarmed by the app's template resolution (review r1)", async () => {
    const { service, rpcCalls } = fakeService({ data: [{ new_id: "new-1", superseded_id: null }] });
    await submitCashReport(service, ARGS);
    expect(rpcCalls[0]!.args).not.toHaveProperty("p_closing_template_id");
  });

  it("the in-transaction refusal closing_finalized (a confirm won the race) → closing_finalized, nothing audited", async () => {
    const { service, writes } = fakeService({ error: { code: "P0001", message: "closing_finalized" } });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "closing_finalized" });
    expect(writes).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a 23505 (a concurrent submit committed first) → concurrent_submit", async () => {
    const { service, writes } = fakeService({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "concurrent_submit" });
    expect(writes).toEqual([]);
  });

  it.each([
    [{ code: "PGRST202", message: "Could not find the function public.submit_cash_report_atomic(...)" }],
    [{ code: "42883", message: "function public.submit_cash_report_atomic(...) does not exist" }],
  ])("before 0304 is applied (%o) it falls back to the direct writes, and says so in the log", async (error) => {
    const { service, writes } = fakeService({ error });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "direct-1" });
    expect(writes).toContain("cash_reports.insert");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[cash 0304_missing]"), expect.anything());
  });

  it("any other RPC error throws (the route's 500), never a silent fallback", async () => {
    const { service, writes } = fakeService({ error: { code: "XX000", message: "boom" } });
    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/submit_cash_report_atomic: boom/);
    expect(writes).toEqual([]);
  });

  it("an unexpected result shape throws", async () => {
    const { service } = fakeService({ data: [] });
    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/unexpected shape/);
  });

  it("a hand count sends no denominations", () => {
    const a = cashAtomicRpcArgs({ ...ARGS, countMethod: "hand" }, { overShortCents: 0, depositCents: 0, nowIso: "x" });
    expect(a.p_denominations).toBeNull();
  });
});

describe("the RPC contract matches migration 0304", () => {
  const start = lower.indexOf("create function public.submit_cash_report_atomic(");
  const params = lower.slice(start, lower.indexOf(") returns table", start))
    .split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);

  it("lib/cash.ts sends exactly the function's named arguments, in order", () => {
    const keys = Object.keys(cashAtomicRpcArgs(ARGS, { overShortCents: 0, depositCents: 0, nowIso: "x" }));
    expect(params).toHaveLength(16);
    expect(keys).toEqual(params);
  });

  it("the SQL gate's status list is CASH_LOCKING_CLOSING_STATUSES", () => {
    const listed = CASH_LOCKING_CLOSING_STATUSES.map((s) => `'${s}'`).join(", ");
    expect(lower).toContain(`status in (${listed})`);
  });

  it("locks the day's closing instances FOR SHARE (FOR KEY SHARE would not block a status update) before the supersede", () => {
    const body = lower.slice(start, lower.indexOf("end $$;", start));
    const lock = body.indexOf("for share of ci;");
    expect(lock).toBeGreaterThan(-1);
    expect(body).not.toContain("for key share");
    // review r1: every closing instance of the shop/day, any template version — no id, no active / effective filter.
    expect(body).not.toContain("p_closing_template_id");
    expect(body).toContain("join public.checklist_templates ct on ct.id = ci.template_id and ct.type = 'closing'");
    expect(body).not.toMatch(/ct\.active|effective_from/);
    expect(lock).toBeLessThan(body.indexOf("update public.cash_reports"));
    expect(body).toContain("raise exception 'closing_finalized'");
    expect(body).toMatch(/and superseded_at is null\s+returning id into v_prior_id;/);
    expect(body).toContain("toast_projected_cents, toast_projected_as_of");
  });

  it("drops 0188's gate-less signature and re-asserts the service_role-only posture", () => {
    expect(lower).toContain("drop function public.submit_cash_report_atomic(\n  uuid, date, integer, integer, integer, text, jsonb, integer, jsonb, integer, integer, text, uuid, timestamptz\n);");
    expect(lower).toContain("security definer set search_path = pg_catalog, public");
    expect(lower).toMatch(/revoke all on function public\.submit_cash_report_atomic\([^)]*\)\s+from public, anon, authenticated;/);
    expect(lower).toMatch(/grant execute on function public\.submit_cash_report_atomic\([^)]*\)\s+to service_role;/);
    expect(SQL).toContain("raise exception '0304: RPC grant escaped on %'");
  });

  it("carries the house header: authored, NOT applied, apply order named", () => {
    const lines = SQL.split("\n");
    expect(lines[0]).toBe("-- Migration 0304_cash_report_closing_lock");
    expect(lines[1]).toMatch(/^-- AUTHORED \d{4}-\d{2}-\d{2}\. NOT YET APPLIED — apply via MCP after review/);
    expect(SQL).toContain("raise exception '0304: already applied");
    expect(SQL).toContain("raise exception '0304: expected 0188 submit_cash_report_atomic signature'");
  });

  it("the executable proof (PGlite: the REAL 0067 + 0069 + 0188 + 0253's columns + 0304 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0304.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0304:");
  }, 260_000);
});
