import { describe, expect, it } from "vitest";
import { buildShopOwnedFixture, OWNED } from "./fixtures/shop-owned-fixture";
import { migratedShopOwnedDb, SHOP_OWNED_ID } from "./fixtures/shop-owned-pglite";

describe("shop-owned PGlite fixture", () => {
  it("runs the committed 0258-0263 chain and seeds a two-shop catalog", async () => {
    const db = await migratedShopOwnedDb();
    try {
      const shops = await db.query<{ id: string }>("select id from public.locations order by id");
      expect(shops.rows.map((row) => row.id)).toEqual([SHOP_OWNED_ID.shopA, SHOP_OWNED_ID.shopB]);
      expect((await db.query("select 1 from public.menu_item_shop_settings limit 0")).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("preserves product identity constraints and generated metadata", async () => {
    const db = await migratedShopOwnedDb();
    try {
      const product = await db.query<{ id: string }>("insert into public.products(name) values ('Fixture product') returning id");
      const productId = product.rows[0]!.id;
      await db.query("update public.vendor_items set product_id = $1 where id = $2", [productId, SHOP_OWNED_ID.sharedSku]);
      const primary = await db.query<{ id: string; created_at: string; updated_at: string }>(
        "insert into public.product_primaries(product_id, location_id, primary_sku_id, note, updated_by) values ($1, null, $2, 'fixture', $3) returning id, created_at, updated_at",
        [productId, SHOP_OWNED_ID.sharedSku, SHOP_OWNED_ID.actor],
      );
      expect(primary.rows[0]).toMatchObject({ id: expect.any(String), created_at: expect.anything(), updated_at: expect.anything() });

      const before = (await db.query<{ n: number }>("select count(*)::int as n from public.product_primaries")).rows[0]!.n;
      await expect(db.query("insert into public.products(name) values ('FIXTURE PRODUCT')"))
        .rejects.toMatchObject({ code: "23505", constraint: "products_name_lower_uq" });
      await expect(db.query("insert into public.product_primaries(product_id, location_id, primary_sku_id) values ($1, null, $2)", [productId, SHOP_OWNED_ID.sharedSku]))
        .rejects.toMatchObject({ code: "23505", constraint: "product_primaries_scope_uq" });
      const other = await db.query<{ id: string }>("insert into public.products(name) values ('Other product') returning id");
      await expect(db.query("insert into public.product_primaries(product_id, location_id, primary_sku_id) values ($1, $2, $3)", [other.rows[0]!.id, SHOP_OWNED_ID.shopA, SHOP_OWNED_ID.sharedSku]))
        .rejects.toMatchObject({ code: "23503", constraint: "product_primaries_member_fk" });
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.product_primaries")).rows[0]!.n).toBe(before);

      const scoped = await db.query<{ id: string; location_id: string }>(
        "insert into public.product_primaries(product_id, location_id, primary_sku_id) values ($1, $2, $3) returning id, location_id",
        [productId, SHOP_OWNED_ID.shopA, SHOP_OWNED_ID.sharedSku],
      );
      expect(scoped.rows[0]).toMatchObject({ id: expect.any(String), location_id: SHOP_OWNED_ID.shopA });
    } finally {
      await db.close();
    }
  });

  it("generates IDs for every catalog entity the real writers create", async () => {
    const db = await migratedShopOwnedDb();
    try {
      const rows = await db.query<{ product_id: string; sku_id: string; item_id: string; menu_id: string; recipe_id: string }>(`
        with p as (insert into public.products(name) values ('Generated product') returning id),
        s as (insert into public.vendor_items(name, created_by, updated_by) values ('Generated SKU', '${SHOP_OWNED_ID.actor}', '${SHOP_OWNED_ID.actor}') returning id),
        i as (insert into public.items(name, section, default_par, required, created_by) values ('Generated prep', 'prep', 2, true, '${SHOP_OWNED_ID.actor}') returning id),
        m as (insert into public.menu_items(name, section, menu_price, created_by) values ('Generated sandwich', 'Subs', 11, '${SHOP_OWNED_ID.actor}') returning id),
        r as (insert into public.recipes(name, recipe_type, batch_yield, created_by) values ('Generated recipe', 'consumer', 1, '${SHOP_OWNED_ID.actor}') returning id)
        select p.id product_id, s.id sku_id, i.id item_id, m.id menu_id, r.id recipe_id from p, s, i, m, r`);
      for (const id of Object.values(rows.rows[0]!)) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await db.close();
    }
  });
});


describe("shop-owned consumer fixture ownership", () => {
  it("omits ownership consistently on all legacy entity rows", () => {
    const tables = buildShopOwnedFixture(false);
    for (const table of ["vendor_items", "items", "recipes", "menu_items"]) {
      expect(tables[table]!.length).toBeGreaterThan(0);
      for (const row of tables[table]!) expect(row).not.toHaveProperty("location_id");
    }
  });

  it("keeps every owned input component in its recipe's owner shop", () => {
    const tables = buildShopOwnedFixture();
    const recipes = tables.recipes!.filter(row => row.location_id != null);
    expect(recipes).toHaveLength(OWNED.length * 2);
    for (const recipe of recipes) {
      const lines = tables.recipe_inputs!.filter(row => row.recipe_id === recipe.id);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const components = [
          ...tables.vendor_items!.filter(row => row.id === line.component_sku_id),
          ...tables.items!.filter(row => row.id === line.component_item_id),
        ];
        expect(components).toHaveLength(1);
        expect(components[0]!.location_id).toBe(recipe.location_id);
      }
    }
  });
});
