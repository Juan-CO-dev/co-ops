import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}
it("runtime has no legacy sales table access or source switch", () => {
  const violations = [...files("lib"), ...files("app")].flatMap(path => {
    const source = readFileSync(path, "utf8");
    // Catch table literals passed directly or via variables, including multiline queries.
    return /["'`]toast_(?:sales_events|daily_depletion|daily_sales_signals)["'`]|DEPLETION_SOURCE/.test(source) ? [path] : [];
  });
  expect(violations).toEqual([]);
});
