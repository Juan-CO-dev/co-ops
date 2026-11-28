/**
 * Digest PR 2, packet C — the run-scoped schedule reader (plan §2.2, §11.1.4 – §11.1.6, §13.1.2 – §13.1.4, §15.1.2;
 * addendum A2-3). A fake `fetch` behind the REAL client, the real `pageStep`, the real check and normalizer; a small
 * fake service-role client for the mirror tables. Synthetic data only: shops "Shop A" / "Shop B", made-up ids,
 * "Person A" / "Person B". No network, no email.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/report-digests-schedule-shared", async (orig) => {
  const m = await orig<typeof import("@/lib/report-digests-schedule-shared")>();
  return { ...m, checkPublishedAnswer: vi.fn(m.checkPublishedAnswer) };
});

import { checkPublishedAnswer } from "@/lib/report-digests-schedule-shared";
import type { SevenShiftsFetch } from "@/lib/sevenshifts/client";
import {
  createScheduleReader, SCHEDULE_ID_BATCH, SCHEDULE_PAGE_MAX_BYTES, SCHEDULE_USER_COLUMNS, SCHEDULE_WHOAMI_MAX_BYTES,
  SCHEDULE_WINDOW_MS, type ServiceRoleClient,
} from "@/lib/report-digests-schedule";
import {
  CASE_REQUEST, COMPANY, SHOP_A_7S, SHOP_B_7S, STAFFING_CASES, VALID_WHOAMI, shiftRow, validAnswerBody,
  type StaffingResponse,
} from "./fixtures/digest/staffing-cases";

const TOKEN = "PLANTED-TOKEN-reader-0123456789abcdef";
const ENV = { SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" };
const SHOP_A = "00000000-0000-4000-8000-00000000a001";
const SHOP_B = "00000000-0000-4000-8000-00000000b002";
const SHOP_C = "00000000-0000-4000-8000-00000000c003"; // never linked
const D = "2026-03-01";
const D1 = "2026-03-02";
const D2 = "2026-03-03";
const enc = new TextEncoder();
const str = (s: string) => JSON.stringify(s);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(checkPublishedAnswer).mockClear();
});

// ── the fake mirror ────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
interface Query { table: string; select: string; eq: Record<string, unknown>; in: unknown[] | null; inCol: string | null; order: string[]; signal: boolean }
interface Mirror {
  links?: Row[]; locations?: Row[]; users?: Row[]; roles?: Row[];
  /** A table whose read never answers. */
  hang?: string;
  /** A table whose read answers an error. */
  fail?: string;
  /** A table whose `::text` casts are NOT honoured: its bigint ids come back as JS numbers (F5). */
  noCast?: string;
  /** A table whose FIRST read never answers (later reads answer). */
  hangFirst?: string;
  /** Called on every query as it is sent (tests count or advance a clock here). */
  onQuery?: (q: Query) => void;
  /** A table whose FIRST read is held open until `until` resolves, then answers normally (fix round 2, F7). */
  holdFirst?: { table: string; until: Promise<void> };
  /** Called when a query ANSWERS, just before its rows are handed back (fix round 2, F4: the clock moves here). */
  onAnswer?: (q: Query) => void;
  /** A table whose FIRST read answers an error (later reads answer normally). */
  failFirst?: string;
}
const DEFAULT_MIRROR: Required<Pick<Mirror, "links" | "locations" | "users" | "roles">> = {
  links: [{ location_id: SHOP_A, sevenshifts_location_id: Number(SHOP_A_7S), active: true },
          { location_id: SHOP_B, sevenshifts_location_id: SHOP_B_7S, active: true }],
  locations: [{ id: Number(SHOP_A_7S), company_id: Number(COMPANY) }, { id: SHOP_B_7S, company_id: COMPANY }],
  users: [{ id: 11, company_id: COMPANY, first_name: "Alpha", preferred_first_name: "Person A", last_name: "NEVER-SELECTED" },
          { id: "12", company_id: COMPANY, first_name: "Person B", preferred_first_name: null, last_name: "NEVER-SELECTED" }],
  roles: [{ id: 21, name: "Cook" }],
};

/**
 * Answers as PostgREST would: every `eq` / `in` filter applied (compared as text), only the selected columns, and a
 * `col::text` cast answered as a STRING under the key `col` (F5). Values may be stored as numbers or strings.
 */
function fakeDb(m: Mirror = {}) {
  const data = { ...DEFAULT_MIRROR, ...m };
  const tables: Record<string, Row[]> = {
    sevenshifts_location_links: data.links, sevenshifts_locations: data.locations, sevenshifts_users: data.users, sevenshifts_roles: data.roles,
  };
  const queries: Query[] = [];
  const sb = {
    from(table: string) {
      const q: Query = { table, select: "", eq: {}, in: null, inCol: null, order: [], signal: false };
      queries.push(q);
      const b: Record<string, unknown> = {
        select: (c: string) => { q.select = c; return b; },
        eq: (c: string, v: unknown) => { q.eq[c] = v; return b; },
        in: (c: string, v: unknown[]) => { q.inCol = c; q.in = v; return b; },
        order: (c: string) => { q.order.push(c); return b; },
        abortSignal: () => { q.signal = true; return b; },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          m.onQuery?.(q);
          if (m.hang === table) return new Promise(() => {}).then(resolve, reject);
          if (m.hangFirst === table && queries.filter((x) => x.table === table)[0] === q) return new Promise(() => {}).then(resolve, reject);
          if (m.fail === table) return Promise.resolve({ data: null, error: { message: "x" } }).then(resolve, reject);
          const cols = q.select.split(",").map((c) => c.trim()).map((c) => { const [name, cast] = c.split("::"); return { name: name!, cast: cast ?? null }; });
          const want = q.in === null ? null : new Set(q.in.map(String));
          const rows = (tables[table] ?? [])
            .filter((r) => Object.entries(q.eq).every(([k, v]) => String(r[k]) === String(v)))
            .filter((r) => want === null || want.has(String(r[q.inCol!])))
            .map((r) => Object.fromEntries(cols.map(({ name, cast }) => {
              const v = r[name] ?? null;
              return [name, cast === "text" && v !== null && m.noCast !== table ? String(v) : v];
            })));
          const first = queries.filter((x) => x.table === table)[0] === q;
          const held = m.holdFirst?.table === table && first ? m.holdFirst.until : Promise.resolve();
          return held.then(() => {
            m.onAnswer?.(q);
            return m.failFirst === table && first ? { data: null, error: { message: "x" } } : { data: rows, error: null };
          }).then(resolve, reject);
        },
      };
      return b;
    },
  };
  return { sb: sb as unknown as ServiceRoleClient, queries };
}

// ── the fake 7shifts ───────────────────────────────────────────────────────────────────────────

