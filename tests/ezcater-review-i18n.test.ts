import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const english = en as Record<string, string>;
const spanish = es as Record<string, string>;
const prefix = "admin.ezcaterReview.";
const source = readFileSync(new URL("../app/admin/catering/ezcater-review/review-client.tsx", import.meta.url), "utf8");
const staticKeys = [...source.matchAll(/t\("(admin\.ezcaterReview\.[^"]+)"/g)].map((match) => match[1]!);
const dynamicKeys = [
  ...["item", "menu_item", "package"].map((kind) => `${prefix}kind.${kind}`),
  ...["not_ezcater", "duplicate", "test", "other"].map((reason) => `${prefix}reason.${reason}`),
];
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("ezCater review translations", () => {
  it("keeps all review keys in parity", () => {
    expect(Object.keys(english).filter((key) => key.startsWith(prefix)).sort())
      .toEqual(Object.keys(spanish).filter((key) => key.startsWith(prefix)).sort());
  });
  it.each([...new Set([...staticKeys, ...dynamicKeys])])("translates %s with matching substitutions", (key) => {
    expect(english[key]).toBeTruthy();
    expect(spanish[key]).toBeTruthy();
    expect(placeholders(spanish[key]!)).toEqual(placeholders(english[key]!));
  });
});
