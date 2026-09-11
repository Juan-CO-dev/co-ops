import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { normalizeEmail } from "@/lib/catering/companies";

it("LRA-220: both staff writers use the portal normalizer and store empty emails as null", () => {
  const source = readFileSync("lib/catering/customers.ts", "utf8");
  expect(source).toContain('import { normalizeEmail } from "@/lib/catering/companies"');
  expect(source).toContain('email: normalizeEmail(input.email ?? "") || null');
  expect(source).toContain('if (input.email !== undefined) patch.email = normalizeEmail(input.email ?? "") || null');
  for (const input of ["  CUSTOMER@EXAMPLE.COM  ", "", "   ", null, undefined]) {
    expect(normalizeEmail(input ?? "") || null).toBe(input?.trim() ? "customer@example.com" : null);
  }
});