const respond = (r: StaffingResponse) => new Response(enc.encode(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
type Route = (url: URL) => Response | Promise<Response>;
interface Net { fetch: SevenShiftsFetch; urls: URL[]; auth: string[]; whoamiCalls: () => number; shiftCalls: () => number }
function fakeNet(shifts: StaffingResponse | Route | Array<StaffingResponse>, whoami: StaffingResponse | Route = VALID_WHOAMI): Net {
  const urls: URL[] = [];
  const auth: string[] = [];
  const queue = Array.isArray(shifts) ? [...shifts] : null;
  const f: SevenShiftsFetch = async (url, init) => {
    const u = new URL(url);
    urls.push(u);
    auth.push(String((init.headers as Record<string, string>).Authorization));
    if (u.pathname === "/v2/whoami") return typeof whoami === "function" ? whoami(u) : respond(whoami);
    if (/^\/v2\/company\/\d+\/shifts$/.test(u.pathname)) {
      if (queue) { const next = queue.length > 1 ? queue.shift()! : queue[0]!; return respond(next); }
      return typeof shifts === "function" ? (shifts as Route)(u) : respond(shifts as StaffingResponse);
    }
    throw new Error("unexpected url");
  };
  return {
    fetch: f, urls, auth,
    whoamiCalls: () => urls.filter((u) => u.pathname === "/v2/whoami").length,
    shiftCalls: () => urls.filter((u) => u.pathname.endsWith("/shifts")).length,
  };
}

const VALID_PAGE: StaffingResponse = { status: 200, body: validAnswerBody() };

function reader(net: Net, mirror: Mirror = {}, env: Record<string, string | undefined> = ENV) {
  const db = fakeDb(mirror);
  const counter = { requests: 0 };
  const r = createScheduleReader(db.sb, { env, fetch: net.fetch, counter });
  return { r, db, counter };
}

const notOk = (x: { kind: string }) => x.kind !== "ok";

// ── happy path ─────────────────────────────────────────────────────────────────────────────────

describe("happy path", () => {
  it("two shops of one company, the valid page → both rosters; preferred first name, else first name; no `users` read", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db } = reader(net);
    const a = await r.shopWindow(SHOP_A, D, D1);
    const b = await r.shopWindow(SHOP_B, D, D1);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("not ok");
    expect(a.value.days.map((d) => d.day)).toEqual([D, D1]);
    expect(a.value.days[0]!.people).toEqual([
      { userId: "11", firstName: "Person A", roleName: "Cook", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T22:00:00.000Z", extraShifts: 0 },
    ]);
    expect(a.value.days[1]!.people).toEqual([]);
    expect(a.value.days[1]!.openShifts).toBe(1);
    expect(b.value.days[0]!.people).toEqual([]);
    expect(b.value.days[1]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["12", "Person B", null]]);
    // A linked CO-OPS user's display name is never read: there is no read of `users` at all.
    expect(db.queries.some((q) => q.table === "users")).toBe(false);
    // Never `last_name`; never `sevenshifts_shifts` (the mirror cannot prove what is published now).
    expect(db.queries.every((q) => !q.select.includes("last_name"))).toBe(true);
    expect(db.queries.some((q) => q.table === "sevenshifts_shifts")).toBe(false);
    // Every mirror read carries the window's abort signal.
    expect(db.queries.every((q) => q.signal)).toBe(true);
    expect(JSON.stringify([a, b])).not.toContain("NEVER-SELECTED");
  });
});

describe("the request (§15.1.2)", () => {
  it("start[gte] / start[lte] are the two strings the check was given; limit=200; tz ranges; no draft/deleted/modified/cursor params", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    const shifts = net.urls.filter((u) => u.pathname.endsWith("/shifts"));
    expect(shifts).toHaveLength(1);
    const u = shifts[0]!;
    expect(u.pathname).toBe(`/v2/company/${COMPANY}/shifts`);
    const calls = vi.mocked(checkPublishedAnswer).mock.calls;
    expect(calls).toHaveLength(1);
    const req = calls[0]![1];
    expect(u.searchParams.get("start[gte]")).toBe(req.startGte);
    expect(u.searchParams.get("start[lte]")).toBe(req.startLte);
    expect(req).toEqual(CASE_REQUEST);
    expect(u.searchParams.get("limit")).toBe("200");
    expect(u.searchParams.get("consider_tz_in_ranges")).toBe("true");
    for (const k of ["include_draft", "include_deleted", "draft", "deleted", "modified_since", "cursor"]) expect(u.searchParams.has(k)).toBe(false);
    // The token went to the client and into the Authorization header, nowhere else.
    expect(net.auth.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
  });
});

// ── the whole case table, all four layers, through the reader for BOTH shops ──────────────────

describe("every case of STAFFING_CASES through the reader, both shops", () => {
  for (const c of STAFFING_CASES) {
    it(`${c.layer}: ${c.name} → ${c.expect}`, async () => {
      let shifts = c.shifts;
      // The table's oversized case is sized for a 64 KiB test ceiling; the reader's page ceiling is 2 MiB
      // (SCHEDULE_PAGE_MAX_BYTES), so the same case is re-padded past the reader's real ceiling.
      if (c.layer === "transport" && c.field === "bytes" && c.name.includes("byte ceiling")) {
        shifts = { status: 200, body: validAnswerBody({ rows: [shiftRow("A", { note_pad: str("x".repeat(SCHEDULE_PAGE_MAX_BYTES + 1)) }), shiftRow("B")] }) };
      }
      const net = fakeNet(shifts, c.whoami ?? VALID_WHOAMI);
      const { r } = reader(net);
      const a = await r.shopWindow(SHOP_A, D, D1);
      const b = await r.shopWindow(SHOP_B, D, D1);
      if (c.expect === "accepted") {
        expect(a.kind).toBe("ok");
        expect(b.kind).toBe("ok");
      } else {
        expect(notOk(a)).toBe(true);
        expect(notOk(b)).toBe(true);
      }
      // One whoami per run, at most one shift request, however many shops.
      expect(net.whoamiCalls()).toBe(1);
      if (c.layer === "identity" && c.expect === "refused") expect(net.shiftCalls()).toBe(0);
    }, 15_000);
  }
});

// ── S1 ─────────────────────────────────────────────────────────────────────────────────────────

describe("S1", () => {
  it("a first page whose cursor names a second page → not available, exactly ONE shift request", async () => {
    const net = fakeNet({ status: 200, body: validAnswerBody({ cursor: `{"next":"c2","prev":null}` }) });
    const { r } = reader(net);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "answer_refused" });
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "answer_refused" });
    expect(net.shiftCalls()).toBe(1);
    expect(net.urls.every((u) => !u.searchParams.has("cursor"))).toBe(true);
  });
});

// ── S7 / A2-3 identity ─────────────────────────────────────────────────────────────────────────

