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
  it("chunk-3 P3d: a GLOBAL chain edit can never deactivate a shop's version", () => {
    // The editor writes ONLY through the RPC, for the global scope (p_location: null), checking the
    // GLOBAL live version the FORM was loaded with (chunk-4 P3c) — never a fresh re-read…
    expect(b).toContain("p_sku: args.skuId, p_location: null,");
    expect(b).toContain("p_expected_live: args.expectedLiveVersionId,");
    expect(b).not.toContain('.from("sku_pack_versions")');
    // …and the RPC retires ONLY the live version of that scope plus that scope's unversioned stragglers.
    const sql = readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8").replace(/\r\n/g, "\n");
    const fn = sql.slice(sql.indexOf("create or replace function public.save_sku_pack_version("), sql.indexOf("\n$$;", sql.indexOf("create or replace function public.save_sku_pack_version(")));
    expect(fn).toContain("select id into v_live from public.sku_pack_versions where sku_id = p_sku and scope_key = v_scope and active for update;");
    expect(fn).toContain("update public.sku_pack_levels set active = false where version_id = v_live and active;");
    expect(fn).toContain("update public.sku_pack_levels set active = false where sku_id = p_sku and scope_key = v_scope and active and version_id is null;");
    const deactivations = fn.split("\n").filter((line) => line.includes("update public.sku_pack_levels set active = false"));
    expect(deactivations).toHaveLength(2);
    // Executed proof on Postgres: scripts/sql-harness-0259.mjs ("a global save leaves the shop's version live").
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

describe("chunk-4 P3c: the legacy chain editor carries the version its FORM was loaded with", () => {
  it("the route refuses a save that does not say which version it saw, and validates the one it does", () => {
    const route = readFileSync("app/api/admin/skus/[id]/pack-chain/route.ts", "utf8");
    expect(route).toContain('if (!("expectedLiveVersionId" in b)) return jsonError(409, "version_changed");');
    expect(route).toContain("replaceSkuPackChain(ctx, { skuId: id, levels, expectedLiveVersionId })");
  });
  it("both admin pages load the version with the chain, and both clients send it back", () => {
    for (const page of ["app/admin/skus/page.tsx", "app/admin/vendors/[id]/page.tsx"]) {
      const src = readFileSync(page, "utf8");
      expect(src).toContain("const chainResolution = await loadSkuPackResolution(skus.map((s) => s.id), null);");
      expect(src).toContain("for (const [skuId, r] of chainResolution) if (r.versionId) chainVersionBySku[skuId] = r.versionId;");
    }
    for (const client of ["components/admin/skus/SkuCatalogClient.tsx", "components/admin/skus/VendorSkusCard.tsx"]) {
      expect(readFileSync(client, "utf8")).toContain("{ levels: payload, expectedLiveVersionId: chainVersionBySku[id] ?? null }");
    }
    expect(readFileSync("components/admin/vendors/VendorDetailClient.tsx", "utf8")).toContain("chainVersionBySku={skuChainVersions}");
    // the add-SKU flow: a SKU minted a moment ago has no live chain
    expect(readFileSync("app/api/admin/skus/route.ts", "utf8")).toContain("expectedLiveVersionId: null });");
  });
});

describe("chunk-4 P3c: every save refusal is a named 4xx, never a 500", () => {
  it("maps each RPC refusal onto the editor's own codes", async () => {
    const { packChainErrorFromRpc, PackChainError } = await import("@/lib/admin/pack-chain");
    const cases: Array<[string, number, string]> = [
      ["sku_pack_version:version_changed", 409, "version_changed"],
      ["sku_pack_version:global_requires_moo", 403, "global_requires_moo"],
      ["sku_pack_version:flat_pack_exists", 403, "global_requires_moo"],
      ["sku_pack_version:sku_not_found", 409, "sku_inactive"],
      ["sku_pack_version:duplicate_label", 400, "duplicate_label"],
      ["sku_pack_version:cycle", 400, "chain_cycle"],
      ["sku_pack_version:not_one_root", 400, "chain_invalid"],
      ["sku_pack_version:shared_child", 400, "chain_invalid"],
      ["sku_pack_version:non_positive_qty", 400, "invalid_qty"],
    ];
    for (const [msg, status, code] of cases) {
      const e = packChainErrorFromRpc(`ERROR: ${msg}`);
      expect(e, msg).toBeInstanceOf(PackChainError);
      expect(e as InstanceType<typeof PackChainError>).toMatchObject({ status, code });
    }
    expect(packChainErrorFromRpc("connection reset")).not.toBeInstanceOf(PackChainError);
  });
  it("the new code is explained in English and Spanish", () => {
    expect(readFileSync("components/admin/skus/shared.ts", "utf8")).toContain('"sku_inactive",');
    expect((en as Record<string, string>)["admin.skus.error.sku_inactive"]).toBeTruthy();
    expect((es as Record<string, string>)["admin.skus.error.sku_inactive"]).toBeTruthy();
  });
});

describe("chunk-4 P3d: the audit comment says what flat_fields_synced = false means now", () => {
  it("false = a malformed chain, mirrored to the unknown placeholder in the same transaction", () => {
    const src = readFileSync("lib/admin/pack-chain.ts", "utf8");
    expect(src).toContain("`false` = the saved chain is MALFORMED for the mirror");
    expect(src).not.toContain("correct while the legacy flat mirror on vendor_items is stale");
  });
});
