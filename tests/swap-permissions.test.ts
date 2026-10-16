import { describe, expect, it } from "vitest";
import { SWAP_ERROR_CODES, SWAP_RPC_STATUS, SwapError, swapErrorFromRpc } from "@/lib/catalog/swap-shared";
import { RPC_STATUS, SHOP_OWNED_ERROR_CODES, ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";
describe("closed job refusal namespaces", () => {
 it.each(SWAP_ERROR_CODES)("maps swap:%s", code => {
  expect(() => swapErrorFromRpc(`swap:${code}`)).toThrow(expect.objectContaining({ name: "SwapError", code, status: SWAP_RPC_STATUS[code] }));
 });
 it.each(SHOP_OWNED_ERROR_CODES)("maps shop_owned:%s", code => {
  expect(() => shopOwnedErrorFromRpc(`shop_owned:${code}`)).toThrow(expect.objectContaining({ name: "ShopOwnedError", code, status: RPC_STATUS[code] }));
 });
 it("preserves valid positions and rejects malformed or foreign namespaces", () => {
  expect(() => shopOwnedErrorFromRpc("shop_owned:line_other_shop:17")).toThrow(expect.objectContaining({ status: 400, line: { position: 17, reason: "line_other_shop" } }));
  for (const message of ["swap:invented", "shop_owned:product_changed", "recipe_version:dependencies_changed", "swap:product_changed:2"]) {
   expect(() => swapErrorFromRpc(message)).toThrow();
   try { swapErrorFromRpc(message); } catch (error) { expect(error).not.toBeInstanceOf(SwapError); }
  }
  for (const message of ["shop_owned:invented", "swap:product_changed", "shop_owned:line_other_shop:0", "shop_owned:line_other_shop:9007199254740992", "shop_owned:output_other_shop:2"]) {
   expect(() => shopOwnedErrorFromRpc(message)).toThrow();
   try { shopOwnedErrorFromRpc(message); } catch (error) { expect(error).not.toBeInstanceOf(ShopOwnedError); }
  }
 });
});
