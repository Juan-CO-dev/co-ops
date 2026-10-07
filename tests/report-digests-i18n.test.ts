import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const PREFIXES = ["digest.", "digestWatch.", "reportRecipients.", "admin.section.report-recipients"];
const ours = (dict: Record<string, string>) => Object.keys(dict).filter((k) => PREFIXES.some((p) => k.startsWith(p))).sort();

describe("digest + recipients strings ship en + es together", () => {
  it("every key exists in both languages, with the same {params}", () => {
    const e = en as Record<string, string>;
    const s = es as Record<string, string>;
    expect(ours(e).length).toBeGreaterThan(150);
    expect(ours(s)).toEqual(ours(e));
    const params = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
    for (const key of ours(e)) expect(params(s[key]!), key).toEqual(params(e[key]!));
  });

  it("the explicit empty states are exactly Juan's words", () => {
    expect((en as Record<string, string>)["digest.catering.none_yesterday"]).toBe("No catering yesterday");
    expect((en as Record<string, string>)["digest.catering.none_today"]).toBe("Nothing booked today");
  });
});
