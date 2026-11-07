import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ImportBatchView } from "@/lib/vendor-import";
const h = vi.hoisted(() => ({ expanded: false, cursor: 0, view: null as ImportBatchView | null }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const slot = h.cursor++; return [slot === 2 ? h.expanded : initial, vi.fn()]; },
  useReducer: (_reducer: unknown, initial: object) => [{ ...initial, view: h.view, decisions: h.view?.decisions ?? {} }, vi.fn()],
}));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), forgetStepUp: vi.fn() }) }));
import { VendorImportPanel } from "@/components/admin/vendors/VendorImportPanel";
const shop = "shop-one";
const view: ImportBatchView = {
  batch: { id: "batch", vendor_id: "vendor", location_id: shop, account_id: null, adapter: "pfg", adapter_version: "v1", source_name: "sheet.csv", source_sha256: "", exported_at: null, row_count: 1,
    report: { counts: { needs_person: 1 }, reasons: {}, needs_person: [], before_state: {}, ignored_rows: 0 }, status: "staged", created_by: "actor", created_at: "" },
  observations: [], decisions: {}, beforeState: {}, ops: [], expectedDigest: "",
};
const props = { vendorId: "vendor", vendorName: "Supplier", canStage: true, canApply: true, canApplyGlobal: false, canChooseGlobal: false, shops: [{ id: shop, name: "North" }], initialShopId: shop };
const render = (language: "en" | "es" = "en", overrides: Partial<typeof props> = {}) => {
  h.cursor = 0;
  return renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(VendorImportPanel, { ...props, ...overrides }) }));
};
beforeEach(() => { h.expanded = false; h.view = null; h.cursor = 0; });
describe("vendor import scope and disclosure", () => {
  it.each(["en", "es"] as const)("keeps shop identity visible and upload collapsed in %s", language => {
    const html = render(language);
    expect(html).toContain("North");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('type="file"');
    expect(html).toContain("min-h-[44px]");
  });
  it("GM sees Apply to their shop and cannot choose the global default", () => {
    h.expanded = true; h.view = view;
    const html = render();
    expect(html).toContain("Apply to North (0)");
    expect(html).not.toContain('value="global"');
    expect(html).toContain("North");
  });
  it("MoO has a compact global or shop scope choice", () => {
    h.expanded = true;
    const html = render("en", { canChooseGlobal: true });
    expect(html).toContain('value="global"');
    expect(html).toContain('value="shop-one"');
  });
  it("keeps needs-person counts visible while review is collapsed", () => {
    h.view = view;
    const html = render();
    expect(html).toContain("Needs review: 1");
    expect(html).not.toContain("<table");
  });
  it("375px layout has stacked review rows without a fixed minimum table width", () => {
    const source = readFileSync("components/admin/vendors/VendorImportPanel.tsx", "utf8");
    expect(source).toContain("grid-cols-1");
    expect(source).toContain("md:table-row");
    expect(source).not.toContain("min-w-[760px]");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).toContain("min-h-[44px] items-center");
  });
});
