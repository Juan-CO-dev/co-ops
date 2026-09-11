import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { reclassifyQuoteLineRefs } from "@/lib/catering/quotes-shared";

it("LRA-226: retired references are unknown on both catalog sides and map to 400", () => {
  const source = readFileSync("lib/catering/quotes.ts", "utf8");
  const verify = source.slice(source.indexOf("async function verifyLineRefs("), source.indexOf("async function resolveDeliveryFee("));
  for (const table of ["items", "menu_items"]) {
    expect(verify).toContain(`sb.from("${table}").select("id").in("id", ids).eq("active", true)`);
  }
  const result = reclassifyQuoteLineRefs([
    { itemId: "retired-item", menuItemId: null },
    { itemId: null, menuItemId: "retired-menu" },
  ], { itemIds: new Set(["active-item"]), menuItemIds: new Set(["active-menu"]) });
  expect(result.unknown).toEqual([
    { index: 0, field: "itemId", id: "retired-item" },
    { index: 1, field: "menuItemId", id: "retired-menu" },
  ]);
  expect(verify).toContain('throw new CateringQuoteError(400, "unknown_item"');
});
