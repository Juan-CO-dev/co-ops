// Digest labor money, the loaders' factory (lib/report-digests-labor.ts; digests round 3, PR 4; plan §3.1, §15.2.3;
// CC addendum A4-4, O-N4, O-N8, P3-7). No network: every "real" Supabase client here runs over an injected transport
// that logs each attempt with its time and its signal. Dummy URL and key, set for this file only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-server")>();
  return { ...actual, createServiceRoleClientWithFetch: vi.fn(actual.createServiceRoleClientWithFetch) };
});

import { businessAccessFor, gmVisibilityCombinations } from "@/lib/business-access-shared";
import { BusinessReportError, resolveBusinessAccess } from "@/lib/business-report";
import { buildLaborMoneyIO, preloadFetch } from "@/lib/report-digests-labor";
import {
  LABOR_PRELOAD_BUDGET_MS, LABOR_SETTINGS_CAP_MS, LABOR_SETTINGS_KEY, laborBusinessAccess, type GmSettingsResult, type HourlyLaborFacts,
} from "@/lib/report-digests-labor-shared";
import { definePreload, preloadValue, signalDeadline, type PieceCtx, type PreloadPiece } from "@/lib/preload-runner";
import { createServiceRoleClientWithFetch } from "@/lib/supabase-server";
import { GM_ALL_ON, fakeClient, gmOff, type VisibilityAnswer } from "./helpers/business-report-fake";

