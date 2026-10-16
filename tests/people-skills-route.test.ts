/**
 * Scheduling Phase 1, Task 16 Step 3 — the people routes. POST /api/people/skills (adjust / rate: no
 * step-up, J8; the outer people-view bind, then the lib) and POST /api/people/settings (tunables MoO+ and
 * shop settings, both inside the Tier E window). The actor comes from the session, never the body;
 * payloads are exact; refusals carry their fixed code (`invalid_tunables` names the key).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ fake: true })) }));
vi.mock("@/lib/people/skills", async (original) => ({
  ...await original<typeof import("@/lib/people/skills")>(),
  adjustSkill: vi.fn(async () => ({ id: "ad1" })), rateNewHire: vi.fn(async () => ({ id: "ra1" })),
}));
vi.mock("@/lib/people/tunables", () => ({ saveSkillTunables: vi.fn(async () => ({ id: "t1" })) }));
vi.mock("@/lib/people/settings", () => ({ savePeopleShopSettings: vi.fn(async () => ({ pmV2: false, prepPositionId: null })) }));

const { requireSession } = await import("@/lib/session");
const { assertStepUp } = await import("@/lib/admin/step-up");
const { adjustSkill, rateNewHire, PeopleSkillError } = await import("@/lib/people/skills");
const { saveSkillTunables } = await import("@/lib/people/tunables");
const { savePeopleShopSettings } = await import("@/lib/people/settings");
const skills = await import("@/app/api/people/skills/route");
const settings = await import("@/app/api/people/settings/route");

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const USER = "33333333-3333-4333-8333-333333333333";
const POS = "44444444-4444-4444-8444-444444444444";
const req = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const postSkills = (body: unknown) => skills.POST(req("/api/people/skills", body));
const postSettings = (body: unknown) => settings.POST(req("/api/people/settings", body));
const session = (role: string, level: number, locations = [SHOP]) =>
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor-1" }, role, level, locations, session: {} } as never);
const adjust = { action: "adjust", locationId: SHOP, userId: USER, positionId: POS, delta: 0.1, reasonCode: "observed_on_floor" };

beforeEach(() => {
  vi.clearAllMocks();
  session("gm", 7);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
});

describe("POST /api/people/skills", () => {
  it("adjust and rate call the lib with the SESSION actor; no step-up", async () => {
    const actor = { userId: "actor-1", role: "gm", level: 7, locations: [SHOP] };
    expect((await postSkills({ ...adjust, reasonNote: "covered" })).status).toBe(200);
    expect(adjustSkill).toHaveBeenCalledWith({ fake: true }, { actor, locationId: SHOP, userId: USER, positionId: POS, reasonCode: "observed_on_floor", reasonNote: "covered", delta: 0.1 });
    expect((await postSkills({ action: "rate", locationId: SHOP, userId: USER, positionId: POS, rating: 0.8, reasonCode: "training_completed" })).status).toBe(200);
    expect(rateNewHire).toHaveBeenCalledWith({ fake: true }, expect.objectContaining({ actor, rating: 0.8, reasonNote: null }));
    expect(assertStepUp).not.toHaveBeenCalled();
  });

  it("exact payloads: an unknown key, a missing key, an unknown action, a non-string id → 400 before the lib", async () => {
    for (const body of [{ ...adjust, actorId: "x" }, { ...adjust, reasonCode: undefined }, { ...adjust, action: "delete" }, { ...adjust, userId: 5 }, [adjust]]) {
      expect((await postSkills(body)).status).toBe(400);
    }
    expect(adjustSkill).not.toHaveBeenCalled();
  });

  it("the outer bind: the SMM and another shop's GM are refused 403 before the lib", async () => {
    session("social_media_mgr", 6);
    expect((await postSkills(adjust)).status).toBe(403);
    session("gm", 7, [OTHER]);
    expect((await postSkills(adjust)).status).toBe(403);
    expect(adjustSkill).not.toHaveBeenCalled();
  });

  it("a lib refusal keeps its status and code", async () => {
    vi.mocked(adjustSkill).mockRejectedValueOnce(new PeopleSkillError(400, "invalid_adjustment"));
    const res = await postSkills(adjust);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_adjustment");
  });
});

describe("POST /api/people/settings", () => {
  it("both acts take Tier E; a stale window stops before the lib", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    expect((await postSettings({ action: "tunables", locationId: null, tunables: {} })).status).toBe(403);
    expect((await postSettings({ action: "shop", locationId: SHOP, pmV2: false, prepPositionId: null })).status).toBe(403);
    expect(vi.mocked(assertStepUp).mock.calls.every((c) => c[1] === "E")).toBe(true);
    expect(saveSkillTunables).not.toHaveBeenCalled();
    expect(savePeopleShopSettings).not.toHaveBeenCalled();
  });

  it("tunables: company (null) or a shop; invalid_tunables names the key", async () => {
    session("moo", 8, []);
    expect((await postSettings({ action: "tunables", locationId: null, tunables: { a: 1 } })).status).toBe(200);
    expect(saveSkillTunables).toHaveBeenCalledWith({ fake: true }, { actor: { userId: "actor-1", role: "moo", level: 8, locations: [] }, locationId: null, tunables: { a: 1 } });
    vi.mocked(saveSkillTunables).mockRejectedValueOnce(new PeopleSkillError(400, "invalid_tunables", "bands.strong"));
    const res = await postSettings({ action: "tunables", locationId: SHOP, tunables: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_tunables", key: "bands.strong" });
  });

  it("shop settings: exact payload; the lib gets the session actor", async () => {
    expect((await postSettings({ action: "shop", locationId: SHOP, pmV2: false, prepPositionId: POS })).status).toBe(200);
    expect(savePeopleShopSettings).toHaveBeenCalledWith({ fake: true }, expect.objectContaining({ locationId: SHOP, pmV2: false, prepPositionId: POS }));
    expect((await postSettings({ action: "shop", locationId: SHOP, pmV2: false })).status).toBe(400);
    expect((await postSettings({ action: "shop", locationId: null, pmV2: false, prepPositionId: null })).status).toBe(400);
  });
});
