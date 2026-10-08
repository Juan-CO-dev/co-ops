import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { EXPORT_FAMILIES } from "@/lib/report-export-shared";
import { EXPORT_TITLE_KEY } from "@/lib/report-export";

const PREFIXES = ["reports.export.", "reportPackage."];
const ours = (dict: Record<string, string>) => Object.keys(dict).filter((k) => PREFIXES.some((p) => k.startsWith(p))).sort();

describe("export + package strings ship en + es together", () => {
  it("every key exists in both languages with the same {params}", () => {
    const e = en as Record<string, string>;
    const s = es as Record<string, string>;
    expect(ours(e).length).toBeGreaterThan(20);
    expect(ours(s)).toEqual(ours(e));
    const params = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
    for (const key of ours(e)) expect(params(s[key]!), key).toEqual(params(e[key]!));
  });

  it("every family has a translated title", () => {
    for (const family of EXPORT_FAMILIES) expect((en as Record<string, string>)[EXPORT_TITLE_KEY[family]], family).toBeTruthy();
  });
});
