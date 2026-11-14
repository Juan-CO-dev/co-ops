/**
 * W03/B040 — a finalized closing locks the day's cash report, whoever finalized it.
 *
 * The bug: `submitCashReport`'s edit-window gate refused only `confirmed` and
 * `incomplete_confirmed`. A closing the SYSTEM finished (`auto_finalized`: the opener's release
 * or the 16 h auto-release) left the gate open, so a key holder could post a past date and
 * supersede that night's signed deposit. The fix is ONE status list (`CASH_LOCKING_CLOSING_STATUSES`)
 * read by the write gate, the /cash page's up-front lock and migration 0304's in-transaction check.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => {}) }));

import { submitCashReport } from "@/lib/cash";
import { CASH_LOCKING_CLOSING_STATUSES, closingLocksCash } from "@/lib/cash-shared";

/** A chainable fake: the closing template exists, its instance has `status`; records cash writes. */
function fakeService(status: string | null) {
  const writes: string[] = [];
  const chain = (table: string, kind: string) => {
    const done = () => {
      if (table === "checklist_templates") return Promise.resolve({ data: { id: "closing-tmpl" }, error: null });
      if (table === "checklist_instances") return Promise.resolve({ data: status === null ? null : { status }, error: null });
      if (table === "cash_reports" && kind === "insert") return Promise.resolve({ data: { id: "new-1" }, error: null });
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
    // Pre-0304 shape: the RPC is not installed, so the writer takes its direct-write path.
    rpc: (name: string) => { writes.push(`rpc.${name}`); return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }); },
  };
  return { service: service as never, writes };
}

const ARGS = {
  locationId: "loc-1", date: "2026-11-10",
  actor: { userId: "kh-1", role: "key_holder" as const, level: 4, locations: ["loc-1"] },
  projectedCents: 50_000, drawerTotalCents: 60_000, floatCents: 20_000,
  countMethod: "hand" as const, denominations: null,
  cashTipsCents: 0, onShift: [], overShortNote: null, toastProjected: null,
};

describe("submitCashReport refuses every finalized closing (B040)", () => {
  it.each(["confirmed", "incomplete_confirmed", "auto_finalized"])("%s → closing_finalized, nothing written", async (status) => {
    const { service, writes } = fakeService(status);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "closing_finalized" });
    expect(writes).toEqual([]);
  });

  it.each([["open"], [null]])("closing %s → the edit window is open", async (status) => {
    const { service, writes } = fakeService(status);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-1" });
    expect(writes).toContain("cash_reports.insert");
  });
});

describe("one list of locking statuses", () => {
  it("is every finalized closing status and nothing transitional", () => {
    expect([...CASH_LOCKING_CLOSING_STATUSES]).toEqual(["confirmed", "incomplete_confirmed", "auto_finalized"]);
    for (const s of ["open", "phase1_complete", "phase2_complete", "", null, undefined]) expect(closingLocksCash(s)).toBe(false);
  });

  it("the /cash page's up-front lock and the write gate both read closingLocksCash (no inline status list)", () => {
    for (const f of ["app/(authed)/cash/page.tsx", "lib/cash.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("closingLocksCash(cInst?.status)");
      expect(src, f).not.toMatch(/status === "incomplete_confirmed"/);
    }
  });
});
