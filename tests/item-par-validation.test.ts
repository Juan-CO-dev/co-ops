/**
 * W15/B089: typing "1,5" or "abc" in the prep par grid sent NaN → null, and a Manual
 * par with null deactivated the old par row and wrote par_value NULL, silently erasing
 * that day's par. The grid now parses with the shared decimal rule, the route refuses
 * a non-number, and setItemPar refuses a Manual par with no number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { parGridSaveValue } from "@/lib/admin/par-grid-shared";

const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => true }));
import { setItemPar } from "@/lib/admin/templates";
import { PATCH } from "@/app/api/admin/checklist-templates/[id]/items/[itemId]/par/route";

describe("parGridSaveValue (the grid's save decision)", () => {
  it("'1,5' saves 1.5 (decimal comma)", () => {
    expect(parGridSaveValue({ parMode: "manual", parValue: "1,5" })).toEqual({ ok: true, parValue: 1.5 });
  });
  it("'abc' is refused, never sent as null", () => {
    expect(parGridSaveValue({ parMode: "manual", parValue: "abc" })).toEqual({ ok: false, code: "invalid_par" });
    expect(parGridSaveValue({ parMode: "auto", parValue: "abc" })).toEqual({ ok: false, code: "invalid_par" });
  });
  it("a sign, a fraction or a bare point is refused", () => {
    for (const v of ["-1", "1/2", "."]) expect(parGridSaveValue({ parMode: "manual", parValue: v })).toMatchObject({ ok: false });
  });
  it("'5.' saves 5", () => {
    expect(parGridSaveValue({ parMode: "manual", parValue: "5." })).toEqual({ ok: true, parValue: 5 });
  });
  it("a blank Manual is refused; a blank Auto still sends null", () => {
    expect(parGridSaveValue({ parMode: "manual", parValue: "  " })).toEqual({ ok: false, code: "invalid_par" });
    expect(parGridSaveValue({ parMode: "auto", parValue: "" })).toEqual({ ok: true, parValue: null });
  });
  it("inherit sends null whatever is in the box", () => {
    expect(parGridSaveValue({ parMode: "inherit", parValue: "abc" })).toEqual({ ok: true, parValue: null });
  });
});

const actor = { user: { id: "fixture-actor", role: "gm", language: "en" }, level: 7, locations: ["shop-a"],
  session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    locations: [{ id: "shop-a", active: true }],
    checklist_templates: [{ id: "template-a", location_id: "shop-a", type: "prep", prep_subtype: "am_prep", active: true }],
    checklist_template_items: [{ id: "line-a", template_id: "template-a", active: true, item_id: "item" }],
    item_par_levels: [{ id: "par-1", item_id: "item", location_id: "shop-a", day_of_week: null, par_value: 2, par_mode: "manual", active: true }],
  };
  db = createFakeDb(tables); h.db.mockReturnValue(db.client);
  h.session.mockResolvedValue(actor);
});

describe("setItemPar / the par route refuse a par with no number", () => {
  it("a manual par with an empty value is 400 invalid_par and the old par row stays active", async () => {
    await expect(setItemPar(actor, { templateId: "template-a", lineItemId: "line-a", locationId: "shop-a",
      dayOfWeek: null, parValue: null, parUnit: null, parMode: "manual" })).rejects.toMatchObject({ status: 400, code: "invalid_par" });
    expect(db.writes).toEqual([]);
    expect(tables.item_par_levels![0]).toMatchObject({ active: true, par_value: 2 });
  });

  it("the route refuses a non-numeric parValue with 400 invalid_par and writes nothing", async () => {
    const res = await PATCH(new NextRequest("https://fixture.test/api/admin/checklist-templates/template-a/items/line-a/par", {
      method: "PATCH", headers: { origin: "https://fixture.test", "content-type": "application/json" },
      body: JSON.stringify({ locationId: "shop-a", dayOfWeek: null, parValue: "1,5", parMode: "manual" }),
    }), { params: Promise.resolve({ id: "template-a", itemId: "line-a" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_par");
    expect(db.writes).toEqual([]);
  });

  it("a manual par with a number still saves (regression)", async () => {
    await setItemPar(actor, { templateId: "template-a", lineItemId: "line-a", locationId: "shop-a",
      dayOfWeek: null, parValue: 1.5, parUnit: null, parMode: "manual" });
    expect(db.writes.length).toBeGreaterThan(0);
  });
});