const factory = vi.mocked(createServiceRoleClientWithFetch);
const ROOT = path.resolve(__dirname, "..");
const ON4 = { DIGEST_LABOR_MONEY: "1", BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const BUSINESS_ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const gm = { userId: "u-gm", level: 7, role: "gm" as const, locations: [A] };

/** One phase of the REAL runner holding `pieces`, on the given clock (timers: the global ones, faked where a test says). */
function runPhase(pieces: PreloadPiece<unknown>[], clock: () => number, maxCapMs = LABOR_SETTINGS_CAP_MS) {
  return definePreload<null>({ phases: [{ name: "t", maxCapMs, pieces: () => pieces }], budgetMs: LABOR_PRELOAD_BUDGET_MS })
    .run({ sources: async () => ({ writersSettled: true }), due: null, clock });
}

beforeEach(() => {
  factory.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── The switch ──────────────────────────────────────────────────────────────────────────────────

describe("switch off: nothing is built", () => {
  it("null for every env that is not all four switches, and no client is ever constructed", () => {
    const envs: Array<Record<string, string | undefined>> = [{}, { DIGEST_LABOR_MONEY: "1" }, BUSINESS_ON];
    for (const k of Object.keys(ON4)) {
      envs.push({ ...ON4, [k]: undefined }, { ...ON4, [k]: "0" }, { ...ON4, [k]: "true" }, { ...ON4, [k]: "" });
    }
    for (const env of envs) expect(buildLaborMoneyIO({ env })).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
  it("switch on: the IO exists, and still no client until a piece STARTS (a run with nothing to read builds none)", () => {
    const io = buildLaborMoneyIO({ env: ON4, clock: () => 0 });
    expect(io).not.toBeNull();
    io!.settings();
    io!.hourly(A, "2026-11-20");
    io!.roles(A, "2026-11-20", {} as HourlyLaborFacts);
    expect(factory).not.toHaveBeenCalled();
  });
});

// ── Settings parity with resolveBusinessAccess (§3.1) ───────────────────────────────────────────

/** The business-report tests' own fake client, with `.abortSignal` / `.retry` recorded on the settings read. */
function sameFake(visibility: ReadonlyArray<VisibilityAnswer>) {
  const f = fakeClient({ visibility });
  const used = { signals: [] as AbortSignal[], retry: [] as boolean[] };
  const inner = f.client as unknown as { from(t: string): Record<string, unknown>; rpc: unknown };
  const client = {
    rpc: inner.rpc,
    from(t: string) {
      const q = inner.from(t);
      q.abortSignal = (s: AbortSignal) => { used.signals.push(s); return q; };
      q.retry = (b: boolean) => { used.retry.push(b); return q; };
      return q;
    },
  };
  return { client, used, reads: f.visibilityReads };
}

async function sealedSettings(visibility: ReadonlyArray<VisibilityAnswer>) {
  const fake = sameFake(visibility);
  factory.mockImplementationOnce(() => fake.client as never);
  const io = buildLaborMoneyIO({ env: ON4, clock: () => Date.now() })!;
  const sealed = await runPhase([io.settings()], () => Date.now());
  return { settings: preloadValue<GmSettingsResult>(sealed, LABOR_SETTINGS_KEY), fake };
}

async function reportAccess(visibility: ReadonlyArray<VisibilityAnswer>) {
  const fake = sameFake(visibility);
  try {
    return await resolveBusinessAccess(gm, { client: fake.client as never, env: BUSINESS_ON });
  } catch (e) {
    // A 503 or a 403 in the report = no labor money in the digest.
    if (e instanceof BusinessReportError && (e.status === 503 || e.status === 403)) return null;
    throw e;
  }
}

describe("the settings piece: a GM's access equals resolveBusinessAccess on the same fake client (§3.1 parity)", () => {
  const CASES: Array<[string, ReadonlyArray<VisibilityAnswer>]> = [
    ["no row saved", [null]],
    ["the table is missing", ["missing"]],
    ["the read errors", ["error"]],
    ["the read throws", ["throw"]],
    ["a row with an extra key", [{ raw: { ...GM_ALL_ON, extra: true } }]],
    ["a row with a non-boolean", [{ raw: { ...GM_ALL_ON, people: 1 } }]],
    ["an incoherent row", [{ raw: { ...GM_ALL_ON, hourly_cost: false } }]],
    ["settings that are not an object", [{ raw: [GM_ALL_ON] }]],
    ["report off", [gmOff("report")]],
  ];
  for (const [name, visibility] of CASES) {
    it(name, async () => {
      const { settings, fake } = await sealedSettings(visibility);
      expect(laborBusinessAccess("gm", settings)).toEqual(await reportAccess(visibility));
      // ONE read, with the stage's signal and WITHOUT the SDK's retries.
      expect(fake.reads()).toBe(1);
      expect(fake.used.retry).toEqual([false]);
      expect(fake.used.signals).toHaveLength(1);
      expect(signalDeadline(fake.used.signals[0]!)).toBeTypeOf("number");
    });
  }
  it("every coherent saved row (gmVisibilityCombinations)", async () => {
    const combos = gmVisibilityCombinations();
    expect(combos.length).toBeGreaterThan(10);
    for (const row of combos) {
      const { settings } = await sealedSettings([row]);
      expect(settings).toEqual({ kind: "settings", settings: row });
      expect(laborBusinessAccess("gm", settings)).toEqual(await reportAccess([row]));
    }
  });
  it("the report's own read passes NO signal and keeps the SDK's retries (byte for byte today's request)", async () => {
    const fake = sameFake([null]);
    await resolveBusinessAccess(gm, { client: fake.client as never, env: BUSINESS_ON });
    expect(fake.used).toEqual({ signals: [], retry: [] });
  });
  it("MoO / Owner / CGS never read: their access is everything with settings null, as in the report", async () => {
    for (const role of ["moo", "owner", "cgs"] as const) {
      const fake = sameFake(["throw"]);
      const viewer = { userId: "u", level: 8, role, locations: [] as string[] };
      expect(laborBusinessAccess(role, null)).toEqual(await resolveBusinessAccess(viewer, { client: fake.client as never, env: BUSINESS_ON }));
      expect(laborBusinessAccess(role, null)).toEqual(businessAccessFor(role, null));
      expect(fake.reads()).toBe(0);
    }
  });
  it("a settings read that never answers is `unavailable` at 3 s (the real runner, fake timers)", async () => {
    vi.useFakeTimers();
    const hanging = { from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "order", "limit", "abortSignal", "retry"]) q[k] = () => q;
      q.then = () => new Promise(() => {});
      return q;
    } };
    factory.mockImplementationOnce(() => hanging as never);
    const io = buildLaborMoneyIO({ env: ON4, clock: () => Date.now() })!;
    let sealed: Awaited<ReturnType<typeof runPhase>> | null = null;
    void runPhase([io.settings()], () => Date.now()).then((s) => { sealed = s; });
    await vi.advanceTimersByTimeAsync(LABOR_SETTINGS_CAP_MS - 1);
    expect(sealed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sealed).not.toBeNull();
    expect(preloadValue<GmSettingsResult>(sealed!, LABOR_SETTINGS_KEY)).toEqual({ kind: "unavailable" });
    expect(laborBusinessAccess("gm", preloadValue<GmSettingsResult>(sealed!, LABOR_SETTINGS_KEY))).toBeNull();
  });
  it("no client (a missing env var) = `unavailable`, never a throw out of the piece", async () => {
    factory.mockImplementationOnce(() => { throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set"); });
    const io = buildLaborMoneyIO({ env: ON4, clock: () => Date.now() })!;
    const sealed = await runPhase([io.settings()], () => Date.now());
    expect(preloadValue<GmSettingsResult>(sealed, LABOR_SETTINGS_KEY)).toEqual({ kind: "unavailable" });
  });
});

// ── L10 / A4-4 / O-N4 / O-N8 at the fetch boundary: a REAL Supabase client ─────────────────────

interface Attempt { t: number; method: string; url: string; body: string; deadline: number | undefined; abortedAtSend: boolean; retryCount: string | null }
/** The injected transport: logs every attempt that REACHES it; `answer` decides the response. */
function transport(answer: (url: string, signal: AbortSignal | null) => Promise<Response>) {
  const attempts: Attempt[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    attempts.push({ t: Date.now(), method: init?.method ?? "GET", url: String(input), body: typeof init?.body === "string" ? init.body : "",
      deadline: signal ? signalDeadline(signal) : undefined, abortedAtSend: signal?.aborted ?? false,
      // postgrest-js stamps every RETRY attempt with X-Retry-Count (PostgrestBuilder executeWithRetry).
      retryCount: new Headers(init?.headers).get("X-Retry-Count") });
    return answer(String(input), signal);
  }) as typeof fetch;
  return { attempts, fn };
}
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
/** Like a real fetch: never answers, rejects when its signal aborts. */
const hang = (signal: AbortSignal | null) => new Promise<Response>((_, reject) => {
  signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
});

/** Every attempt carried a signal with a registered deadline (O-N8) and started BEFORE that deadline. */
function assertStaged(attempts: Attempt[]) {
  expect(attempts.filter((a) => a.deadline === undefined)).toHaveLength(0);
  for (const a of attempts) {
    expect(a.t).toBeLessThan(a.deadline!);
    expect(a.abortedAtSend).toBe(false);
  }
}

describe("the fetch boundary (A4-4, O-N4, O-N8): a real client over an injected transport, the real runner, fake timers", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preload-test.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-key");
    vi.stubEnv("SIM_MODE", "");
    vi.useFakeTimers();
  });
  const clock = () => Date.now();

  it("O-N4: the settings read (a table GET) answered 503 is ONE attempt, not attempted again inside or after its 3 s; the counter stays still after the seal", async () => {
    const t = transport(() => json(503, { message: "x" }));
    const io = buildLaborMoneyIO({ env: ON4, clock, fetch: t.fn })!;
    let sealed: Awaited<ReturnType<typeof runPhase>> | null = null;
    void runPhase([io.settings()], clock).then((s) => { sealed = s; });
    await vi.advanceTimersByTimeAsync(LABOR_SETTINGS_CAP_MS + 10_000);
    expect(sealed).not.toBeNull();
    expect(preloadValue<GmSettingsResult>(sealed!, LABOR_SETTINGS_KEY)).toEqual({ kind: "unavailable" });
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]).toMatchObject({ method: "GET", retryCount: null });
    expect(t.attempts[0]!.url).toContain("/rest/v1/business_report_gm_visibility");
    assertStaged(t.attempts);
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.attempts).toHaveLength(1);
  });

  it("O-N4 control: the SAME table GET built WITHOUT .retry(false) is attempted a second time (the SDK's back-off), and the guard refuses the third at the cutoff", async () => {
    const t = transport(() => json(503, { message: "x" }));
    const sb = createServiceRoleClientWithFetch(preloadFetch(t.fn, clock));
    const control: PreloadPiece<null> = { key: "control", capMs: LABOR_SETTINGS_CAP_MS, start(ctx: PieceCtx) {
      const stage = ctx.stage("cutoff");
      const done = (async () => {
        if (stage.expired()) return;
        await sb.from("business_report_gm_visibility").select("id, settings").order("seq", { ascending: false }).limit(1).abortSignal(stage.signal);
      })();
      return { done, snapshot: () => null };
    } };
    let sealed = false;
    void runPhase([control], clock).then(() => { sealed = true; });
    await vi.advanceTimersByTimeAsync(LABOR_SETTINGS_CAP_MS + 10_000);
    expect(sealed).toBe(true);
    // 0 s, then 1 s (the SDK's first back-off); the next one (at 3 s = the cutoff) never reaches the transport.
    expect(t.attempts.map((a) => a.t - t.attempts[0]!.t)).toEqual([0, 1_000]);
    expect(t.attempts.map((a) => a.retryCount)).toEqual([null, "1"]);
    assertStaged(t.attempts);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.attempts).toHaveLength(2);
  });

  it("A4-4: the clock crosses a stage's deadline between the guard and the transport with the abort timer still pending → ZERO attempts for that stage; a sibling piece on a live stage goes through", async () => {
    const t = transport((url) => json(200, url.includes("business_report_gm_visibility") ? [{ id: "00000000-0000-4000-8000-0000000000f1", settings: GM_ALL_ON }] : []));
    const io = buildLaborMoneyIO({ env: ON4, clock, fetch: t.fn })!;
    const sb = createServiceRoleClientWithFetch(preloadFetch(t.fn, clock));
    const seen: { error: unknown; stageAbortedWhenAnswered: boolean | null } = { error: null, stageAbortedWhenAnswered: null };
    const crossing: PreloadPiece<null> = { key: "crossing", capMs: LABOR_SETTINGS_CAP_MS, start(ctx: PieceCtx) {
      const stage = ctx.stage(500);
      const done = (async () => {
        if (stage.expired()) return; // THE guard: the stage is live here.
        const q = sb.from("labor_week_coverage").select("week_start").abortSignal(stage.signal).retry(false);
        // Start the request (supabase-js now awaits its access token), THEN move the clock past the stage's end
        // WITHOUT running timers: the stage's abort timer is still pending when the wrapped fetch is called.
        const answered = new Promise<{ error: unknown }>((resolve) => { void q.then(resolve, (e: unknown) => resolve({ error: e })); });
        vi.setSystemTime(Date.now() + 600);
        const res = await answered;
        seen.error = res.error;
        seen.stageAbortedWhenAnswered = stage.signal.aborted;
      })();
      return { done, snapshot: () => null };
    } };
    // The sibling is the REAL settings piece (it starts after the jump, so its stage is live).
    const sealed = runPhase([crossing, io.settings()], clock);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LABOR_SETTINGS_CAP_MS + 1_000);
    const results = await sealed;
    expect(seen.stageAbortedWhenAnswered).toBe(false); // the timer had NOT delivered the abort: the clock check refused it
    expect(seen.error).toMatchObject({ message: expect.stringContaining("preload_stage_ended") });
    expect(t.attempts.filter((a) => a.url.includes("labor_week_coverage"))).toHaveLength(0);
    expect(t.attempts.filter((a) => a.url.includes("business_report_gm_visibility"))).toHaveLength(1);
    expect(preloadValue<GmSettingsResult>(results, LABOR_SETTINGS_KEY)).toEqual({ kind: "settings", settings: GM_ALL_ON });
    assertStaged(t.attempts);
  });

  it("O-N8: a request on the pre-load client with no stage signal, or a signal the runner did not make, never reaches the transport", async () => {
    const t = transport(() => json(200, []));
    const sb = createServiceRoleClientWithFetch(preloadFetch(t.fn, clock));
    const a = await sb.from("labor_week_coverage").select("week_start").retry(false);
    const b = await sb.from("labor_week_coverage").select("week_start").abortSignal(new AbortController().signal).retry(false);
    const c = await sb.rpc("fact_labor_week_fingerprint", { p_week: "2026-11-15" });
    for (const r of [a, b, c]) expect(r.error).toMatchObject({ message: expect.stringContaining("preload_unstaged_request") });
    expect(t.attempts).toHaveLength(0);
  });

  it("an aborted stage signal is refused at the boundary even when its deadline is still ahead", async () => {
    const t = transport(() => json(200, []));
    const sb = createServiceRoleClientWithFetch(preloadFetch(t.fn, clock));
    // A piece that finishes at once: the runner snapshots it at once and aborts its signal, long before its 3 s
    // deadline. A request made on that signal afterwards (a request that outlived its piece) is refused.
    let late: AbortSignal | null = null;
    const grab: PreloadPiece<null> = { key: "grab", capMs: LABOR_SETTINGS_CAP_MS, start(ctx: PieceCtx) { late = ctx.stage(2_000).signal; return { done: Promise.resolve(), snapshot: () => null }; } };
    await runPhase([grab], clock);
    expect(late!.aborted).toBe(true);
    expect(signalDeadline(late!)!).toBeGreaterThan(Date.now());
    const r = await sb.from("labor_week_coverage").select("week_start").abortSignal(late!).retry(false);
    expect(r.error).toMatchObject({ message: expect.stringContaining("preload_stage_ended") });
    expect(t.attempts).toHaveLength(0);
  });

  // The core's REAL pieces (lib/business-labor-core.ts), built by this factory, over the same boundary.
  const D = "2026-11-20";
  const roleStepFacts: HourlyLaborFacts = { day: D, latestFinalDay: { kind: "unavailable" }, weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" },
    roleStep: { date: "2026-11-19", weekStart: "2026-11-15", generation: { week_start: "2026-11-15", ot_scope: "per_shop", builder_version: "x", built_at: "2026-11-19T10:00:00Z",
      source_fingerprint: "f".repeat(32) } as never, dayStraightCents: 100, wageEstimated: false } };

  it("core pieces, every answer a 503: each request is ONE attempt (no retry of any table GET), every attempt staged, nothing after the seal", async () => {
    const t = transport(() => json(503, { message: "x" }));
    const io = buildLaborMoneyIO({ env: ON4, clock, fetch: t.fn })!;
    let sealed: Awaited<ReturnType<typeof runPhase>> | null = null;
    void runPhase([io.hourly(A, D) as PreloadPiece<unknown>, io.roles(A, D, roleStepFacts) as PreloadPiece<unknown>], clock, 10_000).then((s) => { sealed = s; });
    await vi.advanceTimersByTimeAsync(10_000 + 60_000);
    expect(sealed).not.toBeNull();
    expect(t.attempts.length).toBeGreaterThan(0);
    expect(t.attempts.some((a) => a.method === "GET")).toBe(true);
    // No attempt is a retry (the coverage read legitimately repeats in every bracket: each is a NEW request).
    expect(t.attempts.filter((a) => a.retryCount !== null)).toHaveLength(0);
    assertStaged(t.attempts);
    expect(factory).toHaveBeenCalledTimes(1); // ONE client for the run, built on the first piece start
    const n = t.attempts.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.attempts).toHaveLength(n);
  });

  it("core pieces, nothing ever answers: every stage ends on time, no attempt starts at or after its stage's end, all facts withheld, nothing after the seal", async () => {
    const t = transport((_, signal) => hang(signal));
    const io = buildLaborMoneyIO({ env: ON4, clock, fetch: t.fn })!;
    let sealed: Awaited<ReturnType<typeof runPhase>> | null = null;
    const start = Date.now();
    void runPhase([io.hourly(A, D) as PreloadPiece<unknown>, io.roles(A, D, roleStepFacts) as PreloadPiece<unknown>], clock, 10_000).then((s) => { sealed = s; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sealed).not.toBeNull();
    expect(Date.now() - start).toBeLessThanOrEqual(10_000);
    expect(t.attempts.length).toBeGreaterThan(0);
    assertStaged(t.attempts);
    const hourly = preloadValue<HourlyLaborFacts>(sealed!, `hourly|${A}|${D}`);
    expect(hourly).toMatchObject({ latestFinalDay: { kind: "unavailable" }, weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" }, roleStep: null });
    expect(preloadValue(sealed!, `roles|${A}|${D}`)).toEqual({ kind: "unavailable" });
    const n = t.attempts.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.attempts).toHaveLength(n);
  });
});

