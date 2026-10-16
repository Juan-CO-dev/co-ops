import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), requestStepUpGrant: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));

import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";

it("preserves the centered builder layout and overrides fieldset min-content sizing", () => {
  const html = renderToStaticMarkup(createElement(RecipeBuilder, {
    recipe: null, skus: [], items: [], unitOptions: [], measures: new Map(), level: 7,
  }));
  const classes = html.match(/^<fieldset class="([^"]+)"/)?.[1]?.split(" ");
  expect(classes).toEqual(expect.arrayContaining(["mt-2", "mx-auto", "w-full", "max-w-3xl", "min-w-0", "p-0", "border-0"]));
});

it("makes an empty owned output inventory actionable without a separate item save", () => {
  const html = renderToStaticMarkup(createElement(RecipeBuilder, {
    recipe: null, skus: [], items: [], outputItems: [], unitOptions: [], measures: new Map(), level: 7,
    locationId: "shop", prepSections: [{ slug: "prep", label: "Prep" }],
  }));
  expect(html).toContain('value="__new__" selected=""');
  expect(html).toContain("recipes.output.create_for_shop");
  expect(html).toContain("recipes.output.new_name_es");
  expect(html).toContain('value="prep" selected=""');
});
