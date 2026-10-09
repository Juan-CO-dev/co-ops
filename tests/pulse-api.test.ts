/**
 * /api/pulse/* gates: the flag (404 when off), section/location shape, the role matrix and the
 * location bind — all BEFORE the loader runs; writes reach their lib only past the same gates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), loadSection: vi.fn(), saveLayout: vi.fn(), create: vi.fn(), ack: vi.fn(), supersede: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/pulse/sections", () => ({ pulseDeps: () => ({}), loadPulseSection: mocks.loadSection, SECTION_DEADLINE_MS: 7_000 }));
vi.mock("@/lib/pulse/layout", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pulse/layout")>()), saveStationLayout: mocks.saveLayout }));
vi.mock("@/lib/pulse/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pulse/handoff")>()),
  createHandoffNote: mocks.create, ackHandoffNote: mocks.ack, supersedeHandoffNote: mocks.supersede,
}));

import { GET as sectionGet } from "@/app/api/pulse/section/route";
import { POST as layoutPost } from "@/app/api/pulse/layout/route";
import { POST as handoffPost } from "@/app/api/pulse/handoff/route";
import { HandoffError } from "@/lib/pulse/handoff";
import { LayoutError } from "@/lib/pulse/layout";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ctx = (level: number, locations = [SHOP]) => ({ user: { id: "u1", role: "employee", language: "en" }, role: level >= 7 ? "gm" : level >= 4 ? "key_holder" : "employee", level, locations });
const get = (qs: string) => sectionGet(new NextRequest(`https://x.test/api/pulse/section?${qs}`));
const post = (fn: typeof layoutPost, body: unknown) => fn(new NextRequest("https://x.test/api/pulse/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PULSE_V2", "1");
  mocks.session.mockResolvedValue(ctx(7));
  mocks.loadSection.mockResolvedValue({ state: "ok", asOf: "2026-10-09T19:30:00Z", data: { hello: 1 } });
  mocks.saveLayout.mockResolvedValue({ saved: 2 });
  mocks.create.mockResolvedValue({ id: "n1" });
  mocks.ack.mockResolvedValue({ changed: true });
  mocks.supersede.mockResolvedValue({ changed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/pulse/section", () => {
  it("404 while the flag is off, before any loader call", async () => {
    vi.stubEnv("PULSE_V2", "");
    expect((await get(`section=sales&location=${SHOP}`)).status).toBe(404);
    expect(mocks.loadSection).not.toHaveBeenCalled();
  });
  it("400 on an unknown section or a non-uuid location", async () => {
    expect((await get(`section=money&location=${SHOP}`)).status).toBe(400);
    expect((await get(`section=sales&location=all`)).status).toBe(400);
    expect(mocks.loadSection).not.toHaveBeenCalled();
  });
  it("403 for crew asking for sales/people/inventory (catering timing is theirs, Astra #11); 403 for a shop not theirs", async () => {
    mocks.session.mockResolvedValue(ctx(3));
    for (const s of ["sales", "people", "inventory"]) expect((await get(`section=${s}&location=${SHOP}`)).status).toBe(403);
    expect((await get(`section=catering&location=${SHOP}`)).status).toBe(200);
    mocks.loadSection.mockClear();
    mocks.session.mockResolvedValue(ctx(7, [OTHER]));
    expect((await get(`section=sales&location=${SHOP}`)).status).toBe(403);
    expect(mocks.loadSection).not.toHaveBeenCalled();
  });
  it("a level-1 account is refused even for the attention list", async () => {
    mocks.session.mockResolvedValue(ctx(1));
    expect((await get(`section=attention&location=${SHOP}`)).status).toBe(403);
  });
  it("200 with the section state, never cached; crew may read their stations", async () => {
    const res = await get(`section=sales&location=${SHOP}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ section: "sales", state: "ok", asOf: "2026-10-09T19:30:00Z", data: { hello: 1 } });
    expect(mocks.loadSection).toHaveBeenCalledWith({}, expect.objectContaining({ locationId: SHOP, auth: expect.objectContaining({ level: 7 }) }), "sales");
    mocks.session.mockResolvedValue(ctx(3));
    expect((await get(`section=stations&location=${SHOP}`)).status).toBe(200);
  });
  it("Astra #5: a level-8 moo assigned to the other shop reads this shop's pulse (pulse read grant); a GM of the other shop still cannot", async () => {
    mocks.session.mockResolvedValue({ ...ctx(8, [OTHER]), role: "moo" });
    expect((await get(`section=sales&location=${SHOP}`)).status).toBe(200);
    mocks.session.mockResolvedValue(ctx(7, [OTHER]));
    expect((await get(`section=sales&location=${SHOP}`)).status).toBe(403);
  });
  it("level 9 reads any shop (the all-locations grant)", async () => {
    mocks.session.mockResolvedValue({ ...ctx(9, []), role: "owner" });
    expect((await get(`section=sales&location=${SHOP}`)).status).toBe(200);
  });
});

describe("POST /api/pulse/layout", () => {
  it("404 off-flag; 400 bad body; lib errors map to their status; 200 passes the viewer + layout through", async () => {
    vi.stubEnv("PULSE_V2", "");
    expect((await post(layoutPost, { locationId: SHOP, layout: {} })).status).toBe(404);
    vi.stubEnv("PULSE_V2", "1");
    expect((await post(layoutPost, { layout: {} })).status).toBe(400);
    mocks.saveLayout.mockRejectedValueOnce(new LayoutError(403, "role_insufficient"));
    expect((await post(layoutPost, { locationId: SHOP, layout: {} })).status).toBe(403);
    const res = await post(layoutPost, { locationId: SHOP, layout: { a: { x: 1, y: 2 } } });
    expect(res.status).toBe(200);
    expect(mocks.saveLayout).toHaveBeenLastCalledWith({}, expect.objectContaining({ level: 7 }), expect.objectContaining({ locationId: SHOP, layout: { a: { x: 1, y: 2 } } }));
  });
});

describe("POST /api/pulse/handoff", () => {
  it("404 off-flag; 400 on a bad action/audience; create/ack/supersede reach their lib with the session", async () => {
    vi.stubEnv("PULSE_V2", "");
    expect((await post(handoffPost, { locationId: SHOP, action: "create", audience: "all", body: "x" })).status).toBe(404);
    vi.stubEnv("PULSE_V2", "1");
    expect((await post(handoffPost, { locationId: SHOP, action: "shout" })).status).toBe(400);
    expect((await post(handoffPost, { locationId: SHOP, action: "create", audience: "everyone", body: "x" })).status).toBe(400);
    expect((await post(handoffPost, { locationId: SHOP, action: "create", audience: "crew", body: "Fryer 2 is down" })).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({}, expect.objectContaining({ level: 7 }), expect.objectContaining({ locationId: SHOP, audience: "crew", body: "Fryer 2 is down", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect((await post(handoffPost, { locationId: SHOP, action: "ack", noteId: "n1" })).status).toBe(200);
    expect((await post(handoffPost, { locationId: SHOP, action: "supersede", noteId: "n1" })).status).toBe(200);
  });
  it("lib refusals keep their status; an unapplied 0240 is a 503", async () => {
    mocks.create.mockRejectedValueOnce(new HandoffError(403, "role_insufficient"));
    expect((await post(handoffPost, { locationId: SHOP, action: "create", audience: "all", body: "x" })).status).toBe(403);
    const { PulseNotInstalledError } = await import("@/lib/pulse/handoff");
    mocks.ack.mockRejectedValueOnce(new PulseNotInstalledError("pulse_handoff_acks"));
    expect((await post(handoffPost, { locationId: SHOP, action: "ack", noteId: "n1" })).status).toBe(503);
  });
});
