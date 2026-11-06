import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const h = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), audit: vi.fn(), suggestions: vi.fn(), applied: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: h.task }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => true, parAutoMovesReady: async () => true,
  parSuggestionActionsReady: async () => true, salesSignalsReady: async () => true }));
vi.mock("@/lib/dynamic-pars-walker", () => ({ loadParSuggestions: h.suggestions, loadAppliedAutoMove: h.applied }));
import { PUT } from "@/app/api/admin/skus/[id]/location-settings/route";
import { POST } from "@/app/api/operations/ordering/suggestion/route";
import { upsertLocationSkuSettings } from "@/lib/admin/skus";
import { dismissSuggestion, revertAutoMove, writeParFromSuggestion } from "@/lib/dynamic-pars";
import { etBusinessDate } from "@/lib/counts-shared";
import { etDayFromDate } from "@/lib/et-day-shared";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode = "gm") => ({ user: { id: "fixture-user", role, language: "en" }, level: 10, locations: [SHOP],
  session: { catalogEditUnlockedAt: new Date().toISOString(), stepUpUnlocked: false } }) as AuthContext;
const baseline = { activeOverride: null, weekdayPar: 2, weekendPar: 3 };
const input = () => ({ skuId: "sku", locationId: SHOP, ...baseline, weekdayPar: 4, expected: { ...baseline }, expectedPackEpoch: 2 });
const verdict = () => ({ locationId: SHOP, skuId: "sku", generationId: "fixture-generation",
  dayClass: etDayFromDate(etBusinessDate(new Date().toISOString())).weekend ? "weekend" as const : "weekday" as const });
const request = (body: unknown, method = "PUT", origin = "https://fixture.test") => new NextRequest("https://fixture.test/api/test", {
  method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
const put = (body: unknown = input()) => PUT(request(body), { params: Promise.resolve({ id: "sku" }) });
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = { vendor_items: [{ id: "sku", location_id: null }], locations: [{ id: SHOP, active: true }],
    sku_pack_epochs: [{ sku_id: "sku", location_id: SHOP, epoch: 2 }], par_suggestion_actions: [],
    location_sku_settings: [{ id: "overlay", sku_id: "sku", location_id: SHOP, active_override: null,
      weekday_par: 2, weekend_par: 3, auto_weekday_par: 9, auto_weekend_par: 8 }] };
  db = createFakeDb(tables); h.db.mockReturnValue(db.client); h.session.mockResolvedValue(actor()); h.task.mockResolvedValue(true);
  h.suggestions.mockResolvedValue(new Map([["sku", { generationId: "fixture-generation", suggestedPar: 6, currentPar: 2 }]]));
  h.applied.mockResolvedValue({ applied: true });
});

describe("Pars typed edits reuse the overlay route and real writer", () => {
  it("writes human overrides, preserves activation and the untouched slot, and clears only the edited auto lane", async () => {
    expect((await put()).status).toBe(200);
    expect(tables.location_sku_settings![0]).toMatchObject({ weekday_par: 4, weekend_par: 3, active_override: null,
      auto_weekday_par: null, auto_weekend_par: 8, pinned_weekday_at: null });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "vendor_item.update" }));
  });
  it("refuses a stale expected value without a write", async () => {
    tables.location_sku_settings![0]!.weekend_par = 7;
    const res = await put(); expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ code: "overlay_changed" });
    expect(db.writes).toEqual([]);
  });
  it("refuses a changed pack epoch without a write", async () => {
    tables.sku_pack_epochs![0]!.epoch = 3;
    const res = await put(); expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ code: "overlay_changed" });
    expect(db.writes).toEqual([]);
  });
  it.each([null, "2000-01-01T00:00:00Z"])("requires a live Tier E window (%s)", async (at) => {
    const ctx = actor(); ctx.session.catalogEditUnlockedAt = at; h.session.mockResolvedValue(ctx);
    const res = await put(); expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ code: at ? "step_up_stale" : "step_up_required" });
    expect(h.db).not.toHaveBeenCalled();
  });
  it.each(["social_media_mgr"] as const)("refuses %s by role, even with inflated level, at route and lib", async (role) => {
    h.session.mockResolvedValue(actor(role)); expect((await put()).status).toBe(403);
    await expect(upsertLocationSkuSettings(actor(role), input())).rejects.toMatchObject({ status: 403 });
    expect(db.writes).toEqual([]);
  });
  it("refuses foreign shop and foreign-owned SKU inside the library", async () => {
    await expect(upsertLocationSkuSettings(actor(), { ...input(), locationId: OTHER })).rejects.toMatchObject({ status: 404 });
    tables.vendor_items![0]!.location_id = OTHER;
    await expect(upsertLocationSkuSettings(actor(), input())).rejects.toMatchObject({ status: 404 });
    expect((await put()).status).toBe(404); expect(db.writes).toEqual([]);
  });
  it("keeps expected mandatory and rejects malformed epoch", async () => {
    expect((await put({ ...input(), expected: undefined })).status).toBe(400);
    expect((await put({ ...input(), expectedPackEpoch: -1 })).status).toBe(400);
    expect(db.writes).toEqual([]);
  });
});

