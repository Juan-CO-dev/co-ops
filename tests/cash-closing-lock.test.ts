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

/** A chainable fake: the day's closing instance has `status` (null = none); records cash writes. */
function fakeService(status: string | null) {
  const writes: string[] = [];
  const chain = (table: string, kind: string) => {
    const done = () => {
      if (table === "checklist_templates") return Promise.resolve({ data: { id: "closing-tmpl" }, error: null });
      // The lock reads the day's closing instances as a list (any template version).
      if (table === "checklist_instances") return Promise.resolve({ data: status === null ? [] : [{ status }], error: null });
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

/**
 * W03/B040 + B041 review round 1: the lock is the day's EXISTING closing instances, whatever
 * template version they hang off — not whatever template resolves as current today. A night
 * closed on template V1 stays locked after an admin publishes V2 (and deactivates V1), and a
 * failed lookup is an error, never "no closing, edit window open".
 */
type Tmpl = { id: string; type: string; active: boolean };
type Inst = { template_id: string; location_id: string; date: string; status: string };

/** A filtering fake over a tiny checklist world; the RPC is missing (pre-0304) unless `rpc` is given. */
function worldService(world: {
  templates: Tmpl[]; instances: Inst[];
  failTable?: "checklist_templates" | "checklist_instances";
  rpc?: { data?: unknown; error?: { code?: string; message: string } | null };
}) {
  const writes: string[] = [];
  const rpcCalls: Array<Record<string, unknown>> = [];
  const tables: string[] = [];
  const chain = (table: string, kind: string) => {
    tables.push(table);
    const eqs: Array<[string, unknown]> = [];
    let resolution = false;
    const rows = (): Record<string, unknown>[] => {
      if (table === "checklist_templates") {
        let r = world.templates.map((t) => ({ ...t, location_id: "loc-1" }) as Record<string, unknown>);
        for (const [c, v] of eqs) r = r.filter((x) => x[c] === v);
        return resolution ? r.slice(-1) : r; // the resolution picks the newest active version
      }
      if (table === "checklist_instances") {
        let r = world.instances.map((i) => ({ ...i, checklist_templates: world.templates.find((t) => t.id === i.template_id) }) as Record<string, unknown>);
        for (const [c, v] of eqs) {
          r = c.includes(".")
            ? r.filter((x) => (x[c.split(".")[0]!] as Record<string, unknown> | undefined)?.[c.split(".")[1]!] === v)
            : r.filter((x) => x[c] === v);
        }
        return r;
      }
      return [];
    };
    const result = (single: boolean) => {
      if (world.failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
      if (table === "cash_reports" && kind === "insert") return Promise.resolve({ data: { id: "new-1" }, error: null });
      if (table === "cash_reports") return Promise.resolve({ data: null, error: null, count: 1 });
      const r = rows();
      return Promise.resolve({ data: single ? (r[0] ?? null) : r, error: null });
    };
    const b: Record<string, unknown> = {
      select: () => b, is: () => b, order: () => b, limit: () => b, in: () => b,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
      or: () => { resolution = true; return b; },
      maybeSingle: () => result(true), single: () => result(true),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => result(false).then(ok, bad),
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
      rpcCalls.push(args);
      writes.push(`rpc.${name}`);
      const a = world.rpc ?? { error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  };
  return { service: service as never, writes, rpcCalls, tables };
}

const V1_RETIRED: Tmpl = { id: "closing-v1", type: "closing", active: false };
const V2: Tmpl = { id: "closing-v2", type: "closing", active: true };
const finalizedV1 = (status: string): Inst => ({ template_id: "closing-v1", location_id: "loc-1", date: "2026-11-10", status });

describe("the lock holds whatever template resolves today (review r1)", () => {
  it.each(["confirmed", "incomplete_confirmed", "auto_finalized"])(
    "retired V1 with a %s instance + replacement V2 (no instance) → closing_finalized, nothing written",
    async (status) => {
      const { service, writes } = worldService({ templates: [V1_RETIRED, V2], instances: [finalizedV1(status)] });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "closing_finalized" });
      expect(writes).toEqual([]);
    },
  );

  it("retired V1 with a finalized instance and NO active closing template (resolution null) → closing_finalized", async () => {
    const { service, writes } = worldService({ templates: [V1_RETIRED], instances: [finalizedV1("confirmed")] });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "closing_finalized" });
    expect(writes).toEqual([]);
  });

  it("V1 finalized + V2 open the same night → still locked (any finalized closing instance locks)", async () => {
    const { service, writes } = worldService({
      templates: [V1_RETIRED, V2],
      instances: [finalizedV1("auto_finalized"), { template_id: "closing-v2", location_id: "loc-1", date: "2026-11-10", status: "open" }],
    });
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: false, reason: "closing_finalized" });
    expect(writes).toEqual([]);
  });

  it("a finalized instance on another day, another shop or a non-closing template does not lock", async () => {
    const { service, writes } = worldService({
      templates: [V1_RETIRED, V2, { id: "prep", type: "prep", active: true }],
      instances: [
        { template_id: "closing-v1", location_id: "loc-1", date: "2026-11-09", status: "confirmed" },
        { template_id: "closing-v2", location_id: "loc-2", date: "2026-11-10", status: "confirmed" },
        { template_id: "prep", location_id: "loc-1", date: "2026-11-10", status: "confirmed" },
      ],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-1" });
    expect(writes).toContain("cash_reports.insert");
  });

  it("a failed closing lookup throws (never 'no closing, edit window open') and writes nothing", async () => {
    const { service, writes } = worldService({ templates: [V1_RETIRED, V2], instances: [finalizedV1("confirmed")], failTable: "checklist_instances" });
    await expect(submitCashReport(service, ARGS)).rejects.toThrow(/closing lock lookup: checklist_instances unavailable/);
    expect(writes).toEqual([]);
  });

  it("no current-template resolution is consulted: the lock is one bounded read of the day's closing instances", async () => {
    const { service, writes, tables } = worldService({ templates: [V1_RETIRED, V2], instances: [], failTable: "checklist_templates" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(submitCashReport(service, ARGS)).resolves.toEqual({ ok: true, id: "new-1" });
    expect(tables).not.toContain("checklist_templates");
    expect(writes).toContain("cash_reports.insert");
  });
});

describe("one list of locking statuses", () => {
  it("is every finalized closing status and nothing transitional", () => {
    expect([...CASH_LOCKING_CLOSING_STATUSES]).toEqual(["confirmed", "incomplete_confirmed", "auto_finalized"]);
    for (const s of ["open", "phase1_complete", "phase2_complete", "", null, undefined]) expect(closingLocksCash(s)).toBe(false);
  });

  it("the /cash page's up-front lock and the write gate are ONE read (cashLockedByClosing), with no template resolution", () => {
    const page = readFileSync("app/(authed)/cash/page.tsx", "utf8");
    const lib = readFileSync("lib/cash.ts", "utf8");
    expect(page).toContain("cashLockedByClosing(sb, { locationId: locationParam, date: today })");
    expect(lib).toContain("cashLockedByClosing(service, { locationId: args.locationId, date: args.date })");
    expect(lib).toContain("closingLocksCash(r.status)");
    for (const [f, src] of [["page", page], ["lib", lib]] as const) {
      expect(src, f).not.toMatch(/status === "incomplete_confirmed"/);
      expect(src, f).not.toContain("applyEffectiveResolution");
    }
  });
});
