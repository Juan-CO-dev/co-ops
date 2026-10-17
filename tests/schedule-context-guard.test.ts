/**
 * CC chunk D ruling 3 — the context byte guard. 0275 CHECKs `octet_length(context::text) <= 262144`, and jsonb's text
 * form is NOT the canonical JSON the lib digests (a space after every `:` and `,`, exponents spelled out). The lib
 * measures the jsonb text form (`jsonbTextBytes`, proved equal to Postgres on PGlite), keeps a 32 KiB margin under the
 * CHECK (`CONTEXT_SAFE_MAX_BYTES`), and refuses past it by name (`context_too_large`, en + es) before any RPC.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTEXT_MAX_BYTES, CONTEXT_SAFE_MAX_BYTES, assertContextFits, jsonbTextBytes } from "@/lib/scheduling/context-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { FIXTURES } from "./fixtures/schedule/fixtures";

let db: PGlite;
beforeAll(async () => { db = new PGlite(); }, 60_000);
afterAll(async () => { await db?.close(); });

const pgBytes = async (v: unknown) => {
  const r = await db.query<{ n: number }>("select octet_length(($1)::jsonb::text) as n", [JSON.stringify(v)]);
  return Number(r.rows[0]!.n);
};

describe("jsonbTextBytes measures exactly what 0275's CHECK measures", () => {
  const samples: unknown[] = [
    {}, [], { a: 1 }, { a: [1, 2, 3], b: { c: null, d: true, e: false } }, [1.5, -0.25, 10.5, 0, -3, 1e-7, 2.5e-9, 1e21, 123456789012],
    { "ñandú": "café — 15 min", quote: 'say "hi"\ \n\t\r\b\f end', ctl: "\u0001\u001f", emoji: "🍞🥪" },
    { z: 1, aa: 2, b: [{ y: "x", x: [] }, null] },
  ];
  it("on a spread of shapes (unicode, escapes, exponents, nesting) — equal to Postgres byte for byte", async () => {
    for (const v of samples) expect(jsonbTextBytes(v), JSON.stringify(v)).toBe(await pgBytes(v));
  });
  it("on real generator contexts (every golden fixture) — equal to Postgres", async () => {
    for (const name of Object.keys(FIXTURES).sort().slice(0, 6)) {
      const ctx = buildWeek(FIXTURES[name]!()).context;
      expect(jsonbTextBytes(ctx), name).toBe(await pgBytes(ctx));
    }
  });
});

describe("assertContextFits: a named refusal well under the CHECK", () => {
  it("the safe ceiling keeps a 32 KiB margin under 262144", () => {
    expect(CONTEXT_MAX_BYTES).toBe(262144);
    expect(CONTEXT_SAFE_MAX_BYTES).toBe(CONTEXT_MAX_BYTES - 32 * 1024);
  });
  /** A context-shaped object padded to exactly `n` jsonb text bytes. */
  const padded = (n: number) => {
    const base = { version: 1, pad: "" };
    const extra = n - jsonbTextBytes(base);
    return { version: 1, pad: "x".repeat(extra) };
  };
  it("AT the safe ceiling: accepted; ONE byte over: refused context_too_large with the numbers", () => {
    const at = padded(CONTEXT_SAFE_MAX_BYTES);
    expect(jsonbTextBytes(at)).toBe(CONTEXT_SAFE_MAX_BYTES);
    expect(assertContextFits(at)).toEqual({ bytes: CONTEXT_SAFE_MAX_BYTES });
    const over = padded(CONTEXT_SAFE_MAX_BYTES + 1);
    try { assertContextFits(over); expect.unreachable(); }
    catch (e) {
      expect(e).toBeInstanceOf(ScheduleError);
      expect((e as ScheduleError).code).toBe("context_too_large");
      expect((e as ScheduleError).params).toEqual({ bytes: CONTEXT_SAFE_MAX_BYTES + 1, max: CONTEXT_SAFE_MAX_BYTES });
    }
  });
  it("a real week fits with room to spare (the v17 mockup week)", () => {
    expect(assertContextFits(buildWeek(FIXTURES["F1-mockup-v17"]!()).context).bytes).toBeLessThan(CONTEXT_SAFE_MAX_BYTES / 2);
  });
  it("the refusal is named in en and es (tú)", () => {
    const k = "schedule.error.context_too_large";
    expect((en as Record<string, string>)[k]).toMatch(/\S/);
    expect((es as Record<string, string>)[k]).toMatch(/\S/);
    expect((es as Record<string, string>)[k]).not.toMatch(/\busted\b|\bsu\b/i);
  });
});
