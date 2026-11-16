/**
 * W23/B128 — a catering-only item could not be switched off the catering menu: the PATCH
 * { cateringAvailable: false } on a row with catering_only = true re-derived available = true from
 * "only", returned 200 and changed nothing. The explicit change now wins (switching off drops
 * catering-only); catering-only still implies available; a contradictory payload is a 400.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture } from "./fixtures/shop-owned-fixture";
import { LOC } from "./fixtures/recipe-versions-fixture";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { setCateringFlags } from "@/lib/admin/catering/menu";

const gm = { user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [LOC] } as unknown as AuthContext;
let tables: ReturnType<typeof buildShopOwnedFixture>;
const row = (table: string, id: string) => tables[table]!.find(r => r.id === id)!;

beforeEach(() => {
  tables = buildShopOwnedFixture();
  Object.assign(row("items", "i-slaw"), { catering_available: true, catering_only: true, seasonal: false });
  for (const m of tables.menu_items!) Object.assign(m, { catering_available: true, catering_only: true, catering_portionable: false, serves: null });
  current = createFakeDb(tables);
});

describe("W23/B128 catering-only items can be switched off", () => {
  it("switching a catering-only item off the catering menu drops catering-only too", async () => {
    const out = await setCateringFlags(gm, "item", "i-slaw", { cateringAvailable: false });
    expect(out).toMatchObject({ cateringAvailable: false, cateringOnly: false });
    expect(row("items", "i-slaw")).toMatchObject({ catering_available: false, catering_only: false });
  });

  it("the same holds for a catering-only menu item (sub)", async () => {
    const out = await setCateringFlags(gm, "menu_item", "m-italian", { cateringAvailable: false });
    expect(out).toMatchObject({ cateringAvailable: false, cateringOnly: false });
    expect(row("menu_items", "m-italian")).toMatchObject({ catering_available: false, catering_only: false });
  });

  it("turning catering-only on for an unavailable item still makes it available", async () => {
    Object.assign(row("items", "i-slaw"), { catering_available: false, catering_only: false });
    const out = await setCateringFlags(gm, "item", "i-slaw", { cateringOnly: true });
    expect(out).toMatchObject({ cateringAvailable: true, cateringOnly: true });
  });

  it("an unrelated change keeps a catering-only item available", async () => {
    const out = await setCateringFlags(gm, "item", "i-slaw", { seasonal: true });
    expect(out).toMatchObject({ cateringAvailable: true, cateringOnly: true });
  });

  it("a contradictory payload (off the menu AND catering-only) is a 400 and writes nothing", async () => {
    await expect(setCateringFlags(gm, "item", "i-slaw", { cateringAvailable: false, cateringOnly: true }))
      .rejects.toMatchObject({ status: 400, code: "invalid_flags" });
    expect(row("items", "i-slaw")).toMatchObject({ catering_available: true, catering_only: true });
  });
});
