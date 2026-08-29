/**
 * Unit spine — submitCashReport's SUPERSEDE ROLLBACK, the failure handler's own failure.
 *
 * `submitCashReport` is a three-statement append-only write with no transaction around it:
 * supersede the prior live row → insert the new one → back-point the prior. The middle
 * statement failing is already handled (roll the supersede back); the wiring audit found the
 * hole one level down — when the ROLLBACK fails, the prior row stays superseded with no live
 * successor, and every read surface (`loadCashReport`, reports hub, dashboard) filters
 * `superseded_at IS NULL`, so the day reads as "no cash report" for a location that filed one.
 * Only a console.error recorded it.
 *
 * The refinement this file pins is the part the finding did not say, and it is why the fix is
 * not "log louder": a FAILED ROLLBACK IS NOT PROOF OF A STRAND. Under two simultaneous submits
 * the loser's rollback is REFUSED by `cash_reports_one_live_per_day` (probe-verified live on
 * prod, 2026-08-29) precisely because the winner's row is already live — refusing is the index
 * doing its job, and nothing is stranded. So the writer must ask the question that actually
 * matters (is there a live report for this location/date?) before crying strand.
 *
 * `submitCashReport` is DB-coupled, so it is off the pure spine by the house law — but it takes
 * its `SupabaseClient` as a PARAMETER, which makes the query SEQUENCE observable without a
 * database. The fake below records every operation in order and answers each one from a
 * scenario; the assertions are about which questions the writer asks and what it filters on,
 * never about Postgres. `audit()` reaches for `getServiceRoleClient()` and there is no Supabase
 * env here, so it fails open into its own console.error — which is why the strand assertions
 * match on the strand message specifically rather than on "console.error was called".
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { submitCashReport, type CashActor } from "@/lib/cash";

// ── The fake client ──────────────────────────────────────────────────────────
// Chainable, thenable, and it records. Every builder resolves through one handler
// so a scenario answers by (table, kind, filters) and the test reads the tape.

type Filter = { op: string; column: string; value: unknown };

interface RecordedOp {
  table: string;
  kind: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  options?: Record<string, unknown>;
  filters: Filter[];
  /** Set when the op is actually awaited (a built-but-unspent builder never resolves). */
  spent: boolean;
}

type Answer = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

function makeService(answer: (op: RecordedOp) => Answer) {
  const ops: RecordedOp[] = [];

  const builder = (op: RecordedOp) => {
    const resolve = () => {
      op.spent = true;
      const a = answer(op);
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count });
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => { op.filters.push({ op: "eq", column, value }); return b; },
      is: (column: string, value: unknown) => { op.filters.push({ op: "is", column, value }); return b; },
      or: (filters: string) => { op.filters.push({ op: "or", column: filters, value: null }); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: resolve,
      single: resolve,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => resolve().then(ok, bad),
    };
    return b;
  };

  const push = (op: Omit<RecordedOp, "filters" | "spent">) => {
    const full: RecordedOp = { ...op, filters: [], spent: false };
    ops.push(full);
    return builder(full);
  };

  const service = {
    from: (table: string) => ({
      select: () => push({ table, kind: "select" }),
      insert: (payload: Record<string, unknown>) => push({ table, kind: "insert", payload }),
      update: (payload: Record<string, unknown>, options?: Record<string, unknown>) =>
        push({ table, kind: "update", payload, options }),
    }),
  };

  // The lib types this as SupabaseClient; the fake implements only what it calls.
  return { service: service as never, ops };
}

const ACTOR: CashActor = { userId: "user-1", role: "gm", level: 7 };
const LOC = "loc-1";
const DATE = "2026-08-29";
const PRIOR = "prior-report-1";

const ARGS = {
  locationId: LOC, date: DATE, actor: ACTOR,
  projectedCents: 40_000, drawerTotalCents: 55_000, floatCents: 15_000,
  countMethod: "hand" as const, denominations: null,
  cashTipsCents: 0, onShift: [], overShortNote: null,
};

/** Scenario knobs: what each step does. Everything else answers "nothing here". */
interface Scenario {
  prior?: boolean;
  insertFails?: boolean;
  rollbackFails?: boolean;
  rollbackRows?: number;
  /** What a post-rollback liveness re-read finds (the fix's new question). */
  liveAfter?: string | null;
}

function scenarioService(s: Scenario) {
  let cashSelects = 0;
  return makeService((op) => {
    if (op.table === "checklist_templates") return { data: null };          // no closing template → edit window open
    if (op.table === "cash_reports" && op.kind === "select") {
      cashSelects += 1;
      // First cash_reports select = the prior-live lookup. Any later one is the
      // fix's liveness re-read.
      if (cashSelects === 1) return { data: s.prior ? { id: PRIOR } : null };
      return { data: s.liveAfter ? { id: s.liveAfter } : null };
    }
    if (op.table === "cash_reports" && op.kind === "insert") {
      return s.insertFails
        ? { error: { message: "duplicate key value violates unique constraint", code: "23505" } }
        : { data: { id: "new-report-1" } };
    }
    if (op.table === "cash_reports" && op.kind === "update") {
      const isRollback = op.payload?.superseded_at === null;
      if (isRollback) {
        return s.rollbackFails
          ? { error: { message: "duplicate key value violates unique constraint", code: "23505" } }
          : { count: s.rollbackRows ?? 1 };
      }
      return { count: 1 };
    }
    return { data: null };
  });
}