describe("S7 / A2-3: whoami names exactly the linked company", () => {
  const who = (users: string): StaffingResponse => ({ status: 200, body: `{"object":"whoami","data":{"users":${users}}}` });
  const cases: Array<[string, StaffingResponse]> = [
    ["zero companies", who("[]")],
    ["two companies", who(`[{"id":77,"company_id":9001},{"id":78,"company_id":9002}]`)],
    ["one company that is not the linked location's", who(`[{"id":77,"company_id":9002}]`)],
    ["a failing whoami (500)", { status: 500, body: `{"error":"x"}` }],
    ["A2-3: company_id written 9001.0", who(`[{"id":77,"company_id":9001.0}]`)],
    ["company_id written as a non-canonical string \"09001\"", who(`[{"id":77,"company_id":"09001"}]`)],
  ];
  for (const [name, w] of cases) {
    it(`${name} → company_unverified with ZERO shift requests`, async () => {
      const net = fakeNet(VALID_PAGE, w);
      const { r } = reader(net);
      expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "company_unverified" });
      expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "company_unverified" });
      expect(net.shiftCalls()).toBe(0);
    });
  }

  it("whoami is asked once per run however many windows and shops ask", async () => {
    const net = fakeNet((u) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : { status: 200, body: validAnswerBody({ rows: [] }) }));
    const { r } = reader(net);
    await Promise.all([r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1), r.shopWindow(SHOP_A, D1, D2), r.shopWindow(SHOP_B, D1, D2)]);
    expect(net.whoamiCalls()).toBe(1);
    expect(net.shiftCalls()).toBe(2);
  });

  it("a failed whoami is kept for the run: never asked again, by any shop or window", async () => {
    const net = fakeNet(VALID_PAGE, { status: 500, body: `{"error":"x"}` });
    const { r } = reader(net);
    for (const [s, f, t] of [[SHOP_A, D, D1], [SHOP_B, D, D1], [SHOP_A, D1, D2], [SHOP_B, D1, D2]] as const) {
      expect(await r.shopWindow(s, f, t)).toEqual({ kind: "unavailable", reason: "company_unverified" });
    }
    expect(net.whoamiCalls()).toBe(1);
    expect(net.shiftCalls()).toBe(0);
  });
});

// ── no request at all ──────────────────────────────────────────────────────────────────────────

describe("no request at all", () => {
  it("not ready: no token → seven_not_ready, no read, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db, counter } = reader(net, {}, { SEVENSHIFTS_SYNC: "1" });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "seven_not_ready" });
    expect(db.queries).toEqual([]);
    expect(net.urls).toEqual([]);
    expect(counter.requests).toBe(0);
  });
  it("not ready: the switch off → seven_not_ready, no read, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db, counter } = reader(net, {}, { SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "0" });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "seven_not_ready" });
    expect(db.queries).toEqual([]);
    expect(counter.requests).toBe(0);
  });
  it("a shop with no live link → shop_not_linked, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net);
    expect(await r.shopWindow(SHOP_C, D, D1)).toEqual({ kind: "unavailable", reason: "shop_not_linked" });
    expect(counter.requests).toBe(0);
  });
  it("an inactive link is not a link", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net, { links: [{ location_id: SHOP_A, sevenshifts_location_id: 501, active: false }] });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "shop_not_linked" });
    expect(counter.requests).toBe(0);
  });
  it("a link whose 7shifts location has no row → shop_not_linked, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net, { locations: [] });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "shop_not_linked" });
    expect(counter.requests).toBe(0);
  });
  it("a mirror read error → mirror_read_failed, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net, { fail: "sevenshifts_location_links" });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    expect(counter.requests).toBe(0);
  });
  it("a bad window → bad_window, no read, no request", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db, counter } = reader(net);
    expect(await r.shopWindow(SHOP_A, D1, D)).toEqual({ kind: "unavailable", reason: "bad_window" });
    expect(await r.shopWindow(SHOP_A, "2026-02-30", D)).toEqual({ kind: "unavailable", reason: "bad_window" });
    expect(db.queries).toEqual([]);
    expect(counter.requests).toBe(0);
  });
});

// ── S6 ─────────────────────────────────────────────────────────────────────────────────────────

describe("S6: bounds", () => {
  it("a whoami body over 64 KiB → not available, zero shift requests", async () => {
    const pad = "x".repeat(SCHEDULE_WHOAMI_MAX_BYTES + 1);
    const net = fakeNet(VALID_PAGE, { status: 200, body: `{"object":"whoami","pad":"${pad}","data":{"users":[{"id":77,"company_id":9001}]}}` });
    const { r } = reader(net);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "company_unverified" });
    expect(net.shiftCalls()).toBe(0);
  });

  const big = validAnswerBody({ rows: [shiftRow("A", { note_pad: str("x".repeat(SCHEDULE_PAGE_MAX_BYTES + 1)) }), shiftRow("B")] });
  const bigLen = String(enc.encode(big).byteLength);
  for (const [name, headers] of [["a truthful Content-Length", { "content-length": bigLen }], ["no Content-Length", {}], ["a false small Content-Length", { "content-length": "10" }]] as const) {
    it(`a shift page over 2 MiB with ${name} → not available`, async () => {
      const net = fakeNet({ status: 200, headers, body: big });
      const { r } = reader(net);
      expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "request_failed" });
      expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "request_failed" });
      expect(net.shiftCalls()).toBe(1);
    });
  }

  it("201 rows on a terminal page → not available", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => shiftRow("A", { id: String(10_000 + i) }));
    const net = fakeNet({ status: 200, body: validAnswerBody({ rows }) });
    const { r } = reader(net);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "answer_refused" });
  });

  it("a duplicate shift id → not available", async () => {
    const net = fakeNet({ status: 200, body: validAnswerBody({ rows: [shiftRow("A"), shiftRow("B", { id: "1001" })] }) });
    const { r } = reader(net);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "answer_refused" });
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "answer_refused" });
  });
});

// ── one logical read ───────────────────────────────────────────────────────────────────────────

describe("one logical read", () => {
  const second = (u: URL) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : { status: 200, body: validAnswerBody({ rows: [] }) });

  it("shop A and shop B each ask [D, D+1] twice → 2 HTTP requests (one whoami, one page)", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net);
    const all = await Promise.all([r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1), r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1)]);
    expect(all.every((x) => x.kind === "ok")).toBe(true);
    expect(counter.requests).toBe(2);
    expect(net.urls).toHaveLength(2);
  });

  it("with one 429 on the page → 3", async () => {
    const net = fakeNet([{ status: 429, headers: { "retry-after": "0" }, body: `{"error":"rate"}` }, VALID_PAGE]);
    const { r, counter } = reader(net);
    const all = await Promise.all([r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1), r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1)]);
    expect(all.every((x) => x.kind === "ok")).toBe(true);
    expect(counter.requests).toBe(3);
  });

  it("a second window [D+1, D+2] in the same run → +1 (no second whoami)", async () => {
    const net = fakeNet(second);
    const { r, counter } = reader(net);
    await Promise.all([r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1)]);
    expect(counter.requests).toBe(2);
    const w2 = await Promise.all([r.shopWindow(SHOP_A, D1, D2), r.shopWindow(SHOP_B, D1, D2)]);
    expect(w2.every((x) => x.kind === "ok")).toBe(true);
    expect(counter.requests).toBe(3);
    expect(net.whoamiCalls()).toBe(1);
  });
});

