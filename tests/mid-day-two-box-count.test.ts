/**
 * Unit spine — the mid-day Phase 1 two-box count (0215 batch vs bottle, plan S r3 ruling F).
 *
 * A batch item's mid-day count is LINE (onHand) + bulk BACK UP; the RPC derives the total.
 * `lib/prep.ts` is a service-role module, so the guarantees are SOURCE assertions (the
 * tests/recipes-production-wiring.test.ts posture):
 *
 *   · submitMidDayPhase1 pre-validates the pair for batch items and answers a named reason,
 *     and maps the RPC's own two raises to the same reason (one answer, two guards);
 *   · the route turns that reason into 422 mid_day_backup_required;
 *   · the form posts `backUp` only for batch items and never defaults a batch box to 0;
 *   · non-batch items still post today's `{ onHand }` and nothing else;
 *   · the strings exist in both languages.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe("submitMidDayPhase1 — two boxes on a batch item", () => {
  const body = fnBody(read("lib", "prep.ts"), "submitMidDayPhase1");
  it("pre-validates onHand + backUp (both numbers >= 0) for batch items before the RPC", () => {
    const checkAt = body.indexOf('reason: "backup_required"');
    const rpcAt = body.indexOf('rpc("submit_mid_day_phase1_atomic"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(rpcAt);
    expect(body).toMatch(/state\.batchContext\[entry\.templateItemId\]\?\.isBatch === true/);
    expect(body).toMatch(/typeof onHand !== "number" \|\| typeof backUp !== "number" \|\| onHand < 0 \|\| backUp < 0/);
  });
  it("maps the RPC's mid_day_backup_required / mid_day_count_negative raises to the same reason", () => {
    expect(body).toMatch(/mid_day_backup_required\|mid_day_count_negative/);
    expect(body.split('reason: "backup_required"').length - 1).toBe(2);
  });
  it("leaves the 23514 → not_open mapping and the entries' inputs untouched for non-batch items", () => {
    expect(body).toContain('if (error.code === "23514") return { ok: false, reason: "not_open" };');
    expect(body).toContain("inputs: entry.inputs,");
  });
});

describe("route + form", () => {
  it("the route answers 422 mid_day_backup_required with the item id", () => {
    const route = read("app", "api", "prep", "mid-day", "phase1", "route.ts");
    expect(route).toMatch(/result\.reason === "backup_required"/);
    expect(route).toMatch(/jsonError\(422, "mid_day_backup_required"/);
  });
  it("the form posts { onHand, backUp } for batch items, { onHand } for the rest, and never defaults a batch box to 0", () => {
    const form = read("components", "MidDayPhase1Form.tsx");
    expect(form).toContain("inputs: { onHand: n, backUp: Number(backUps[it.id]) }");
    expect(form).toContain("inputs: { onHand: Number.isFinite(n) ? n : 0 }");
    // The guard runs before any entry is built.
    const guardAt = form.indexOf("items.filter((it) => !batchBoxesComplete(it))");
    const entriesAt = form.indexOf("const entries = items.map(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(entriesAt);
  });
  it("the page passes batchMode from the loader's batchContext", () => {
    expect(read("app", "(authed)", "operations", "mid-day", "page.tsx")).toMatch(/batchMode: state\.batchContext\[item\.id\]\?\.isBatch === true/);
  });
  it.each(["mid_day_prep.phase1.back_up", "mid_day_prep.phase1.error.backup_required"])("%s exists in en and es", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((es as Record<string, string>)[key]).toBeTruthy();
  });
});