const cashUpdates = (ops: RecordedOp[]) => ops.filter((o) => o.table === "cash_reports" && o.kind === "update" && o.spent);
const rollbackOp = (ops: RecordedOp[]) => cashUpdates(ops).find((o) => o.payload?.superseded_at === null);
const cashSelects = (ops: RecordedOp[]) => ops.filter((o) => o.table === "cash_reports" && o.kind === "select" && o.spent);

afterEach(() => { vi.restoreAllMocks(); });

describe("submitCashReport — the rollback lifts our own stamp and nobody else's", () => {
  it("filters the rollback on the supersede stamp it wrote, and counts the rows", async () => {
    const { service, ops } = scenarioService({ prior: true, insertFails: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/insert/);

    const supersede = cashUpdates(ops).find((o) => typeof o.payload?.superseded_at === "string");
    const rollback = rollbackOp(ops);
    expect(supersede).toBeDefined();
    expect(rollback).toBeDefined();

    // The stamp the rollback matches on is EXACTLY the one the supersede wrote — an
    // unfiltered rollback would lift a concurrent writer's supersede too.
    const stampFilter = rollback!.filters.find((f) => f.column === "superseded_at");
    expect(stampFilter).toBeDefined();
    expect(stampFilter!.value).toBe(supersede!.payload!.superseded_at);
    expect(rollback!.filters.some((f) => f.column === "id" && f.value === PRIOR)).toBe(true);
    // Rowcount is asked for: a silent UPDATE 0 is the house's oldest trap.
    expect(rollback!.options).toMatchObject({ count: "exact" });

    errSpy.mockRestore();
  });
});

describe("submitCashReport — a refused rollback is not proof of a strand", () => {
  it("re-reads liveness for the location/date after a failed rollback", async () => {
    const { service, ops } = scenarioService({
      prior: true, insertFails: true, rollbackFails: true, liveAfter: "winner-1",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/insert/);

    // Two cash_reports selects: the prior lookup, then the liveness question.
    const selects = cashSelects(ops);
    expect(selects).toHaveLength(2);
    const liveness = selects[1]!;
    expect(liveness.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "location_id", value: LOC },
        { op: "eq", column: "report_date", value: DATE },
        { op: "is", column: "superseded_at", value: null },
      ]),
    );
    // …and it is asked AFTER the rollback, not before it.
    expect(ops.indexOf(liveness)).toBeGreaterThan(ops.indexOf(rollbackOp(ops)!));
  });

  it("stays quiet when a concurrent submit already left a live report standing", async () => {
    const { service } = scenarioService({
      prior: true, insertFails: true, rollbackFails: true, liveAfter: "winner-1",
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/insert/);

    // The loser of a double-submit must NOT report a strand: the index refused its
    // rollback precisely because the winner's row is live. Crying wolf here is how a
    // real strand gets scrolled past later.
    const stranded = errSpy.mock.calls.filter((c) => String(c[0]).includes("STRANDED"));
    expect(stranded).toHaveLength(0);
  });

  it("says STRANDED, loudly, when the rollback failed AND no live report survives", async () => {
    const { service } = scenarioService({
      prior: true, insertFails: true, rollbackFails: true, liveAfter: null,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/insert/);

    const stranded = errSpy.mock.calls.filter((c) => String(c[0]).includes("STRANDED"));
    expect(stranded).toHaveLength(1);
    expect(String(stranded[0]![0])).toContain(PRIOR);
    expect(String(stranded[0]![0])).toContain(DATE);
  });

  it("treats a rollback that matched ZERO rows as the same question, not a success", async () => {
    // The other shape of the same event: no error, but someone re-stamped the row so
    // our stamp no longer matches. UPDATE 0 is silent — the house law is to check it.
    const { service, ops } = scenarioService({
      prior: true, insertFails: true, rollbackRows: 0, liveAfter: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/insert/);
    expect(cashSelects(ops)).toHaveLength(2);
  });
});

describe("submitCashReport — the paths that already worked still work", () => {
  it("supersedes, inserts, then back-points on an ordinary edit", async () => {
    const { service, ops } = scenarioService({ prior: true });

    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-report-1" });

    const updates = cashUpdates(ops);
    expect(updates).toHaveLength(2);
    expect(typeof updates[0]!.payload!.superseded_at).toBe("string");
    expect(updates[1]!.payload).toMatchObject({ superseded_by: "new-report-1" });
    // No rollback, and no liveness question on a clean write.
    expect(rollbackOp(ops)).toBeUndefined();
    expect(cashSelects(ops)).toHaveLength(1);
  });

  it("touches no prior row at all on a first submit of the day", async () => {
    const { service, ops } = scenarioService({ prior: false });

    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-report-1" });
    expect(cashUpdates(ops)).toHaveLength(0);
  });
});