describe("Pars suggestion verbs use the walk route and real libraries without step-up", () => {
  it.each(["accept", "dismiss", "revert"] as const)("%s reaches the walk writer and its existing audit vocabulary", async (action) => {
    const ctx = actor(); ctx.session.catalogEditUnlockedAt = null; h.session.mockResolvedValue(ctx);
    const res = await POST(request({ ...verdict(), action, value: 999 }, "POST")); expect(res.status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: action === "revert" ? "par.auto_tune_revert" : `par.suggestion_${action}` }));
    const row = tables.location_sku_settings![0]!;
    const slot = `${verdict().dayClass}_par`;
    if (action === "accept") expect(row[slot]).toBe(6);
    if (action === "dismiss") expect(db.writes.every((w) => w.table === "par_suggestion_actions")).toBe(true);
    if (action === "revert") { expect(row[slot]).toBeNull(); expect(row[`pinned_${verdict().dayClass}_at`]).toBeTruthy(); }
  });
  for (const action of ["accept", "dismiss", "revert"] as const) {
    const callLib = (ctx: AuthContext, locationId = SHOP) => action === "dismiss"
      ? dismissSuggestion(ctx, { ...verdict(), locationId, currentPar: 2 })
      : action === "revert" ? revertAutoMove(ctx, { ...verdict(), locationId, value: null })
        : writeParFromSuggestion({ actor: ctx, actorKind: "accept", ...verdict(), locationId, value: 6 });
    it.each(["agm", "prep_mgr", "catering_mgr", "social_media_mgr"] as const)(`${action} refuses %s at the route and library`, async (role) => {
      h.session.mockResolvedValue(actor(role)); expect((await POST(request({ ...verdict(), action }, "POST"))).status).toBe(403);
      await expect(callLib(actor(role))).rejects.toMatchObject({ status: 403 }); expect(db.writes).toEqual([]);
    });
    it(`${action} refuses foreign shop and foreign-owned SKU at library and route`, async () => {
      await expect(callLib(actor(), OTHER)).rejects.toMatchObject({ status: 404 });
      expect((await POST(request({ ...verdict(), locationId: OTHER, action }, "POST"))).status).toBe(404);
      tables.vendor_items![0]!.location_id = OTHER;
      await expect(callLib(actor())).rejects.toMatchObject({ status: 404 });
      expect((await POST(request({ ...verdict(), action }, "POST"))).status).toBe(404); expect(db.writes).toEqual([]);
    });
  }
  it("refuses a stale generation or a nonexistent applied move", async () => {
    h.applied.mockResolvedValue(null);
    expect((await POST(request({ ...verdict(), action: "revert" }, "POST"))).status).toBe(409);
    expect((await POST(request({ ...verdict(), generationId: "older", action: "accept" }, "POST"))).status).toBe(409);
    expect(db.writes).toEqual([]);
  });
  it("both routes refuse bad origin before auth or reads", async () => {
    expect((await PUT(request(input(), "PUT", "https://other.test"), { params: Promise.resolve({ id: "sku" }) })).status).toBe(403);
    expect((await POST(request({ ...verdict(), action: "accept" }, "POST", "https://other.test"))).status).toBe(403);
    expect(h.session).not.toHaveBeenCalled(); expect(h.db).not.toHaveBeenCalled();
  });
});


