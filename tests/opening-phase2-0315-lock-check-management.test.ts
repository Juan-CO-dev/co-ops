/**
 * The 0315 two-session proof (scripts/sim/opening-phase2-0315-lock-check-management.mjs) is FILE
 * ONLY: CC runs it on the sim after applying 0315. It is never executed here — these tests pin
 * its safety (sim only, no direct database URL, fixtures retired not deleted), its coverage
 * (every ordered pair of the three opening Phase 2 writers, the six committed orders), and that
 * its orchestration runs end to end against a scripted transport.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertEvidence, calls, evidenceSQL, expectations, fixture, fixtureSQL, main, outcomes, pairings,
  preflight, refusalSQL, requiredColumns, retireSQL, runProof, signatures, writers,
} from "../scripts/sim/opening-phase2-0315-lock-check-management.mjs";
import { PROD_REF, SIM_REF } from "../scripts/supabase-management-query.mjs";

type Case = Record<"instance" | "phase1A" | "phase1B" | "savedA" | "savedB", string>;
type Fixture = Record<"actor" | "shop" | "opening" | "closing" | "itemA" | "itemB" | "trackItem" | "tabA" | "tabB" | "tag", string>
  & { cases: Case[]; draft: { instance: string }; track: { instance: string; completion: string } };
const allocated = (): Fixture => fixture() as unknown as Fixture;
const source = readFileSync("scripts/sim/opening-phase2-0315-lock-check-management.mjs", "utf8");

describe("0315 Management API proof (offline only)", () => {
  it("covers every ordered pair of the three opening Phase 2 writers and the six committed orders", () => {
    expect(writers).toEqual(["save", "undo", "finalize"]);
    expect(pairings).toHaveLength(9);
    expect(new Set(pairings.map((p: string[]) => p.join(">"))).size).toBe(9);
    expect(outcomes.map((o: string[]) => o.join(">")).sort()).toEqual(Object.keys(expectations).sort());
    // The matrix rolls back (lock presence); the outcomes commit (who wins).
    expect(source).toContain("await proveRace(rollbackQuery(query), ops[a], ops[b]");
    expect(source).toContain("await proveRace(query, ops[a], racer");
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL|DATABASE_URL|import\(['"]pg['"]\)|from ['"]pg['"]/);
    expect(source).toContain("const ref = projectRef(args, true);");
  });

  it("the committed orders state the B080 / B181 outcomes", () => {
    // An Undo or a save that queued behind a finalize is refused; the report's rows stay live.
    expect(expectations["finalize>undo"]).toMatchObject({ racer: "phase2_not_eligible", status: "phase2_complete", live: 2, named_live: true });
    expect(expectations["finalize>save"]).toMatchObject({ racer: "phase2_not_eligible", status: "phase2_complete", named_live: true });
    // A finalize that queued behind an Undo sees the row missing and leaves the opening open.
    expect(expectations["undo>finalize"]).toMatchObject({ racer: "phase2_incomplete", status: "phase1_complete", submissions: 0 });
    // A finalize that queued behind a save names the NEW row.
    expect(expectations["save>finalize"]).toMatchObject({ racer: null, status: "phase2_complete", names_old_a: false, named_live: true });
    // Save then Undo of the row the screen still shows: a named refusal, never a deadlock.
    expect(expectations["save>undoOld"]).toMatchObject({ racer: "revoke_conflict", live_a: 1 });
    expect(expectations["undo>save"]).toMatchObject({ racer: null, live_a: 1 });
  });

  it("allocates its own fixtures, inserts only, and retires configuration without deleting history", () => {
    const f = allocated();
    expect(f.tag).toMatch(/^SIM-0315-/);
    expect(f.cases).toHaveLength(pairings.length + outcomes.length);
    const ids = [...f.cases.flatMap((c) => Object.values(c)), f.draft.instance, f.track.instance, f.track.completion];
    expect(new Set(ids).size).toBe(ids.length);
    const sql = fixtureSQL(f);
    expect(sql).not.toMatch(/\b(update|delete|truncate|drop|alter)\b/i);
    expect(sql).toContain(`'${f.opening}','${f.shop}','opening'`);
    expect(sql).toContain(`'{"openingPhase2":true,"section":"SIM"}'::jsonb`);
    expect(sql).toContain(`'${f.trackItem}','${f.closing}'`);
    expect(sql.match(/'phase1_complete'\)/g)).toHaveLength(f.cases.length);
    // Every column the fixture writes is in the catalog pre-check.
    for (const [table, cols] of Object.entries(requiredColumns as Record<string, string[]>)) {
      for (const m of sql.matchAll(new RegExp(`insert into public\\.${table}\\(([^)]*)\\)`, "g"))) {
        for (const col of m[1]!.split(",")) expect(cols, `${table}.${col}`).toContain(col.trim());
      }
    }
    const retire = retireSQL(f);
    expect(retire.match(/set active=false/g)).toHaveLength(5);
    expect(retire).not.toMatch(/delete|truncate|checklist_completions|checklist_instances|checklist_submissions|opening_phase1_drafts/i);
  });

  it("calls the three real writers, as the fixture's own actor, on the case's own opening", () => {
    const f = allocated(), c = f.cases[0]!, ops = calls(f, c);
    expect(ops.save).toContain(`public.save_phase2_item_atomic('${c.instance}','${f.actor}','${f.itemA}',7,`);
    expect(ops.undo).toContain(`public.revoke_phase2_item_atomic('${c.instance}',(select id from public.checklist_completions`);
    expect(ops.undo).toContain("superseded_at is null and revoked_at is null");
    expect(ops.undoOld).toContain(`public.revoke_phase2_item_atomic('${c.instance}','${c.savedA}'`);
    expect(ops.finalize).toBe(`select public.submit_phase2_atomic('${c.instance}','${f.actor}') as result`);
    expect(evidenceSQL(f, c)).toContain("as named_live");
  });

  it("a refusal is proven inside the racer's own transaction, by name", () => {
    const sql = refusalSQL("select public.submit_phase2_atomic('i','a') as result", "phase2_incomplete");
    expect(sql).toContain("begin perform public.submit_phase2_atomic('i','a');");
    expect(sql).toContain("if position('phase2_incomplete' in sqlerrm) > 0 then refused := true; else raise; end if;");
    expect(sql).toContain("raise exception 'expected refusal missing' using errcode='XX000'");
    // Only a P0001 is ever swallowed: a deadlock (40P01) fails the proof.
    expect(sql.match(/when sqlstate/g)).toHaveLength(1);
    expect(() => refusalSQL("select 1 as result", "deadlock detected")).toThrow();
  });

  it("the evidence check rejects any drift from the expected outcome", () => {
    const expected = expectations["finalize>undo"];
    const row = { status: "phase2_complete", submissions: 1, live: 2, live_a: 1, named_live: true, names_old_a: true };
    expect(() => assertEvidence(row, expected)).not.toThrow();
    for (const [key, wrong] of [["status", "phase1_complete"], ["submissions", 2], ["live", 1], ["named_live", false]] as const) {
      expect(() => assertEvidence({ ...row, [key]: wrong }, expected)).toThrow();
    }
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

  it("fails the deployment preflight before allocating or writing fixture data", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(runProof(query, vi.fn())).rejects.toThrow("0315 preflight");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
    // A database where 0315 is not applied (no instance lock in a Phase 2 writer) is refused too.
    const noLock = vi.fn().mockResolvedValue(signatures.map((signature: string) => ({ signature, present: true, executable: true, parent_lock: false, draft_columns: 2 })));
    await expect(preflight(noLock)).rejects.toThrow("no instance lock");
  });

  it("runs end to end against a scripted transport: matrix rolled back, outcomes committed, fixtures retired", async () => {
    let f: Fixture | null = null;
    const logs: string[] = [];
    const log = (line: string) => { logs.push(line); if (line.startsWith("FIXTURE allocated ")) f = JSON.parse(line.slice("FIXTURE allocated ".length)) as Fixture; };
    const sent: string[] = [];
    const committedOutcome = new Set<number>();
    let stored: { tab: string | null; seq: number | null } | null = null;
    const query = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
      sent.push(sql);
      if (sql.startsWith("begin read only;")) return signatures.map((signature: string) => ({ signature, present: true, executable: true, parent_lock: true, draft_columns: 2 }));
      if (sql.includes("from information_schema.columns where table_schema='public' and table_name in")) {
        return Object.entries(requiredColumns as Record<string, string[]>).flatMap(([table_name, cols]) => cols.map((column_name) =>
          ({ table_name, column_name, is_nullable: "NO", column_default: null, is_identity: "NO", is_generated: "NEVER" })));
      }
      if (sql.includes("pg_enum")) return [];
      if (sql.includes("pg_stat_activity")) return [{ ready: true, blocked: true }];
      if (sql.includes("as names_old_a")) {
        const index = f!.cases.findIndex((c) => sql.includes(c.instance));
        if (index < pairings.length || !committedOutcome.has(index)) return [{ status: "phase1_complete", submissions: 0, live: 2, live_a: 1, named_live: true, names_old_a: false }];
        const { racer: _racer, ...row } = expectations[outcomes[index - pairings.length]!.join(">") as keyof typeof expectations];
        return [row];
      }
      if (sql.includes("as retired")) return [{ retired: true }];
      if (sql.includes("draft->>'n' as n")) return [{ n: "5", no_tab: true }];
      if (sql.includes("revoked_at is null as live")) return [{ live: true }];
      if (sql.includes("save_opening_phase1_draft") && !sql.includes("do $proof$")) {
        const m = /::jsonb,'[^']+',(null|'([^']+)'),(null|\d+)\) as result/.exec(sql)!;
        const tab = m[2] ?? null, seq = m[3] === "null" ? null : Number(m[3]);
        const applied = stored === null || tab === null || stored.tab !== tab || stored.seq === null || (seq !== null && seq > stored.seq);
        if (applied) stored = { tab, seq };
        return [{ result: { applied } }];
      }
      const outcomeIndex = f ? f.cases.findIndex((c, i) => i >= pairings.length && sql.includes(c.instance)) : -1;
      if (outcomeIndex >= 0 && sql.trimEnd().endsWith("commit;")) committedOutcome.add(outcomeIndex);
      return [{ result: {} }];
    });
    let clock = 0;
    await runProof(query, log, { sleep: async () => {}, now: () => (clock += 10_000) });

    expect(logs.at(-2)).toBe("PASS 0315: 9 ordered lock pairs with observed waits; 6 committed orders; draft compare-and-set; item-tracking refusal");
    expect(logs.at(-1)).toBe("PASS own fixture configuration retired; append-only evidence retained");
    expect(logs.filter((l) => l.startsWith("PASS ordered lock pair"))).toHaveLength(9);
    expect(logs.filter((l) => l.startsWith("PASS committed order"))).toHaveLength(6);
    const transactions = sent.filter((s) => s.startsWith("begin isolation level read committed;"));
    const matrix = transactions.filter((s) => f!.cases.slice(0, pairings.length).some((c) => s.includes(c.instance)) && !s.includes("save_opening_phase1_draft"));
    const committed = transactions.filter((s) => f!.cases.slice(pairings.length).some((c) => s.includes(c.instance)) && !s.includes("save_opening_phase1_draft"));
    expect(matrix).toHaveLength(18);
    for (const s of matrix) expect(s.trimEnd().endsWith("rollback;")).toBe(true);
    expect(committed).toHaveLength(12);
    for (const s of committed) expect(s.trimEnd().endsWith("commit;")).toBe(true);
    // Four of the six waiting writers must be REFUSED, by name, inside their own transaction.
    expect(committed.filter((s) => s.includes("do $proof$"))).toHaveLength(4);
    for (const s of transactions) expect(s).toContain("set local role service_role;");
    // First write is the fixture; last write is the retirement.
    const writes = sent.filter((s) => s.startsWith("begin;"));
    expect(writes[0]).toContain("insert into public.locations");
    expect(writes.at(-1)).toContain("set active=false");
  });

  it("retires its fixtures even when a proof step fails", async () => {
    const sent: string[] = [];
    const query = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
      sent.push(sql);
      if (sql.startsWith("begin read only;")) return signatures.map((signature: string) => ({ signature, present: true, executable: true, parent_lock: true, draft_columns: 2 }));
      if (sql.includes("from information_schema.columns")) return Object.entries(requiredColumns as Record<string, string[]>).flatMap(([table_name, cols]) => cols.map((column_name) => ({ table_name, column_name, is_nullable: "YES" })));
      if (sql.includes("pg_enum")) return [];
      if (sql.includes("as retired")) return [{ retired: true }];
      if (sql.includes("pg_stat_activity")) return [{ ready: false, blocked: false }]; // the holder never becomes ready
      return [{ result: {} }];
    });
    await expect(runProof(query, vi.fn(), { sleep: async () => {}, now: () => 0 })).rejects.toThrow();
    expect(sent.some((s) => s.startsWith("begin;") && s.includes("set active=false"))).toBe(true);
  });
});
