/**
 * Digest PR 2, packet A — the 7shifts client's one-page bounded read (plan §11.1.1, §13.1.2 = S6,
 * addendum A2-3). The real client, an injected fetch, a fake clock, no network, synthetic ids only.
 * Bodies are LITERAL BYTES (never objects through JSON.stringify), because A2-3 is about the written form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSevenShiftsClient, parseJsonWithIdSource, SevenShiftsApiError, SOURCE_CHECKED_ID_KEYS,
  type SevenShiftsFetch,
} from "@/lib/sevenshifts/client";
import { createLimiter } from "@/lib/sevenshifts/rate-limit-shared";
import { PUBLISHED_SHIFTS_ENDPOINT, windowInstants, type PublishedShiftsQuery, type SyncWindow } from "@/lib/sevenshifts/endpoints-shared";
import { whoamiSnapshot } from "@/lib/sevenshifts/paginate-shared";
import { normalizeDepartments } from "@/lib/sevenshifts/normalize-shared";

const TOKEN = "PLANTED-TOKEN-one-page-0123456789";
const WINDOW: SyncWindow = { modifiedSince: null, from: "2026-11-27", to: "2026-11-27" };
const { gte, lte } = windowInstants(WINDOW);
const Q: PublishedShiftsQuery = { companyId: "1234", startGte: gte, startLte: lte };
const enc = new TextEncoder();

interface Call { url: string; init: RequestInit }
function harness(
  responses: Array<(call: Call) => Response | Promise<Response>>,
  opts: { signal?: AbortSignal; deadlineInMs?: number; maxResponseBytes?: number } = {},
) {
  let clock = 1_000_000;
  const calls: Call[] = [];
  const fetchImpl: SevenShiftsFetch = async (url, init) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next(call);
  };
  const limiter = createLimiter({ perSecond: 8, perMinute: 500, now: () => clock });
  const counter = { requests: 0 };
  const client = createSevenShiftsClient({
    token: TOKEN, fetch: fetchImpl, limiter, counter,
    sleep: async (ms) => { clock += ms; },
    signal: opts.signal ?? new AbortController().signal,
    now: () => clock,
    deadlineAt: opts.deadlineInMs === undefined ? undefined : clock + opts.deadlineInMs,
    maxResponseBytes: opts.maxResponseBytes,
  });
  return { client, calls, counter };
}

/** A literal body as one chunk (a plain Response; undici gives it a byte stream). */
const raw = (text: string | Uint8Array, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(typeof text === "string" ? enc.encode(text) : new Uint8Array(text), { status, headers: { "content-type": "application/json", ...headers } });

/** A body served in fixed chunks, pulled only on demand; records what was pulled and whether it was cancelled. */
function chunked(bytes: Uint8Array, chunkSize: number, headers: Record<string, string> = {}, onPull?: (n: number) => void) {
  const state = { pulledBytes: 0, pulls: 0, cancelled: false };
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) { c.close(); return; }
      const piece = bytes.slice(at, at + chunkSize);
      at += piece.length;
      state.pulledBytes += piece.length;
      state.pulls += 1;
      c.enqueue(piece);
      onPull?.(state.pulls);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  const respond = () => new Response(stream, { status: 200, headers: { "content-type": "application/json", ...headers } });
  return { state, respond };
}

