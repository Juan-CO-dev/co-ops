/**
 * Migration 0361 (Toast labor "only if newer": the guarded writer public.toast_time_entries_apply_newer) pinned BY
 * NAME, and its offline PGlite proof run in CI (scripts/sql-harness-0361.mjs: the REAL 0224, the REAL 0233 section A,
 * then the REAL 0361). CC applies sim then prod on Juan's word; nothing here touches a database.
 *
 * Pins: the house header and the AUTHORED gate line (APPLIED stamps only directly under it), one transaction, the only
 * file numbered 0361, exactly ONE `create function` and no other DDL, SECURITY INVOKER + the pinned search_path, the
 * revoke / grant, the header's Toast spec citation (URL, quoted meaning, sha256, UNVERIFIED), the rollback and the U1
 * residual; the labor writer census patterns (one insert, one update); the typed column list = LaborEntryRow's
 * fourteen keys; no user_id in the body; and the harness's toastInstant replica = the real normalizer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { toastInstant, type LaborEntryRow } from "@/lib/toast/labor-shared";

const NAME = "0361_toast_time_entries_newer";
const sql = readFileSync(`supabase/migrations/${NAME}.sql`, "utf8").replace(/\r\n/g, "\n");
const lines = sql.split("\n");
const code = sql.replace(/--[^\n]*/g, "");
/**
 * Statement pins are WHITESPACE-NORMALISED (ruling U7, fix round): re-wrapping or re-indenting a statement must not
 * fail a test when nothing it says changed. `flat` = the code with every run of whitespace as one space; `flatHeader`
 * = the header's comment text the same way (the `-- ` prefixes dropped, so a sentence may wrap anywhere).
 */
const flat = code.replace(/\s+/g, " ").trim();
const flatHeader = sql.slice(0, sql.indexOf("\nbegin;\n")).replace(/^--[ \t]?/gm, "").replace(/\s+/g, " ");
const harness = readFileSync("scripts/sql-harness-0361.mjs", "utf8").replace(/\r\n/g, "\n");

const GATE = "-- AUTHORED 2026-11-28 (Toast labor \"only if newer\", CC ruling D-R2, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.";
const STAMP = new RegExp(`^-- APPLIED TO (SIM|PROD) \\d{4}-\\d{2}-\\d{2}( UTC)? \\(schema_migrations version \\d{14}, name '${NAME}'\\)$`);

/** LaborEntryRow's keys; `satisfies` keeps the list complete and exact as the interface changes. */
const LABOR_KEYS = {
  location_id: true, time_entry_guid: true, business_date: true, employee_guid: true, employee_first_name: true, job_guid: true,
  job_name: true, in_at: true, out_at: true, hours: true, overtime_hours: true, auto_clocked_out: true, deleted: true, source_modified_at: true,
} satisfies Record<keyof LaborEntryRow, true>;

/** The SQL census pattern of tests/fact-labor-writer-census.test.ts, for the one table. */
const CENSUS_SQL = new RegExp(`\\b(insert\\s+into|update|delete\\s+from|truncate(?:\\s+table)?)\\s+(?:only\\s+)?(?:public\\.)?(toast_time_entries)\\b`, "gi");

