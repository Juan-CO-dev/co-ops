/**
 * The W20 two-session proof (scripts/sim/receiving-0326-0327-lock-check-management.mjs) is FILE ONLY:
 * CC runs it on the sim after applying 0326 / 0327. It is never executed against a database here.
 * These tests pin its safety (sim only, no direct database URL, fixtures inserted then deactivated,
 * never deleted), its coverage, and that its orchestration runs end to end against a SCRIPTED
 * transport (a function that answers from memory; no network).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calls, evidenceSQL, fixture, fixtureColumns, fixtureSQL, functions, linkSQL, main, parse, preflightSQL, proofs, retireSQL, runProof, wrap,
} from "../scripts/sim/receiving-0326-0327-lock-check-management.mjs";
import { PROD_REF, SIM_REF } from "../scripts/supabase-management-query.mjs";

const source = readFileSync("scripts/sim/receiving-0326-0327-lock-check-management.mjs", "utf8").replace(/\r\n/g, "\n");
type Fixture = Record<string, string>;
const allocated = (): Fixture => fixture() as Fixture;

describe("W20 Management API proof (offline only)", () => {
  it("is sim-only and never opens a direct database connection", () => {
    expect(source).toContain("const ref = projectRef(args, true);");
    expect(source).not.toMatch(/import.*dotenv|SIM_DATABASE_URL|DATABASE_URL|from ['"]pg['"]|import\(['"]pg['"]\)/);
    expect(source).not.toContain("readFileSync");
    // The only environment value it reads is the operator's token, handed to main() by the caller.
    expect(source.match(/env\.[A-Z_]+/g)).toEqual(["env.SUPABASE_ACCESS_TOKEN", "env.SUPABASE_ACCESS_TOKEN"]);
    expect(source).toContain("FILE ONLY");
  });

  it("refuses the production project and a missing token before anything is sent", async () => {
    const lines: string[] = [];
    expect(await main([`--ref=${PROD_REF}`], { SUPABASE_ACCESS_TOKEN: "not-used" }, (l: string) => lines.push(l))).toBe(2);
    expect(await main([], {}, (l: string) => lines.push(l))).toBe(2);
    expect(await main([`--ref=${SIM_REF}`], {}, (l: string) => lines.push(l))).toBe(2);
    expect(lines.every((l) => l.startsWith("REFUSED:"))).toBe(true);
  });

  it("covers the deadlock, the three lock races and the atomic write", () => {
    expect(proofs.map((p: string[]) => p[0])).toEqual(["mail-vs-parse", "override>attest", "attest>attest", "unlink>attest", "atomic write"]);
    expect(proofs.filter((p: string[]) => p[1] === "0326")).toHaveLength(1);
    expect(Object.values(functions)).toEqual([
      "public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)", "public.delivery_match_verdict(uuid,text,text,text)", "public.delivery_receipt_unlink(uuid,uuid,text,uuid)",
    ]);
    const c = calls(allocated());
    // The deadlock repro: the message with the installed function's lock clause, a pause, then the receipt.
    const holder = c.mailHolder("for no key update");
    expect(holder).toMatch(/from public\.inbound_messages where id = \$1 for no key update/);
    expect(holder.indexOf("pg_sleep")).toBeLessThan(holder.indexOf("from public.email_receipts"));
    expect(holder).toContain("for update;");
    // The racer is the parser's own guarded write (the one that fires the receipt-event trigger).
    expect(c.parserWrite).toMatch(/update public\.email_receipts set parse_state='failed'.*and parse_state='unparsed'/s);
    expect(c.attestAfterOverride).toContain("'attest','discrepant'");
    expect(c.recordBadFlag).toContain("bogus");
  });

  it("allocates its own ids, only inserts them, and retires configuration without deleting anything", () => {
    const f = allocated();
    expect(f.tag).toMatch(/^SIM-W20-/);
    const ids = Object.entries(f).filter(([k]) => k !== "tag").map(([, v]) => v);
    expect(new Set(ids).size).toBe(ids.length);
    const insert = fixtureSQL(f);
    expect(insert).not.toMatch(/\b(update|delete|truncate|drop|alter)\b/i);
    expect(insert.match(/insert into public\.(\w+)/g)!.map((m) => m.replace("insert into public.", "")))
      .toEqual(["users", "locations", "vendors", "vendor_items", "email_receipts", "vendor_deliveries", "inbound_messages", "email_receipts"]);
    // Every fixture date is in 2099, and the mail is parked where the fetch worker never looks.
    expect(insert).toContain("date '2099-01-0"); expect(insert).toContain("'vendor_receipt','skipped'");
    for (const sql of [linkSQL(f), retireSQL(f)]) {
      expect(sql).not.toMatch(/\b(delete|truncate|drop|alter|insert)\b/i);
      // Every UPDATE is pinned to a fixture id AND its tag.
      for (const statement of sql.split(";").filter((s) => /\bupdate\b/i.test(s))) {
        expect(statement).toMatch(/where id='[0-9a-f-]{36}'::uuid and (subject|name|code)='SIM-W20-/);
      }
    }
    expect(retireSQL(f).match(/set active=false/g)).toHaveLength(4);
    // Every column the fixture writes is in the catalog pre-check.
    for (const [table, columns] of Object.entries(fixtureColumns) as Array<[string, string[]]>) {
      for (const statement of insert.split(";").filter((s) => s.includes(`insert into public.${table}(`))) {
        const written = /\(([^)]+)\)\s+values/.exec(statement)![1]!.split(",").map((c) => c.trim());
        for (const column of written) expect(columns, `${table}.${column}`).toContain(column);
      }
    }
    expect(preflightSQL()).toContain("is_nullable='NO' and k.column_default is null");
  });

  it("a refusal from the database comes back as data, in one transaction that still commits", () => {
    const sql = wrap("zz-test", "v_out := 'x';", { hold: 6000 });
    expect(sql).toContain("begin isolation level read committed;");
    expect(sql).toContain("set local role service_role;");
    expect(sql).toContain("exception when others then");
    expect(sql.indexOf("select pg_sleep(6);")).toBeLessThan(sql.indexOf("select current_setting('zzw20.out', true) as out;"));
    expect(wrap("zz-test", "v_out := 'x';", { serviceRole: false })).not.toContain("set local role service_role;");
    expect(parse('ok:{"item_ids":["a","b"]}')).toEqual({ ok: true, value: { item_ids: ["a", "b"] } });
    expect(parse("err:P0001:already_overridden")).toEqual({ ok: false, code: "P0001", msg: "already_overridden" });
    expect(parse("err:40P01:deadlock detected: detail")).toEqual({ ok: false, code: "40P01", msg: "deadlock detected: detail" });
    expect(parse(undefined)).toMatchObject({ ok: false, code: "no_output" });
  });

  // ── the orchestration, against a scripted transport ──────────────────────────────────────────
  type Scenario = { has0326: boolean; has0327: boolean; unfilled?: string[] };
  function transport(scenario: Scenario) {
    const sent: string[] = [];
    const later = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
    const out = (value: string) => [{ out: value }];
    const query = async (sql: string): Promise<Array<Record<string, unknown>>> => {
      sent.push(sql);
      if (sql.includes("as has_0326")) return [{ has_mutate: true, has_0326: scenario.has0326, has_0327: scenario.has0327, missing_columns: [], unfilled_required: scenario.unfilled ?? [] }];
      if (sql.includes("wait_event='PgSleep'")) return [{ ready: true }];
      if (sql.includes("pg_blocking_pids")) return [{ blocked: !sql.includes("zzw20-mail-r-") || !scenario.has0326 }];
      if (sql.includes("as override_pair")) return [{
        override_pair: { state: "override", note: "N0\naccepted per vendor call", receipt: "r" }, notes_pair: JSON.stringify({ state: "discrepant", note: "N0\nfirst note\nsecond note" }),
        unlink_pair: { state: "counted_only", receipt: null, receipt_side: null, unlinks: 1 }, atomic: { deliveries: 1, lines: 2, credits: 1 }, mail_receipt_state: scenario.has0326 ? "failed" : "unparsed",
      }];
      const app = /application_name='(zzw20-[a-z]+-[a-z]+)-/.exec(sql)?.[1];
      if (app === "zzw20-mail-h") return later(40, out(scenario.has0326 ? 'ok:"locked both"' : "err:40P01:deadlock detected"));
      if (app === "zzw20-mail-r") return scenario.has0326 ? later(0, out('ok:"parser write committed"')) : later(60, out('ok:"parser write committed"'));
      if (app?.endsWith("-h")) return later(20, out('ok:{"prior_state":"counted_only"}'));
      if (app === "zzw20-over-r") return later(40, out("err:P0001:already_overridden"));
      if (app === "zzw20-note-r") return later(40, out('ok:{"prior_state":"discrepant"}'));
      if (app === "zzw20-unlk-r") return later(40, out("err:P0001:no_receipt"));
      if (app === "zzw20-atomic-zzw") return out("ok:null");
      if (sql.includes("record_delivery_atomic")) {
        if (sql.includes("bogus")) return out("err:23514:new row violates check constraint");
        return sql.includes("line_index") ? out('ok:{"delivery_id":"d","item_ids":["a","b"]}') : out('err:23505:duplicate key value violates unique constraint "vendor_deliveries_dedupe_uq"');
      }
      return [{ done: 1 }];
    };
    return { query, sent };
  }
  const instant = { sleep: async () => {} };

  it("with both migrations applied every proof passes, and the fixture is retired at the end", async () => {
    const t = transport({ has0326: true, has0327: true });
    const lines: string[] = [];
    const { refused, results } = await runProof(t.query, (l: string) => lines.push(l), instant);
    expect(refused).toBe(false);
    expect(results.map((r: { name: string; pass: boolean | null }) => [r.name, r.pass])).toEqual(proofs.map((p: string[]) => [p[0], true]));
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(5);
    // Order on the wire: read-only pre-check, inserts, links, ..., and the retirement LAST.
    expect(t.sent[0]).toContain("as has_0326");
    expect(t.sent[1]).toContain("insert into public.users");
    expect(t.sent[2]).toContain("update public.email_receipts set linked_delivery_id");
    expect(t.sent.at(-1)).toContain("update public.locations set active=false");
    expect(t.sent.some((s) => /\bdelete\s+from\b|\btruncate\b/i.test(s))).toBe(false);
    // The 0326 holder runs as the function's owner would (no service_role), with the installed lock clause.
    const mailHolder = t.sent.find((s) => s.includes("zzw20-mail-h-"))!;
    expect(mailHolder).toContain("for no key update");
    expect(mailHolder).not.toContain("set local role service_role;");
  });

  it("before 0326 the deadlock pairing FAILS and says why; a 0327-less sim skips its proofs", async () => {
    const t = transport({ has0326: false, has0327: false });
    const lines: string[] = [];
    const { results } = await runProof(t.query, (l: string) => lines.push(l), instant);
    expect(results.find((r: { name: string }) => r.name === "mail-vs-parse")).toMatchObject({ pass: false });
    expect(lines.find((l) => l.startsWith("FAIL mail-vs-parse"))).toContain("0326 is NOT applied");
    expect(t.sent.find((s) => s.includes("zzw20-mail-h-"))).toContain("$1 for update'");
    expect(results.filter((r: { pass: boolean | null }) => r.pass === null).map((r: { name: string }) => r.name)).toEqual(["override>attest", "attest>attest", "unlink>attest", "atomic write"]);
    expect(t.sent.at(-1)).toContain("set active=false");
  });

  it("a schema the fixture does not fit is refused before any write", async () => {
    const t = transport({ has0326: true, has0327: true, unfilled: ["vendors.category"] });
    const lines: string[] = [];
    expect(await runProof(t.query, (l: string) => lines.push(l), instant)).toEqual({ refused: true, results: [] });
    expect(t.sent).toHaveLength(1);
    expect(lines[0]).toContain("vendors.category");
  });

  it("the evidence read is read-only", () => {
    expect(evidenceSQL(allocated())).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    // ("for no key update" is the text it looks for in the function source, not a statement.)
    expect(preflightSQL().replaceAll("for no key update", "")).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
  });
});
