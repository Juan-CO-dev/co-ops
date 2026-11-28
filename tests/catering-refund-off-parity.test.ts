/**
 * Catering refunds Part B1 v2 — OFF PARITY (plan section 5, row 1: "Both unset = main, byte for byte, on every existing
 * path"; plan 4.1: "order of checks unchanged up to the switch").
 *
 *  1. With CATERING_REFUNDS and CATERING_REFUNDS_OBSERVE unset, each EXISTING refund route (GET + POST .../refunds,
 *     POST .../refunds/[requestId]/retry, GET pipeline/[id]/refunds) answers, for an authenticated, an unauthenticated
 *     and a bad-origin request, exactly main's status and body, through the REAL requireSession over a fake sessions
 *     table: the database calls are EXACTLY the session check's own (the same calls a bare requireSession makes on that
 *     path: main's), no RPC, and zero fetches. OBSERVE alone changes none of it. (The quote page and the pipeline
 *     rendering no refund UI is the panel piece's parity case.)
 *  2. Main's exact bytes: each handler's text from its signature down to and INCLUDING the switch line is identical to
 *     origin/main's (so nothing new runs before the switch), and the switch answers main's literal body.
 *  3. The new cron answers `{ skipped }` with no service client created.
 *  4. `git diff origin/main` is EMPTY for lib/stripe/webhook.ts, lib/stripe/shared.ts, app/api/webhooks/stripe/**,
 *     lib/job-watch-run.ts, lib/jobs-registry.ts, lib/cron-route-lease.ts; and a static scan proves those files name no
 *     B1 module and neither switch.
 * GIT IN CI: the build job checks out the PR's merge commit at depth 1, where `origin/main` does not exist. The base is
 * `origin/main`, else `git merge-base HEAD origin/main`; when neither resolves the two git cases are SKIPPED BY NAME
 * (the skip names what is unproven). The static scan and every behavioural case run everywhere.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ client: null as unknown, factory: vi.fn(), calls: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.factory, createAuthedClient: h.factory }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}), auditChecked: async () => ({ ok: true }) }));
vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(),
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
}));

import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { GET as QUOTE_GET, POST as QUOTE_POST } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { GET as LEAD_GET } from "@/app/api/catering/pipeline/[id]/refunds/route";
import { GET as SWEEP } from "@/app/api/cron/catering-refund-sweep/route";
import { fakeSupabase, type FakeDb } from "./fake-supabase";

const ORIGIN = "http://localhost";
const Q = "00000000-0000-4000-8000-0000000000b1";
const R = "00000000-0000-4000-8000-0000000000c1";
const L = "00000000-0000-4000-8000-0000000000e1";
const COOKIE = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const BODY = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 1000, seenRefundableCents: 1000, reasonCode: "event_lost", reasonNote: null, trigger: "lost" };
/** Main's answers, from main's own code: `jsonError(503, "refunds_off")` and `assertSameOrigin`'s refusal. */
const MAIN_OFF = { status: 503, body: { error: "refunds_off", code: "refunds_off" } };
const MAIN_BAD_ORIGIN = { status: 403, body: { error: "bad_origin" } };

