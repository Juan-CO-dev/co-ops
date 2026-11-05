import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pairings, fixture, fixtureSQL, retireSQL, calls, evidenceSQL, assertEvidence,
  runProof, main, proveClosingOverlap, setupStatements } from "../scripts/sim/checklist-0291-lock-check-management.mjs";
import { PROD_REF, SIM_REF } from "../scripts/supabase-management-query.mjs";

type Case = Record<"closing" | "am" | "old" | "generic" | "extra" | "stale" | "key" | "editKey", string>;
type Fixture = Record<"actor" | "shop" | "template" | "amTemplate" | "item" | "referenceItem" | "prepItem" | "tag", string> & { cases: Case[] };
const allocated = (): Fixture => fixture() as unknown as Fixture;
type Evidence = { submissions: number; completions: number; live: number; edits: number; audits: number; closing_status: string };

describe("0291 Management API proof (offline only)", () => {
  it("covers committed same-key original/edit races and replay/closing in both orders", () => {
    expect(pairings).toEqual([["original", "original"], ["edit", "edit"], ["replay", "confirm"], ["confirm", "replay"], ["edit", "confirm"], ["confirm", "edit"]]);
    const source = readFileSync("scripts/sim/checklist-0291-lock-check-management.mjs", "utf8");
    expect(source).toContain("const race=closingRace?proveClosingOverlap:proveRace");
    expect(source).toContain("await race(query,ops[a],ops[b]");
    expect(source).not.toContain("rollbackQuery");
    expect(source).toContain("if(closingRace) assertEvidence(before[0],committedReplay)");
    expect(source).toContain("result.rows[0]?.result?.replayed,true");
    expect(source).toContain("replay[0]?.result?.submissionId,stored[0]?.id");
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL|import\(['"]pg['"]\)/);
  });
  it("uses isolated prep templates, real entry payloads, distinct keys and scoped retirement", () => {
    const f = allocated();
    expect(f.cases).toHaveLength(6);
    expect(f.tag).toMatch(/^SIM-0291-/);
    const ids = f.cases.flatMap(c => Object.values(c));
    expect(new Set(ids).size).toBe(ids.length);
    const sql = fixtureSQL(f), retire = retireSQL(f);
    expect(sql).toContain(`'${f.amTemplate}','${f.shop}','prep'`);
    expect(sql).toContain(`'${f.prepItem}','${f.amTemplate}'`);
    expect(sql).not.toMatch(/\b(update|delete|truncate)\b/i);
    expect(retire.match(/set active=false/g)).toHaveLength(6);
    expect(retire).toContain(`id='${f.prepItem}' and template_id='${f.amTemplate}'`);
    expect(retire).not.toMatch(/delete|truncate|checklist_completions|checklist_instances|checklist_submissions/i);
  });
  it("commits only the original before fresh edit/confirm pairs, preserving committed replay pairs", () => {
    const f = allocated(), ops = calls(f, f.cases[0]!);
    for (const [a, b] of [["edit", "confirm"], ["confirm", "edit"]] as const) {
      const setup = setupStatements(ops, a, b, "fresh");
      expect(setup).toHaveLength(1);
      expect(setup[0]).toContain(ops.original);
      expect(setup[0]).not.toContain(ops.edit);
    }
    for (const [a, b] of [["replay", "confirm"], ["confirm", "replay"]] as const) {
      const setup = setupStatements(ops, a, b, "replay");
      expect(setup).toHaveLength(2);
      expect(setup[0]).toContain(ops.original);
      expect(setup[1]).toContain(ops.edit);
    }
  });
  it("reuses the frozen key and intent for edits and binds originals to authenticated fixture actor", () => {
    const f = allocated(), c = f.cases[0]!;
    const ops = calls(f, c);
    expect(ops.original).toContain(`'${c.am}','${f.actor}'`);
    expect(ops.original).toContain(`'${c.key}'::uuid`);
    expect(ops.original).toContain(f.prepItem);
    expect(ops.edit).toContain(`client_request_id='${c.key}'`);
    expect(ops.edit).toContain(`'${c.editKey}'::uuid`);
    expect(ops.replay).toBe(ops.edit);
    expect(ops.confirm).toContain("superseded_at is null and revoked_at is null");
    expect(evidenceSQL(c)).toContain("action='report.update'");
  });
  it("rejects duplicated histories, edits and audits in the evidence validator", () => {
    const original: Evidence = { submissions: 1, completions: 1, live: 1, edits: 0, audits: 0, closing_status: "open" };
    expect(() => assertEvidence(original, false)).not.toThrow();
    const edit: Evidence = { ...original, submissions: 2, completions: 2, edits: 1, audits: 1, closing_status: "confirmed" };
    expect(() => assertEvidence(edit, true, true)).not.toThrow();
    for (const key of ["submissions", "completions", "live", "edits", "audits"] as const) {
      expect(() => assertEvidence({ ...edit, [key]: edit[key] + 1 }, true, true)).toThrow();
    }
    expect(() => assertEvidence({ ...edit, closing_status: "open" }, true, true)).toThrow();
  });
  it("refuses non-SIM targets before accessing transport", () => {
    const fetcher = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetcher);
    try {
      for (const args of [[], [`--ref=${PROD_REF}`], [`--ref=${SIM_REF}`, `--ref=${SIM_REF}`]]) {
        expect(() => main(args)).toThrow();
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("observes closing/replay overlap without claiming a conflicting production lock", async () => {
    let release: ((rows: { result: { replayed: boolean } }[]) => void) | undefined;
    let observations = 0;
    const query = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
      if (sql.includes("pg_stat_activity")) {
        if (++observations === 2) queueMicrotask(() => release?.([{ result: { replayed: true } }]));
        return [{ ready: true }];
      }
      if (sql.includes("pg_sleep")) return new Promise(resolve => { release = resolve; });
      // Second commits while the first remains open. Release the fixture hold
      // after the overlap observation so the pure orchestration test can finish.
      return [{ result: { replayed: true } }];
    });
    await expect(proveClosingOverlap(query, "select 1", "select 2", "fixture")).resolves.toMatchObject({ ok: true });
    expect(query.mock.calls.filter(([sql]) => sql.includes("pg_stat_activity"))).toHaveLength(2);
    expect(query.mock.calls.some(([sql]) => sql.includes("pg_blocking_pids"))).toBe(false);
  });
  it.each(["not-ready", "no-overlap", "racer-failed"])("refuses an unproven closing overlap: %s", async state => {
    let observations = 0;
    const query = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
      if (sql.includes("pg_stat_activity")) return [{ ready: state !== "not-ready" && ++observations === 1 }];
      if (!sql.includes("pg_sleep") && state === "racer-failed") throw new Error("fixture racer failed");
      return [{ result: { replayed: true } }];
    });
    await expect(proveClosingOverlap(query, "select 1", "select 2", "fixture", { sleep: async () => {} })).rejects.toThrow();
  });
  it("fails deployment preflight before allocating or writing fixture data", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(runProof(query, vi.fn())).rejects.toThrow("missing");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
  });
});
