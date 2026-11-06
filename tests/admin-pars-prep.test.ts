import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const h = vi.hoisted(() => ({ db: vi.fn(), auth: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/session", () => ({ requireSession: h.auth }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/prep-sections.server", () => ({ loadPrepSections: async () => new Map() }));
vi.mock("@/lib/units.server", () => ({ loadUnits: async () => [] }));
import { loadChecklistLocationView } from "@/lib/admin/templates";
import { PATCH } from "@/app/api/admin/checklist-templates/[id]/items/[itemId]/par/route";

const actor = { user: { id: "actor", role: "agm" }, locations: ["shop-a"], session: { stepUpUnlocked: true } } as AuthContext;
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    locations: [{ id: "shop-a", name: "A", code: "A", active: true }, { id: "shop-b", name: "B", code: "B", active: true }],
    checklist_templates: ["a", "b"].map((id) => ({ id: `template-${id}`, name: id, location_id: `shop-${id}`, type: "prep", prep_subtype: "am_prep", active: true, effective_from: null })),
    checklist_template_items: ["a", "b"].map((id) => ({ id: `line-${id}`, template_id: `template-${id}`, item_id: "item", label: "Stale label", active: true, station: null, prep_meta: null, display_order: 1 })),
    items: [{ id: "item", location_id: null, name: "Prep item", name_es: "Preparado", default_par: 5, default_par_unit: "pan", active: true }],
    item_par_levels: ["a", "b"].map((id) => ({ id: `par-${id}`, item_id: "item", location_id: `shop-${id}`, day_of_week: null, par_value: id === "a" ? 7 : 99, par_unit: null, par_mode: "manual", active: true })),
    section_questions: [],
  };
  tables.item_par_levels!.push({ id: "monday", item_id: "item", location_id: "shop-a", day_of_week: 1, par_value: 11, par_unit: null, par_mode: "manual", active: true });
  db = createFakeDb(tables); h.db.mockReturnValue(db.client); h.auth.mockResolvedValue(actor);
});
const write = (template = "template-a", line = "line-a", locationId = "shop-a") => PATCH(new NextRequest("https://fixture.test/api/par", {
  method: "PATCH", headers: { origin: "https://fixture.test", "content-type": "application/json" },
  body: JSON.stringify({ locationId, dayOfWeek: null, parValue: 8, parMode: "manual" }),
}), { params: Promise.resolve({ id: template, itemId: line }) });

it("matches LocationChecklistTab's actual loader context and rereads saved values", async () => {
  const loc = { id: "shop-a", name: "A", code: "A" };
  const prep = await loadChecklistLocationView(actor, loc, "am_prep");
  expect(prep.locationId).toBe("shop-a");
  expect(prep.parContext["line-a"]).toMatchObject({ itemId: "item", recommendedPar: 5, recommendedParUnit: "pan",
    overrides: [{ dayOfWeek: null, parValue: 7, parMode: "manual" }, { dayOfWeek: 1, parValue: 11, parMode: "manual" }] });
  expect(prep.items.map((i) => i.id)).toEqual(["line-a"]);
  expect(prep.parContext["line-a"]?.overrides[0]?.parValue).toBe(7);
  expect((await write()).status).toBe(200);
  expect((await loadChecklistLocationView(actor, loc, "am_prep")).parContext["line-a"]?.overrides.find((o) => o.dayOfWeek === null)?.parValue).toBe(8);
});
it.each([
  ["template-b", "line-b", "shop-a"], ["template-a", "line-b", "shop-a"], ["template-a", "line-a", "shop-b"],
])("refuses cross-shop template/line/binding %s %s %s through the existing route", async (template, line, shop) => {
  expect((await write(template, line, shop)).status).toBe(shop === "shop-b" ? 403 : 404);
  expect(db.writes).toEqual([]);
});
it("preserves the prep floor and Tier A", async () => {
  h.auth.mockResolvedValue({ ...actor, user: { ...actor.user, role: "shift_lead" } });
  expect((await write()).status).toBe(403);
  h.auth.mockResolvedValue({ ...actor, session: { stepUpUnlocked: false } });
  expect((await write()).status).toBe(403);
  expect(db.writes).toEqual([]);
});

it.each(["agm", "prep_mgr", "catering_mgr", "gm"] as const)("prep route: %s edits own shop and refuses another", async (role) => {
  h.auth.mockResolvedValue({ ...actor, user: { ...actor.user, role } });
  expect((await write()).status).toBe(200);
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actorRole: role, action: "item_par.update" }));
  h.db.mockClear();
  expect((await write("template-b", "line-b", "shop-b")).status).toBe(role === "gm" ? 404 : 403);
  expect(h.db).not.toHaveBeenCalled();
});
it("prep route refuses social media manager by role", async () => {
  h.auth.mockResolvedValue({ ...actor, level: 10, user: { ...actor.user, role: "social_media_mgr" } });
  expect((await write()).status).toBe(403); expect(h.db).not.toHaveBeenCalled();
});
