/**
 * Unit spine — migration 0255 (B11a-floor) re-emits submit_phase2_atomic faithfully.
 *
 * 0255 is built MECHANICALLY from the latest definer (0215 §6f): the source body plus an
 * enumerated list of `[old, new]` modifications. Applying the same mods to the 0215 body must
 * give a line-SUBSEQUENCE of the 0255 body (the batch-vs-bottle-migration.test.ts idiom), so a
 * dropped line fails here by name. Then the two owner decisions are pinned directly:
 *   · recipients = key holders and up at the shop (trainer + employee dropped), MoO + Owner everywhere;
 *   · bodyParams carries `par` = the frozen Phase 1 par_value.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (f: string) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").replace(/\r\n/g, "\n");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const FILE = "0255_under_par_alert_recipients.sql";
const SOURCE = "0215_batch_vs_bottle.sql";
const START = "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(";
const END = "$function$;";

function extract(src: string): string {
  const a = src.indexOf(START);
  expect(a, "function start not found").toBeGreaterThan(-1);
  const b = src.indexOf(END, a);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b + END.length);
}

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
  [`            'freeText', COALESCE(v_over_under_reason_text, '')
          ),`,
   `            'freeText', COALESCE(v_over_under_reason_text, ''),
            'par', NULLIF(v_phase1->>'par_value', '')::numeric
          ),`],
  [`              'shift_lead', 'key_holder', 'trainer', 'employee'`,
   `              'shift_lead', 'key_holder'`],
];

const raw = read(FILE);
const emitted = extract(raw);

describe("0255 re-emits submit_phase2_atomic from its latest definer", () => {
  it("0215 was the previous latest definer and 0255 is the latest now", () => {
    const defining = files.filter((f) => read(f).includes(START));
    expect(defining[defining.length - 1]).toBe(FILE);
    expect(defining[defining.length - 2]).toBe(SOURCE);
  });

  it("the 0215 body (± the enumerated mods) is a line-subsequence of the 0255 body", () => {
    let source = extract(read(SOURCE));
    for (const [o, n] of MODS) {
      expect(source.split(o).length - 1, `mod anchor must occur once: ${o.slice(0, 60)}`).toBe(1);
      source = source.replace(o, n);
    }
    const check = isLineSubsequence(source, emitted);
    expect(check.ok, `missing from 0255 → ${check.missing}`).toBe(true);
  });

  it("adds nothing beyond the mods except comment lines", () => {
    let source = extract(read(SOURCE));
    for (const [o, n] of MODS) source = source.replace(o, n);
    const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
    const extra = emitted
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
    expect(extra).toEqual([]);
  });
});

describe("0255 — the two owner decisions", () => {
  const recipients = emitted.slice(emitted.indexOf("INSERT INTO notification_recipients"), emitted.indexOf(") recipients;"));

  it("recipients: key holders and up at the shop; trainer and employee are gone", () => {
    expect(recipients).toContain("'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',");
    expect(recipients).toContain("'shift_lead', 'key_holder'");
    expect(recipients).not.toMatch(/'trainer'|'employee'|'trainee'/);
    expect(recipients).toContain("OR u.role = 'moo'");
    expect(recipients).toContain("OR u.role = 'owner'");
  });

  it("bodyParams carries par from the frozen Phase 1 contract", () => {
    const params = emitted.slice(emitted.indexOf("'bodyParams', jsonb_build_object("), emitted.indexOf("'itemName', v_item_label,\n          'templateItemId'"));
    expect(params).toContain("'par', NULLIF(v_phase1->>'par_value', '')::numeric");
  });

  it("keeps the signature, definer posture and grants, and is authored-only", () => {
    expect(emitted).toContain(" SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'");
    expect(raw).toContain("revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;");
    expect(raw).toContain("grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;");
    expect(raw).toMatch(/NOT YET APPLIED — apply via MCP after review/);
    const sql = raw.replace(/--[^\n]*/g, "").trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
  });

  it("the opener's on-screen warning matches the recipient set (en)", () => {
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    expect(en["opening.under_par.warning"]).toMatch(/KH\+, MoO, and Owner/);
  });
});
