/**
 * Migration 0318 (audit follow-up W05B, Juan's ruling 2026-11-15): level 8+ (MoO, owner, CGS) complete, submit and
 * confirm checklist tasks at any shop without a membership row; below 8 the ACTIVE membership stays required.
 * The executable proof is scripts/sql-harness-0318.mjs (PGlite, the real 0228 + 0276 + 0287 confirm); this pin runs
 * it in CI, names what it must have proven, and pins the re-emitted body as a line-subsequence of 0276's.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (f: string) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").replace(/\r\n/g, "\n");
const FILE = "0318_checklist_task_writers_any_shop_level8.sql";
const SOURCE = "0276_checklist_guarded_writers.sql";
const sql = read(FILE);
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

const body = (src: string, header: RegExp) => src.match(new RegExp(`${header.source}[\\s\\S]*?\\nend \\$\\$;`))?.[0] ?? "";
const original = body(read(SOURCE), /create function public\.checklist_actor_level\(/);
const emitted = body(sql, /create or replace function public\.checklist_actor_level\(/);

function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}

// The enumerated modifications (reviewers read THIS list).
const MODS: ReadonlyArray<readonly [string, string]> = [
  ["create function public.checklist_actor_level(", "create or replace function public.checklist_actor_level("],
];
// The only non-comment lines 0318 adds.
const ADDED = [
  "  if coalesce(public.assignment_author_level(p_actor), 0) < 8 then",
  "  end if;",
];

describe("0318 re-emits checklist_actor_level from 0276", () => {
  it("0276 is the only earlier definer, 0318 the latest", () => {
    const defining = files.filter((f) => /create (?:or replace )?function public\.checklist_actor_level\(/.test(read(f).replace(/--[^\n]*/g, "")));
    expect(defining).toEqual([SOURCE, FILE]);
  });

  it("nothing but the three guarded writers calls it (every caller is covered by the harness)", () => {
    const callers = new Set<string>();
    for (const f of files) {
      const src = read(f).replace(/--[^\n]*/g, "");
      for (const m of src.matchAll(/create (?:or replace )?function public\.([a-z_]+)\([\s\S]*?\nend \$\$;/g)) {
        if (m[1] !== "checklist_actor_level" && m[0].includes("checklist_actor_level(")) callers.add(m[1]!);
      }
    }
    expect([...callers].sort()).toEqual(["checklist_confirm_instance", "checklist_submit_batch", "checklist_write_completion"]);
  });

  it("the 0276 body (± the enumerated mods) is a line-subsequence of the 0318 body", () => {
    expect(original).toBeTruthy();
    expect(emitted).toBeTruthy();
    let source = original;
    for (const [o, n] of MODS) {
      expect(source.split(o).length - 1, `mod anchor must occur once: ${o}`).toBe(1);
      source = source.replace(o, n);
    }
    const check = isLineSubsequence(source, emitted);
    expect(check.ok, `missing from 0318 → ${check.missing}`).toBe(true);
  });

  it("adds nothing beyond the level-8 arm except a comment", () => {
    let source = original;
    for (const [o, n] of MODS) source = source.replace(o, n);
    const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
    const extra = emitted.split("\n").map((l) => l.trimEnd())
      .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
    // `end if;` also closes nothing else in the 0276 body, so it is a genuine addition.
    expect(extra).toEqual(ADDED);
    // The arm wraps exactly the membership read and its refusal, in order, after the active-user check.
    const lines = emitted.split("\n").map((l) => l.trimEnd());
    const at = (s: string) => lines.indexOf(s);
    const active = at("  perform 1 from public.users where id = p_actor and active for share;");
    const open = at(ADDED[0]!);
    const membership = at("  perform 1 from public.user_locations where user_id = p_actor and location_id = p_location and active for share;");
    const close = lines.indexOf("  end if;", membership);
    expect(active).toBeGreaterThan(-1);
    expect(active).toBeLessThan(open);
    expect(open + 1).toBe(membership);
    expect(close).toBe(membership + 2);
  });
});

describe("0318 file shape", () => {
  it("is one transaction, file-only, audited, and never destructive", () => {
    expect(sql).toMatch(/^-- Migration 0318_checklist_task_writers_any_shop_level8\n-- AUTHORED 2026-11-15\. NOT YET APPLIED/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    const statements = sql.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(/\b(drop table|truncate table|delete from|drop column|drop policy|drop function|create table|alter table|alter policy)\b/i);
    expect(statements).toContain("'migration', '0318_checklist_task_writers_any_shop_level8'");
    expect(statements).toContain("revoke all on function public.checklist_actor_level(uuid,uuid) from public, anon, authenticated;");
    expect(statements).toContain("grant execute on function public.checklist_actor_level(uuid,uuid) to service_role;");
    expect((statements.match(/raise exception '0318: /g) ?? []).length).toBeGreaterThanOrEqual(6);
    // The callers are not re-emitted: the lock order of 0276 / 0287 stays theirs.
    expect(statements).not.toMatch(/function public\.checklist_(write_completion|submit_batch|confirm_instance)\b/);
  });

  it("runs the offline SQL harness clean", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0318.mjs"], { encoding: "utf8", timeout: 280_000 });
    expect(output).toContain("PASS 0318:");
    expect(output).not.toContain("FAIL");
    for (const line of [
      "A0 before 0318: moo with no membership is refused complete (the rule 0318 lifts)",
      "A0 before 0318: an active member GM completes",
      "B1 complete moo (8)/missing: allowed",
      "B1 submit owner (9)/missing: allowed",
      "B1 confirm cgs (10)/missing: allowed",
      "B1 confirm moo (8)/inactive: allowed",
      "B1 complete gm (7)/missing: not_authorized",
      "B1 submit gm (7)/inactive: not_authorized",
      "B1 confirm social_media_mgr (6)/missing: not_authorized",
      "B1 complete employee (3)/active: allowed",
      "B1 complete key_holder (4)/inactive: not_authorized",
      "B2 an INACTIVE moo (missing membership) is refused confirm",
      "B2 an INACTIVE cgs (active membership) is refused complete",
      "B3 a MoO (8) at a non-member shop is still held to the item's min level 9",
      "B4 a CGS with no membership confirms the instance (confirmed_by = the CGS)",
      "C2 at 8+: user_locations is never read or locked",
      "D2 EXECUTE: service_role only, never anon / authenticated",
      "D3 authenticated cannot call checklist_actor_level",
      "E3 refuses a drifted (not 0276) checklist_actor_level -> re-sync",
      "E6 after every refusal the untouched schema still takes the real 0318",
      "Z  one audit row, migration_apply, destructive",
      "Z  a second apply refuses (already applied)",
    ]) expect(output).toContain(`ok   ${line}`);
  }, 290_000);
});
