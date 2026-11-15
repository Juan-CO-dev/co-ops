/**
 * W15 — publishTemplateVersion through the real library over the in-memory fake DB.
 *   B082: an added line linked to ANOTHER shop's fridge is refused before anything is written.
 *   B083: a publish from a version that is no longer the lineage head is refused (stale_source).
 *   B022: the copy gives every copied row an explicit id and hands the old→new map to the
 *         activation RPC, which moves the fridge pointers (0320).
 *   0320 fallback: before 0320 is applied (function missing) the publish still works the old way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { planQuickAddTargets } from "@/lib/admin/template-builder-shared";

const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), sync: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/closing-stations", () => ({ syncStationsFromClosing: h.sync }));
vi.mock("@/lib/midshift", () => ({ operationalNow: () => ({ date: "2026-11-15" }) }));
import { publishTemplateVersion } from "@/lib/admin/template-builder";

const SHOP = "shop-a", OTHER = "shop-b";
const actor = { user: { id: "gm-1", role: "gm", language: "en" }, level: 7, locations: [SHOP] } as unknown as AuthContext;

function tpl(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: "Closing", type: "closing", location_id: SHOP, prep_subtype: null, description: null,
    single_submission_only: false, reminder_time: null, submission_gate_predicate: null, edit_gate_predicate: null,
    active: true, effective_from: "2026-01-01", created_at: "2026-01-01T00:00:00Z", ...over,
  };
}
function item(id: string, templateId: string, over: Record<string, unknown> = {}) {
  return {
    id, template_id: templateId, station: "Line", display_order: 1, label: id, description: null,
    min_role_level: 3, required: true, expects_count: false, expects_photo: false, item_id: null,
    vendor_item_id: null, equipment_id: null, active: true, translations: null, prep_meta: null,
    report_reference_type: null, references_template_item_id: null, hard_gate: false,
    ref_track_item_completion: false, input_type: null, ...over,
  };
}

let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    checklist_templates: [tpl("v1")],
    checklist_template_items: [
      item("c1", "v1", { expects_count: true, equipment_id: "fridge-a", label: "Fridge 1 temp" }),
      item("c2", "v1", { display_order: 2, label: "Wipe slicer" }),
    ],
    checklist_instances: [],
    maintenance_equipment: [
      { id: "fridge-a", location_id: SHOP, active: true, kind: "fridge", closing_temp_item_id: "c1", opening_temp_item_id: null },
      { id: "fridge-b", location_id: OTHER, active: true, kind: "fridge", closing_temp_item_id: null, opening_temp_item_id: null },
    ],
  };
  db = createFakeDb(tables);
  h.db.mockReturnValue({ from: db.client.from, rpc: h.rpc });
  // Default: 0320 is applied and the activation succeeds.
  h.rpc.mockResolvedValue({ data: { retired: [], pointers_moved: 1, currently_effective: "v1" }, error: null });
});

const quickAdd = (equipmentId: string) => ({
  op: "add" as const, tempId: "t1", displayOrder: 3, label: "Fridge 2 temp", station: "Line",
  minRoleLevel: 3, required: true, expectsCount: true, spineLink: { kind: "equipment" as const, id: equipmentId },
});

describe("W15/B082 an equipment add must be this shop's fridge", () => {
  it("publish refuses a quick-add linked to another shop's fridge and writes nothing", async () => {
    await expect(publishTemplateVersion(actor, { templateId: "v1", edits: [quickAdd("fridge-b")], effectiveMode: "next_day" }))
      .rejects.toMatchObject({ status: 400, code: "equipment_location_mismatch" });
    expect(db.writes).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("an unknown or retired fridge is invalid_target", async () => {
    tables.maintenance_equipment!.push({ id: "fridge-old", location_id: SHOP, active: false, kind: "fridge" });
    await expect(publishTemplateVersion(actor, { templateId: "v1", edits: [quickAdd("fridge-old")], effectiveMode: "next_day" }))
      .rejects.toMatchObject({ status: 400, code: "invalid_target" });
    expect(db.writes).toEqual([]);
  });

  it("a same-shop fridge add publishes", async () => {
    const out = await publishTemplateVersion(actor, { templateId: "v1", edits: [quickAdd("fridge-a")], effectiveMode: "next_day" });
    expect(out.newTemplateId).toBeTruthy();
    const added = tables.checklist_template_items!.find((r) => r.template_id === out.newTemplateId && r.label === "Fridge 2 temp");
    expect(added).toMatchObject({ equipment_id: "fridge-a" });
  });
});

describe("W15/B082 planQuickAddTargets (owner decision W15-3)", () => {
  const templates = [{ id: "tA", locationId: SHOP }, { id: "tB", locationId: OTHER }, { id: "tC", locationId: "shop-c" }];
  const loc = (id: string) => ({ "fridge-a": SHOP, "fridge-b": OTHER, "fridge-c": "shop-c" } as Record<string, string>)[id] ?? null;
  const base = { label: "Temp", station: null, minRoleLevel: 3, required: true, expectsCount: true, spineLink: { kind: "equipment" as const, id: "fridge-a" } };

  it("a fridge-linked add with every shop on goes only to the fridge's shop when no other fridge is picked", () => {
    expect(planQuickAddTargets({ base, allShops: true, activeTemplateId: "tA", templates, equipmentLocationOf: loc }))
      .toEqual([{ templateId: "tA", base }]);
  });

  it("each other shop gets its own line with ITS fridge when the manager picks one (any number of shops)", () => {
    const out = planQuickAddTargets({ base, allShops: true, activeTemplateId: "tA", templates, equipmentLocationOf: loc,
      otherShopLinks: { tB: { kind: "equipment", id: "fridge-b" }, tC: { kind: "equipment", id: "fridge-c" } } });
    expect(out.map((o) => [o.templateId, o.base.spineLink])).toEqual([
      ["tA", { kind: "equipment", id: "fridge-a" }],
      ["tB", { kind: "equipment", id: "fridge-b" }],
      ["tC", { kind: "equipment", id: "fridge-c" }],
    ]);
  });

  it("a pick that is not that shop's fridge is dropped, never cross-linked", () => {
    const out = planQuickAddTargets({ base, allShops: true, activeTemplateId: "tA", templates, equipmentLocationOf: loc,
      otherShopLinks: { tB: { kind: "equipment", id: "fridge-a" } } });
    expect(out.map((o) => o.templateId)).toEqual(["tA"]);
  });

  it("an item-linked add still fans out to every shop", () => {
    const itemBase = { ...base, spineLink: { kind: "item" as const, id: "item-1" } };
    expect(planQuickAddTargets({ base: itemBase, allShops: true, activeTemplateId: "tA", templates, equipmentLocationOf: loc })
      .map((o) => o.templateId)).toEqual(["tA", "tB", "tC"]);
  });

  it("this-shop-only stays on the active template", () => {
    expect(planQuickAddTargets({ base, allShops: false, activeTemplateId: "tA", templates, equipmentLocationOf: loc })
      .map((o) => o.templateId)).toEqual(["tA"]);
  });
});

describe("W15/B083 a publish from an out-of-date screen is refused", () => {
  beforeEach(() => {
    tables.checklist_templates!.push(tpl("v2", { effective_from: "2026-11-16", created_at: "2026-11-15T10:00:00Z", supersedes_template_id: "v1" }));
    tables.checklist_template_items!.push(item("c1b", "v2", { expects_count: true, equipment_id: "fridge-a" }));
  });

  it("publishing from a version that is no longer the lineage head is 409 stale_source and writes nothing", async () => {
    await expect(publishTemplateVersion(actor, { templateId: "v1", edits: [{ op: "relabel", itemId: "c2", label: "B" }], effectiveMode: "next_day" }))
      .rejects.toMatchObject({ status: 409, code: "stale_source" });
    expect(db.writes).toEqual([]);
    expect(tables.checklist_templates!.find((t) => t.id === "v2")).toMatchObject({ active: true });
  });

  it("publishing from the pending head still works (it replaces it)", async () => {
    const out = await publishTemplateVersion(actor, { templateId: "v2", edits: [], effectiveMode: "next_day" });
    expect(h.rpc).toHaveBeenCalledWith("checklist_template_activate_version", expect.objectContaining({ p_source: "v2", p_new: out.newTemplateId }));
  });

  it("the activation RPC's own stale_source (a race the early check missed) is a 409 too", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "stale_source" } });
    await expect(publishTemplateVersion(actor, { templateId: "v2", edits: [], effectiveMode: "next_day" }))
      .rejects.toMatchObject({ status: 409, code: "stale_source" });
  });
});

describe("W15/B022 the publish hands the old → new item map to the activation (0320)", () => {
  it("every copied row gets an explicit id and the map names it", async () => {
    const out = await publishTemplateVersion(actor, { templateId: "v1", edits: [quickAdd("fridge-a")], effectiveMode: "next_day" });
    const call = h.rpc.mock.calls[0]![1] as { p_item_map: Record<string, string>; p_apply_now: boolean; p_today: string };
    const copies = tables.checklist_template_items!.filter((r) => r.template_id === out.newTemplateId);
    const c1Copy = copies.find((r) => r.label === "Fridge 1 temp")!;
    expect(call.p_item_map).toEqual({ c1: c1Copy.id, c2: copies.find((r) => r.label === "Wipe slicer")!.id });
    expect(c1Copy.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call).toMatchObject({ p_apply_now: false, p_today: "2026-11-15" });
    // The RPC owns retirement + activation: nothing else was flipped by the app.
    expect(tables.checklist_templates!.find((t) => t.id === "v1")).toMatchObject({ active: true });
  });

  it("apply-now refused by the RPC under its lock is the same 409 the early gate gives", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "apply_now_blocked_open_instance" } });
    await expect(publishTemplateVersion(actor, { templateId: "v1", edits: [], effectiveMode: "apply_now" }))
      .rejects.toMatchObject({ status: 409, code: "apply_now_blocked_open_instance" });
  });

  it("before 0320 is applied (function missing) the publish falls back and still moves the pointer", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.checklist_template_activate_version" } });
    const out = await publishTemplateVersion(actor, { templateId: "v1", edits: [], effectiveMode: "next_day" });
    expect(tables.checklist_templates!.find((t) => t.id === out.newTemplateId)).toMatchObject({ active: true });
    expect(tables.checklist_templates!.find((t) => t.id === "v1")).toMatchObject({ active: true });
    const c1Copy = tables.checklist_template_items!.find((r) => r.template_id === out.newTemplateId && r.label === "Fridge 1 temp")!;
    expect(tables.maintenance_equipment!.find((m) => m.id === "fridge-a")).toMatchObject({ closing_temp_item_id: c1Copy.id });
    expect(tables.maintenance_equipment!.find((m) => m.id === "fridge-b")).toMatchObject({ closing_temp_item_id: null });
  });
});
