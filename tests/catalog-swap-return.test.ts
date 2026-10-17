import { expect, it } from "vitest";
import { swapReturnContext, swapReturnHref } from "@/lib/catalog/swap-return-shared";
const sku = "10000000-0000-4000-8000-000000000001";
const replacement = "20000000-0000-4000-8000-000000000001";
it("accepts only one SKU identity, never a caller-controlled return URL", () => {
  expect(swapReturnContext(sku)).toBe(sku);
  for (const raw of [undefined, "", "https://example.com", "/admin/users", [sku], "../../admin/users"]) {
    expect(swapReturnContext(raw)).toBeNull();
  }
});
it("returns to the exact original scope with the created replacement identity", () => {
  expect(swapReturnHref(sku, null, replacement)).toBe(`/admin/catalog/sku/${sku}/swap?location=global&replacement=${replacement}`);
  expect(swapReturnHref(sku, sku, replacement)).toBe(`/admin/catalog/sku/${sku}/swap?location=${sku}&replacement=${replacement}`);
});