// ── batches ────────────────────────────────────────────────────────────────────────────────────

describe("batches", () => {
  it("150 distinct people on one page → the users read is two batches of at most 100, each ordered", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => shiftRow("A", { id: String(10_000 + i), user_id: String(100 + i) }));
    const users = Array.from({ length: 150 }, (_, i) => ({ id: 100 + i, company_id: COMPANY, first_name: `Person ${i}`, preferred_first_name: null }));
    const net = fakeNet({ status: 200, body: validAnswerBody({ rows }) });
    const { r, db } = reader(net, { users });
    const a = await r.shopWindow(SHOP_A, D, D1);
    expect(a.kind).toBe("ok");
    if (a.kind !== "ok") throw new Error("not ok");
    expect(a.value.days[0]!.people).toHaveLength(150);
    const reads = db.queries.filter((q) => q.table === "sevenshifts_users");
    expect(reads.map((q) => q.in?.length)).toEqual([100, 50]);
    expect(reads.every((q) => q.order.length === 1 && q.order[0] === "id" && q.select === SCHEDULE_USER_COLUMNS)).toBe(true);
    expect(reads.every((q) => (q.in?.length ?? 0) <= SCHEDULE_ID_BATCH)).toBe(true);
    const roles = db.queries.filter((q) => q.table === "sevenshifts_roles");
    expect(roles).toHaveLength(1);
    expect(roles[0]!.order).toEqual(["id"]);
  });

  it("a names read error → mirror_read_failed (never an unnamed roster); an id with no row is simply unnamed-by-absence", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net, { fail: "sevenshifts_users" });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    const net2 = fakeNet(VALID_PAGE);
    const { r: r2 } = reader(net2, { users: [], roles: [] });
    const a = await r2.shopWindow(SHOP_A, D, D1);
    expect(a.kind).toBe("ok");
    if (a.kind !== "ok") throw new Error("not ok");
    expect(a.value.days[0]!.people.map((p) => [p.firstName, p.roleName])).toEqual([[null, null]]);
  });
});

// ── deadline ───────────────────────────────────────────────────────────────────────────────────

describe("deadline (S10)", () => {
  it("a whoami that never answers → settles at 6 s as not available, with no shift request", async () => {
    vi.useFakeTimers();
    const net = fakeNet(VALID_PAGE, () => new Promise<Response>(() => {}));
    const { r } = reader(net);
    let settled: unknown = null;
    const p = r.shopWindow(SHOP_A, D, D1).then((x) => { settled = x; return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const out = await p;
    expect(out.kind).toBe("unavailable");
    expect(net.shiftCalls()).toBe(0);
  });

  it("a link lookup that never answers → settles at 6 s with ZERO HTTP requests", async () => {
    vi.useFakeTimers();
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net, { hang: "sevenshifts_location_links" });
    let settled: unknown = null;
    const p = r.shopWindow(SHOP_A, D, D1).then((x) => { settled = x; return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(counter.requests).toBe(0);
  });

  it("a page that never answers → settles at 6 s; a second window gets its own 6 s", async () => {
    vi.useFakeTimers();
    const net = fakeNet((u) => u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? new Promise<Response>(() => {}) : respond({ status: 200, body: validAnswerBody({ rows: [] }) }));
    const { r } = reader(net);
    const p = r.shopWindow(SHOP_A, D, D1);
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS);
    expect((await p).kind).toBe("unavailable");
    const q = r.shopWindow(SHOP_A, D1, D2);
    await vi.advanceTimersByTimeAsync(0);
    expect((await q).kind).toBe("ok");
  });

  it("a 429 whose Retry-After cannot fit the deadline → not available", async () => {
    const net = fakeNet({ status: 429, headers: { "retry-after": "10" }, body: `{"error":"rate"}` });
    const { r, counter } = reader(net);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "request_failed" });
    expect(counter.requests).toBe(2); // whoami + the one page; no retry was started
  });
});

// ── the token ──────────────────────────────────────────────────────────────────────────────────

describe("the token", () => {
  it("never appears in any console call, any returned fact, or any thrown error", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const results: unknown[] = [];
    const runs: Array<[StaffingResponse | Route, StaffingResponse | Route, Mirror]> = [
      [VALID_PAGE, VALID_WHOAMI, {}],
      [VALID_PAGE, { status: 500, body: `{"error":"${TOKEN}"}` }, {}],
      [{ status: 401, body: `{"error":"${TOKEN}"}` }, VALID_WHOAMI, {}],
      [{ status: 200, body: `{"data":[` }, VALID_WHOAMI, {}],
      [() => { throw new Error(TOKEN); }, VALID_WHOAMI, {}],
      [VALID_PAGE, VALID_WHOAMI, { fail: "sevenshifts_users" }],
    ];
    for (const [shifts, who, mirror] of runs) {
      const net = fakeNet(shifts, who);
      const { r } = reader(net, mirror);
      try {
        results.push(await r.shopWindow(SHOP_A, D, D1), await r.shopWindow(SHOP_B, D, D1));
      } catch (e) {
        results.push(String(e), (e as Error)?.stack);
      }
    }
    expect(JSON.stringify(results)).not.toContain(TOKEN);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
    // Logs are fixed codes only.
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((l) => /^\[digests\] schedule: [a-z_]+$/.test(l))).toBe(true);
  });
});

// ── publish → un-publish ───────────────────────────────────────────────────────────────────────

describe("publish → un-publish", () => {
  it("run 1 holds the shift → in the roster; run 2's answer no longer holds it → not in the roster", async () => {
    const r1 = reader(fakeNet(VALID_PAGE)).r;
    const a1 = await r1.shopWindow(SHOP_A, D, D1);
    if (a1.kind !== "ok") throw new Error("not ok");
    expect(a1.value.days[0]!.people.map((p) => p.userId)).toEqual(["11"]);
    const r2 = reader(fakeNet({ status: 200, body: validAnswerBody({ rows: [shiftRow("B"), shiftRow("OPEN")] }) })).r;
    const a2 = await r2.shopWindow(SHOP_A, D, D1);
    if (a2.kind !== "ok") throw new Error("not ok");
    expect(a2.value.days[0]!.people).toEqual([]);
    expect(a2.value.days[0]!.assignedShifts).toBe(0);
  });
});

// ── memo ───────────────────────────────────────────────────────────────────────────────────────

describe("memo", () => {
  it("the same shop + window asked twice returns the same promise and the same object", async () => {
    const { r } = reader(fakeNet(VALID_PAGE));
    const p1 = r.shopWindow(SHOP_A, D, D1);
    const p2 = r.shopWindow(SHOP_A, D, D1);
    expect(p1).toBe(p2);
    expect(await p1).toBe(await p2);
  });
});

