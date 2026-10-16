import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { NextRequest } from "next/server";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[], race: false }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: async () => actor() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));
vi.mock("@/lib/prep-sections.server", () => ({ loadPrepSections: async () => new Map([["prep", { slug: "prep" }]]) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));
const client = { from(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  let update: Record<string, unknown> | undefined;
  let insert: Record<string, unknown> | undefined;
  let single = false;
  const q = {
    select() { return q; }, eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    is(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    in(k: string, v: unknown[]) { filters.push(r => v.includes(r[k])); return q; },
    or(value: string) { const shop = value.split(".eq.")[1]; filters.push(r => r.location_id === null || r.location_id === shop); return q; },
    order() { return q; }, returns() { return q; },
    maybeSingle() { single = true; return q; },
    insert(row: Record<string, unknown>) { insert = row; return q; },
    update(row: Record<string, unknown>) { update = row; return q; },
    then(resolve: (v: unknown) => unknown) {
      if (update && state.race && table === "items") state.rows.items![0]!.location_id = null;
      let rows = (state.rows[table] ?? []).filter(r => filters.every(f => f(r)));
      if (insert) { const row = { id: "new", ...insert }; (state.rows[table] ??= []).push(row); rows = [row]; state.writes.push(table); }
      if (update) for (const row of rows) { Object.assign(row, update); state.writes.push(table); }
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, count: rows.length, error: null }).then(resolve);
    },
  }; return q;
} };
import { addRegistryItem, updateRegistryItemDefinition, promoteItemToGlobal, loadItemRegistry } from "@/lib/admin/templates";
import { POST } from "@/app/api/admin/checklist-templates/registry/route";
import { PATCH } from "@/app/api/admin/checklist-templates/registry/[itemId]/route";
function actor(role: AuthContext["user"]["role"] = "gm", locations = [A]): AuthContext { return { user: { id: "actor", role }, locations } as AuthContext; }
const input = { name: "Sauce", nameEs: null, section: "prep", recommendedPar: null, recommendedParUnit: null, isDefault: false };
beforeEach(() => {
  state.writes = []; state.race = false;
  state.rows = { locations: [{ id: A, active: true }, { id: B, active: true }], items: [{ id: "item", name: "Old", location_id: A, active: true, required: false }] };
});
it("owning GM creates a private item without global propagation", async () => {
  const result = await addRegistryItem(actor(), { ...input, locationId: A });
  expect(result).toEqual({ itemId: "new", propagatedLocationIds: [] });
  expect(state.rows.items!.at(-1)).toMatchObject({ location_id: A, is_default: false });
  expect(state.writes).toEqual(["items"]);
});
it.each([
  ["global GM", "gm", [A], null, "global_requires_moo"],
  ["foreign GM", "gm", [A], B, "not_found"],
  ["ambiguous", "gm", [A, B], undefined, "location_required"],
  ["social", "social_media_mgr", [A], A, "forbidden"],
] as const)("creation rejects %s before writes", async (_name, role, locations, locationId, code) => {
  await expect(addRegistryItem(actor(role, [...locations]), { ...input, locationId })).rejects.toMatchObject({ code });
  expect(state.writes).toEqual([]);
});
it("owned creation refuses default propagation", async () => {
  await expect(addRegistryItem(actor(), { ...input, locationId: A, isDefault: true })).rejects.toMatchObject({ code: "not_global" });
  expect(state.writes).toEqual([]);
});
it("MoO can create a shared definition", async () => {
  await addRegistryItem(actor("moo"), { ...input, locationId: null });
  expect(state.rows.items!.at(-1)).toMatchObject({ location_id: null });
});
it("owning GM edits the definition", async () => {
  await updateRegistryItemDefinition(actor(), { itemId: "item", name: "New" });
  expect(state.rows.items![0]!.name).toBe("New");
});
it("owned definition propagation reaches only its owning shop's existing lines", async () => {
  state.rows.checklist_templates = [{ id: "own", location_id: A }, { id: "foreign", location_id: B }];
  state.rows.checklist_template_items = ["own", "foreign"].map(template_id => ({ id: template_id, template_id, item_id: "item", active: true, required: false, prep_meta: null }));
  await updateRegistryItemDefinition(actor(), { itemId: "item", required: true });
  expect(state.rows.checklist_template_items.map(row => row.required)).toEqual([true, false]);
});
it("promotion succeeds for MoO without memberships and leaves the item shared", async () => {
  await promoteItemToGlobal(actor("moo", []), { itemId: "item" });
  expect(state.rows.items![0]!.location_id).toBeNull();
  expect(state.writes).toEqual(["items"]);
});
it.each([null, B])("GM cannot edit owner %s", async owner => {
  state.rows.items![0]!.location_id = owner;
  await expect(updateRegistryItemDefinition(actor(), { itemId: "item", name: "New" })).rejects.toMatchObject({ code: owner === null ? "global_requires_moo" : "not_found" });
  expect(state.writes).toEqual([]);
});
it("owner changes refuse before any propagation", async () => {
  state.race = true;
  await expect(updateRegistryItemDefinition(actor(), { itemId: "item", required: true })).rejects.toMatchObject({ code: "ownership_changed" });
  expect(state.writes).toEqual([]);
});
it("promotion requires MoO even through direct library calls", async () => {
  await expect(promoteItemToGlobal(actor(), { itemId: "item" })).rejects.toMatchObject({ code: "global_requires_moo" });
  expect(state.writes).toEqual([]);
});
it("promotion binds the observed owner and checks affected rows", async () => {
  state.race = true;
  await expect(promoteItemToGlobal(actor("moo"), { itemId: "item" })).rejects.toMatchObject({ code: "ownership_changed" });
  expect(state.writes).toEqual([]);
});
it("registry keeps old global callers global and includes owner items for explicit shop", async () => {
  state.rows.items!.push({ id: "global", location_id: null, active: true }, { id: "foreign", location_id: B, active: true });
  const sb = client as never;
  expect((await loadItemRegistry(sb)).map(x => x.itemId)).toEqual(["global"]);
  expect((await loadItemRegistry(sb, A)).map(x => x.itemId)).toEqual(["item", "global"]);
});
it("registry POST forwards explicit ownership rather than silently inferring another shop", async () => {
  const req = new NextRequest("http://localhost/api/admin/checklist-templates/registry", { method: "POST", body: JSON.stringify({ ...input, locationId: B }) });
  const res = await POST(req);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ code: "not_found" });
  expect(state.writes).toEqual([]);
});
it("registry POST validates malformed ownership", async () => {
  const req = new NextRequest("http://localhost/api/admin/checklist-templates/registry", { method: "POST", body: JSON.stringify({ ...input, locationId: 1 }) });
  expect((await POST(req)).status).toBe(400);
  expect(state.writes).toEqual([]);
});
it("registry PATCH admits owning GM definition edits", async () => {
  const req = new NextRequest("http://localhost/api/admin/checklist-templates/registry/item", { method: "PATCH", body: JSON.stringify({ name: "From route" }) });
  expect((await PATCH(req, { params: Promise.resolve({ itemId: "item" }) })).status).toBe(200);
  expect(state.rows.items![0]!.name).toBe("From route");
});