it("allows an owner-shop store-copy SKU through the overlay library", async () => {
  tables.vendor_items![0]!.location_id = SHOP;
  await upsertLocationSkuSettings(actor(), input());
  expect(tables.location_sku_settings![0]!.weekday_par).toBe(4);
});

it("accepts a legacy PUT without expectedPackEpoch", async () => {
  const { expectedPackEpoch: _epoch, ...legacy } = input();
  expect((await put(legacy)).status).toBe(200);
  expect(tables.location_sku_settings![0]!.weekday_par).toBe(4);
});

it.each(["accept", "dismiss", "revert"] as const)("allows owner-shop store-copy SKU for %s", async (action) => {
  tables.vendor_items![0]!.location_id = SHOP;
  const res = await POST(request({ ...verdict(), action }, "POST"));
  expect(res.status).toBe(200);
  expect(db.writes.length).toBeGreaterThan(0);
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: action === "revert" ? "par.auto_tune_revert" : `par.suggestion_${action}` }));
});

it("off-here PUT preserves both pars and restores inheritance through the same writer", async () => {
  expect((await put({ ...input(), weekdayPar: 2, activeOverride: false })).status).toBe(200);
  expect(tables.location_sku_settings![0]).toMatchObject({ active_override: false, weekday_par: 2, weekend_par: 3 });
  expect((await put({ ...input(), weekdayPar: 2, activeOverride: null, expected: { ...baseline, activeOverride: false } })).status).toBe(200);
  expect(tables.location_sku_settings![0]).toMatchObject({ active_override: null, weekday_par: 2, weekend_par: 3 });
});
it.each(["social_media_mgr"] as const)("off-here PUT refuses %s", async (role) => {
  h.session.mockResolvedValue(actor(role));
  expect((await put({ ...input(), activeOverride: false })).status).toBe(403);
  expect(db.writes).toEqual([]);
});
it("off-here PUT refuses a missing window, stale snapshot, foreign shop and foreign owner", async () => {
  const ctx = actor(); ctx.session.catalogEditUnlockedAt = null; h.session.mockResolvedValue(ctx);
  expect((await put({ ...input(), activeOverride: false })).status).toBe(403);
  h.session.mockResolvedValue(actor());
  expect((await put({ ...input(), activeOverride: false, expected: { ...baseline, weekdayPar: 99 } })).status).toBe(409);
  expect((await put({ ...input(), activeOverride: false, locationId: OTHER })).status).toBe(404);
  tables.vendor_items![0]!.location_id = OTHER;
  expect((await put({ ...input(), activeOverride: false })).status).toBe(404);
  expect(db.writes).toEqual([]);
});

for (const role of ["agm", "prep_mgr", "catering_mgr", "gm"] as const) {
  it.each(["values", "off", "inherit"] as const)(`${role} edits %s at own shop through Tier E and the human audit lane`, async (kind) => {
    h.session.mockResolvedValue(actor(role));
    const payload = kind === "off" ? { ...input(), activeOverride: false } : kind === "inherit" ? { ...input(), weekdayPar: null, weekendPar: null } : input();
    expect((await put(payload)).status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actorRole: role, actorId: "fixture-user", action: "vendor_item.update" }));
    expect(tables.location_sku_settings![0]).toMatchObject({ weekday_par: payload.weekdayPar, weekend_par: payload.weekendPar, active_override: payload.activeOverride, updated_by: "fixture-user" });
  });
  it.each([null, "2000-01-01T00:00:00Z"])(`${role} retains Tier E refusal (%s)`, async (at) => {
    const ctx = actor(role); ctx.session.catalogEditUnlockedAt = at; h.session.mockResolvedValue(ctx);
    expect((await put()).status).toBe(403); expect(h.db).not.toHaveBeenCalled();
  });
  it(`${role} has the same exclusive 15-minute Tier E boundary`, async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-11-05T15:00:00Z"); vi.setSystemTime(now);
      const ctx = actor(role); ctx.session.catalogEditUnlockedAt = new Date(now.getTime() - 900_000).toISOString(); h.session.mockResolvedValue(ctx);
      expect((await put()).status).toBe(403); expect(h.db).not.toHaveBeenCalled();
      ctx.session.catalogEditUnlockedAt = new Date(now.getTime() - 899_999).toISOString();
      expect((await put()).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
}
