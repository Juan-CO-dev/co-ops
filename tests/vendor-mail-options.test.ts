import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
const client = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: client }));
import { vendorMailOptions } from "@/lib/vendor-mail-options";
type Row = Record<string, unknown>;
function setup(role = "gm", active = true) {
  const tables: Record<string, Row[]> = {
    users: [{ id: "actor", role, active, name: "Manager", email: "manager@example.test" }, { id: "mine", name: "My staff", active: true, email: "mine@example.test" }, { id: "other", name: "Other staff", active: true, email: "other@example.test" }],
    user_locations: [{ user_id: "actor", location_id: "shop-a", active: true }, { user_id: "mine", location_id: "shop-a", active: true }, { user_id: "other", location_id: "shop-b", active: true }],
    locations: [{ id: "shop-a", name: "A" }, { id: "shop-b", name: "B" }], vendors: [{ id: "vendor", name: "Vendor" }],
  };
  client.mockImplementation(() => ({ from(table: string) {
    const predicates: ((row: Row) => boolean)[] = []; let single = false;
    const query = { select: () => query, order: () => query, range: () => query,
      eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return query; },
      in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return query; },
      maybeSingle() { single = true; return query; },
      then(resolve: (value: unknown) => unknown) { const rows = (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row))); return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); },
    }; return query;
  } }));
}
const ctx = (role: RoleCode = "gm") => ({ user: { id: "actor", role, active: true } }) as AuthContext;
beforeEach(() => client.mockReset());
it.each(["agm", "prep_mgr", "social_media_mgr", "shift_lead"] as RoleCode[])("rejects %s before loading staff contacts", async role => {
  await expect(vendorMailOptions(ctx(role))).rejects.toMatchObject({ status: 403 }); expect(client).not.toHaveBeenCalled();
});
it("fresh membership scope keeps other-shop staff contacts off the GM page", async () => {
  setup(); const result = await vendorMailOptions(ctx());
  expect(result.shops.map(row => row.id)).toEqual(["shop-a"]);
  expect(result.staff.map(row => row.id)).toEqual(["actor", "mine"]);
  expect(JSON.stringify(result)).not.toContain("other@example.test");
  expect(result.staff.find(row => row.id === "mine")).toMatchObject({ email: "mine@example.test", locations: ["shop-a"] });
});
it("rechecks deactivation and role changes against the current row", async () => {
  setup("gm", false); await expect(vendorMailOptions(ctx())).rejects.toMatchObject({ status: 403 });
  setup("agm"); await expect(vendorMailOptions(ctx())).rejects.toMatchObject({ status: 403 });
});
it("level-8 role sees both shops and their eligible recipients", async () => {
  setup("moo"); const result = await vendorMailOptions(ctx("moo")); expect(result.shops).toHaveLength(2); expect(result.staff).toHaveLength(3);
});
