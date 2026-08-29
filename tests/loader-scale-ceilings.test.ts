/**
 * Unit spine — THE TWO SCALE CEILINGS, pinned on the three loaders repaired in the
 * post-Dynamic-Pars cleanup batch.
 *
 * The ceilings fail in opposite directions and neither is visible at today's data volumes,
 * which is exactly why they need pinning rather than smoking:
 *
 *   ROW cap        — the read SUCCEEDS and silently returns the first 1000 rows. No error,
 *                    no log, a truncated admin list. The PR #63 lesson.
 *   REQUEST-LINE   — the read FAILS on page 0 with zero rows, before any SQL runs, because
 *                    the `.in()` filter made the GET request line too long for the proxy.
 *                    `selectAllRows` pages the RESPONSE and cannot help.
 *
 * All three loaders are DB-coupled, so they stay off the pure spine per the house law
 * (AGENTS.md § Module boundaries). What IS assertable is (a) the arithmetic that makes the
 * request-line cliff a real deadline rather than a theoretical one, over the pure helpers in
 * lib/supabase-paginate.ts, and (b) the SHAPE of the fix at the source — the same posture
 * tests/dynamic-pars-walker.test.ts takes for loadWalkerData's row rules, and for the same
 * reason: when the guarantee is "this list is never spent whole", the ABSENCE is what has to
 * be asserted, and no unit test over the module's exports can see an absence.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { inListFitsRequestLine, requestLineBytesForInList } from "@/lib/supabase-paginate";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const read = (file: string) => readFileSync(join(LIB, file), "utf8");

/** The chunk size all three production-id consumers settled on. */
const CHUNK = 150;

describe("the production-id chunk size clears the request line with room to spare", () => {
  it("150 ids fit, and the whole-list spend does not", () => {
    // The fix's premise: one chunk is safely inside the budget, while the unbounded list
    // it replaced is refused somewhere in the 200-400 band.
    expect(inListFitsRequestLine("production_id", CHUNK)).toBe(true);
    expect(inListFitsRequestLine("production_id", 250)).toBe(false);
    expect(inListFitsRequestLine("production_id", 5_000)).toBe(false);
  });

  it("a chunk spends well under half the budget, leaving room for the rest of the request", () => {
    // `requestLineBytesForInList` is a FLOOR — the real request also pays percent-encoding,
    // the select list, the order clause and the range. A chunk sized right at the ceiling
    // would be a chunk that fails on the first loader that adds a column.
    const perChunk = requestLineBytesForInList("production_id", CHUNK);
    expect(perChunk).toBeLessThan(6_000);
    expect(inListFitsRequestLine("production_id", CHUNK * 2)).toBe(false);
  });

  it("the cliff for THIS column is 221 ids — a reachable number, not a theoretical one", () => {
    // `production_id` is 13 characters, so the filter costs 18 + 37n bytes and the
    // conservative 8192-byte budget breaks between 220 and 221. Pinned exactly, because
    // "somewhere in the 200-400 band" is the kind of estimate that gets rounded up by a
    // future reader until the guard no longer guards.
    expect(inListFitsRequestLine("production_id", 220)).toBe(true);
    expect(inListFitsRequestLine("production_id", 221)).toBe(false);
  });

  it("30 days of production reaches that cliff on ordinary volume", () => {
    // Why this was invisible: production_inputs carries 0 rows in prod today, so every
    // smoke and every sim passed over the broken path. Eight captures a day at one shop
    // crosses it inside the 30-day window — the reason this is a fix, not a hardening.
    expect(inListFitsRequestLine("production_id", 30)).toBe(true); // today-ish
    expect(inListFitsRequestLine("production_id", 8 * 30)).toBe(false); // 8/day for a month
  });
});

describe("loadSkuUsageRank spends its production ids in WINDOWS, in both twins", () => {
  // lib/ordering.ts's own header declares these two "mirror ... EXACTLY". Asserting both
  // is what keeps that claim true — a fix applied to one twin only is the drift this pair
  // of assertions exists to catch.
  for (const file of ["ordering.ts", "receiving.ts"]) {
    describe(`lib/${file}`, () => {
      const src = read(file);

      it("declares the chunk size and never spends the whole id list", () => {
        expect(src).toContain(`const PRODUCTION_ID_CHUNK = ${CHUNK}`);
        // The exact spelling of the bug: the unbounded array passed straight to `.in()`.
        expect(src).not.toContain('.in("production_id", prodIds)');
      });

      it("filters on the CHUNK, inside a loop stepping by the chunk size", () => {
        expect(src).toContain('.in("production_id", chunk)');
        expect(src).toContain("i += PRODUCTION_ID_CHUNK");
        // The chunks must be DISJOINT and cover the list — union == the one-shot result,
        // which is what makes this a no-behaviour-change fix with no parity to verify.
        expect(src).toContain("prodIds.slice(i, i + PRODUCTION_ID_CHUNK)");
      });

      it("still PAGES each chunk's response — the two ceilings are independent", () => {
        // A chunk of 150 productions can still yield more than 1000 input rows, so the
        // request-line fix must not quietly cost the row-cap fix.
        const chunkAt = src.indexOf('.in("production_id", chunk)');
        const pagerAt = src.lastIndexOf("selectAllRows", chunkAt);
        expect(chunkAt).toBeGreaterThan(-1);
        expect(pagerAt).toBeGreaterThan(-1);
        expect(src.slice(pagerAt, chunkAt)).toContain("production_inputs");
      });
    });
  }
});

describe("loadVendorRhythmSkips pages under a STABLE TOTAL order", () => {
  const src = read("vendor-rhythm.ts");
  const at = src.indexOf("export async function loadVendorRhythmSkips");
  const body = src.slice(at, src.indexOf("\n}", at));

  it("is paged at all — skips are unbounded where rhythm PAIRS are index-bounded", () => {
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("selectAllRows");
    expect(body).toContain(".range(from, to)");
  });

  it("orders by skip_from AND id — skip_from alone is not unique, so not a total order", () => {
    // Under a non-total order PostgREST may return a row on two pages or on none. Two
    // shops' outages routinely start the same day, so the tiebreak is load-bearing, not
    // ceremonial. `id` (the PK) is the house's stable tiebreak.
    expect(body).toContain('.order("skip_from", { ascending: true })');
    expect(body).toContain('.order("id", { ascending: true })');
  });

  it("keeps the CONTRACT: no date bound, unlike the walker's loadRhythmSkips", () => {
    // The admin card is a HISTORY — an expired window is exactly what an admin is looking
    // for. A `gte` here would silently hide rows the card exists to show, which would be a
    // contract change wearing a bug fix's clothes. The walker's read keeps its own bound.
    expect(body).not.toContain("gte");
    const walkerAt = src.indexOf("export async function loadRhythmSkips");
    expect(src.slice(walkerAt, src.indexOf("\n}", walkerAt))).toContain('.gte("skip_through", fromDate)');
  });

  it("still degrades to [] while migration 0182 is unapplied", () => {
    // Paging must not disturb the probe gate: pre-apply the table does not exist, and the
    // loader returns an empty list rather than throwing.
    expect(body).toContain("if (!(await rhythmSchemaReady(sb))) return []");
  });
});
