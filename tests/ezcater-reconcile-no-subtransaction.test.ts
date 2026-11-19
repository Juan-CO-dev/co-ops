/**
 * Item 21 PR 4: THE ezCater RECONCILER NEVER RUNS IN A SUBTRANSACTION.
 *
 * 0347's incumbent rule (`ezcater_toast_incumbent`) reads xmin of the link row the reconciler retired in the SAME
 * top-level transaction (the recapture re-home). Inside a savepoint (a plpgsql EXCEPTION block, a SAVEPOINT) that xmin
 * is a subtransaction id: the re-insert would be skipped and recorded as a conflict. So:
 *   1. every caller of `reconcile_ezcater_toast` / `publish_ezcater_shadow` is a direct PostgREST `.rpc()` (one request
 *      = one top-level transaction), and the list of callers is CLOSED;
 *   2. no item-21 migration calls either function from SQL (no wrapper that could add an exception block);
 *   3. the house reconciler is its OWN call, made after the ezCater one, and its SQL has no exception block.
 * A new caller fails this file until someone checks it is a top-level call.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs)$/.test(name) ? [path.replace(/\\/g, "/")] : [];
});
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const sources = ["lib", "app", "components", "scripts"].flatMap(walk).filter((p) => !/sql-harness-|scripts\/sim\//.test(p));
const NAMES = /\b(reconcile_ezcater_toast|publish_ezcater_shadow)\b/;

describe("the ezCater reconciler and publisher are only ever top-level calls", () => {
  it("the callers are a closed list, each a direct .rpc(\"name\", ...)", () => {
    const callers: Record<string, number> = {};
    for (const path of sources) {
      const raw = readFileSync(path, "utf8");
      if (!NAMES.test(raw)) continue;
      const src = strip(raw);
      if (!NAMES.test(src)) continue;
      const direct = src.match(/\.rpc\(\s*"(reconcile_ezcater_toast|publish_ezcater_shadow)"/g) ?? [];
      // Every mention in code is one of those direct calls.
      expect([path, (src.match(new RegExp(NAMES, "g")) ?? []).length]).toEqual([path, direct.length]);
      callers[path] = direct.length;
    }
    expect(callers).toEqual({
      "lib/ezcater/pass2.ts": 1, // publish_ezcater_shadow, per order
      "lib/ezcater/reconcile.ts": 2, // the nightly pass and the recovery pass
      "lib/toast/capture-intraday.ts": 1, // every ten minutes
    });
  }, 120_000);

  it("no item-21 migration calls either function from SQL", () => {
    for (const name of ["0344_catering_toast_house_side.sql", "0347_catering_toast_link_step.sql", "0348_catering_toast_reconciler.sql"]) {
      const code = readFileSync(`supabase/migrations/${name}`, "utf8").replace(/--[^\n]*/g, "");
      expect([name, /\b(reconcile_ezcater_toast|publish_ezcater_shadow)\s*\(/.test(code)]).toEqual([name, false]);
    }
  });

  it("the house reconciler runs after the ezCater one, as its own request, and its SQL has no exception block", () => {
    const intraday = strip(readFileSync("lib/toast/capture-intraday.ts", "utf8"));
    expect(intraday.indexOf("runHouseCateringToast(")).toBeGreaterThan(intraday.indexOf('"reconcile_ezcater_toast"'));
    const lib = strip(readFileSync("lib/catering/catering-toast-reconcile.ts", "utf8"));
    expect(lib).not.toMatch(NAMES);
    expect(lib.match(/rpc\("(\w+)"/g)).toEqual(['rpc("ensure_catering_ring_codes"', 'rpc("reconcile_catering_toast"']);
    const sql = readFileSync("supabase/migrations/0348_catering_toast_reconciler.sql", "utf8").replace(/\r\n/g, "\n");
    const house = sql.match(/create function public\.reconcile_catering_toast\([\s\S]*?\nend \$\$;/)![0].replace(/--[^\n]*/g, "");
    expect(house).not.toMatch(/\bexception\s+when\b|savepoint/i);
  });

  it("the patterns are not vacuous", () => {
    expect(NAMES.test('sb.rpc("reconcile_ezcater_toast", {})')).toBe(true);
    expect(/\bexception\s+when\b/i.test("begin x; exception when others then null; end")).toBe(true);
  });
});
