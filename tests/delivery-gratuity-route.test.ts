/**
 * Catering delivery D4 — POST /api/catering/pipeline/[id]/delivery/gratuity over the REAL lib and a recording fake client.
 *
 * The law of every delivery write, for this one: same-origin BEFORE the session; the session on the route's own path;
 * the switch off = 503 `delivery_off` with the body unread and ZERO database work; a strict parse (400, never the
 * writer; an empty reason is the NAMED `reason_required`); **Tier A** asserted after the parse; the write gate by
 * trusted ROLE before any I/O; the shop's own switch; every refusal the database raises passed through BY NAME.
 * RECORDED ONLY: one RPC, nothing else.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryActor, deliveryFake, type FakeRpcs, type FakeTables } from "./helpers/delivery-fake";

const h = vi.hoisted(() => ({ off: [] as string[], actor: null as unknown, fake: null as unknown as ReturnType<typeof import("./helpers/delivery-fake").deliveryFake>, session: vi.fn() }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: h.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.fake.sb }));

import { isStepUpSurface } from "@/lib/session";
import { DELIVERY_SQL_REFUSALS, deliveryErrorStatus } from "@/lib/delivery/errors";
import { parseGratuityCorrection } from "@/lib/delivery/parse-shared";
import { POST } from "@/app/api/catering/pipeline/[id]/delivery/gratuity/route";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const LEAD = "00000000-0000-4000-8000-0000000000d1", HEAD = "00000000-0000-4000-8000-0000000000f7", JOB = "00000000-0000-4000-8000-0000000000e2";
const ORIGIN = "http://localhost", PATH = `/api/catering/pipeline/${LEAD}/delivery/gratuity`, ACTOR = "00000000-0000-4000-8000-0000000000aa";
const BODY = { mode: "recompute", expectedShopId: B, expectedHeadId: HEAD, reason: "the quote was revised after delivery" };
const SPLIT = { split_id: "00000000-0000-4000-8000-0000000000f8", kind: "split", job_id: JOB, gratuity_cents: 8_000, driver_bps: 1000, driver_cents: 800, crew_cents: 7_200 };

const TABLES: FakeTables = {
  delivery_settings: (q) => ({ data: q.eq.location_id === A || q.eq.location_id === B ? { location_id: q.eq.location_id, enabled: !h.off.includes(q.eq.location_id as string) } : null }),
};
const OK: FakeRpcs = { record_delivery_gratuity_split: () => ({ data: SPLIT }) };
const ctx = (lead = LEAD) => ({ params: Promise.resolve({ id: lead }) });
const post = (body: unknown, origin: string | null = ORIGIN) => new NextRequest(`${ORIGIN}${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } });
const unlocked = { stepUpUnlocked: true, stepUpUnlockedAt: "2020-01-01T00:00:00Z" }; // Tier A: an unlock of ANY age
const as = (role: string, locations: string[] = [], session: Parameters<typeof deliveryActor>[2] = unlocked) => { h.actor = deliveryActor(role, locations, session); };
const withDb = (rpcs: FakeRpcs = OK, tables: FakeTables = TABLES) => { h.fake = deliveryFake(tables, rpcs); };
const refuse = (error: { code?: string; message?: string }): FakeRpcs => ({ record_delivery_gratuity_split: () => ({ error }) });
const untouched = () => expect([h.fake.reads, h.fake.calls]).toEqual([[], []]);
const code = async (res: Response) => ((await res.json()) as { code?: string }).code;

beforeEach(() => {
  vi.stubEnv("DELIVERY_TRACKING", "1");
  h.off = [];
  h.session.mockReset();
  h.session.mockImplementation(async () => h.actor);
  as("catering_mgr");
  withDb();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the order of the route", () => {
  it("the statements, in the source: same-origin, its refusal, the session on its own path, the switch, the parse, Tier A, the lib", () => {
    const src = readFileSync("app/api/catering/pipeline/[id]/delivery/gratuity/route.ts", "utf8");
    const body = src.slice(src.indexOf("export async function POST"));
    const order = ["const origin = assertSameOrigin(req);", "if (origin) return origin;", "requireSession(req, `/api/catering/pipeline/${id}/delivery/gratuity`)", "deliveryOffResponse()",
      "parseJsonBody(req)", "parseGratuityCorrection(raw)", 'assertStepUp(ctx, "A")', "recordDeliveryGratuitySplit(ctx,"].map((needle) => body.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // RECORDED ONLY: the route calls the one writer and nothing that pays, notifies or audits on its own.
    expect(src).not.toMatch(/audit\(|notif|sendEmail|fetch\(|stripe|payroll\w*\(/i);
  });
  it("a cross-origin or origin-less POST is refused before the session and the database", async () => {
    for (const origin of ["https://evil.test", null]) {
      const res = await POST(post(BODY, origin), ctx());
      expect([res.status, await res.json()]).toEqual([403, { error: "bad_origin" }]);
    }
    expect(h.session).not.toHaveBeenCalled();
    untouched();
  });
  it("the session is asked on the route's OWN path; a signed-out request stops there", async () => {
    await POST(post(BODY), ctx());
    expect(h.session).toHaveBeenCalledWith(expect.anything(), PATH);
    withDb();
    h.session.mockResolvedValue(Response.json({ code: "unauthorized" }, { status: 401 }));
    expect((await POST(post(BODY), ctx())).status).toBe(401);
    untouched();
  });
  it("the switch off is 503 delivery_off with Retry-After, the body unread, zero database work", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const req = post(BODY);
    const body = vi.spyOn(req, "json");
    const res = await POST(req, ctx());
    expect([res.status, await code(res), res.headers.get("Retry-After")]).toEqual([503, "delivery_off", "60"]);
    expect(body).not.toHaveBeenCalled();
    untouched();
  });
  it("exactly this path keeps a password unlock", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
    for (const path of [`${PATH}/x`, `/api/catering/pipeline/${LEAD}/gratuity`, `/api/catering/pipeline/${LEAD}/delivery/${JOB}/gratuity`, "/api/catering/pipeline/delivery/gratuity",
      `/api/catering/pipeline/${LEAD}/delivery`]) expect([path, isStepUpSurface(path)]).toEqual([path, false]);
  });
});

describe("the parse: exact keys, what the person saw, a reason", () => {
  it("reaches the one writer with the actor, the shop and the head the person saw, the mode and the reason", async () => {
    const res = await POST(post({ ...BODY, expectedShopId: B.toUpperCase(), expectedHeadId: HEAD.toUpperCase(), reason: "  the quote was revised  " }), ctx());
    expect(res.status).toBe(200);
    expect(h.fake.calls).toEqual([{ name: "record_delivery_gratuity_split", params: { p_actor_id: ACTOR, p_lead_id: LEAD, p_expected_shop: B, p_mode: "recompute", p_expected_head: HEAD,
      p_reason: "the quote was revised" } }]);
    expect(await res.json()).toEqual({ ok: true, split: { splitId: SPLIT.split_id, kind: "split", jobId: JOB, gratuityCents: 8_000, driverBps: 1000, driverCents: 800, crewCents: 7_200 } });
    // The shop's own switch was read once, before the writer; nothing else.
    expect(h.fake.reads).toEqual(["delivery_settings", "rpc:record_delivery_gratuity_split"]);
  });
  it("'I saw no split' is an explicit null; void names the head it removes", async () => {
    await POST(post({ ...BODY, expectedHeadId: null }), ctx());
    expect(h.fake.calls[0]!.params).toMatchObject({ p_expected_head: null, p_mode: "recompute" });
    withDb({ record_delivery_gratuity_split: () => ({ data: { ...SPLIT, kind: "void", job_id: null, gratuity_cents: 0, driver_cents: 0, crew_cents: 0 } }) });
    const res = await POST(post({ ...BODY, mode: "void", reason: "it was never delivered" }), ctx());
    expect(h.fake.calls[0]!.params).toMatchObject({ p_expected_head: HEAD, p_mode: "void", p_reason: "it was never delivered" });
    expect(((await res.json()) as { split: { kind: string; jobId: string | null } }).split).toMatchObject({ kind: "void", jobId: null, gratuityCents: 0 });
  });
  it("a malformed body never reaches the writer (400 invalid_request)", async () => {
    const without = (key: string) => Object.fromEntries(Object.entries(BODY).filter(([name]) => name !== key));
    const noHead = without("expectedHeadId"), noShop = without("expectedShopId"), noReason = without("reason"), noMode = without("mode");
    for (const body of [[], "x", 7, { ...BODY, surprise: 1 }, { ...BODY, expectedShopId: "not-a-uuid" }, { ...BODY, expectedHeadId: "nope" }, { ...BODY, expectedHeadId: 7 }, { ...BODY, mode: "delete" },
      { ...BODY, mode: "delivered" }, { ...BODY, reason: 7 }, { ...BODY, reason: "x".repeat(501) }, { ...BODY, expectedShop: B }, noHead, noShop, noReason, noMode]) {
      const res = await POST(post(body), ctx());
      expect([res.status, await code(res)], JSON.stringify(body)).toEqual([400, "invalid_request"]);
    }
    untouched();
  });
  it("an empty reason is the named 400 reason_required, before the password and the database", async () => {
    as("catering_mgr", [], {}); // no unlock: the reason is asked for first
    for (const reason of ["", "   ", null]) {
      const res = await POST(post({ ...BODY, reason }), ctx());
      expect([res.status, await code(res)]).toEqual([400, "reason_required"]);
    }
    untouched();
    expect(parseGratuityCorrection({ ...BODY, reason: " " })).toBe("reason_required");
    expect(parseGratuityCorrection(BODY)).toEqual({ expectedShopId: B, mode: "recompute", expectedHeadId: HEAD, reason: BODY.reason });
  });
  it("a lead id that is not a uuid is a 400, never a query", async () => {
    expect((await POST(post(BODY), ctx("lead"))).status).toBe(400);
    untouched();
  });
});

describe("Tier A: the password, of any age", () => {
  it("without an unlock: 403 step_up_required, zero database work", async () => {
    as("moo", [], {});
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res)]).toEqual([403, "step_up_required"]);
    untouched();
  });
  it("with an unlock of any age (not Tier B's two minutes) it reaches the writer", async () => {
    as("agm", [B], { stepUpUnlocked: true, stepUpUnlockedAt: "2020-01-01T00:00:00Z" });
    expect((await POST(post(BODY), ctx())).status).toBe(200);
    expect(h.fake.calls).toHaveLength(1);
  });
  it("the tier is asserted after the parse: a malformed body is a 400, not a password prompt", async () => {
    as("moo", [], {});
    expect((await POST(post({ ...BODY, mode: "x" }), ctx())).status).toBe(400);
  });
});

describe("who may correct it: the write gate, by trusted ROLE, before any database work", () => {
  it("the prep manager, the social media manager, a key holder, a shift lead, and a GM / AGM of another shop are refused", async () => {
    for (const [role, shops] of [["prep_mgr", [B]], ["social_media_mgr", [B]], ["key_holder", [B]], ["shift_lead", [B]], ["gm", [C]], ["agm", [A]]] as const) {
      as(role, [...shops]);
      const res = await POST(post(BODY), ctx());
      expect([role, res.status, await code(res)]).toEqual([role, 403, "forbidden"]);
    }
    untouched();
  });
  it("the shop's AGM and GM, the catering manager and MoO and up pass", async () => {
    for (const [role, shops] of [["agm", [B]], ["gm", [B]], ["catering_mgr", []], ["moo", []], ["owner", []], ["cgs", []]] as const) {
      as(role, [...shops]); withDb();
      expect([role, (await POST(post(BODY), ctx())).status]).toEqual([role, 200]);
    }
  });
  it("the gate binds to the shop the person SAW: a GM of A naming B is refused before the database", async () => {
    as("gm", [A]);
    expect((await POST(post(BODY), ctx())).status).toBe(403);
    untouched();
  });
  it("off means off: a shop that is turned off refuses 409 delivery_off and the writer is never called", async () => {
    h.off = [B];
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res)]).toEqual([409, "delivery_off"]);
    expect(h.fake.calls).toEqual([]);
  });
});

describe("every refusal is passed through by name", () => {
  const REFUSALS = ["lead_not_found", "shop_moved", "delivery_off", "forbidden", "split_moved", "quote_ambiguous", "no_change", "reason_required", "invalid_request"] as const;
  it.each(REFUSALS)("%s", async (refusal) => {
    withDb(refuse({ code: "P0001", message: refusal }));
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res)]).toEqual([deliveryErrorStatus(refusal), refusal]);
  });
  it("the cases only name refusals the migration raises; a stale head, a moved shop and 'nothing changed' are 409s (the panel reloads)", () => {
    for (const refusal of REFUSALS) expect(DELIVERY_SQL_REFUSALS).toContain(refusal);
    for (const stale of ["split_moved", "shop_moved", "no_change", "quote_ambiguous", "delivery_off"] as const) expect(deliveryErrorStatus(stale)).toBe(409);
    const sql = readFileSync("supabase/migrations/0356_delivery_jobs.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create function public.record_delivery_gratuity_split"), sql.indexOf("create function public.delivery_ready"));
    for (const raised of ["invalid_request", "reason_required", "split_moved", "no_change"]) expect(fn).toContain(`raise exception '${raised}'`);
    expect(fn).toContain("public.delivery_lead_gate(p_actor_id, p_lead_id, p_expected_shop)"); // lead_not_found, shop_moved, delivery_off, forbidden
  });
  it("a double tap that lost the race (23505 on the one-successor index) is split_moved", async () => {
    withDb(refuse({ code: "23505", message: "duplicate key value violates unique constraint" }));
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res)]).toEqual([409, "split_moved"]);
  });
  it("0356 not on the database is 503 delivery_unavailable with Retry-After, never a 500", async () => {
    withDb(refuse({ code: "PGRST202", message: "Could not find the function" }));
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res), res.headers.get("Retry-After")]).toEqual([503, "delivery_unavailable", "60"]);
  });
  it("an unknown failure is a 500 generic; a writer that answers nothing, or a malformed answer, is never a success", async () => {
    withDb(refuse({ code: "XX000", message: "boom" }));
    const res = await POST(post(BODY), ctx());
    expect([res.status, await code(res)]).toEqual([500, "generic"]);
    for (const data of [null, [], { ...SPLIT, kind: "paid" }, { ...SPLIT, split_id: 7 }, { ...SPLIT, driver_cents: "800" }]) {
      withDb({ record_delivery_gratuity_split: () => ({ data }) });
      expect((await POST(post(BODY), ctx())).status).toBe(500);
    }
  });
});
