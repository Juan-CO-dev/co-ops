import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { inboundAliasAddress } from "@/lib/admin/inbound-settings-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
import { saveVendorShopAccount, saveInboundAlias } from "@/lib/admin/inbound-settings";
import { POST as accountPost } from "@/app/api/admin/inbound/vendor-accounts/route";
import { POST as aliasPost } from "@/app/api/admin/inbound/aliases/route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const ALIAS = "44444444-4444-4444-8444-444444444444";
const actor = (role: RoleCode) => ({ user: { id: "fixture-actor", role }, locations: [SHOP], level: 10,
  session: { stepUpUnlocked: true } }) as AuthContext;
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = { locations: [{ id: SHOP, active: true }, { id: OTHER, active: true }],
    vendors: [{ id: VENDOR, active: true }], vendor_location_accounts: [], inbound_address_aliases: [] };
  db = createFakeDb(tables); h.db.mockReturnValue(db.client); h.session.mockResolvedValue(actor("moo"));
});

for (const role of ["gm", "moo", "owner", "cgs", "social_media_mgr", "agm"] as const) {
  for (const shop of [SHOP, OTHER]) {
    it(`account library binds ${role} at ${shop}`, async () => {
      const allowed = ["moo", "owner", "cgs"].includes(role) || (role === "gm" && shop === SHOP);
      if (allowed) {
        await saveVendorShopAccount(actor(role), VENDOR, shop, "account-fixture");
        expect(tables.vendor_location_accounts![0]).toMatchObject({ vendor_id: VENDOR, location_id: shop, account_number: "account-fixture", created_by: "fixture-actor" });
        expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "vendor_location_account.save" }));
      } else {
        await expect(saveVendorShopAccount(actor(role), VENDOR, shop, "account-fixture")).rejects.toMatchObject({ status: 403 });
        expect(h.db).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
      }
    });
  }
}
it("account changes preserve creation provenance and the vendor global account", async () => {
  tables.vendor_location_accounts = [{ vendor_id: VENDOR, location_id: SHOP, account_number: "old", created_by: "first-actor" }];
  tables.vendors![0]!.account_number = "legacy";
  await saveVendorShopAccount(actor("gm"), VENDOR, SHOP, "new");
  expect(tables.vendor_location_accounts![0]).toMatchObject({ account_number: "new", created_by: "first-actor", updated_by: "fixture-actor" });
  expect(tables.vendors![0]!.account_number).toBe("legacy");
});
it("inactive shops refuse writes", async () => {
  tables.locations![0]!.active = false;
  await expect(saveVendorShopAccount(actor("gm"), VENDOR, SHOP, "account-fixture")).rejects.toMatchObject({ status: 404 });
  expect(db.writes).toEqual([]);
});
it.each(["gm", "social_media_mgr", "agm"] as const)("alias library refuses %s before I/O", async role => {
  await expect(saveInboundAlias(actor(role), { address: "shop@example.test", lane: "vendor_receipt", locationId: SHOP })).rejects.toMatchObject({ status: 403 });
  expect(h.db).not.toHaveBeenCalled();
});
it("aliases lowercase and soft deactivate without altering receiving addresses", async () => {
  await saveInboundAlias(actor("moo"), { address: "Shop@Example.test", lane: "vendor_receipt", locationId: SHOP });
  expect(tables.inbound_address_aliases![0]).toMatchObject({ address: "shop@example.test", active: true, location_id: SHOP });
  tables.inbound_address_aliases![0]!.id = ALIAS;
  await saveInboundAlias(actor("moo"), { id: ALIAS, remove: true });
  expect(tables.inbound_address_aliases![0]!.active).toBe(false);
  expect(db.writes.every(write => write.table !== "locations")).toBe(true);
});
it("catering must have no shop; vendor alias must have an active shop", async () => {
  await expect(saveInboundAlias(actor("moo"), { address: "food@example.test", lane: "catering", locationId: SHOP })).rejects.toMatchObject({ status: 400 });
  await expect(saveInboundAlias(actor("moo"), { address: "food@example.test", lane: "vendor_receipt", locationId: null })).rejects.toMatchObject({ status: 400 });
  expect(db.writes).toEqual([]);
});
it.each(["bad", "<shop@example.test>", "a b@example.test", "a@localhost", "a@example.test\r\nBCC: b@example.test"])("refuses invalid address %s", value => {
  expect(inboundAliasAddress(value)).toBeNull();
});
const request = (body: unknown, origin = "https://fixture.test") => new NextRequest("https://fixture.test/api/admin/inbound", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("routes enforce origin and step-up before mutation", async () => {
  expect((await accountPost(request({}, "https://other.test"))).status).toBe(403);
  expect(h.session).not.toHaveBeenCalled();
  h.session.mockResolvedValue({ ...actor("moo"), session: { stepUpUnlocked: false } });
  expect((await aliasPost(request({}))).status).toBe(403);
  expect(h.db).not.toHaveBeenCalled();
});
it("routes keep the own-shop bind with an inflated level", async () => {
  h.session.mockResolvedValue(actor("gm"));
  expect((await accountPost(request({ vendorId: VENDOR, locationId: OTHER, accountNumber: "account-fixture" }))).status).toBe(403);
  expect(h.db).not.toHaveBeenCalled();
});
it("admin inbound keys have matching Spanish keys and placeholders", () => {
  const keys = Object.keys(en).filter(key => key.startsWith("admin.inbound."));
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    const english = en[key as keyof typeof en];
    const spanish = es[key as keyof typeof es];
    expect(spanish).toBeTruthy();
    expect(spanish.match(/\{\w+\}/g) ?? []).toEqual(english.match(/\{\w+\}/g) ?? []);
  }
});
