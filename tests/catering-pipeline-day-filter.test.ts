/**
 * Digests round 3, PR 1b (plan §3.4 + the plan check): the pipeline board's server-side DAY FILTER, through the real
 * `loadPipelineBoardView` over an in-memory PostgREST-shaped fake that behaves like the real one where it matters:
 *
 *  - a server ROW CAP (max-rows = 1000) on every response, ranged or not;
 *  - rows that tie on every requested sort key come back in a DIFFERENT order on every request (Postgres gives no
 *    order to ties), so a paged read without a unique total order loses and repeats rows across page boundaries.
 *
 * Pinned: an older booked order beyond the unfiltered board's row cap is shown; another shop / an unknown shop is
 * ignored (the normal board, no filter); `none`; the booked stage set; the scope is AND-ed in; the ensured lead
 * decision (a readable `?lead=` outside the filter CLEARS the filter); tied timestamps across a page boundary; the
 * shape of the one filtered read; and the URL parser (a bad or impossible day is ignored).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, calls } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
}));

const MAX_ROWS = 1000;
let requestNo = 0;
/** A cheap, request-salted hash: ties are ordered differently on every request. */
function salt(id: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
type Pred = (r: Row) => boolean;
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function term(t: string): Pred {
  const [col, op, ...rest] = t.split(".");
  const val = rest.join(".");
  if (op === "is") return (r) => (r[col!] ?? null) === (val === "null" ? null : val);
  if (op === "in") { const ids = val.replace(/^\(|\)$/g, "").split(","); return (r) => ids.includes(String(r[col!])); }
  if (op === "eq") return (r) => String(r[col!]) === val;
  throw new Error(`fake: unsupported filter ${t}`);
}
class Q {
  private preds: Pred[] = [];
  private sorts: Array<{ col: string; asc: boolean }> = [];
  private from = 0;
  private size: number | null = null;
  private rec: { table: string; ops: Array<[string, unknown[]]> };
  constructor(private table: string) { this.rec = { table, ops: [] }; calls.push(this.rec); }
  private log(op: string, args: unknown[]) { this.rec.ops.push([op, args]); return this; }
  select(...a: unknown[]) { return this.log("select", a); }
  eq(c: string, v: unknown) { this.preds.push((r) => r[c] === v); return this.log("eq", [c, v]); }
  is(c: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) === v); return this.log("is", [c, v]); }
  in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this.log("in", [c, vs]); }
  or(expr: string) { const p = splitTop(expr).map(term); this.preds.push((r) => p.some((f) => f(r))); return this.log("or", [expr]); }
  order(col: string, o?: { ascending?: boolean }) { this.sorts.push({ col, asc: o?.ascending ?? true }); return this.log("order", [col, o]); }
  limit(n: number) { this.size = n; return this.log("limit", [n]); }
  range(from: number, to: number) { this.from = from; this.size = to - from + 1; return this.log("range", [from, to]); }
  returns() { return this; }
  private exec(): { data: Row[]; error: null } {
    requestNo += 1;
    const n = requestNo;
    const rows = (db[this.table] ?? []).filter((r) => this.preds.every((p) => p(r)));
    rows.sort((a, b) => {
      for (const s of this.sorts) {
        const x = String(a[s.col]);
        const y = String(b[s.col]);
        if (x !== y) return (x < y ? -1 : 1) * (s.asc ? 1 : -1);
      }
      return salt(String(a.id), n) - salt(String(b.id), n); // ties: a fresh order per request
    });
    const take = Math.min(this.size ?? MAX_ROWS, MAX_ROWS);
    return { data: rows.slice(this.from, this.from + take).map((r) => ({ ...r })), error: null };
  }
  maybeSingle() { const r = this.exec(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); }
  then<A, B>(res: (v: { data: Row[]; error: null }) => A, rej?: (e: unknown) => B) { return Promise.resolve(this.exec()).then(res, rej); }
}
const sbFake = { from: (t: string) => new Q(t) };
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => sbFake }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { loadPipelineBoard, loadPipelineBoardView } from "@/lib/catering/pipeline";
import { CATERING_RAN_STAGES, isCalendarDay, leadMatchesDayFilter, parsePipelineDayFilter } from "@/lib/catering/pipeline-shared";
import { selectAllRows } from "@/lib/supabase-paginate";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // well formed, no such shop
const D = "2026-11-27";
const OTHER_DAY = "2026-11-28";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function actor(id: string, role: string, locations: string[]): AuthContext {
  db.users!.push({ id, role, active: true });
  for (const l of locations) db.user_locations!.push({ user_id: id, location_id: l, active: true });
  return { user: { id, role }, role, locations } as unknown as AuthContext;
}
let next = 1;
function lead(over: Row = {}): Row {
  const n = next++;
  return { id: uuid(n), contact_name: `Contact ${n}`, stage: "confirmed", location_id: A, event_date: D, created_at: `2026-11-20T10:00:${String(n % 60).padStart(2, "0")}.000Z`, ...over };
}
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  calls.length = 0;
  next = 1;
  db.users = [];
  db.user_locations = [];
  db.locations = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
  db.catering_quotes = [];
  db.catering_pipeline = [];
});
const ids = (leads: Array<{ id: string }>) => leads.map((l) => l.id).sort();
const F = (location: string, day = D) => ({ day, location });

