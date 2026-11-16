import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownEntry } from "@/lib/api-helpers";

// W27 / B227: `FIELDS[b.action]` read the prototype chain — `"constructor"` returned `Object` (so `.includes` threw),
// `"__proto__"` returned `Object.prototype` — a 500 on an allowlist route. Lookups are own-property only now.
describe("ownEntry", () => {
  const table: Record<string, readonly string[]> = { open: ["a"] };
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "missing"])("%s is not an entry", (key) => {
    expect(ownEntry(table, key)).toBeUndefined();
  });
  it("own keys resolve; non-strings never do", () => {
    expect(ownEntry(table, "open")).toEqual(["a"]);
    expect(ownEntry(table, 1)).toBeUndefined();
    expect(ownEntry(table, null)).toBeUndefined();
    expect(ownEntry(JSON.parse('{"__proto__": ["x"]}') as Record<string, string[]>, "__proto__")).toEqual(["x"]);
  });
});

describe("allowlist routes look up the action as an own property", () => {
  it.each([
    "app/api/pm-report/v2/route.ts", "app/api/pm-criteria/route.ts", "app/api/people/settings/route.ts",
    "app/api/people/skills/route.ts", "app/api/admin/sevenshifts/route.ts",
  ])("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/(FIELDS|ACTIONS)\[b\.action\]/);
    expect(src).toMatch(/ownEntry\((FIELDS|ACTIONS), b\.action\)/);
  });
});
