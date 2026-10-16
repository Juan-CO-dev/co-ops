import { expect, it } from "vitest";
import { catalogRouteFiles, readBoundaryViolations } from "./helpers/catalog-read-boundary";
it("inventory includes every supported route extension", () => {
  expect(catalogRouteFiles(["a/route.ts", "b/route.tsx", "c/route.js", "d/route.jsx", "e/route.mts", "f/route.test.ts"])).toEqual(["a/route.ts", "b/route.tsx", "c/route.js", "d/route.jsx", "e/route.mts"]);
});
it.each(["insert", "update", "delete", "upsert"])("refuses direct %s even through bracket access", method => {
  expect(readBoundaryViolations(`db.from('x').${method}({});`)).not.toEqual([]);
  expect(readBoundaryViolations(`db.from('x')['${method}']({});`)).not.toEqual([]);
});
it("refuses mutating/unknown RPCs, allowing only the stable snapshot", () => {
  expect(readBoundaryViolations(`db.rpc('start_sku_swap', {});`)).not.toEqual([]);
  expect(readBoundaryViolations(`db.rpc(name, {});`)).not.toEqual([]);
  expect(readBoundaryViolations(`db.rpc('sku_swap_product_snapshot', {});`)).toEqual([]);
});
it("refuses new write-path imports even when aliased as a preview", () => {
  expect(readBoundaryViolations(`import { startSkuSwap as previewSkuSwap } from '@/lib/catalog/swap-vendor'; previewSkuSwap();`)).not.toEqual([]);
  expect(readBoundaryViolations(`import * as writer from '@/lib/catalog/swap-vendor'; writer.startSkuSwap();`)).not.toEqual([]);
  expect(readBoundaryViolations(`import { previewSkuSwap } from '@/lib/catalog/swap-vendor'; previewSkuSwap();`)).toEqual([]);
});