describe("the URL parser: anything but a well-formed booked filter is ignored", () => {
  it("accepts a real day + a shop id or none + view=booked", () => {
    expect(parsePipelineDayFilter({ day: D, location: A, view: "booked" })).toEqual({ day: D, location: A });
    expect(parsePipelineDayFilter({ day: D, location: A.toUpperCase(), view: "booked" })).toEqual({ day: D, location: A });
    expect(parsePipelineDayFilter({ day: D, location: "none", view: "booked" })).toEqual({ day: D, location: "none" });
  });
  it.each([
    [{ day: "2026-02-31", location: A, view: "booked" }, "an impossible date"],
    [{ day: "2026-13-01", location: A, view: "booked" }, "month 13"],
    [{ day: "2026-2-3", location: A, view: "booked" }, "not YYYY-MM-DD"],
    [{ day: "tomorrow", location: A, view: "booked" }, "a word"],
    [{ day: D, location: "Shop A", view: "booked" }, "a name, not an id"],
    [{ day: D, location: A }, "no view"],
    [{ day: D, location: A, view: "all" }, "another view"],
    [{ location: A, view: "booked" }, "no day"],
    [{ day: D, view: "booked" }, "no shop"],
    [{ day: [D, D], location: A, view: "booked" }, "a repeated param"],
  ] as const)("%j (%s) → null", (sp: unknown, why: string) => expect(parsePipelineDayFilter(sp as never), why).toBeNull());
  it("a calendar day is a real one (leap years included)", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-04-31")).toBe(false);
  });
  it("the booked set is the digest's RAN set", () => {
    expect([...CATERING_RAN_STAGES]).toEqual(["confirmed", "out", "completed"]);
    expect(leadMatchesDayFilter({ eventDate: D, locationId: null, stage: "out" }, F("none"))).toBe(true);
    expect(leadMatchesDayFilter({ eventDate: D, locationId: A, stage: "inquiry" }, F(A))).toBe(false);
  });
});

