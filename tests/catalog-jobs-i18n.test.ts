import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { JOB_ERROR_CODES, jobErrorKey } from "@/lib/catalog/jobs-shared";

it("has bilingual named refusals and matching job placeholders including ARIA", () => {
  for (const code of JOB_ERROR_CODES) {
    const key = jobErrorKey(code);
    expect(key, code).not.toBe("catalog.error.generic");
    expect(en[key], key).toBeTruthy();
    expect(es[key as keyof typeof es], key).toBeTruthy();
  }
  const keys = Object.keys(en).filter(key => key.startsWith("catalog.jobs."));
  expect(keys).toContain("catalog.jobs.toast.search_aria");
  expect(keys).toContain("catalog.jobs.setup.day_result_aria");
  for (const key of keys) {
    const english = en[key as keyof typeof en];
    const spanish = es[key as keyof typeof es];
    expect(spanish, key).toBeTruthy();
    expect(spanish?.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(english.match(/\{\w+\}/g)?.sort() ?? []);
  }
  expect(Object.keys(es).filter(key => key.startsWith("catalog.jobs.")).sort()).toEqual(keys.sort());
});