describe("0361 header and shape", () => {
  it("line 1 is the name, line 2 the AUTHORED gate line; APPLIED stamps only directly under it", () => {
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toBe(GATE);
    let i = 2;
    while (i < lines.length && STAMP.test(lines[i] ?? "")) i++;
    expect(lines[i] ?? "").not.toMatch(/^-- APPLIED/);
    const elsewhere = lines.map((l, n) => [l, n] as const).filter(([l, n]) => /APPLIED TO/.test(l) && (n < 2 || n >= i));
    expect(elsewhere).toEqual([]);
  });

  it("one transaction, commit last", () => {
    expect(flat.match(/(?:^|[; ])begin;/g)).toHaveLength(1);
    expect(flat.match(/(?:^|[; ])commit;/g)).toHaveLength(1);
    expect(flat.startsWith("begin;")).toBe(true);
    expect(flat.endsWith("commit;")).toBe(true);
  });

  it("is the only file numbered 0361", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0361"))).toEqual([`${NAME}.sql`]);
  });

  it("exactly ONE create function and no other DDL or data statement", () => {
    expect(code.match(/\bcreate\s+function\b/gi)).toHaveLength(1);
    expect(flat).toContain("create function public.toast_time_entries_apply_newer(p_rows jsonb) returns jsonb language plpgsql volatile security invoker");
    for (const banned of [/\bcreate\s+or\s+replace\b/i, /\bcreate\s+(?:unique\s+)?(table|index|policy|trigger|type|view)\b/i, /\balter\s/i, /\bdrop\s/i,
      /\btruncate\b/i, /\bdelete\s+from\b/i, /\bsecurity\s+definer\b/i]) {
      expect(code, String(banned)).not.toMatch(banned);
    }
  });

  it("SECURITY INVOKER, the pinned search_path, the revoke and the grant", () => {
    expect(flat).toMatch(/\bsecurity invoker\b/);
    expect(flat).toContain("set search_path = pg_catalog, public");
    expect(flat).toContain("revoke all on function public.toast_time_entries_apply_newer(jsonb) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.toast_time_entries_apply_newer(jsonb) to service_role;");
    // Exactly one revoke and one grant STATEMENT (a statement starts the file or follows a `;`).
    expect(flat.match(/(?:^|; )(grant|revoke)\b/g)).toHaveLength(2);
  });

  it("the header cites Toast's spec, says what is UNVERIFIED, carries the rollback and the U1 residual", () => {
    expect(flatHeader).toContain("https://doc.toasttab.com/toast-api-specifications/toast-labor-api.yaml");
    expect(flatHeader).toContain("\"Date modified, in UTC format (read-only).\"");
    expect(flatHeader).toContain("45c2ce1a797297e1a0772270667ab9803e28592e05e18c7a3046f02feca46a92");
    expect(flatHeader).toContain("UNVERIFIED");
    expect(flatHeader).toContain("drop function public.toast_time_entries_apply_newer(jsonb);");
    expect(flatHeader).toContain("archived in Toast more than 48 h ago");
  });

  it("the pins above do not depend on line breaks or indentation (U7)", () => {
    // The same file with every statement re-wrapped: each line break inside the code becomes a break plus an indent,
    // and each single space between two words becomes a line break. Every flat pin must read the same.
    const rewrapped = code.replace(/\n/g, "\n      ").replace(/(\w) (\w)/g, "$1\n$2");
    expect(rewrapped).not.toBe(code);
    expect(rewrapped.replace(/\s+/g, " ").trim()).toBe(flat);
  });
});

describe("the labor writer census sees exactly one insert and one update", () => {
  it("over the WHOLE text, comments included", () => {
    const hits = [...sql.matchAll(CENSUS_SQL)].map((m) => `${m[1]!.toLowerCase().split(/\s+/)[0]!} ${m[2]!.toLowerCase()}`);
    expect(hits.sort()).toEqual(["insert toast_time_entries", "update toast_time_entries"]);
  });
});

