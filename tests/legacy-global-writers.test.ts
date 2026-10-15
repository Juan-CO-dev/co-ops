/**
 * Catalog Phase 2a (D5) — every EXISTING global pack/price writer obeys the boundary: below MoO a
 * first value only, decided atomically (an RPC under the SKU lock, or a compare-and-set UPDATE).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const body = (file: string, start: string) => {
  const src = readFileSync(file, "utf8");
  const a = src.indexOf(start);
  expect(a, `${start} not found`).toBeGreaterThan(-1);
  return src.slice(a, src.indexOf("\n}\n", a));
};

describe("the /admin/skus chain editor", () => {
  const b = body("lib/admin/pack-chain.ts", "export async function replaceSkuPackChain(");
  it("writes through the locked RPC with first-only below MoO, and never deactivates rows itself", () => {
    expect(b).toContain('sb.rpc("save_sku_pack_version"');
    expect(b).toContain("p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN");
    expect(b).not.toContain('.from("sku_pack_levels")');
    expect(b).toContain("skuOwnerAllowed(");
  });
  it("never syncs the flat mirror after the transaction (Astra 2a r2#6 — the RPC derives it under the lock)", () => {
    const src = readFileSync("lib/admin/pack-chain.ts", "utf8");
    expect(src).not.toContain("syncSkuFlatFieldsFromChain");
    expect(readFileSync("lib/admin/sku-versions.ts", "utf8")).not.toContain("syncSkuFlatFieldsFromChain");
  });
});

describe("Record price", () => {
  const b = body("lib/admin/cost.ts", "export async function recordSkuPrice(");
  it("writes through the locked first-value RPC, never a bare insert; binds the owning shop", () => {
    expect(b).toContain('sb.rpc("save_sku_global_price"');
    expect(b).toContain("skuOwnerAllowed(");
    expect(b).toContain("p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN");
    expect(b).not.toContain(".insert(");
  });
});

describe("the SKU edit's flat pack fields", () => {
  const b = body("lib/admin/skus.ts", "export async function updateSku(");
  it("below MoO: an UNCHANGED pack field is stripped (a stale form can never restore a MoO's change); a changed one must have been empty, enforced by the UPDATE itself", () => {
    expect(b).toContain("delete update[f];");
    expect(b).toContain("for (const f of changedPack) q = q.is(f, null);");
    expect(b).toContain('.select("id, location_id, sku_class, pack_format, units_per_pack, each_size, each_measure, each_container_label")');
    expect(b).toContain("currentSkuClass = cur.sku_class;");
    expect(b).toContain('"global_requires_moo"');
    expect(b).toContain('.from("sku_pack_versions")');
  });
});

describe("the SKU screens explain the refusal", () => {
  it("knows the codes, in English and Spanish", () => {
    const shared = readFileSync("components/admin/skus/shared.ts", "utf8");
    expect(shared).toContain('"global_requires_moo",');
    expect(shared).toContain('"version_changed",');
    for (const k of ["admin.skus.error.global_requires_moo", "admin.skus.error.version_changed"]) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((es as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
