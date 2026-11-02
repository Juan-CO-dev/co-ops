import { expect, it } from "vitest";
import { dollarsToCents } from "@/lib/marketing/spend-shared";
it.each([["1.005", 101], ["1.004", 100], ["4.50", 450], ["0", 0], ["1000000", 100000000], ["1000000.01", null], ["-1", null], ["", null], ["1e3", null], ["Infinity", null]])("converts decimal dollars %s exactly", (input, expected) => {
  expect(dollarsToCents(String(input))).toBe(expected);
});
