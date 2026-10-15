/**
 * Chunk-4 review P2 — the avg oz per each a chained RAW SKU needs (its chain ends in a count or
 * volume unit) cannot be cleared through the identity Save: the server refuses
 * `avg_required_by_chain`, and the client blocks the Save before it asks. Over the
 * predicate-aware fake.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "./fake-supabase";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { updateSku } from "@/lib/admin/skus";
import type { AuthContext } from "@/lib/session";

const owner = { user: { id: "u-owner", role: "owner" }, locations: [] } as unknown as AuthContext;
const SKU = "sku-1";

function seed(skuClass: string, leafUnit: string) {
  h.db = fakeSupabase({
    vendor_items: [{ id: SKU, location_id: null, sku_class: skuClass, avg_oz_per_each: 2 }],
    sku_pack_levels: [
      { id: "l0", sku_id: SKU, active: true, contains_measure_unit: null },
      { id: "l1", sku_id: SKU, active: true, contains_measure_unit: leafUnit },
      { id: "old", sku_id: SKU, active: false, contains_measure_unit: "each" },
    ],
    measure_units: [
      { label: "each", dimension: "count", active: true },
      { label: "lb", dimension: "weight", active: true },
    ],
  });
}
const sku = () => (h.db.tables.vendor_items as Row[])[0]!;

describe("updateSku refuses to clear an avg the live chain needs", () => {
  beforeEach(() => seed("raw", "each"));

  it("a raw SKU whose chain ends in a count unit: clearing the avg is avg_required_by_chain, nothing written", async () => {
    await expect(updateSku(owner, { id: SKU, changes: { avgOzPerEach: null } }))
      .rejects.toMatchObject({ status: 400, code: "avg_required_by_chain" });
    expect(sku().avg_oz_per_each).toBe(2);
    expect(h.db.writes.filter((w) => w.op === "update")).toEqual([]);
  });

  it("…and the class moving AWAY from raw in the same save lets it clear", async () => {
    await expect(updateSku(owner, { id: SKU, changes: { avgOzPerEach: null, skuClass: "packaging" } })).resolves.toBeUndefined();
    expect(sku().avg_oz_per_each).toBeNull();
  });

  it("changing the avg to another positive number is fine", async () => {
    await updateSku(owner, { id: SKU, changes: { avgOzPerEach: 3 } });
    expect(sku().avg_oz_per_each).toBe(3);
  });

  it("a chain ending in weight never needed it, so it clears", async () => {
    seed("raw", "lb");
    await updateSku(owner, { id: SKU, changes: { avgOzPerEach: null } });
    expect(sku().avg_oz_per_each).toBeNull();
  });

  it("the refusal has an en and es message", () => {
    expect((en as Record<string, string>)["admin.skus.error.avg_required_by_chain"]).toBeTruthy();
    expect((es as Record<string, string>)["admin.skus.error.avg_required_by_chain"]).toBeTruthy();
    expect(readFileSync("components/admin/skus/shared.ts", "utf8")).toContain('"avg_required_by_chain",');
  });
});

describe("SkuBuilder blocks the identity Save that would clear a needed avg (source pin)", () => {
  const src = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
  it("submit refuses when the chain needs the avg and the field is empty", () => {
    const submit = src.slice(src.indexOf("const submit = () => {"), src.indexOf("// ── Chain editor actions"));
    expect(submit).toContain("if (chainNeedsAvg && parseNum(avgOzPerEach) === null)");
    expect(submit).toContain('t("admin.skus.error.leaf_needs_avg")');
  });

  it("the avg field's min matches the > 0 rule and its hint is wired with aria-describedby", () => {
    const field = src.slice(src.indexOf("chainNeedsAvg ? ("), src.indexOf("// UNCHAINED (add flow"));
    expect(field).not.toContain("min={0}");
    expect(field).toContain("aria-describedby={avgHintId}");
    expect(field).toContain("id={avgHintId}");
  });
});
