// Item 2: the sim-only two-session proof script, exercised OFFLINE (never run here). Its guard is the
// designated sim; its SQL builders run single-session in PGlite on the real parents + real 0337, so a
// typo cannot reach CC's sim run. The concurrency itself is proven only on sim.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  D1, D2, VERSION, entry, fixture, fixtureSQL, fullCaptureSQL, modifiedSaveSQL, replaceSQL, retireSQL, staleSQL,
} from "../scripts/sim/fact-0337-lock-check-management.mjs";
import { PROD_REF, SIM_REF, projectRef } from "../scripts/supabase-management-query.mjs";
import { M0337, freshParents } from "./helpers/fact-0337-parents";
import { FACT_BUILDER_VERSION } from "@/lib/facts/order-facts-shared";

describe("0337 sim Management API proof (offline)", () => {
  it("guards the designated sim, reads only the access token, and never deletes", () => {
    const source = readFileSync("scripts/sim/fact-0337-lock-check-management.mjs", "utf8");
    expect(source).toContain("projectRef(process.argv.slice(2), true)");
    expect(source.match(/process\.env\.[A-Z_]+/g)).toEqual(["process.env.SUPABASE_ACCESS_TOKEN"]);
    expect(source).not.toMatch(/dotenv|\bdelete from\b|\btruncate\b/i);
    expect(projectRef([`--ref=${SIM_REF}`], true)).toBe(SIM_REF);
    for (const ref of [PROD_REF, "aaaaaaaaaaaaaaaaaaaa"]) expect(() => projectRef([`--ref=${ref}`], true)).toThrow();
    expect(VERSION).toBe(FACT_BUILDER_VERSION);
  });

  it("every SQL builder runs on the real schema, and the single-session sequence ends drained", async () => {
    const db = await freshParents();
    await db.exec(M0337);
    const f = fixture();
    const run = async (sql: string) => db.exec(`begin; set local role service_role; ${sql}; commit;`);
    const stale = async () => (await db.query<{ d: string }>(staleSQL(f))).rows.map((r) => r.d);
    await db.exec(fixtureSQL(f));
    await run(fullCaptureSQL(f, D1, [entry("a", D1, { payment: true }), entry("b", D1)]));
    await run(fullCaptureSQL(f, D2, [entry("c", D2, { payment: true })]));
    expect(await stale()).toEqual([D1, D2]);
    await run(replaceSQL(f, D1)); await run(replaceSQL(f, D2));
    expect(await stale()).toEqual([]);
    await run(modifiedSaveSQL(f, [entry("a", D1, { payment: true, modified: `${D1}T18:00:00Z` }), entry("c", D2, { payment: true, modified: `${D2}T18:00:00Z` })]));
    await run(fullCaptureSQL(f, D2, [entry("c", D2, { payment: true, modified: `${D2}T19:00:00Z` })]));
    expect(await stale()).toEqual([D1, D2]);
    await run(replaceSQL(f, D1)); await run(replaceSQL(f, D2));
    expect(await stale()).toEqual([]);
    await db.exec(retireSQL(f));
    expect((await db.query("select active from locations where id=$1", [f.shop])).rows).toEqual([{ active: false }]);
  }, 120_000);
});