describe("the function reads the pull's fourteen columns and never user_id", () => {
  const body = (() => {
    const m = sql.match(/as \$fn\$\n([\s\S]*?)\n\$fn\$;/);
    if (!m) throw new Error("the function body was not found");
    return m[1]!;
  })();

  it("the typed column list is exactly LaborEntryRow's keys", () => {
    const m = code.match(/jsonb_to_record\(t\.el\) as x\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const names = (m?.[1] ?? "").split(",").map((part) => part.trim().split(/\s+/)[0] ?? "");
    expect(names).toHaveLength(14);
    expect([...names].sort()).toEqual(Object.keys(LABOR_KEYS).sort());
    expect(names).not.toContain("user_id");
    expect(names).not.toContain("pulled_at");
  });

  it("the body never mentions user_id", () => {
    expect(body.length).toBeGreaterThan(1000);
    expect(body).not.toMatch(/user_id/i);
  });
});

describe("the harness's toastInstant replica is the real normalizer", () => {
  const block = harness.match(/\/\/ BEGIN toastInstant replica[^\n]*\n([\s\S]*?)\n\/\/ END toastInstant replica/);
  if (!block) throw new Error("the replica block was not found in scripts/sql-harness-0361.mjs");
  const source = block[1]!;
  const replica = new Function(`${source}\nreturn toastInstant;`)() as (x: unknown) => unknown;

  it("is three lines inside its function", () => {
    const inner = source.split("\n").slice(1, -1);
    expect(source.split("\n")[0]).toBe("function toastInstant(x) {");
    expect(inner).toHaveLength(3);
  });

  it("gives the real toastInstant's output for the two Toast stamps (and they are EQUAL)", () => {
    const a = "2026-11-01T10:00:00.123100+0000";
    const b = "2026-11-01T10:00:00.123900+0000";
    expect(replica(a)).toBe(toastInstant(a));
    expect(replica(b)).toBe(toastInstant(b));
    expect(toastInstant(a)).toBe("2026-11-01T10:00:00.123Z");
    expect(toastInstant(b)).toBe(toastInstant(a));
  });

  it("agrees on the other shapes too", () => {
    for (const x of [null, undefined, "", "2026-11-01T10:00:00.000+0000", "2026-11-01T10:00:00.124-0500", "2026-11-01T10:00:00Z"]) {
      expect(replica(x)).toBe(toastInstant(x));
    }
    for (const x of ["not a date", 5]) {
      expect(() => replica(x)).toThrow("toast_labor_invalid_timestamp");
      expect(() => toastInstant(x)).toThrow("toast_labor_invalid_timestamp");
    }
  });
});

describe("the executable proof", () => {
  it("scripts/sql-harness-0361.mjs (PGlite, the REAL 0224 + 0233 section A + 0361) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0361.mjs"], { encoding: "utf8", timeout: 180_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toMatch(/^PASS 0361 harness: \d+ checks, 0 failures/m);
    const ids = out.match(/^checks by id: (.*)$/m);
    expect(ids).not.toBeNull();
    const byId = new Map((ids?.[1] ?? "").split(" ").map((kv) => { const [k, v] = kv.split("="); return [k ?? "", Number(v)] as const; }));
    for (const id of ["H0", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]) expect([id, (byId.get(id) ?? 0) > 0]).toEqual([id, true]);
    for (const needle of [
      "H0 a second apply -> 0361: already applied",
      "H0 the statement trigger disabled -> 0361: missing or disabled 0233 trigger toast_time_entries_link_lock. Refusing.",
      "H1 D-R2 closed then open: the shift ends CLOSED",
      "H1 the normalizer turns 2026-11-01T10:00:00.123100+0000 and 2026-11-01T10:00:00.123900+0000 into the SAME instant",
      "H2 the same payload again: unchanged + duplicates, never an error",
      "H3 the replay wrote nothing: every row's xmin AND pulled_at unchanged",
      "H4 user_id is filled by 0233's row trigger on a row the function inserts",
      "H4 the function body (pg_proc.prosrc) never names user_id",
      "H5 U2 a stale K1 with hours 49 + a valid later K2: the call SUCCEEDS",
      "H6 under default privileges the ACL still ends as postgres + service_role only",
      "H7 …and nothing else: the whole of public is as it was before 0361 (function count included)",
      "H8 main's unconditional upsert, the older write LAST, leaves the shift OPEN (the bug, shown)",
      "H8 the function on the same fixture and order leaves the shift CLOSED",
      "H9 every guarded call",
    ]) expect(out, needle).toContain(`ok   ${needle}`);
  }, 200_000);
});
