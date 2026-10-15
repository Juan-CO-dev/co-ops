/**
 * Searchable ingredient picker — CLIENT-SAFE pure half (catalog redesign Phase 1, 2026-10-15).
 * Replaces three unsearchable <select>s (every SKU, every item, every product) with ONE list a
 * manager can type into on a phone: name · vendor · kind.
 *
 * Search is accent-blind and case-blind; every typed word must appear in the name or the vendor
 * ("ham baldor"). Ranking: the name STARTS with the whole query, then any word of the name starts
 * with the first word, then anywhere; ties by name, kind (product, SKU, item — the product is the
 * vendor-proof pin), vendor, id.
 */
export type IngredientKind = "sku" | "item" | "product";

export interface IngredientOption {
  key: string;
  kind: IngredientKind;
  id: string;
  name: string;
  /** A SKU's vendor; null for items, products and vendorless SKUs. */
  vendorName: string | null;
}

export const INGREDIENT_RESULT_LIMIT = 50;

const KIND_ORDER: Record<IngredientKind, number> = { product: 0, sku: 1, item: 2 };

export function ingredientKey(kind: IngredientKind, id: string): string {
  return `${kind}:${id}`;
}

function compareOptions(a: IngredientOption, b: IngredientOption): number {
  return (
    a.name.localeCompare(b.name) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (a.vendorName ?? "").localeCompare(b.vendorName ?? "") ||
    a.id.localeCompare(b.id)
  );
}

export function buildIngredientOptions(input: {
  skus: ReadonlyArray<{ id: string; name: string; vendorName?: string | null }>;
  items: ReadonlyArray<{ id: string; name: string }>;
  products: ReadonlyArray<{ id: string; name: string }>;
}): IngredientOption[] {
  const out: IngredientOption[] = [
    ...input.products.map((p) => ({ key: ingredientKey("product", p.id), kind: "product" as const, id: p.id, name: p.name, vendorName: null })),
    ...input.skus.map((s) => ({ key: ingredientKey("sku", s.id), kind: "sku" as const, id: s.id, name: s.name, vendorName: s.vendorName ?? null })),
    ...input.items.map((i) => ({ key: ingredientKey("item", i.id), kind: "item" as const, id: i.id, name: i.name, vendorName: null })),
  ];
  return out.sort(compareOptions);
}

/** Lower-case, accents stripped, whitespace collapsed. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function filterIngredientOptions(
  options: readonly IngredientOption[],
  query: string,
  limit: number = INGREDIENT_RESULT_LIMIT,
): { matches: IngredientOption[]; total: number } {
  const q = normalizeSearch(query);
  if (q === "") return { matches: options.slice(0, limit), total: options.length };
  const tokens = q.split(" ");
  const first = tokens[0] ?? q;
  const scored: Array<{ o: IngredientOption; rank: number }> = [];
  for (const o of options) {
    const name = normalizeSearch(o.name);
    const hay = o.vendorName ? `${name} ${normalizeSearch(o.vendorName)}` : name;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const rank = name.startsWith(q) ? 0 : name.split(" ").some((w) => w.startsWith(first)) ? 1 : 2;
    scored.push({ o, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || compareOptions(a.o, b.o));
  return { matches: scored.slice(0, limit).map((s) => s.o), total: scored.length };
}

/** The keyboard's next active row: one step, clamped to the list. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

type LineTarget = {
  componentSkuId: string | null;
  componentItemId: string | null;
  componentProductId: string | null;
};

export function lineTargetKey(line: LineTarget): string {
  if (line.componentProductId !== null) return ingredientKey("product", line.componentProductId);
  if (line.componentItemId !== null) return ingredientKey("item", line.componentItemId);
  return ingredientKey("sku", line.componentSkuId ?? "");
}

/** The option for a line's current target — synthesised when the picker no longer offers it
 *  (a retired product or a deactivated SKU), so the editor still shows what the line names. */
export function optionForLine(line: LineTarget & { componentName: string }, options: readonly IngredientOption[]): IngredientOption {
  const key = lineTargetKey(line);
  const found = options.find((o) => o.key === key);
  if (found) return found;
  const kind: IngredientKind = line.componentProductId !== null ? "product" : line.componentItemId !== null ? "item" : "sku";
  const id = (kind === "product" ? line.componentProductId : kind === "item" ? line.componentItemId : line.componentSkuId) ?? "";
  return { key, kind, id, name: line.componentName, vendorName: null };
}
