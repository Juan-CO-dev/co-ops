import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { CatalogEntity } from "@/lib/admin/catalog-shared";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, changed: false, params: new URLSearchParams() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = hooks.index++;
    if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[slot], (next: unknown) => {
      hooks.slots[slot] = typeof next === "function" ? next(hooks.slots[slot]) : next;
      hooks.changed = true;
    }];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => hooks.params }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ noteStepUpConfirmed: vi.fn(), forgetStepUp: vi.fn() }) }));
vi.mock("@/components/auth/PasswordModal", () => ({ PasswordModal: () => null }));
import { CatalogClient } from "@/components/admin/catalog/CatalogClient";

// Only the parent is invoked: inspect its real input and filtered CatalogRow elements.
const entities = [
  { key: "one", name: "Pickles & Cheese", nameEs: "Pepinillos", section: "Lunch", taxonType: "made", issues: [] },
  { key: "two", name: "Turkey", nameEs: "Pavo", section: "Lunch", taxonType: "made", issues: [] },
] as unknown as CatalogEntity[];
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function render() {
  for (let pass = 0; pass < 10; pass++) {
    hooks.index = 0;
    hooks.changed = false;
    const tree = CatalogClient({ entities, actorLevel: 7 });
    if (!hooks.changed) {
      const all = nodes(tree);
      const search = all.find((node) => node.type === "input" && node.props.type === "search")!;
      return { search, rows: all.filter((node) => node.props.e).map((node) => (node.props.e as CatalogEntity).key) };
    }
  }
  throw new Error("Render did not settle");
}
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.params = new URLSearchParams(); });

it("prefills decoded q and filters the actual catalog rows", () => {
  hooks.params = new URLSearchParams("q=Pickles%20%26%20Cheese");
  const result = render();
  expect(result.search.props.value).toBe("Pickles & Cheese");
  expect(result.rows).toEqual(["one"]);
});
it("starts empty without q and retains the available rows", () => {
  expect(render().search.props.value).toBe("");
  expect(render().rows).toEqual(["one", "two"]);
});
it("updates on q navigation, including removal, without overwriting subsequent typing", () => {
  hooks.params = new URLSearchParams("q=Turkey");
  let result = render();
  expect(result.rows).toEqual(["two"]);
  (result.search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Pepinillos" } });
  hooks.params = new URLSearchParams("q=Turkey&location=another");
  result = render();
  expect(result.search.props.value).toBe("Pepinillos");
  expect(result.rows).toEqual(["one"]);
  hooks.params = new URLSearchParams("q=Pavo");
  result = render();
  expect(result.search.props.value).toBe("Pavo");
  expect(result.rows).toEqual(["two"]);
  hooks.params = new URLSearchParams();
  expect(render().search.props.value).toBe("");
  expect(render().rows).toEqual(["one", "two"]);
});