describe("the filtered board: one scoped read of exactly that day, read to completion", () => {
  it("an older booked order beyond the unfiltered board's row cap is shown", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const old = lead({ created_at: "2026-01-02T09:00:00.000Z" });
    for (let i = 0; i < 1200; i += 1) db.catering_pipeline!.push(lead({ event_date: OTHER_DAY, created_at: `2026-11-2${i % 9}T10:00:00.000Z` }));
    db.catering_pipeline!.push(old);
    // The cap is real: the unfiltered board never reaches the old order.
    expect((await loadPipelineBoard(gm)).some((l) => l.id === old.id)).toBe(false);
    const view = await loadPipelineBoardView(gm, { filter: F(A) });
    expect(view.filter).toEqual({ day: D, location: A, shopName: "Shop A" });
    expect(ids(view.leads)).toEqual([old.id as string]);
  });

  it("only the booked stages of that day at that shop", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const keep = ["confirmed", "out", "completed"].map((stage) => lead({ stage }));
    db.catering_pipeline!.push(...keep, lead({ stage: "inquiry" }), lead({ stage: "quote_sent" }), lead({ stage: "lost" }),
      lead({ event_date: OTHER_DAY }), lead({ location_id: null }), lead({ location_id: B }));
    const view = await loadPipelineBoardView(gm, { filter: F(A) });
    expect(ids(view.leads)).toEqual(ids(keep as Array<{ id: string }>));
  });

  it("`none` = the leads with no shop set on that day (for everyone in scope)", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const none = [lead({ location_id: null }), lead({ location_id: null, stage: "completed" })];
    db.catering_pipeline!.push(...none, lead(), lead({ location_id: B }), lead({ location_id: null, stage: "inquiry" }));
    const view = await loadPipelineBoardView(gm, { filter: F("none") });
    expect(view.filter).toEqual({ day: D, location: "none", shopName: null });
    expect(ids(view.leads)).toEqual(ids(none as Array<{ id: string }>));
  });

  it("the shape of the read: filtered in the database BEFORE paging, scope AND-ed, a unique total order, paged", async () => {
    const gm = actor("gm-a", "gm", [A]);
    db.catering_pipeline!.push(lead());
    calls.length = 0;
    await loadPipelineBoardView(gm, { filter: F(A) });
    const read = calls.find((c) => c.table === "catering_pipeline")!;
    const ops = read.ops.map(([op, args]) => `${op}:${JSON.stringify(args)}`);
    expect(ops).toEqual(expect.arrayContaining([
      `eq:${JSON.stringify(["event_date", D])}`,
      `in:${JSON.stringify(["stage", ["confirmed", "out", "completed"]])}`,
      `eq:${JSON.stringify(["location_id", A])}`,
      `or:${JSON.stringify([`location_id.is.null,location_id.in.(${A})`])}`,
      `range:${JSON.stringify([0, 999])}`,
    ]));
    const orders = read.ops.filter(([op]) => op === "order").map(([, a]) => a);
    expect(orders).toEqual([["created_at", { ascending: false }], ["id", { ascending: true }]]);
    // Every filter precedes the range: nothing is filtered after a page is cut.
    expect(read.ops.findIndex(([op]) => op === "range")).toBeGreaterThan(Math.max(...read.ops.map(([op], i) => (["eq", "in", "is", "or"].includes(op) ? i : -1))));
  });

  it("tied timestamps across a page boundary: every row once, none lost (2,500 orders at one instant)", async () => {
    const moo = actor("moo", "moo", []);
    const many = Array.from({ length: 2500 }, () => lead({ created_at: "2026-11-01T08:00:00.000Z" }));
    db.catering_pipeline!.push(...many);
    const view = await loadPipelineBoardView(moo, { filter: F(A) });
    expect(view.leads).toHaveLength(2500);
    expect(new Set(view.leads.map((l) => l.id)).size).toBe(2500);
    // Control: the fake really punishes a non-unique order — paging by created_at alone repeats and loses rows.
    const careless = await selectAllRows<Row>((from, to) => sbFake.from("catering_pipeline").select("*").eq("event_date", D)
      .order("created_at", { ascending: false }).range(from, to) as never);
    expect(careless).toHaveLength(2500);
    expect(new Set(careless.map((r) => r.id)).size).toBeLessThan(2500);
  });
});

