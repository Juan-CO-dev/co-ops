/**
 * Scheduling Phase 1, Task 6 — the 7shifts status and the GET-only client. Injected fetch, a fake
 * clock, no real sleeps, no network, no token anywhere but a planted test value.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sevenShiftsStatus, sevenShiftsToken, syncEnabled } from "@/lib/sevenshifts/config";
import { createSevenShiftsClient, SevenShiftsApiError, type SevenShiftsFetch } from "@/lib/sevenshifts/client";
import { createLimiter } from "@/lib/sevenshifts/rate-limit-shared";
import type { SyncWindow } from "@/lib/sevenshifts/endpoints-shared";
import { ASSIGNMENTS_DOC_EXAMPLE } from "./fixtures/sevenshifts/payloads";

const TOKEN = "PLANTED-TOKEN-0123456789abcdef";
const WINDOW: SyncWindow = { modifiedSince: null, from: "2026-07-16", to: "2026-10-15" };

describe("sevenShiftsStatus — the one line every surface renders", () => {
  it("no token ⇒ not_connected / token_missing, even with SEVENSHIFTS_SYNC=1", () => {
    expect(sevenShiftsStatus({})).toEqual({ state: "not_connected", reason: "token_missing" });
    expect(sevenShiftsStatus({ SEVENSHIFTS_SYNC: "1" })).toEqual({ state: "not_connected", reason: "token_missing" });
    expect(sevenShiftsStatus({ SEVENSHIFTS_ACCESS_TOKEN: "   ", SEVENSHIFTS_SYNC: "1" })).toEqual({ state: "not_connected", reason: "token_missing" });
    expect(syncEnabled({ SEVENSHIFTS_SYNC: "1" })).toBe(false);
  });
  it("a token without the switch ⇒ sync_off; both ⇒ ready", () => {
    expect(sevenShiftsStatus({ SEVENSHIFTS_ACCESS_TOKEN: TOKEN })).toEqual({ state: "sync_off", reason: "sync_off" });
    expect(sevenShiftsStatus({ SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "true" })).toEqual({ state: "sync_off", reason: "sync_off" });
    expect(sevenShiftsStatus({ SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" })).toEqual({ state: "ready", reason: null });
    expect(syncEnabled({ SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" })).toBe(true);
  });
  it("the status never carries the token, its length or a prefix", () => {
    for (const env of [{ SEVENSHIFTS_ACCESS_TOKEN: TOKEN }, { SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" }]) {
      const json = JSON.stringify(sevenShiftsStatus(env));
      expect(json).not.toContain(TOKEN.slice(0, 6));
      expect(json).not.toContain(String(TOKEN.length));
    }
    expect(sevenShiftsToken({ SEVENSHIFTS_ACCESS_TOKEN: ` ${TOKEN} ` })).toBe(TOKEN);
  });
  it("config.ts is the only reader of the 7shifts env vars", () => {
    const client = readFileSync("lib/sevenshifts/client.ts", "utf8");
    expect(client).not.toMatch(/process\.env/);
  });
});

// ── the client harness: a fake clock, an injected fetch, an injected sleep ──
interface Call { url: string; init: RequestInit }
function harness(responses: Array<(call: Call) => Response | Promise<Response>>, opts: { signal?: AbortSignal; deadlineInMs?: number } = {}) {
  let clock = 1_000_000;
  const calls: Call[] = [];
  const sentAt: number[] = [];
  const sleeps: number[] = [];
  const fetchImpl: SevenShiftsFetch = async (url, init) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    sentAt.push(clock);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next(call);
  };
  const limiter = createLimiter({ perSecond: 8, perMinute: 500, now: () => clock });
  const counter = { requests: 0 };
  const client = createSevenShiftsClient({
    token: TOKEN, fetch: fetchImpl, limiter, counter,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    signal: opts.signal ?? new AbortController().signal,
    now: () => clock,
    deadlineAt: opts.deadlineInMs === undefined ? undefined : clock + opts.deadlineInMs,
  });
  return { client, calls, sentAt, sleeps, counter, limiter, now: () => clock, tick: (ms: number) => { clock += ms; } };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const page = (rows: unknown[], next: string | null) => json({ data: rows, meta: { cursor: { next, prev: null } } });

describe("sevenShiftsGet — GET only, headers, limiter, retries, fixed codes", () => {
  it("sends the bearer token and the pinned API version, GET, no-store, and counts the request", async () => {
    const h = harness([page([{ id: 1 }], null)]);
    const out = await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(out).toEqual({ kind: "list", rows: [{ id: 1 }], pages: 1, complete: true, error: null });
    const init = h.calls[0]!.init;
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("x-api-version")).toBe("2026-01-01");
    expect(h.calls[0]!.url).toBe("https://api.7shifts.com/v2/company/1234/locations?limit=200");
    expect(h.counter.requests).toBe(1);
  });

  it("follows cursors for paginated resources only", async () => {
    const h = harness([page([{ id: 1 }], "c2"), page([{ id: 2 }], null)]);
    const out = await h.client.get("roles", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ kind: "list", rows: [{ id: 1 }, { id: 2 }], pages: 2, complete: true });
    expect(new URL(h.calls[1]!.url).searchParams.get("cursor")).toBe("c2");
  });

  it("a valid page 1 then a malformed page 2 → rows of page 1, complete: false, bad_pagination", async () => {
    const h = harness([page([{ id: 1 }], "c2"), json({ data: [{ id: 2 }], meta: {} })]);
    const out = await h.client.get("shifts", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ kind: "list", rows: [{ id: 1 }], complete: false, error: "bad_pagination" });
  });

  it("time punches run both passes (deleted=false, deleted=true) and concatenate them", async () => {
    const h = harness([page([{ id: 1, deleted: false }], null), page([{ id: 2, deleted: true }], null)]);
    const out = await h.client.get("time_punches", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ kind: "list", rows: [{ id: 1, deleted: false }, { id: 2, deleted: true }], pages: 2, complete: true });
    expect(h.calls.map((c) => new URL(c.url).searchParams.get("deleted"))).toEqual(["false", "true"]);
  });

  it("one incomplete pass makes the whole resource incomplete", async () => {
    const h = harness([page([{ id: 1 }], null), json({ data: "nope" })]);
    const out = await h.client.get("time_punches", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ kind: "list", complete: false, error: "bad_pagination" });
  });

  it("a singleton is ONE request run through its validator: the documented assignments example, no cursor", async () => {
    const h = harness([json(ASSIGNMENTS_DOC_EXAMPLE)]);
    const out = await h.client.get("assignments", { companyId: "1234", userId: "501", window: WINDOW });
    expect(out.kind).toBe("snapshot");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe("https://api.7shifts.com/v2/company/1234/users/501/assignments");
  });

  it("a singleton that fails its validator is bad_snapshot (never an empty success)", async () => {
    const h = harness([json({ object: "assignments", data: { locations: [], departments: [], roles: {} } })]);
    await expect(h.client.get("assignments", { companyId: "1234", userId: "501", window: WINDOW })).rejects.toMatchObject({ code: "bad_snapshot" });
  });

  it("whoami returns the distinct companies", async () => {
    const h = harness([json({ object: "whoami", data: { identity_id: 9, users: [{ company_id: 1234 }, { company_id: 1234 }] } })]);
    expect(await h.client.get("whoami", { companyId: null, window: WINDOW })).toEqual({ kind: "snapshot", value: { companyIds: ["1234"] } });
  });

  it("waits for the limiter before every request (9 requests ⇒ the 9th waits ~1 s)", async () => {
    const h = harness(Array.from({ length: 9 }, () => page([], null)));
    for (let i = 0; i < 9; i++) await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(h.sentAt[8]! - h.sentAt[0]!).toBeGreaterThanOrEqual(1000);
  });

  it("on 429 honours Retry-After, penalizes, and retries ONCE", async () => {
    const h = harness([json({}, 429, { "retry-after": "3" }), page([{ id: 1 }], null)]);
    const out = await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ rows: [{ id: 1 }] });
    expect(h.sentAt[1]! - h.sentAt[0]!).toBeGreaterThanOrEqual(3000);
    expect(h.counter.requests).toBe(2);
  });

  it("a second 429 is rate_limited", async () => {
    const h = harness([json({}, 429, { "retry-after": "1" }), json({}, 429, { "retry-after": "1" })]);
    await expect(h.client.get("locations", { companyId: "1234", window: WINDOW })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it.each([[401, "auth_failed"], [403, "plan_forbidden"], [404, "not_found"], [500, "server_error"], [503, "server_error"], [400, "http_error"]] as const)(
    "HTTP %i → %s", async (status, code) => {
      const h = harness([json({ error: "secret detail https://api.7shifts.com/x" }, status)]);
      const err = await h.client.get("locations", { companyId: "1234", window: WINDOW }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SevenShiftsApiError);
      expect((err as SevenShiftsApiError).code).toBe(code);
      expect((err as Error).message).toBe(code);
    });

  it("a non-JSON body is bad_payload", async () => {
    const h = harness([() => new Response("<html>oops</html>", { status: 200 })]);
    await expect(h.client.get("locations", { companyId: "1234", window: WINDOW })).rejects.toMatchObject({ code: "bad_payload" });
  });

  it("an abort is deadline; a network failure is network_error; neither carries the URL or token", async () => {
    const ac = new AbortController();
    ac.abort();
    const h = harness([page([], null)], { signal: ac.signal });
    const err = await h.client.get("locations", { companyId: "1234", window: WINDOW }).catch((e: unknown) => e);
    expect((err as SevenShiftsApiError).code).toBe("deadline");
    const h2 = harness([() => { throw new TypeError(`fetch failed for https://api.7shifts.com/v2 with ${TOKEN}`); }]);
    const err2 = await h2.client.get("locations", { companyId: "1234", window: WINDOW }).catch((e: unknown) => e);
    expect((err2 as SevenShiftsApiError).code).toBe("network_error");
    expect(JSON.stringify(err2) + String((err2 as Error).message) + String((err2 as Error).stack)).not.toContain(TOKEN);
    expect(String((err2 as Error).message)).not.toContain("http");
  });

  it("refuses a malformed company or user id before any request", async () => {
    const h = harness([]);
    await expect(h.client.get("locations", { companyId: "12/x", window: WINDOW })).rejects.toThrow("bad_id");
    await expect(h.client.get("locations", { companyId: null, window: WINDOW })).rejects.toThrow("bad_id");
    await expect(h.client.get("wages", { companyId: "1234", userId: "x", window: WINDOW })).rejects.toThrow("bad_id");
    expect(h.calls).toHaveLength(0);
  });
});

describe("chunk B review (Astra) #5 — Retry-After is honoured in full and shared", () => {
  it("a cooldown above 60 s is honoured in full (no cap) when it fits before the run deadline", async () => {
    const h = harness([json({}, 429, { "retry-after": "120" }), page([{ id: 1 }], null)], { deadlineInMs: 300_000 });
    const out = await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(out).toMatchObject({ rows: [{ id: 1 }] });
    expect(h.sentAt[1]! - h.sentAt[0]!).toBeGreaterThanOrEqual(120_000);
  });

  it("an HTTP-date Retry-After beyond 60 s is honoured in full too", async () => {
    // The harness clock starts at 1_000_000 ms; the date is read against the client's injected clock.
    const at = new Date(1_000_000 + 90_000).toUTCString();
    const h = harness([json({}, 429, { "retry-after": at }), page([], null)], { deadlineInMs: 600_000 });
    await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(h.sentAt[1]! - h.sentAt[0]!).toBeGreaterThanOrEqual(89_000);
  });

  it("a cooldown that cannot fit before the deadline ends the resource (rate_limited, no retry, no sleep) …", async () => {
    const h = harness([json({}, 429, { "retry-after": "300" })], { deadlineInMs: 100_000 });
    await expect(h.client.get("locations", { companyId: "1234", window: WINDOW })).rejects.toMatchObject({ code: "rate_limited" });
    expect(h.counter.requests).toBe(1);
    expect(h.sleeps.every((ms) => ms < 300_000)).toBe(true);
  });

  it("… and the cooldown still lands on the SHARED limiter, so the next resource waits too (here: past the deadline → deadline, nothing sent)", async () => {
    const h = harness([json({}, 429, { "retry-after": "300" }), page([], null)], { deadlineInMs: 100_000 });
    await h.client.get("locations", { companyId: "1234", window: WINDOW }).catch(() => undefined);
    await expect(h.client.get("roles", { companyId: "1234", window: WINDOW })).rejects.toMatchObject({ code: "deadline" });
    expect(h.counter.requests).toBe(1);
  });

  it("the SECOND 429's Retry-After also penalizes the limiter before rate_limited is thrown", async () => {
    const h = harness([json({}, 429, { "retry-after": "1" }), json({}, 429, { "retry-after": "200" })], { deadlineInMs: 1_000_000 });
    await expect(h.client.get("locations", { companyId: "1234", window: WINDOW })).rejects.toMatchObject({ code: "rate_limited" });
    expect(h.limiter.reserve()).toBeGreaterThanOrEqual(199_000);
  });

  it("without a deadline the full cooldown is waited (the signal still bounds it)", async () => {
    const h = harness([json({}, 429, { "retry-after": "3600" }), page([], null)]);
    await h.client.get("locations", { companyId: "1234", window: WINDOW });
    expect(h.sentAt[1]! - h.sentAt[0]!).toBeGreaterThanOrEqual(3_600_000);
  });
});

describe("GET only, by construction", () => {
  const src = readFileSync("lib/sevenshifts/client.ts", "utf8");
  it("the client has no method other than GET", () => {
    const methods = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    expect(src).not.toMatch(/"(POST|PUT|PATCH|DELETE)"/);
  });
  it("is server-only", () => {
    expect(src).toContain('import "server-only";');
  });
});
