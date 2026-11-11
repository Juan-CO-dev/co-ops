import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the parser MIME gate byte-identical to base 6dc3e285", () => {
  const source = readFileSync("lib/receipt-parse.ts", "utf8").replace(/\r\n/g, "\n");
  const gate = source.split("    const base = t.contentType.split")[1]!.split("  return { assets, textFallbackForMatch };")[0]!;
  expect(createHash("sha256").update(gate).digest("hex")).toBe("f06defb528f8d9e5bb17f93999c43ad26cc459e8d151296de175d28637bc1f58");
});