/** A JSON body of exactly `n` bytes: `{"data":[],"pad":"xxx…"}`. */
function bodyOfLength(n: number): Uint8Array {
  const head = '{"data":[],"pad":"';
  const tail = '"}';
  return enc.encode(head + "x".repeat(n - head.length - tail.length) + tail);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("PUBLISHED_SHIFTS_ENDPOINT + getOnePage — the request", () => {
  it("sends limit, both instants exactly as passed, consider_tz_in_ranges=true, and nothing else", async () => {
    const h = harness([raw('{"data":[],"meta":{"cursor":{"next":null,"prev":null}}}')], { maxResponseBytes: 65_536 });
    await h.client.getOnePage(Q, { maxBytes: 2 * 1024 * 1024 });
    expect(h.calls).toHaveLength(1);
    expect(h.counter.requests).toBe(1);
    const url = new URL(h.calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.7shifts.com/v2/company/1234/shifts");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("start[gte]")).toBe(gte);
    expect(url.searchParams.get("start[lte]")).toBe(lte);
    expect(url.searchParams.get("consider_tz_in_ranges")).toBe("true");
    for (const k of ["include_draft", "include_deleted", "draft", "deleted", "modified_since", "cursor"]) {
      expect(url.searchParams.has(k)).toBe(false);
    }
    expect([...url.searchParams.keys()].sort()).toEqual(["consider_tz_in_ranges", "limit", "start[gte]", "start[lte]"]);
    expect(h.calls[0]!.init.method).toBe("GET");
  });

  it("a page whose meta.cursor.next names a second page still causes NO second request, and the JSON is returned as it arrived", async () => {
    const h = harness([raw('{"object":"shifts","data":[{"id":7,"hours":7.50}],"meta":{"cursor":{"next":"PAGE2","prev":null}}}')], { maxResponseBytes: 65_536 });
    const out = await h.client.getOnePage(Q);
    expect(out).toEqual({ object: "shifts", data: [{ id: "7", hours: 7.5 }], meta: { cursor: { next: "PAGE2", prev: null } } });
    expect(h.counter.requests).toBe(1);
    expect(h.calls).toHaveLength(1);
  });

  it("validates the id and both instants before any request", async () => {
    const h = harness([], { maxResponseBytes: 65_536 });
    await expect(h.client.getOnePage({ ...Q, companyId: "12/x" })).rejects.toThrow("bad_id");
    await expect(h.client.getOnePage({ ...Q, startGte: "2026-11-27" })).rejects.toThrow("bad_window");
    await expect(h.client.getOnePage({ ...Q, startLte: "yesterday" })).rejects.toThrow("bad_window");
    expect(() => PUBLISHED_SHIFTS_ENDPOINT.path("1234567890123456789")).toThrow("bad_id");
    expect(h.calls).toHaveLength(0);
  });

  it("is only ever a bounded read: no ceiling on the client or the call → bad_payload, nothing sent", async () => {
    const h = harness([raw('{"data":[]}')]);
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    expect(h.counter.requests).toBe(0);
    // An unusable ceiling is refused too, never read as "no ceiling".
    await expect(h.client.getOnePage(Q, { maxBytes: 0 })).rejects.toMatchObject({ code: "bad_payload" });
    await expect(h.client.getOnePage(Q, { maxBytes: Number.NaN })).rejects.toMatchObject({ code: "bad_payload" });
    expect(h.counter.requests).toBe(0);
  });

  it("opts.maxBytes overrides the client's maxResponseBytes for that one request", async () => {
    const body = bodyOfLength(100);
    const h = harness([raw(body), raw(body)], { maxResponseBytes: 50 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    await expect(h.client.getOnePage(Q, { maxBytes: 100 })).resolves.toMatchObject({ data: [] });
  });
});

describe("S6 — the byte ceiling", () => {
  const MAX = 1_000;

  it("(i) one byte over with a TRUTHFUL Content-Length → bad_payload, the body cancelled unread", async () => {
    const c = chunked(bodyOfLength(MAX + 1), 100, { "content-length": String(MAX + 1) });
    const h = harness([c.respond], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    expect(c.state.pulledBytes).toBe(0);
    expect(c.state.cancelled).toBe(true);
  });

  it("(ii) one byte over with NO Content-Length → bad_payload; the stream is cancelled and never read whole", async () => {
    const body = bodyOfLength(MAX + 1 + 5_000); // the ceiling is passed early; the rest must never be pulled
    const c = chunked(body, 100);
    const h = harness([c.respond], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    expect(c.state.cancelled).toBe(true);
    expect(c.state.pulledBytes).toBeLessThanOrEqual(MAX + 100);
    expect(c.state.pulledBytes).toBeLessThan(body.length);
  });

  it("(ii') exactly one byte over, no Content-Length → bad_payload", async () => {
    const c = chunked(bodyOfLength(MAX + 1), 100);
    const h = harness([c.respond], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    expect(c.state.cancelled).toBe(true);
  });

  it("(iii) over the ceiling with a FALSE small Content-Length → bad_payload; cancelled, never read whole", async () => {
    const body = bodyOfLength(MAX + 1 + 5_000);
    const c = chunked(body, 100, { "content-length": "10" });
    const h = harness([c.respond], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    expect(c.state.cancelled).toBe(true);
    expect(c.state.pulledBytes).toBeLessThanOrEqual(MAX + 100);
    expect(c.state.pulledBytes).toBeLessThan(body.length);
  });

  it("a body EXACTLY at the ceiling parses (streamed and as one chunk)", async () => {
    const c = chunked(bodyOfLength(MAX), 100);
    const h = harness([c.respond, raw(bodyOfLength(MAX), 200, { "content-length": String(MAX) })], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).resolves.toMatchObject({ data: [] });
    expect(c.state.pulledBytes).toBe(MAX);
    await expect(h.client.getOnePage(Q)).resolves.toMatchObject({ data: [] });
  });

  it("a whoami body over its ceiling surfaces as a SevenShiftsApiError (bad_payload)", async () => {
    const big = `{"object":"whoami","data":{"users":[${Array.from({ length: 200 }, () => '{"company_id":1234}').join(",")}]}}`;
    const h = harness([raw(big)], { maxResponseBytes: 256 });
    const err = await h.client.get("whoami", { companyId: null, window: WINDOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SevenShiftsApiError);
    expect((err as SevenShiftsApiError).code).toBe("bad_payload");
  });

  it("get('whoami') on a bounded client goes through the bounded read and still answers", async () => {
    const h = harness([raw('{"object":"whoami","data":{"users":[{"company_id":1234}]}}')], { maxResponseBytes: 65_536 });
    expect(await h.client.get("whoami", { companyId: null, window: WINDOW })).toEqual({ kind: "snapshot", value: { companyIds: ["1234"] } });
  });

  it("no body stream → bad_payload", async () => {
    const h = harness([() => new Response(null, { status: 200 })], { maxResponseBytes: MAX });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("a client with NO ceiling still parses a large body through res.json(), as today", async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => `{"id":${i + 1},"name":"Role ${i}"}`).join(",");
    const text = `{"data":[${rows}],"meta":{"cursor":{"next":null,"prev":null}}}`;
    expect(text.length).toBeGreaterThan(2 * 1024 * 1024 / 4);
    let jsonCalls = 0;
    const h = harness([() => {
      const r = new Response(enc.encode(text), { status: 200 });
      const orig = r.json.bind(r);
      r.json = () => { jsonCalls += 1; return orig(); };
      return r;
    }]);
    const out = await h.client.get("roles", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ kind: "list", complete: true });
    expect(out.kind === "list" ? out.rows.length : 0).toBe(30_000);
    expect(jsonCalls).toBe(1);
    // The unbounded path keeps JSON.parse's numbers: an id is a number, not a source-checked string.
    expect(out.kind === "list" ? out.rows[0] : null).toEqual({ id: 1, name: "Role 0" });
  });
});

describe("S6 — deadline, encoding and syntax", () => {
  it("an aborted signal between chunks → deadline (the stream is cancelled)", async () => {
    const ac = new AbortController();
    const c = chunked(bodyOfLength(500), 100, {}, (n) => { if (n === 1) ac.abort(); });
    const h = harness([c.respond], { signal: ac.signal, maxResponseBytes: 1_000 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "deadline" });
    expect(c.state.cancelled).toBe(true);
    expect(c.state.pulledBytes).toBeLessThan(500);
  });

  it("invalid UTF-8 → bad_payload", async () => {
    const bytes = new Uint8Array([...enc.encode('{"data":["'), 0xff, 0xfe, ...enc.encode('"]}')]);
    const h = harness([raw(bytes)], { maxResponseBytes: 1_000 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("a truncated multi-byte character → bad_payload (strict decode, no replacement character)", async () => {
    const bytes = new Uint8Array([...enc.encode('{"data":["'), 0xc3]);
    const h = harness([raw(bytes)], { maxResponseBytes: 1_000 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("invalid JSON → bad_payload", async () => {
    const h = harness([raw("<html>oops</html>"), raw('{"data":[')], { maxResponseBytes: 1_000 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "bad_payload" });
  });
});

describe("A2-3 — ids are parsed from their SOURCE TEXT (literal bytes)", () => {
  const parse = (text: string) => parseJsonWithIdSource(text) as Record<string, unknown>;

  it("the id keys are exactly the five the digest consumes", () => {
    expect([...SOURCE_CHECKED_ID_KEYS]).toEqual(["id", "location_id", "company_id", "user_id", "role_id"]);
  });

  it('this runtime gives the reviver `context.source` (Node 22; A2-3 depends on it)', () => {
    let seen: unknown = "unset";
    JSON.parse("[1.50]", function (this: unknown, ...args: unknown[]) {
      const ctx = args[2] as { source?: unknown } | undefined;
      if (typeof args[1] === "number") seen = ctx?.source;
      return args[1];
    } as (this: unknown, key: string, value: unknown) => unknown);
    expect(seen).toBe("1.50");
    expect(Number(process.versions.node.split(".")[0])).toBeGreaterThanOrEqual(22);
  });

  it('"user_id":42.0000000000000001 → NaN, not 42', () => {
    const v = parse('{"user_id":42.0000000000000001}').user_id;
    expect(Number.isNaN(v)).toBe(true);
    expect(JSON.parse('{"user_id":42.0000000000000001}').user_id).toBe(42); // what a plain parse would have said
  });

  it('"id":7 → "7"; "id":"07" stays the string "07" (the raw check refuses it later)', () => {
    const out = parseJsonWithIdSource('{"data":[{"id":7},{"id":"07"}]}') as { data: Array<{ id: unknown }> };
    expect(out.data[0]!.id).toBe("7");
    expect(out.data[1]!.id).toBe("07");
  });

  it('"id":0 → "0" (the one canonical zero); "id":00 is not JSON at all', () => {
    expect(parse('{"id":0}').id).toBe("0");
    expect(() => parseJsonWithIdSource('{"id":00}')).toThrow();
  });

  it.each([
    ["exponent", '{"location_id":4.2e1}', "location_id"],
    ["negative", '{"role_id":-7}', "role_id"],
    ["negative zero", '{"id":-0}', "id"],
    ["fraction", '{"company_id":12.5}', "company_id"],
    ["trailing-zero fraction", '{"user_id":7.0}', "user_id"],
    ["upper-case exponent", '{"id":1E2}', "id"],
    ["19 digits", '{"id":1234567890123456789}', "id"],
  ])("%s under an id key → NaN", (_name, text, key) => {
    expect(Number.isNaN(parse(text)[key])).toBe(true);
  });

  it("a canonical 18-digit id survives exactly (no precision loss)", () => {
    expect(parse('{"id":123456789012345678}').id).toBe("123456789012345678");
    expect(String(JSON.parse('{"id":123456789012345678}').id)).not.toBe("123456789012345678"); // why it matters
  });

  it('a non-id key\'s number is untouched ("hours": 7.50 → 7.5); strings everywhere are left as written', () => {
    const out = parse('{"hours":7.50,"wage":-3,"name":"Person A","company_id":"1234","nested":{"user_id":9,"count":1e2}}');
    expect(out.hours).toBe(7.5);
    expect(out.wage).toBe(-3);
    expect(out.name).toBe("Person A");
    expect(out.company_id).toBe("1234");
    expect(out.nested).toEqual({ user_id: "9", count: 100 });
  });

  it("an odd numeric id in a nested object is NaN there and does not refuse the whole answer", () => {
    const out = parseJsonWithIdSource('{"data":[{"id":1,"extra":{"id":2.5}}]}') as { data: Array<{ id: unknown; extra: { id: unknown } }> };
    expect(out.data[0]!.id).toBe("1");
    expect(Number.isNaN(out.data[0]!.extra.id)).toBe(true);
  });

  it("fail closed: with NO source text from the runtime, EVERY numeric id is NaN (other numbers untouched)", () => {
    const realParse = JSON.parse;
    // Simulate a runtime whose reviver gets no third argument.
    vi.spyOn(JSON, "parse").mockImplementation(((text: string, reviver?: (this: unknown, k: string, v: unknown) => unknown) =>
      realParse(text, reviver ? function (this: unknown, k: string, v: unknown) { return reviver.call(this, k, v); } : undefined)) as typeof JSON.parse);
    const out = parseJsonWithIdSource('{"id":7,"user_id":0,"role_id":"12","hours":7.5}') as Record<string, unknown>;
    expect(Number.isNaN(out.id)).toBe(true);
    expect(Number.isNaN(out.user_id)).toBe(true);
    expect(out.role_id).toBe("12");
    expect(out.hours).toBe(7.5);
  });

  it('"company_id":12.5 inside a whoami body → get("whoami") on a bounded client throws bad_snapshot', async () => {
    const h = harness([raw('{"object":"whoami","data":{"users":[{"company_id":12.5}]}}')], { maxResponseBytes: 65_536 });
    await expect(h.client.get("whoami", { companyId: null, window: WINDOW })).rejects.toMatchObject({ code: "bad_snapshot" });
  });

  it("the existing validators refuse NaN: whoamiSnapshot and the normalizer's idOf", () => {
    expect(whoamiSnapshot({ object: "whoami", data: { users: [{ company_id: Number.NaN }] } }).ok).toBe(false);
    const n = normalizeDepartments([{ id: Number.NaN, name: "Dept A" }, { id: 5, location_id: Number.NaN }]);
    expect(n.rows).toHaveLength(0);
    expect(n.rejected.map((r) => r.reason)).toEqual(["bad_id", "bad_id"]);
  });

  it("the bounded read applies it on the wire: a shift page's user_id 42.0000000000000001 arrives as NaN", async () => {
    const h = harness([raw('{"data":[{"id":123456789012345678,"user_id":42.0000000000000001,"hours":7.50}],"meta":{"cursor":{"next":null,"prev":null}}}')], { maxResponseBytes: 65_536 });
    const out = await h.client.getOnePage(Q) as { data: Array<Record<string, unknown>> };
    expect(out.data[0]!.id).toBe("123456789012345678");
    expect(Number.isNaN(out.data[0]!.user_id)).toBe(true);
    expect(out.data[0]!.hours).toBe(7.5);
  });
});

describe("getOnePage shares getJson: the 429 retry, the deadline, the fixed codes, the token", () => {
  it("429 once then 200 → two requests, one result", async () => {
    const h = harness([raw("{}", 429, { "retry-after": "1" }), raw('{"data":[{"id":3}]}')], { maxResponseBytes: 65_536 });
    expect(await h.client.getOnePage(Q)).toEqual({ data: [{ id: "3" }] });
    expect(h.counter.requests).toBe(2);
  });

  it("429 with a Retry-After that cannot fit deadlineAt → rate_limited, no retry", async () => {
    const h = harness([raw("{}", 429, { "retry-after": "300" })], { maxResponseBytes: 65_536, deadlineInMs: 100_000 });
    await expect(h.client.getOnePage(Q)).rejects.toMatchObject({ code: "rate_limited" });
    expect(h.counter.requests).toBe(1);
  });

  it("the token never appears in any thrown error", async () => {
    const errors: unknown[] = [];
    const cases: Array<[Array<(c: Call) => Response>, Parameters<typeof harness>[1]]> = [
      [[raw(`{"error":"${TOKEN}"}`, 401)], { maxResponseBytes: 1_000 }],
      [[raw(`<html>${TOKEN}`)], { maxResponseBytes: 1_000 }],
      [[raw(`{"pad":"${TOKEN}${"x".repeat(2_000)}"}`)], { maxResponseBytes: 1_000 }],
      [[() => { throw new TypeError(`fetch failed with Bearer ${TOKEN}`); }], { maxResponseBytes: 1_000 }],
      [[raw('{"data":[]}')], {}],
    ];
    for (const [responses, opts] of cases) {
      const h = harness(responses, opts);
      errors.push(await h.client.getOnePage(Q).catch((e: unknown) => e));
    }
    for (const e of errors) {
      expect(e).toBeInstanceOf(SevenShiftsApiError);
      const text = JSON.stringify(e) + String((e as Error).message) + String((e as Error).stack);
      expect(text).not.toContain(TOKEN);
      expect((e as Error).message).toBe((e as SevenShiftsApiError).code);
    }
  });
});
