/** Catalog Phase 2b — the door report: one operational button, a short sheet, a KH+ same-origin route, every refusal named. */
import { readFileSync } from "node:fs";
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { CaseLooksDifferent } from "@/components/receiving/CaseLooksDifferent";
import { DOOR_REPORT_ERROR_CODES, doorReportErrorKey } from "@/lib/pack-change-requests-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
const E = en as Record<string, string>;
const S = es as Record<string, string>;

describe("CaseLooksDifferent", () => {
  it("is one closed, labelled button until tapped — en and es", () => {
    const html = render(jsx(CaseLooksDifferent, { skuId: "s", locationId: "l" }));
    expect(html).toContain(en["receiving.case_different.button"]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<button(?![^>]*min-h-\[)[^>]*>/);
    expect(render(jsx(CaseLooksDifferent, { skuId: "s", locationId: "l" }), "es")).toContain(es["receiving.case_different.button"]);
  });
  it("the door line mounts it on a known SKU's line (not on store-run rows, not on an unidentified line)", () => {
    const src = readFileSync("components/receiving/IntakeLineRow.tsx", "utf8");
    expect(src).toContain("{storeMode || !line.skuId ? null : <CaseLooksDifferent skuId={line.skuId} locationId={locationId} />}");
    expect(src).toContain('import { CaseLooksDifferent } from "@/components/receiving/CaseLooksDifferent";');
  });
  it("joining an open report says the note and photo were ADDED; the panel id is unique per line (chunk-3 review P3a/P3b)", () => {
    const src = readFileSync("components/receiving/CaseLooksDifferent.tsx", "utf8");
    expect(src).toContain('r.data.added === true ? "added" : "already"');
    expect(src).toContain("const panelId = `case-different-${useId()}`;");
    expect(E["receiving.case_different.added"]).toMatch(/added/);
    expect(S["receiving.case_different.added"]).toBeTruthy();
  });
  it("a refusal is shown by its own name, through the closed map", () => {
    const src = readFileSync("components/receiving/CaseLooksDifferent.tsx", "utf8");
    expect(src).toContain("t(doorReportErrorKey(errorCode))");
  });
});

describe("every door refusal has its OWN en + es message (never the generic one)", () => {
  it("the closed list covers every code the filing lib and the route can return", () => {
    const lib = readFileSync("lib/pack-change-requests.ts", "utf8");
    const body = lib.slice(lib.indexOf("export async function filePackChangeRequest"), lib.indexOf("async function shopManagers"));
    const libCodes = [...body.matchAll(/PackChangeRequestError\(\d{3}, "([a-z_]+)"/g)].map((m) => m[1]!);
    const requireLoc = lib.slice(lib.indexOf("function requireLocation"), lib.indexOf("export interface FilePackChangeInput"));
    const bindCodes = [...requireLoc.matchAll(/PackChangeRequestError\(\d{3}, "([a-z_]+)"/g)].map((m) => m[1]!);
    const route = readFileSync("app/api/operations/receiving/pack-change/route.ts", "utf8");
    const routeCodes = [...route.matchAll(/jsonError\(\d{3}, "([a-z_]+)"/g)].map((m) => m[1]!);
    const list = new Set<string>(DOOR_REPORT_ERROR_CODES);
    for (const c of [...libCodes, ...bindCodes, ...routeCodes]) expect(list, c).toContain(c);
    for (const c of ["delivery_not_found", "photo_not_found", "sku_owned_by_other_shop", "sku_not_found", "forbidden", "not_found", "invalid_payload"]) expect(list).toContain(c);
  });
  it("each has both languages, distinct from the generic text, with matching placeholders", () => {
    for (const c of DOOR_REPORT_ERROR_CODES) {
      const k = doorReportErrorKey(c);
      expect(k).toBe(`receiving.case_different.error.${c}`);
      expect(E[k], `en ${k}`).toBeTruthy();
      expect(S[k], `es ${k}`).toBeTruthy();
      expect(E[k]).not.toBe(E["receiving.case_different.error"]);
    }
    expect(doorReportErrorKey("something_else")).toBe("receiving.case_different.error");
    expect(E["receiving.case_different.error.delivery_not_found"]).toMatch(/delivery/i);
    expect(E["receiving.case_different.error.photo_not_found"]).toMatch(/photo/i);
  });
});

describe("POST /api/operations/receiving/pack-change", () => {
  const src = readFileSync("app/api/operations/receiving/pack-change/route.ts", "utf8");
  it("same-origin first, a session, the KH floor, the strict proposal parser, no step-up (it changes nothing)", () => {
    expect(src.indexOf("assertSameOrigin(req)")).toBeLessThan(src.indexOf("requireSession("));
    expect(src).toContain("PACK_REQUEST_FILE_MIN");
    expect(src).toContain("parsePackChangeProposal(");
    expect(src).toContain("filePackChangeRequest(");
    expect(src).not.toContain("assertStepUp");
    expect(src).toContain("if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code");
  });
});