// ── The two import censuses ─────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry) ? [full] : [];
  });
}
const SOURCES = ["lib", "app"].flatMap((d) => walk(path.join(ROOT, d))).map((f) => ({ rel: path.relative(ROOT, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }));
/** Every module specifier a file imports, re-exports, dynamically imports or requires. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4])!);
  return out;
}

describe("import censuses (A4-4)", () => {
  it("lib/report-digests-labor.ts is the ONLY importer of lib/business-labor-core.ts in lib/** and app/**", () => {
    const importers = SOURCES.filter((f) => f.rel !== "lib/business-labor-core.ts" && specifiers(f.text).some((s) => /(^|\/)business-labor-core(\.ts)?$/.test(s)))
      .map((f) => f.rel);
    expect(importers).toEqual(["lib/report-digests-labor.ts"]);
  });
  it("lib/report-digests-labor.ts is the ONLY caller of createServiceRoleClientWithFetch in lib/** and app/** (beside its definition)", () => {
    const users = SOURCES.filter((f) => f.rel !== "lib/supabase-server.ts" && /\bcreateServiceRoleClientWithFetch\b/.test(f.text)).map((f) => f.rel);
    expect(users).toEqual(["lib/report-digests-labor.ts"]);
  });
  it("this module sends no request of its own: no `.from(` / `.rpc(` (its one read is readGmVisibility with a stage signal)", () => {
    const text = readFileSync(path.join(ROOT, "lib/report-digests-labor.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(text).not.toMatch(/\.(from|rpc)\(/);
    expect(text).toMatch(/readGmVisibility\(client\(\), stage\.signal\)/);
  });
});