// ── S10: one clock ─────────────────────────────────────────────────────────────────────────────

describe("S10: the limiter, deadlineAt and the race run on the run's clock", () => {
  it("the limiter is built with the injected clock (source pin), once per reader", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/report-digests-schedule.ts", "utf8");
    expect(src).toContain("createLimiter({ ...SEVENSHIFTS_LIMITS, now: clock })");
    expect(src.match(/createLimiter\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/from\("sevenshifts_shifts"\)/);
  });

  it("an injected clock that passes deadlineAt before the page → the page is never sent", async () => {
    let t = 5_000_000;
    let reads = 0;
    const clock = () => { reads += 1; return t; };
    const net = fakeNet(VALID_PAGE, () => { t += SCHEDULE_WINDOW_MS + 1; return respond(VALID_WHOAMI); });
    const db = fakeDb();
    const counter = { requests: 0 };
    const r = createScheduleReader(db.sb, { env: ENV, fetch: net.fetch, counter, clock });
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("unavailable");
    expect(net.shiftCalls()).toBe(0);
    expect(counter.requests).toBe(1);
    expect(reads).toBeGreaterThan(0);
  });
});

// ── F4: the deadline belongs to the WINDOW; the links are read once per run; settled work is reused at once ─────

describe("F4: one 6 s per window (plan §11.1.4), the links once per run, settled work reused with no I/O and no wait", () => {
  const second = (u: URL) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : { status: 200, body: validAnswerBody({ rows: [] }) });
  const tableReads = (db: ReturnType<typeof fakeDb>, t: string) => db.queries.filter((q) => q.table === t).length;

  it("F4: shop A asks [D, D+1] → ok; 30 s later shop B asks the same window → ok with its roster, ZERO new HTTP requests, ZERO new mirror reads", async () => {
    vi.useFakeTimers();
    const net = fakeNet(VALID_PAGE);
    const { r, db, counter } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    expect(counter.requests).toBe(2);
    const readsAfterA = db.queries.length;
    await vi.advanceTimersByTimeAsync(30_000);
    let bDone: unknown = null;
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(0); // no time passes: it is answered at once
    expect(bDone).not.toBeNull();
    const out = await b;
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("not ok");
    expect(out.value.days[1]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    expect(counter.requests).toBe(2);
    expect(net.urls).toHaveLength(2);
    // Links, locations, names and roles: nothing new was read for B.
    expect(db.queries.length).toBe(readsAfterA);
    expect(tableReads(db, "sevenshifts_location_links")).toBe(1);
  });

  it("F4: the links are read ONCE per run however many shops and windows ask (one links read, one locations read)", async () => {
    vi.useFakeTimers();
    const net = fakeNet(second);
    const { r, db } = reader(net);
    await Promise.all([r.shopWindow(SHOP_A, D, D1), r.shopWindow(SHOP_B, D, D1), r.shopWindow(SHOP_C, D, D1)]);
    await vi.advanceTimersByTimeAsync(30_000);
    const later = await Promise.all([r.shopWindow(SHOP_A, D1, D2), r.shopWindow(SHOP_B, D1, D2), r.shopWindow(SHOP_C, D1, D2)]);
    expect(later.map((x) => x.kind)).toEqual(["ok", "ok", "unavailable"]);
    expect(tableReads(db, "sevenshifts_location_links")).toBe(1);
    expect(tableReads(db, "sevenshifts_locations")).toBe(1);
    // The one links read names no shop: it reads every live link; the locations read asks for their ids as text.
    const linkQ = db.queries.find((q) => q.table === "sevenshifts_location_links")!;
    expect(linkQ.eq).toEqual({ active: true });
    const locQ = db.queries.find((q) => q.table === "sevenshifts_locations")!;
    expect(locQ.in).toEqual([SHOP_A_7S, SHOP_B_7S]);
  });

  it("F4: 30 s later a NEW window for shop A → ok: one new page request, no new whoami, no new links read, and its OWN 6 s", async () => {
    vi.useFakeTimers();
    // The second window's page answers 5 s after it is asked: only a fresh 6 s for that window can take it.
    const net = fakeNet((u) => u.searchParams.get("start[gte]") === CASE_REQUEST.startGte
      ? respond(VALID_PAGE)
      : new Promise<Response>((resolve) => setTimeout(() => resolve(respond({ status: 200, body: validAnswerBody({ rows: [] }) })), 5_000)));
    const { r, db, counter } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    await vi.advanceTimersByTimeAsync(30_000);
    const p = r.shopWindow(SHOP_A, D1, D2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).kind).toBe("ok");
    expect(counter.requests).toBe(3);
    expect(net.whoamiCalls()).toBe(1);
    expect(net.shiftCalls()).toBe(2);
    expect(tableReads(db, "sevenshifts_location_links")).toBe(1);
  });

  it("F4: shop B asks while A's page is in flight and the page answers at 2 s → both ok, one page request", async () => {
    vi.useFakeTimers();
    const net = fakeNet(() => new Promise<Response>((resolve) => setTimeout(() => resolve(respond(VALID_PAGE)), 2_000)));
    const { r, counter } = reader(net);
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.advanceTimersByTimeAsync(1_000);
    const b = r.shopWindow(SHOP_B, D, D1);
    await vi.advanceTimersByTimeAsync(1_000);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.kind).toBe("ok");
    expect(rb.kind).toBe("ok");
    expect(net.shiftCalls()).toBe(1);
    expect(counter.requests).toBe(2);
  });

  it("F4: the page never answers; B joins at 3 s → BOTH settle as not available at the WINDOW's 6 s, measured from A's first ask", async () => {
    vi.useFakeTimers();
    const net = fakeNet(() => new Promise<Response>(() => {}));
    const { r, counter } = reader(net);
    const t0 = Date.now();
    let aAt = -1;
    let bAt = -1;
    const a = r.shopWindow(SHOP_A, D, D1).then((x) => { aAt = Date.now(); return x; });
    await vi.advanceTimersByTimeAsync(3_000);
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bAt = Date.now(); return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 3_000 - 1);
    expect(aAt).toBe(-1);
    expect(bAt).toBe(-1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await a).kind).toBe("unavailable");
    expect((await b).kind).toBe("unavailable");
    expect(aAt - t0).toBe(SCHEDULE_WINDOW_MS);
    expect(bAt - t0).toBe(SCHEDULE_WINDOW_MS); // 3 s after B's own ask, not 6
    expect(net.shiftCalls()).toBe(1);
    expect(counter.requests).toBe(2);
  });

  it("F4: A's page runs out of the window's time → B afterwards gets the kept failure at once, no new request", async () => {
    vi.useFakeTimers();
    const net = fakeNet(() => new Promise<Response>(() => {}));
    const { r, counter } = reader(net);
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS);
    expect((await a).kind).toBe("unavailable");
    let bDone: { kind: string } | null = null;
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bDone).not.toBeNull();
    expect((await b).kind).toBe("unavailable");
    expect(counter.requests).toBe(2);
  });

  it("F4 / S10: a links read that never answers → the first ask settles at 6 s with ZERO HTTP requests; the same window again is not available AT ONCE; a NEW window reads the links again inside its own 6 s", async () => {
    vi.useFakeTimers();
    const net = fakeNet(second);
    const { r, db, counter } = reader(net, { hangFirst: "sevenshifts_location_links" });
    let aDone: unknown = null;
    const a = r.shopWindow(SHOP_A, D, D1).then((x) => { aDone = x; return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 1);
    expect(aDone).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await a).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(counter.requests).toBe(0);
    // The same window, another shop: no fresh time and nothing settled → not available at once, nothing read.
    const readsBefore = db.queries.length;
    let bDone: unknown = null;
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bDone).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(await b).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(db.queries.length).toBe(readsBefore);
    expect(counter.requests).toBe(0);
    // A NEW window: the timed-out links read was not kept, so it reads them again with its own 6 s.
    expect((await r.shopWindow(SHOP_A, D1, D2)).kind).toBe("ok");
    expect(tableReads(db, "sevenshifts_location_links")).toBe(2);
  });

  it("F4: one shop with TWO live links → that shop not available (mirror_read_failed), the other shop ok", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net, {
      links: [...DEFAULT_MIRROR.links, { location_id: SHOP_A, sevenshifts_location_id: "503", active: true }],
      locations: [...DEFAULT_MIRROR.locations, { id: "503", company_id: COMPANY }],
    });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    expect((await r.shopWindow(SHOP_B, D, D1)).kind).toBe("ok");
  });

  it("F4: a link whose 7shifts location id is not a canonical real id refuses THAT shop only", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net, { links: [{ location_id: SHOP_A, sevenshifts_location_id: "0501", active: true }, DEFAULT_MIRROR.links[1]!] });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    expect((await r.shopWindow(SHOP_B, D, D1)).kind).toBe("ok");
  });

  it("F4: the total time spent waiting across a serial run of two shops on one window never exceeds 6 s (fake clock)", async () => {
    vi.useFakeTimers();
    for (const net of [fakeNet(() => new Promise<Response>(() => {})), fakeNet(VALID_PAGE, () => new Promise<Response>(() => {}))]) {
      const { r } = reader(net);
      let waited = 0;
      for (const shop of [SHOP_A, SHOP_B]) {
        const t = Date.now();
        let done = false;
        const p = r.shopWindow(shop, D, D1).then((x) => { done = true; return x; });
        await vi.advanceTimersByTimeAsync(0);
        while (!done) await vi.advanceTimersByTimeAsync(100);
        expect((await p).kind).toBe("unavailable");
        waited += Date.now() - t;
        await vi.advanceTimersByTimeAsync(30_000); // the rest of shop A's facts, between the two asks
      }
      expect(waited).toBeLessThanOrEqual(SCHEDULE_WINDOW_MS);
    }
  });
});

