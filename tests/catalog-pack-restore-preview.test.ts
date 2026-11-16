/**
 * Audit W18/B107: Back to default and Restore changed what a shop's par counts in (a par of "4 cases"
 * went from 4 × 192 oz to 4 × 96 oz) with no conversion and no preview. Both now go through the
 * preview with the par keep-or-convert rows; Restore saves through apply_sku_pack_change, Back to
 * default through 0324 apply_sku_pack_back_to_default (atomicity proven by scripts/sql-harness-0324.mjs).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { RecipeInputSku } from "@/lib/recipe-math";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import { previewPackChange, type PreviewShopState } from "@/lib/catalog/change-preview-shared";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import { ChangePreviewPanel } from "@/components/catalog/ChangePreviewPanel";
import en from "@/lib/i18n/en.json";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed"); // a call that got past the gates
  return { ...current.client, rpc: async () => { throw new Error("no rpc in this test"); } };
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; });
import { applyPackBackToDefault, applyPackChange, CatalogItemError, computeRestorePreview } from "@/lib/catalog/sku-item";

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role, language: "en" }, role, level, locations }) as unknown as AuthContext;
const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof CatalogItemError ? { status: e.status, code: e.code } : { error: String(e) }));

describe("Back to default offers the par conversion (the preview it now shows)", () => {
  const measures = new Map([["oz", { dimension: "weight" as const, toBaseFactor: 1 }]]);
  const defaultChain: PackChainLevel[] = [
    { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "b", label: "bag", containsQty: 24, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const shopChain: PackChainLevel[] = [
    { id: "sc", label: "case", containsQty: 8, containsLevelId: "sb", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "sb", label: "bag", containsQty: 24, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const pack = (chain: PackChainLevel[]): RecipeInputSku => ({ packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: chain });
  const state: PreviewShopState = {
    shopId: A, shopName: "P Street", basePack: pack(shopChain), ownPackVersion: true, ownPriceLane: false,
    priceHeads: { global: null, lane: null }, graph: buildRecipeGraph([], new Map([["t", pack(shopChain)]]), measures), prices: new Map(),
    slots: [{ slot: "weekday", value: 4, lane: "human" }, { slot: "weekend", value: null, lane: "none" }], openOrders: [],
  };
  it("a shop par of 4 eight-bag cases becomes 8 four-bag cases", () => {
    const p = previewPackChange({
      skuId: "t", target: { kind: "shop", shopId: A }, targetBasePack: pack(shopChain), newChain: defaultChain,
      shops: [state], globalPars: { weekday: 3, weekend: null }, parStep: null, menuItems: [], recipeLines: [],
      liveVersionId: "shop-v", basedOnVersionId: null,
    });
    expect(p.shops[0]?.orderUnitOz).toEqual({ before: 192, after: 96 });
    expect(p.conversions).toEqual([{ locationId: A, slot: "weekday", expected: 4, to: 8 }]);
  });
});

describe("the gates hold in the lib, before any I/O", () => {
  const input = { skuId: "s", locationId: A, versionId: "v", conversions: [], previewToken: "abcd1234" };
  it("Back to default: the social media manager by ROLE, another shop, a conversion of another shop's par", async () => {
    expect(await refused(applyPackBackToDefault(actor("social_media_mgr", 6, [A]), input))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(applyPackBackToDefault(actor("gm", 7, [B]), input))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(applyPackBackToDefault(actor("gm", 7, [A]), { ...input, conversions: [{ locationId: B, slot: "weekday", expected: 4, to: 8 }] })))
      .toEqual({ status: 400, code: "par_lane_mismatch" });
    expect(await refused(applyPackBackToDefault(actor("gm", 7, [A]), input))).toEqual({ error: "Error: no fake db installed" });
  });
});

describe("Restore reads its levels from the server and saves exactly them", () => {
  const db = () => createFakeDb({
    vendor_items: [{ id: "s", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true }],
    measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1, active: true }],
    sku_pack_versions: [
      { id: "v-old", sku_id: "s", location_id: A, active: false, flat_snapshot: null },
      { id: "v-base", sku_id: "s", location_id: null, active: false, flat_snapshot: { pack_format: "case" } },
    ],
    sku_pack_levels: [{ id: "l1", version_id: "v-old", sku_id: "s", label: "case", contains_qty: 4, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0 }],
  });
  it("the flat baseline is refused by name before any preview", async () => {
    current = db();
    expect(await refused(computeRestorePreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, "v-base"))).toEqual({ status: 409, code: "baseline_not_restorable" });
  });
  it("a Restore save whose levels are not the restored version's is preview_stale", async () => {
    current = db();
    const out = await refused(applyPackChange(actor("gm", 7, [A]), {
      skuId: "s", target: { kind: "shop", shopId: A }, conversions: [], requestId: null, previewToken: "abcd1234",
      levels: [{ label: "case", containsQty: 5, containsIndex: null, containsMeasureUnit: "oz" }], restoredFromVersionId: "v-old",
    }));
    expect(out).toEqual({ status: 409, code: "preview_stale" });
  });
});

describe("the routes and the page only go through the preview", () => {
  it("/pack/restore writes nothing and refuses preview_required; /pack/back-to-default needs the preview token", () => {
    const restore = readFileSync("app/api/admin/catalog/sku/[id]/pack/restore/route.ts", "utf8");
    expect(restore).toContain('return jsonError(409, "preview_required");');
    expect(restore).not.toMatch(/restoreSkuPackVersion|retire|\.rpc\(/);
    const back = readFileSync("app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts", "utf8");
    expect(back).toContain('if (b.previewToken === undefined) return jsonError(409, "preview_required");');
    expect(back).toContain("applyPackBackToDefault(ctx,");
    expect(back).not.toContain("retireShopPackVersion");
    const preview = readFileSync("app/api/admin/catalog/sku/[id]/preview/route.ts", "utf8");
    expect(preview).toContain('b.kind === "pack_restore"');
    expect(preview).toContain('b.kind === "pack_back_to_default"');
  });
  it("the item page previews Restore and Back to default and saves the previewed conversions", () => {
    const src = readFileSync("components/catalog/SkuItemClient.tsx", "utf8");
    expect(src).toContain('postJson(`${base}/preview`, { kind: "pack_back_to_default"');
    expect(src).toContain('postJson(`${base}/preview`, { kind: "pack_restore"');
    expect(src).toContain("restoredFromVersionId: packAct.versionId");
    expect(src).not.toContain("`${base}/pack/restore`");
    for (const lang of ["en", "es"] as const) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      for (const k of ["catalog.item.back_to_default_preview", "catalog.history.restore_preview", "catalog.error.preview_required", "catalog.error.back_to_default_unavailable"]) {
        expect(dict[k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});

// Fix round 1 (W18/B107): a shop's own chain that equals the default is still a real Back to default —
// the save retires the shop's version, so the shop rides FUTURE default changes and its pack epoch
// moves (its machine par restarts). The preview must say so and keep the Save, never "no change".
describe("Back to default with a shop chain identical to the default", () => {
  const measures = new Map([["oz", { dimension: "weight" as const, toBaseFactor: 1 }]]);
  const chain: PackChainLevel[] = [
    { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "b", label: "bag", containsQty: 24, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const pack = (c: PackChainLevel[]): RecipeInputSku => ({ packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: c });
  const state: PreviewShopState = {
    shopId: A, shopName: "P Street", basePack: pack(chain), ownPackVersion: true, ownPriceLane: false,
    priceHeads: { global: null, lane: null }, graph: buildRecipeGraph([], new Map([["t", pack(chain)]]), measures), prices: new Map(),
    slots: [{ slot: "weekday", value: 4, lane: "human" }, { slot: "weekend", value: 5, lane: "auto" }], openOrders: [],
  };
  const preview = () => previewPackChange({
    skuId: "t", target: { kind: "shop", shopId: A }, targetBasePack: pack(chain), newChain: chain,
    shops: [state], globalPars: { weekday: 3, weekend: 2 }, parStep: null, menuItems: [], recipeLines: [],
    liveVersionId: "shop-v", basedOnVersionId: null, retiresOwnVersion: true,
  });
  it("is a change: the human par keeps its count, the machine par's restart is disclosed", () => {
    const p = preview();
    expect(p.changed).toBe(true);
    expect(p.shops[0]?.orderUnitOz).toEqual({ before: 96, after: 96 });
    expect(p.pars.map((r) => [r.slot, r.lane, r.status])).toEqual([["weekend", "auto", "machine_par"]]);
  });
  it("renders the Save for the shop, not 'no change'", () => {
    const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: "en", children:
      jsx(ChangePreviewPanel, { preview: { ...preview(), snapshot: null, token: "t" }, canSave: true, canEditPar: true, chosen: new Set<string>(), onToggleConversion: () => {}, onSave: () => {}, busy: false }) }));
    expect(html).not.toContain(en["catalog.preview.no_change"]);
    expect(html).toContain("Save for P Street");
    expect(html).toContain("Until it recomputes, P Street uses the default par");
  });
  it("a plain pack edit to the same chain is still 'no change'", () => {
    const p = previewPackChange({
      skuId: "t", target: { kind: "shop", shopId: A }, targetBasePack: pack(chain), newChain: chain,
      shops: [state], globalPars: { weekday: 3, weekend: 2 }, parStep: null, menuItems: [], recipeLines: [],
      liveVersionId: "shop-v", basedOnVersionId: null,
    });
    expect(p.changed).toBe(false);
  });
  it("computeBackToDefaultPreview asks the preview to treat the retire as a change", () => {
    const src = readFileSync("lib/catalog/sku-item.ts", "utf8");
    expect(src).toMatch(/kind: "pack_back_to_default"[\s\S]{0,400}retiresOwnVersion: true/);
  });
});