describe("whose shop: the board's own scope; anything else is ignored (the normal board, no banner)", () => {
  it("a GM: own shop filtered; another shop ignored (never that shop's leads, never an error)", async () => {
    const gm = actor("gm-a", "gm", [A]);
    db.catering_pipeline!.push(lead(), lead({ location_id: B }), lead({ event_date: OTHER_DAY }));
    expect((await loadPipelineBoardView(gm, { filter: F(A) })).filter?.location).toBe(A);
    const other = await loadPipelineBoardView(gm, { filter: F(B) });
    expect(other.filter).toBeNull();
    // The normal board under the GM's scope: shop A's leads (any day), never shop B's.
    expect(other.leads.every((l) => l.locationId === A)).toBe(true);
    expect(other.leads).toHaveLength(2);
  });

  it.each([
    ["moo", [] as string[], "MoO with no membership"],
    ["owner", [] as string[], "owner"],
    ["catering_mgr", [A], "catering manager (member of A only)"],
  ])("%s (%s): any shop", async (role, locs) => {
    const who = actor(`u-${role}`, role, locs);
    db.catering_pipeline!.push(lead({ location_id: B }));
    const view = await loadPipelineBoardView(who, { filter: F(B) });
    expect(view.filter).toEqual({ day: D, location: B, shopName: "Shop B" });
    expect(view.leads).toHaveLength(1);
  });

  it.each([["agm", 6], ["shift_lead", 5], ["social_media_mgr", 6]] as const)("%s (level %d): own shop yes, another shop no", async (role: string, level: number) => {
    expect(level).toBeGreaterThanOrEqual(5); // PIPELINE_READ_MIN
    const who = actor(`u-${role}`, role, [A]);
    expect((await loadPipelineBoardView(who, { filter: F(A) })).filter?.location).toBe(A);
    expect((await loadPipelineBoardView(who, { filter: F(B) })).filter).toBeNull();
  });

  it("a well-formed id of a shop that does not exist is ignored, even for the MoO", async () => {
    const moo = actor("moo", "moo", []);
    expect((await loadPipelineBoardView(moo, { filter: F(C) })).filter).toBeNull();
  });

  it("no filter = the board exactly as before", async () => {
    const gm = actor("gm-a", "gm", [A]);
    db.catering_pipeline!.push(lead(), lead({ event_date: OTHER_DAY }));
    const view = await loadPipelineBoardView(gm, {});
    expect(view.filter).toBeNull();
    expect(view.leads).toHaveLength(2);
  });
});

describe("the ensured lead never contradicts the banner (plan check, Astra #1): a readable lead outside the filter clears it", () => {
  it("a readable lead from ANOTHER DAY: the filter is cleared, the normal board shows that lead (even past the cap)", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const elsewhere = lead({ event_date: OTHER_DAY, created_at: "2026-01-01T00:00:00.000Z" });
    for (let i = 0; i < 1100; i += 1) db.catering_pipeline!.push(lead({ created_at: "2026-11-25T00:00:00.000Z" }));
    db.catering_pipeline!.push(elsewhere);
    const view = await loadPipelineBoardView(gm, { ensureLead: elsewhere.id as string, filter: F(A) });
    expect(view.filter).toBeNull();
    expect(view.leads.some((l) => l.id === elsewhere.id)).toBe(true);
  });

  it("a readable lead at ANOTHER SHOP in scope, or not in a booked stage: cleared too", async () => {
    const moo = actor("moo", "moo", []);
    const atB = lead({ location_id: B });
    const inquiry = lead({ stage: "inquiry" });
    db.catering_pipeline!.push(atB, inquiry, lead());
    expect((await loadPipelineBoardView(moo, { ensureLead: atB.id as string, filter: F(A) })).filter).toBeNull();
    expect((await loadPipelineBoardView(moo, { ensureLead: inquiry.id as string, filter: F(A) })).filter).toBeNull();
  });

  it("a lead that MATCHES the filter: the filter stands and the lead is in it", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const match = lead();
    db.catering_pipeline!.push(match, lead({ event_date: OTHER_DAY }));
    const view = await loadPipelineBoardView(gm, { ensureLead: match.id as string, filter: F(A) });
    expect(view.filter?.location).toBe(A);
    expect(ids(view.leads)).toEqual([match.id as string]);
  });

  it("a lead the reader may NOT view: ignored, the filter stands, the lead is not added", async () => {
    const gm = actor("gm-a", "gm", [A]);
    const hidden = lead({ location_id: B, event_date: OTHER_DAY });
    const mine = lead();
    db.catering_pipeline!.push(hidden, mine);
    const view = await loadPipelineBoardView(gm, { ensureLead: hidden.id as string, filter: F(A) });
    expect(view.filter?.location).toBe(A);
    expect(ids(view.leads)).toEqual([mine.id as string]);
  });
});
