import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("0290 closing reference SQL harness", () => {
  it("proves transaction rollback, CAS, provenance, revoked/multiple-head refusals and the AM push in ephemeral PGlite", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0290.mjs"], {
      encoding: "utf8", timeout: 120_000,
    });
    expect(output).toContain("0290 behavior: rollback after supersede/insert, first-insert CAS, provenance/link");
    expect(output).toContain("revoked and multiple-head refusals, confirmed reconcile, AM push verified");
    expect(output).toContain("0290 monotonicity: count/time regressions refused, actual confirmation preferred, timestamp repair and repeated reconcile verified");
    expect(output).toContain("0290 contracts: service-only ACLs, security modes, signatures and parent lock verified");
    expect(output).toContain("PASS 0290:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 130_000);

  it("retains the 0186 update branch verbatim and preserves its nine-argument signature", () => {
    const old = readFileSync("supabase/migrations/0186_am_prep_chain_edit_supersede.sql", "utf8").replace(/\r\n/g, "\n");
    const current = readFileSync("supabase/migrations/0290_checklist_closing_ref_atomic.sql", "utf8").replace(/\r\n/g, "\n");
    const start = old.indexOf("  ELSE\n    -- ================================================================");
    const end = old.indexOf("$function$;", start);
    expect(start).toBeGreaterThan(0);
    expect(current).toContain(old.slice(start, end));
    const originalStart = old.indexOf("    -- 1. Insert one checklist_completion per entry.");
    const originalEnd = old.indexOf("    -- 4. Auto-complete the closing's report-reference item", originalStart);
    expect(originalStart).toBeGreaterThan(0);
    expect(originalEnd).toBeGreaterThan(originalStart);
    expect(current).toContain(old.slice(originalStart, originalEnd));
    expect(current).not.toMatch(/drop\s+function/i);
  });
});