let fake: FakeDb;
function seed(role: string) {
  const now = new Date().toISOString();
  fake = fakeSupabase({
    sessions: [{ id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password", step_up_unlocked: false, step_up_unlocked_at: null,
      catalog_edit_unlocked_at: null, created_at: now, last_activity_at: now, expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null }],
    users: [{ id: "user-1", name: "Ops", email: "ops@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: L, active: true }],
  });
  const client = fake.client as unknown as { from: (t: string) => unknown; rpc: (n: string, a: unknown) => unknown };
  const from = client.from.bind(client);
  const rpc = client.rpc.bind(client);
  client.from = (t: string) => { h.calls.push(`from:${t}`); return from(t); };
  client.rpc = (n: string, a: unknown) => { h.calls.push(`rpc:${n}`); return rpc(n, a); };
  h.client = client;
}

interface Route { name: string; path: string; method: "GET" | "POST"; call: (req: NextRequest) => Promise<Response> }
const ROUTES: Route[] = [
  { name: "GET quote refunds", path: `/api/catering/quotes/${Q}/refunds`, method: "GET", call: (r) => QUOTE_GET(r, { params: Promise.resolve({ id: Q }) }) },
  { name: "POST quote refunds (the confirm)", path: `/api/catering/quotes/${Q}/refunds`, method: "POST", call: (r) => QUOTE_POST(r, { params: Promise.resolve({ id: Q }) }) },
  { name: "POST retry", path: `/api/catering/quotes/${Q}/refunds/${R}/retry`, method: "POST", call: (r) => RETRY(r, { params: Promise.resolve({ id: Q, requestId: R }) }) },
  { name: "GET pipeline refunds", path: `/api/catering/pipeline/${Q}/refunds`, method: "GET", call: (r) => LEAD_GET(r, { params: Promise.resolve({ id: Q }) }) },
];
const request = (rt: Route, headers: Record<string, string>) =>
  new NextRequest(`${ORIGIN}${rt.path}`, rt.method === "GET" ? { headers } : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(BODY) });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.calls = [];
  h.factory.mockReset();
  h.factory.mockImplementation(() => h.client);
  fetchSpy = vi.fn(() => { throw new Error("no network on the OFF path"); });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("CATERING_REFUNDS", "");
  vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
  seed("owner");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** What main does on this path: the session check, alone (its database calls and, on a denial, its response). */
async function sessionAlone(rt: Route, headers: Record<string, string>) {
  h.calls = [];
  const out = await requireSession(request(rt, headers), rt.path);
  const calls = [...h.calls];
  h.calls = [];
  return { out, calls };
}
const answerOf = async (res: Response) => ({ status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") });

describe("1. both switches unset (and OBSERVE alone): every existing refund route answers main's bytes", () => {
  describe.each(["", "1"])("CATERING_REFUNDS_OBSERVE=%j", (observe) => {
    beforeEach(() => vi.stubEnv("CATERING_REFUNDS_OBSERVE", observe));
    describe.each(ROUTES)("$name", (rt) => {
      it.each(["owner", "catering_mgr", "gm", "employee"])("authenticated (%s): 503 refunds_off, ONLY the session check's own database calls, no RPC, no fetch, the body unread", async (role) => {
        seed(role);
        const { out, calls: sessionCalls } = await sessionAlone(rt, { ...COOKIE, origin: ORIGIN });
        expect(out).not.toBeInstanceOf(Response);
        const req = request(rt, { ...COOKIE, origin: ORIGIN });
        const json = vi.spyOn(req, "json");
        const res = await rt.call(req);
        expect(await answerOf(res)).toEqual({ ...MAIN_OFF, cookie: null });
        expect(h.calls).toEqual(sessionCalls);
        expect(h.calls.every((x) => ["from:sessions", "from:users", "from:user_locations"].includes(x))).toBe(true);
        expect(fake.writes.map((w) => w.table)).toEqual(["sessions", "sessions"]); // the last_activity_at touch: the bare check's, then the route's
        expect(json).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
      });
      it("unauthenticated: the session check's own 401 (and its cookie), no other call", async () => {
        const { out } = await sessionAlone(rt, { origin: ORIGIN });
        expect(out).toBeInstanceOf(Response);
        const expected = await answerOf(out as Response);
        const res = await rt.call(request(rt, { origin: ORIGIN }));
        expect(await answerOf(res)).toEqual(expected);
        expect(expected.status).toBe(401);
        expect(h.calls).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
      it("bad origin: a POST is 403 bad_origin before the session (no call at all); a GET has no origin check (main's), so it is the authenticated answer", async () => {
        const res = await rt.call(request(rt, { ...COOKIE, origin: "https://evil.test" }));
        if (rt.method === "POST") {
          expect(await answerOf(res)).toEqual({ ...MAIN_BAD_ORIGIN, cookie: null });
          expect(h.calls).toEqual([]);
        } else {
          expect(await answerOf(res)).toEqual({ ...MAIN_OFF, cookie: null });
          expect(h.calls.every((x) => ["from:sessions", "from:users", "from:user_locations"].includes(x))).toBe(true);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });
  });
});

// ── git: the base and the files ──────────────────────────────────────────────────────────────────────────
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function resolveBase(): string | null {
  for (const attempt of [() => git(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]), () => git(["merge-base", "HEAD", "origin/main"])]) {
    try {
      const sha = attempt();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch { /* next */ }
  }
  return null;
}
const BASE = resolveBase();
const gitIt = BASE ? it : it.skip;
const SKIP_NOTE = BASE ? "" : " [SKIPPED: origin/main is not resolvable in this clone (CI checks out the merge commit at depth 1); UNPROVEN HERE, run locally]";

const MAIN_ONLY_FILES = ["lib/stripe/webhook.ts", "lib/stripe/shared.ts", "lib/job-watch-run.ts", "lib/jobs-registry.ts", "lib/cron-route-lease.ts"];
const MAIN_ONLY_DIRS = ["app/api/webhooks/stripe"];
const filesIn = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, "/");
  return statSync(p).isDirectory() ? filesIn(p) : [p];
});

describe("2. main's exact bytes up to the switch", () => {
  const SWITCH = 'if (!cateringRefundsOn(process.env)) return jsonError(503, "refunds_off");';
  const handlerPrefix = (src: string, method: string) => {
    const s = src.replace(/\r\n/g, "\n");
    const start = s.indexOf(`export async function ${method}(`);
    expect(start, method).toBeGreaterThanOrEqual(0);
    const end = s.indexOf(SWITCH, start);
    expect(end, method).toBeGreaterThan(start);
    return s.slice(start, end + SWITCH.length);
  };
  const FILES: Array<[string, string[]]> = [
    ["app/api/catering/quotes/[id]/refunds/route.ts", ["GET", "POST"]],
    ["app/api/catering/quotes/[id]/refunds/[requestId]/retry/route.ts", ["POST"]],
    ["app/api/catering/pipeline/[id]/refunds/route.ts", ["GET"]],
  ];
  gitIt(`each existing handler, from its signature down to and including the switch, is origin/main's text${SKIP_NOTE}`, () => {
    for (const [file, methods] of FILES) {
      const ours = readFileSync(file, "utf8");
      const mains = git(["show", `${BASE}:${file}`]);
      for (const m of methods) expect([file, m, handlerPrefix(ours, m)]).toEqual([file, m, handlerPrefix(mains, m)]);
    }
  });
  it("the switch answer is main's literal (jsonError(503, 'refunds_off')) in every existing handler", () => {
    for (const [file, methods] of FILES) for (const m of methods) expect(handlerPrefix(readFileSync(file, "utf8"), m).endsWith(SWITCH)).toBe(true);
  });
});

describe("3. the new cron with OBSERVE unset", () => {
  it("{ skipped } with no service client created, no fetch (CATERING_REFUNDS alone changes nothing)", async () => {
    vi.stubEnv("CRON_SECRET", "test-only-off-parity-cron");
    for (const refunds of ["", "1"]) {
      vi.stubEnv("CATERING_REFUNDS", refunds);
      const res = await SWEEP(new NextRequest(`${ORIGIN}/api/cron/catering-refund-sweep`, { headers: { authorization: "Bearer test-only-off-parity-cron" } }));
      expect([res.status, await res.json()]).toEqual([200, { skipped: "observe_off" }]);
    }
    expect(h.factory).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("4. main's webhook, lease and watch files", () => {
  const all = () => [...MAIN_ONLY_FILES, ...MAIN_ONLY_DIRS.flatMap(filesIn)];
  gitIt(`git diff against origin/main is EMPTY for every one of them${SKIP_NOTE}`, () => {
    let empty = true;
    try {
      execFileSync("git", ["diff", "--quiet", BASE!, "--", ...MAIN_ONLY_FILES, ...MAIN_ONLY_DIRS], { stdio: "ignore" });
    } catch {
      empty = false;
    }
    expect(empty).toBe(true);
    // …and nothing new was added under the webhook directory.
    expect(git(["diff", "--name-only", BASE!, "--", ...MAIN_ONLY_DIRS])).toBe("");
  });
  it("a static scan: they name no B1 module and neither switch", () => {
    const files = all();
    expect(files.length).toBeGreaterThanOrEqual(MAIN_ONLY_FILES.length + 3);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const banned of ["refund-observe", "catering/refunds", "refunds-shared", "CATERING_REFUNDS", "cateringRefundsOn", "cateringRefundsObserveOn", "catering_refund_"]) {
        expect([f, banned, src.includes(banned)]).toEqual([f, banned, false]);
      }
    }
  });
});