// ── F3: a mirror user of ANOTHER company never supplies a printed name ─────────────────────────

describe("F3: the name lookup proves the mirror user's company", () => {
  it("F3: a published row whose user has a mirror row of ANOTHER company → not available for both shops (mirror_conflict); the name never appears", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db } = reader(net, {
      users: [{ id: 11, company_id: "9002", first_name: "Person X", preferred_first_name: "Person X", last_name: "NEVER-SELECTED" }, DEFAULT_MIRROR.users[1]!],
    });
    const a = await r.shopWindow(SHOP_A, D, D1);
    const b = await r.shopWindow(SHOP_B, D, D1);
    expect(a).toEqual({ kind: "unavailable", reason: "mirror_conflict" });
    expect(b).toEqual({ kind: "unavailable", reason: "mirror_conflict" });
    expect(JSON.stringify([a, b])).not.toContain("Person X");
    // The user read asked for the company and never for a last name.
    const q = db.queries.find((x) => x.table === "sevenshifts_users")!;
    expect(q.select).toContain("company_id");
    expect(q.select).not.toContain("last_name");
  });

  it("F3: a user id with NO mirror row → ok, no name on file (null first name)", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net, { users: [DEFAULT_MIRROR.users[1]!] });
    const a = await r.shopWindow(SHOP_A, D, D1);
    expect(a.kind).toBe("ok");
    if (a.kind !== "ok") throw new Error("not ok");
    expect(a.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["11", null]]);
    const b = await r.shopWindow(SHOP_B, D, D1);
    if (b.kind !== "ok") throw new Error("not ok");
    expect(b.value.days[1]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
  });

  it("F3: a user row with no provable company (null) → mirror_read_failed, no name", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r } = reader(net, { users: [{ id: 11, company_id: null, first_name: "Person X", preferred_first_name: null }] });
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
  });
});

// ── F5: mirror ids are text; a number is unverifiable ─────────────────────────────────────────

describe("F5: mirror bigints are selected as TEXT; a JS number for an id is refused", () => {
  const BIG_CO = "9007199254740993"; // above Number.MAX_SAFE_INTEGER; Number() would round it
  const BIG_CO_NEXT = "9007199254740994";
  const BIG_P1 = "9007199254740993";
  const BIG_P2 = "9007199254740994";
  const bigWhoami: StaffingResponse = { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":"${BIG_CO}"}]}}` };
  const bigPage: StaffingResponse = {
    status: 200,
    body: validAnswerBody({
      rows: [
        shiftRow("A", { company_id: str(BIG_CO), user_id: str(BIG_P1) }),
        shiftRow("A", { id: "1002", company_id: str(BIG_CO), user_id: str(BIG_P2), start: `"2026-03-01T15:00:00Z"` }),
      ],
    }),
  };
  const bigMirror: Mirror = {
    // Shop B's location belongs to the ADJACENT company: it must not pass for whoami's company.
    locations: [{ id: SHOP_A_7S, company_id: BIG_CO }, { id: SHOP_B_7S, company_id: BIG_CO_NEXT }],
    users: [
      { id: BIG_P1, company_id: BIG_CO, first_name: "Person A", preferred_first_name: null },
      { id: BIG_P2, company_id: BIG_CO, first_name: "Person B", preferred_first_name: null },
    ],
  };

  it("F5: ids above MAX_SAFE_INTEGER, two ADJACENT people and two ADJACENT companies → the right names, never collided", async () => {
    expect(Number(BIG_P1) > Number.MAX_SAFE_INTEGER).toBe(true);
    const net = fakeNet(bigPage, bigWhoami);
    const { r, db } = reader(net, bigMirror);
    const a = await r.shopWindow(SHOP_A, D, D1);
    expect(a.kind).toBe("ok");
    if (a.kind !== "ok") throw new Error(JSON.stringify(a));
    expect(a.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([[BIG_P1, "Person A"], [BIG_P2, "Person B"]]);
    expect(net.urls.find((u) => u.pathname.endsWith("/shifts"))!.pathname).toBe(`/v2/company/${BIG_CO}/shifts`);
    // Shop B's company is the adjacent id: not whoami's, so not verified.
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "company_unverified" });
    // Filters went out as canonical strings.
    expect(db.queries.find((q) => q.table === "sevenshifts_users")!.in).toEqual([BIG_P1, BIG_P2]);
  });

  for (const table of ["sevenshifts_location_links", "sevenshifts_locations", "sevenshifts_users", "sevenshifts_roles"]) {
    it(`F5: ${table} answers a JS NUMBER for an id (cast not honoured) → refused, never converted`, async () => {
      const net = fakeNet(VALID_PAGE);
      const { r } = reader(net, { noCast: table });
      expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    });
  }

  it("F5: every select list casts its ids to text", async () => {
    const net = fakeNet(VALID_PAGE);
    const { r, db } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    const sel = (t: string) => db.queries.find((q) => q.table === t)!.select;
    expect(sel("sevenshifts_location_links")).toBe("location_id, sevenshifts_location_id::text");
    expect(sel("sevenshifts_locations")).toBe("id::text, company_id::text");
    expect(sel("sevenshifts_users")).toBe("id::text, company_id::text, first_name, preferred_first_name");
    expect(sel("sevenshifts_roles")).toBe("id::text, name");
  });
});

