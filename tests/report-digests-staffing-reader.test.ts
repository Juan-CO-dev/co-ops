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
interface Query { table: string; select: string; eq: Record<string, unknown>; in: unknown[] | null; order: string[]; signal: boolean }
interface Mirror {
  links?: Row[]; locations?: Row[]; users?: Row[]; roles?: Row[];
  /** A table whose read never answers. */
  hang?: string;
  /** A table whose read answers an error. */
  fail?: string;
  /** A shop whose link lookup never answers. */
  hangLinkOf?: string;
}
const DEFAULT_MIRROR: Required<Pick<Mirror, "links" | "locations" | "users" | "roles">> = {
  links: [{ location_id: SHOP_A, sevenshifts_location_id: Number(SHOP_A_7S), active: true },
          { location_id: SHOP_B, sevenshifts_location_id: SHOP_B_7S, active: true }],
  // The bigint comes back as a number here and as a string there.
  locations: [{ id: Number(SHOP_A_7S), company_id: Number(COMPANY) }, { id: SHOP_B_7S, company_id: COMPANY }],
  users: [{ id: 11, first_name: "Alpha", preferred_first_name: "Person A", last_name: "NEVER-SELECTED" },
          { id: "12", first_name: "Person B", preferred_first_name: null, last_name: "NEVER-SELECTED" }],
  roles: [{ id: 21, name: "Cook" }],
};

function fakeDb(m: Mirror = {}) {
  const data = { ...DEFAULT_MIRROR, ...m };
  const queries: Query[] = [];
  const sb = {
    from(table: string) {
      const q: Query = { table, select: "", eq: {}, in: null, order: [], signal: false };
      queries.push(q);
      const b: Record<string, unknown> = {
        select: (c: string) => { q.select = c; return b; },
        eq: (c: string, v: unknown) => { q.eq[c] = v; return b; },
        in: (c: string, v: unknown[]) => { q.in = v; return b; },
        order: (c: string) => { q.order.push(c); return b; },
        abortSignal: () => { q.signal = true; return b; },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          if (m.hang === table) return new Promise(() => {}).then(resolve, reject);
          if (table === "sevenshifts_location_links" && m.hangLinkOf !== undefined && q.eq.location_id === m.hangLinkOf) return new Promise(() => {}).then(resolve, reject);
          if (m.fail === table) return Promise.resolve({ data: null, error: { message: "x" } }).then(resolve, reject);
          let rows: Row[] = [];
          if (table === "sevenshifts_location_links") rows = data.links.filter((r) => r.location_id === q.eq.location_id && r.active === q.eq.active);
          else if (table === "sevenshifts_locations") rows = data.locations.filter((r) => String(r.id) === String(q.eq.id));
          else if (table === "sevenshifts_users" || table === "sevenshifts_roles") {
            const src = table === "sevenshifts_users" ? data.users : data.roles;
            const want = new Set((q.in ?? []).map(String));
            // Only the selected columns come back, as PostgREST would answer.
            const cols = q.select.split(",").map((c) => c.trim());
            rows = src.filter((r) => want.has(String(r.id))).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
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
    const users = Array.from({ length: 150 }, (_, i) => ({ id: 100 + i, first_name: `Person ${i}`, preferred_first_name: null }));
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

// ── each ask has its own 6 s (lead review: the deadline belongs to the ASK, not to the window key) ─────────

describe("each ask (a shop and a window) has its own 6 s; the page and whoami are fetched once, under their starter", () => {
  const second = (u: URL) => respond(u.searchParams.get("start[gte]") === CASE_REQUEST.startGte ? VALID_PAGE : { status: 200, body: validAnswerBody({ rows: [] }) });
  const linkReadsOf = (db: ReturnType<typeof fakeDb>, shop: string) => db.queries.filter((q) => q.table === "sevenshifts_location_links" && q.eq.location_id === shop).length;

  it("shop B asks the same window 30 s after shop A finished → ok, ZERO new HTTP requests, its own link reads ran", async () => {
    vi.useFakeTimers();
    const net = fakeNet(VALID_PAGE);
    const { r, db, counter } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    expect(counter.requests).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    const b = await r.shopWindow(SHOP_B, D, D1);
    expect(b.kind).toBe("ok");
    if (b.kind !== "ok") throw new Error("not ok");
    expect(b.value.days[1]!.people.map((p) => [p.userId, p.firstName])).toEqual([["12", "Person B"]]);
    expect(counter.requests).toBe(2);
    expect(net.urls).toHaveLength(2);
    expect(linkReadsOf(db, SHOP_B)).toBe(1);
    expect(db.queries.filter((q) => q.table === "sevenshifts_locations" && String(q.eq.id) === SHOP_B_7S)).toHaveLength(1);
  });

  it("30 s later, a NEW window [D+1, D+2] for shop A → ok, one new page request, no new whoami", async () => {
    vi.useFakeTimers();
    const net = fakeNet(second);
    const { r, counter } = reader(net);
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await r.shopWindow(SHOP_A, D1, D2)).kind).toBe("ok");
    expect(counter.requests).toBe(3);
    expect(net.whoamiCalls()).toBe(1);
    expect(net.shiftCalls()).toBe(2);
  });

  it("A's ask hits its deadline while the page is in flight → A not available at 6 s; B afterwards gets the kept failure at once, no new request", async () => {
    vi.useFakeTimers();
    const net = fakeNet(() => new Promise<Response>(() => {}));
    const { r, counter } = reader(net);
    let aDone: unknown = null;
    const a = r.shopWindow(SHOP_A, D, D1).then((x) => { aDone = x; return x; });
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 1);
    expect(aDone).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect((await a).kind).toBe("unavailable");
    expect(counter.requests).toBe(2);
    let bDone: { kind: string } | null = null;
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(0); // no time passes: the kept failure answers at once
    expect(bDone).not.toBeNull();
    expect((await b).kind).toBe("unavailable");
    expect(counter.requests).toBe(2);
    expect(net.shiftCalls()).toBe(1);
  });

  it("B asks while A's page is in flight and the page answers at 2 s → both ok, one page request", async () => {
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

  it("B's link lookup never answers, asked 30 s after A finished → B settles 6 s after B's OWN start, zero new HTTP requests", async () => {
    vi.useFakeTimers();
    const net = fakeNet(VALID_PAGE);
    const { r, counter } = reader(net, { hangLinkOf: SHOP_B });
    expect((await r.shopWindow(SHOP_A, D, D1)).kind).toBe("ok");
    await vi.advanceTimersByTimeAsync(30_000);
    let bDone: unknown = null;
    const b = r.shopWindow(SHOP_B, D, D1).then((x) => { bDone = x; return x; });
    await vi.advanceTimersByTimeAsync(0);
    expect(bDone).toBeNull(); // not immediately
    await vi.advanceTimersByTimeAsync(SCHEDULE_WINDOW_MS - 1);
    expect(bDone).toBeNull();
    await vi.advanceTimersByTimeAsync(1); // and not never
    expect(await b).toEqual({ kind: "unavailable", reason: "deadline" });
    expect(counter.requests).toBe(2);
  });
});
