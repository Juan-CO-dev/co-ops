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

  it("pins the intended edit timestamp refresh after chain locks and before the cap", () => {
    const edit = current.slice(current.indexOf("-- 1. Lock the chain head."));
    const chainLock = edit.indexOf("WHERE original_submission_id = p_original_submission_id");
    const timestamp = edit.indexOf("v_submitted_at := clock_timestamp();");
    expect(chainLock).toBeGreaterThan(0);
    expect(timestamp).toBeGreaterThan(chainLock);
    expect(timestamp).toBeLessThan(edit.indexOf("-- 2. Cap check"));
    expect(current).toContain("-- Ruling 3 intended change: the edit branch refreshes v_submitted_at");
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