// ── F7: names and roles memoized for the run ───────────────────────────────────────────────────

describe("F7: names and roles are memoized for the run by the ids asked (plan §2.2)", () => {
  it("F7: overlapping windows [D, D+1] then [D+1, D+2] with the same people and roles → the second asks ONLY for the new id", async () => {
    const pageW2: StaffingResponse = {
      status: 200,
      body: validAnswerBody({
        rows: [
          shiftRow("B"),
          shiftRow("A", { id: "1003", user_id: "13", start: `"2026-03-03T14:00:00Z"`, end: `"2026-03-03T22:00:00Z"` }),
        ],
      }),
    };
    const net = fakeNet((u) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : pageW2));
    const { r, db } = reader(net, { users: [...DEFAULT_MIRROR.users, { id: 13, company_id: COMPANY, first_name: "Person C", preferred_first_name: null }] });
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    const users = () => db.queries.filter((q) => q.table === "sevenshifts_users");
    const roles = () => db.queries.filter((q) => q.table === "sevenshifts_roles");
    expect(users()).toHaveLength(1);
    expect(roles()).toHaveLength(1);
    const w2 = await r.shopWindow(SHOP_A, D1, D2);
    if (w2.kind !== "ok") throw new Error(JSON.stringify(w2));
    expect(w2.value.days[1]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["13", "Person C", "Cook"]]);
    const b2 = await r.shopWindow(SHOP_B, D1, D2);
    if (b2.kind !== "ok") throw new Error(JSON.stringify(b2));
    expect(b2.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    // Window 2: one users query, for the new id only; no roles query (role 21 was resolved by window 1).
    expect(users()).toHaveLength(2);
    expect(users()[1]!.in).toEqual(["13"]);
    expect(roles()).toHaveLength(1);
  });

  it("F7: a failed lookup is not cached as a success: the next window asks for the same ids again", async () => {
    let failUsers = true;
    const net = fakeNet((u) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : { status: 200, body: validAnswerBody({ rows: [shiftRow("B")] }) }));
    const db = fakeDb();
    const sb = {
      from(t: string) {
        if (t === "sevenshifts_users" && failUsers) {
          failUsers = false;
          const b: Record<string, unknown> = {
            select: () => b, eq: () => b, in: () => b, order: () => b, abortSignal: () => b,
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "x" } }).then(res, rej),
          };
          return b;
        }
        return (db.sb as unknown as { from(t: string): unknown }).from(t);
      },
    } as unknown as ServiceRoleClient;
    const r = createScheduleReader(sb, { env: ENV, fetch: net.fetch });
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    const w2 = await r.shopWindow(SHOP_B, D1, D2);
    if (w2.kind !== "ok") throw new Error(JSON.stringify(w2));
    expect(w2.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    expect(db.queries.filter((q) => q.table === "sevenshifts_users").map((q) => q.in)).toEqual([["12"]]);
  });
});

// ── fix round 2 (CC addendum 2026-11-28) ───────────────────────────────────────────────────────

