import type { ReactElement, ReactNode } from "react";
import { expect, it, vi } from "vitest";
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useState: (value: unknown) => [value === false ? true : value, vi.fn()] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));
import { ItemRow } from "@/components/admin/items/ItemRow";
import { AddItemForm } from "@/components/admin/items/AddItemForm";
import type { ChecklistRegistryItem } from "@/lib/admin/templates";
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
const item = { itemId: "item", locationId: "shop", name: "Sauce", batchYield: 1, trackingType: "portioned", required: false, isDefault: false } as ChecklistRegistryItem;
const props = { item, actorLevel: 7, sections: [], units: [], language: "en", itemQuestions: [], readiness: null, producingRecipeId: null, madeFrom: [] };
it("owning GM can open the definition editor without receiving global-management controls", () => {
  const rendered = nodes(ItemRow({ ...props, canEditDefinition: true }));
  const labels = rendered.flatMap(node => typeof node.props.children === "string" ? [node.props.children] : []);
  expect(labels).toContain("admin.templates.definition.title");
  expect(labels).not.toContain("admin.templates.default_toggle_hint");
  expect(labels).not.toContain("admin.templates.opening_verify_hint");
  expect(labels).not.toContain("admin.templates.sold_directly.title");
});
it("GM without the definition capability cannot open a shared or foreign editor", () => {
  const rendered = nodes(ItemRow({ ...props, canEditDefinition: false }));
  expect(rendered.some(node => node.props.children === "admin.templates.definition.title")).toBe(false);
});
it("empty owned registry still offers authorized creation scopes, never global for GM", () => {
  const rendered = nodes(AddItemForm({ sections: [], units: [], actorLevel: 7, shops: [{ id: "a", name: "Shop A" }, { id: "b", name: "Shop B" }], initialScope: null }));
  const scope = rendered.find(node => node.type === "select" && nodes(node).some(option => option.props.value === "a"))!;
  expect(scope.props.value).toBe("");
  expect(nodes(scope).filter(node => node.type === "option").map(node => node.props.value)).toEqual(["", "a", "b"]);
  expect(rendered.some(node => node.props.children === "admin.templates.add_global_is_default")).toBe(false);
});
