import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { main } from "../scripts/reconcile-toast-cutover";
it("parity command import is inert and rejects invalid ranges before client creation", async () => {
  await expect(main(["2026-02-30", "2026-10-06"])).rejects.toThrow("cutover_invalid_range");
  await expect(main(["2026-10-07", "2026-10-06"])).rejects.toThrow("cutover_invalid_range");
});
it("parity entry is read-only and uses both row sets with the shared derivation", () => {
  const src = readFileSync("scripts/reconcile-toast-cutover.ts", "utf8");
  expect(src).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  expect(src).not.toContain("readFileSync");
  expect(src).toContain("deriveSalesConsumptionFrom(locationId, date, latest)");
  expect(src).toContain("deriveCapturedSalesConsumption(locationId, date, day)");
  expect(src).toContain("pathToFileURL(process.argv[1]).href");
});