/** Window 2 = [D+1, D+2]: Person B at Shop B on D+1 (user 12, no role), a third person at Shop A on D+2 (user 13, role 21). */
const PAGE_W2: StaffingResponse = {
  status: 200,
  body: validAnswerBody({
    rows: [
      shiftRow("B"),
      shiftRow("A", { id: "1003", user_id: "13", start: `"2026-03-03T14:00:00Z"`, end: `"2026-03-03T22:00:00Z"` }),
    ],
  }),
};
const USERS_3: Row[] = [...DEFAULT_MIRROR.users, { id: 13, company_id: COMPANY, first_name: "Person C", preferred_first_name: null }];
const byWindow = (u: URL) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : PAGE_W2);
const reads = (db: ReturnType<typeof fakeDb>, t: string) => db.queries.filter((q) => q.table === t);
/** Lets every pending promise reaction run (real timers). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("fix round 2, F4: the clock is read when the work resolves; a late answer is discarded, never reused", () => {
  /** A reader on a clock only the test moves. The timers are real and never get the chance to fire: only the clock check can refuse. */
  function clocked(lateTable: string, lateBy: number) {
    let t = 5_000_000;
    let armed = true;
    const net = fakeNet(byWindow);
    const db = fakeDb({ users: USERS_3, onAnswer: (q) => { if (armed && q.table === lateTable) { armed = false; t += lateBy; } } });
    const counter = { requests: 0 };
    const r = createScheduleReader(db.sb, { env: ENV, fetch: net.fetch, counter, clock: () => t });
    return { r, db, net, counter };
  }

  it("F4 r2: the clock passes 6 s during the LAST role lookup, the timer not yet fired → not available for BOTH shops; the late roster is never reused", async () => {
    const { r, db, counter } = clocked("sevenshifts_roles", SCHEDULE_WINDOW_MS + 100);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    const readsAfterA = db.queries.length;
    // Shop B asks the same, now expired, window: nothing settled in time, nothing new is read.
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(db.queries.length).toBe(readsAfterA);
    expect(counter.requests).toBe(2);
    // The late role answer was not kept either: a NEW window (its own 6 s) asks for role 21 again.
    const w2 = await r.shopWindow(SHOP_A, D1, D2);
    if (w2.kind !== "ok") throw new Error(JSON.stringify(w2));
    expect(w2.value.days[1]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["13", "Person C", "Cook"]]);
    expect(reads(db, "sevenshifts_roles").map((q) => q.in)).toEqual([["21"], ["21"]]);
    // The names of window 1 were proved in time and are kept: window 2 asks only for the new person.
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"]]);
  });

  it("F4 r2: the boundary. An answer AT the deadline (6,000 ms) is late; one millisecond before it is in time", async () => {
    const at = clocked("sevenshifts_roles", SCHEDULE_WINDOW_MS);
    expect(await at.r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(await at.r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    const before = clocked("sevenshifts_roles", SCHEDULE_WINDOW_MS - 1);
    expect((await before.r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    // The window's time is now nearly spent, yet what settled in time is still served to the other shop.
    expect((await before.r.shopWindow(SHOP_B, D, D1)).kind).toBe("ok");
  });

  it("F4 r2: a name lookup answered after the deadline is not kept either", async () => {
    const { r, db } = clocked("sevenshifts_users", SCHEDULE_WINDOW_MS + 1);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(reads(db, "sevenshifts_roles")).toHaveLength(0);
    const w2 = await r.shopWindow(SHOP_B, D1, D2);
    if (w2.kind !== "ok") throw new Error(JSON.stringify(w2));
    expect(w2.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    // Person B's id was in the late batch: it is asked again.
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["12", "13"]]);
  });

  it("F4 r2: a links read answered after the deadline is discarded: no request is sent on it, and a NEW window reads the links again", async () => {
    const { r, db, net, counter } = clocked("sevenshifts_locations", SCHEDULE_WINDOW_MS + 100);
    expect(await r.shopWindow(SHOP_A, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(counter.requests).toBe(0);
    expect(await r.shopWindow(SHOP_B, D, D1)).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(counter.requests).toBe(0);
    expect((await r.shopWindow(SHOP_A, D1, D2)).kind).toBe("ok");
    expect(reads(db, "sevenshifts_location_links")).toHaveLength(2);
    expect(net.whoamiCalls()).toBe(1);
  });
});

describe("fix round 2, F7: the memo holds the IN-FLIGHT lookup, so two windows asking at once share one lookup per id", () => {
  function gate() {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => { release = resolve; });
    return { until, release };
  }

  it("F7 r2: the first users read is held open and an overlapping window asks → the shared id is NOT asked twice; the second window asks only for its new id", async () => {
    const g = gate();
    const { r, db } = reader(fakeNet(byWindow), { users: USERS_3, holdFirst: { table: "sevenshifts_users", until: g.until } });
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.waitFor(() => expect(reads(db, "sevenshifts_users")).toHaveLength(1));
    const b = r.shopWindow(SHOP_A, D1, D2);
    // Window 2's page is in and its names are asked while window 1's read of [11, 12] is still open.
    await vi.waitFor(() => expect(reads(db, "sevenshifts_users")).toHaveLength(2));
    await settle();
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"]]);
    g.release();
    const [ra, rb] = await Promise.all([a, b]);
    if (ra.kind !== "ok" || rb.kind !== "ok") throw new Error(JSON.stringify([ra, rb]));
    expect(ra.value.days[0]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["11", "Person A", "Cook"]]);
    expect(rb.value.days[1]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["13", "Person C", "Cook"]]);
    const b2 = await r.shopWindow(SHOP_B, D1, D2);
    if (b2.kind !== "ok") throw new Error(JSON.stringify(b2));
    expect(b2.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    // One lookup per id for the whole run: 11 and 12 once, 13 once, role 21 once.
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"]]);
    expect(reads(db, "sevenshifts_roles").map((q) => q.in)).toEqual([["21"]]);
  });

  it("F7 r2: the same for roles. The first roles read is held open; an overlapping window with the same role sends no second roles read", async () => {
    const g = gate();
    const { r, db } = reader(fakeNet(byWindow), { users: USERS_3, holdFirst: { table: "sevenshifts_roles", until: g.until } });
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.waitFor(() => expect(reads(db, "sevenshifts_roles")).toHaveLength(1));
    const b = r.shopWindow(SHOP_A, D1, D2);
    // Window 2 reads its one new name, then reaches its role step while window 1's read of role 21 is still open.
    await vi.waitFor(() => expect(reads(db, "sevenshifts_users")).toHaveLength(2));
    await settle();
    expect(reads(db, "sevenshifts_roles")).toHaveLength(1);
    g.release();
    const [ra, rb] = await Promise.all([a, b]);
    if (ra.kind !== "ok" || rb.kind !== "ok") throw new Error(JSON.stringify([ra, rb]));
    expect(rb.value.days[1]!.people.map((p) => [p.userId, p.roleName])).toEqual([["13", "Cook"]]);
    expect(reads(db, "sevenshifts_roles").map((q) => q.in)).toEqual([["21"]]);
  });

  it("F7 r2: a shared lookup that FAILS fails everyone who joined it, and its ids are dropped: a later window asks for them again", async () => {
    const g = gate();
    const D3 = "2026-03-04";
    const pageW3: StaffingResponse = {
      status: 200,
      body: validAnswerBody({ rows: [shiftRow("B", { id: `"2002"`, start: `"2026-03-03T15:00:00-05:00"`, end: `"2026-03-03T23:30:00-05:00"` })] }),
    };
    const net = fakeNet((u) => {
      const gte = u.searchParams.get("start[gte]");
      return respond(gte === CASE_REQUEST.startGte ? VALID_PAGE : gte === "2026-03-02T05:00:00Z" ? PAGE_W2 : pageW3);
    });
    const { r, db } = reader(net, { users: USERS_3, holdFirst: { table: "sevenshifts_users", until: g.until }, failFirst: "sevenshifts_users" });
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.waitFor(() => expect(reads(db, "sevenshifts_users")).toHaveLength(1));
    const b = r.shopWindow(SHOP_B, D1, D2);
    await vi.waitFor(() => expect(reads(db, "sevenshifts_users")).toHaveLength(2));
    await settle();
    g.release();
    // Window 1 started the read of [11, 12]; window 2 joined it for 12. It answered an error: both are refused.
    expect(await a).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    expect(await b).toEqual({ kind: "unavailable", reason: "mirror_read_failed" });
    // A later window needs 12 again: the failed batch was not kept, so it is read again (13 was proved and is kept).
    const c = await r.shopWindow(SHOP_B, D2, D3);
    if (c.kind !== "ok") throw new Error(JSON.stringify(c));
    expect(c.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"], ["12"]]);
  });

  it("F7 r2: a lookup another window started that runs out of THAT window's time is asked again inside the joiner's own 6 s", async () => {
    vi.useFakeTimers();
    const { r, db } = reader(fakeNet(byWindow), { users: USERS_3, hangFirst: "sevenshifts_users" });
    const a = r.shopWindow(SHOP_A, D, D1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"]]);
    let bDone: { kind: string } | null = null;
    const b = r.shopWindow(SHOP_B, D1, D2).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 3_000 - 1);
    // Window 2 asked only for 13 and is waiting on window 1's read for 12.
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"]]);
    expect(bDone).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await a).toEqual({ kind: "unavailable", reason: "deadline" });
    const out = await b;
    if (out.kind !== "ok") throw new Error(JSON.stringify(out));
    expect(out.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    expect(reads(db, "sevenshifts_users").map((q) => q.in)).toEqual([["11", "12"], ["13"], ["12"]]);
  });
});
