import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const current = read("0291_prep_submit_idempotency.sql");

describe("0291 preserves the applied 0290 writer", () => {
  it("retains every prior body statement in order, including closing CAS and edit supersession", () => {
    const statements = (source: string) => source
      .slice(source.indexOf("DECLARE", source.indexOf("FUNCTION public.submit_am_prep_atomic")), source.indexOf("$function$;"))
      .split(/\r?\n/).map(line => line.replace(/--.*$/, "").trim().replace(/,$/, ""))
      .filter(Boolean);
    const prior = statements(read("0290_checklist_closing_ref_atomic.sql"));
    const next = statements(current);
    expect(prior.length).toBeGreaterThan(200);
    let cursor = 0;
    for (const line of prior) {
      while (cursor < next.length && next[cursor] !== line) cursor++;
      expect(cursor, `missing or reordered 0290 statement: ${line}`).toBeLessThan(next.length);
      cursor++;
    }
  });

  it("runs actual SQL, rejecting the deliberately broken hash comparison before passing", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0291.mjs"], {
      encoding: "utf8", timeout: 120_000,
    });
    expect(output).toContain("EXPECTED FAIL 0291 broken variant:");
    expect(output).toContain("PASS 0291:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 130_000);
});
