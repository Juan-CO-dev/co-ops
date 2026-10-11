/** Pure, direct recipe relationships for the two admin registries. No recipe flattening. */
export interface LinkEntity {
  id: string;
  name: string;
  name_es?: string | null;
  active: boolean;
}
export interface LinkSku extends LinkEntity {
  product_id: string | null;
  vendor_id: string | null;
}
export interface LinkInput {
  recipe_id: string;
  component_product_id: string | null;
  component_sku_id: string | null;
  component_item_id: string | null;
}
export interface LinkOutput { recipe_id: string; output_item_id: string | null }
export interface RegistryLink {
  id: string;
  kind: "product" | "sku" | "item";
  name: string;
  nameEs: string | null;
  vendorName: string | null;
}
export interface ProductItemLinks {
  madeFromByItem: Record<string, RegistryLink[]>;
  usedInByProduct: Record<string, RegistryLink[]>;
  producingRecipeByItem: Record<string, string>;
}

export function registryLinkHref(link: RegistryLink): string {
  const id = encodeURIComponent(link.id);
  if (link.kind === "item") return `/admin/items?view=registry#${id}`;
  if (link.kind === "product") return `/admin/products?product=${id}#${id}`;
  return `/admin/skus#${id}`;
}

export function mapProductItemLinks(data: {
  recipes: Array<{ id: string; active: boolean }>;
  inputs: LinkInput[];
  outputs: LinkOutput[];
  products: LinkEntity[];
  skus: LinkSku[];
  items: Array<LinkEntity & { location_id: string | null }>;
  vendors: Array<{ id: string; name: string }>;
}): ProductItemLinks {
  const recipes = new Set(data.recipes.filter(r => r.active).map(r => r.id));
  const products = new Map(data.products.filter(p => p.active).map(p => [p.id, p]));
  const skus = new Map(data.skus.filter(s => s.active).map(s => [s.id, s]));
  // /admin/items' prep registry contains active GLOBAL items only. Never link
  // to a location-only item that the destination cannot render.
  const items = new Map(data.items.filter(i => i.active && i.location_id === null).map(i => [i.id, i]));
  const vendors = new Map(data.vendors.map(v => [v.id, v.name]));
  const inputs = new Map<string, LinkInput[]>();
  for (const input of data.inputs) {
    if (!recipes.has(input.recipe_id)) continue;
    const list = inputs.get(input.recipe_id) ?? [];
    list.push(input);
    inputs.set(input.recipe_id, list);
  }
  const result: ProductItemLinks = { madeFromByItem: {}, usedInByProduct: {}, producingRecipeByItem: {} };
  const link = (entity: LinkEntity, kind: RegistryLink["kind"], vendorName: string | null = null): RegistryLink =>
    ({ id: entity.id, kind, name: entity.name, nameEs: entity.name_es ?? null, vendorName });
  const add = (map: Record<string, RegistryLink[]>, id: string, entry: RegistryLink) => {
    const list = map[id] ??= [];
    if (!list.some(x => x.kind === entry.kind && x.id === entry.id)) list.push(entry);
  };
  for (const output of data.outputs) {
    if (!recipes.has(output.recipe_id) || !output.output_item_id) continue;
    const item = items.get(output.output_item_id);
    if (!item) continue;
    result.producingRecipeByItem[item.id] = output.recipe_id;
    for (const input of inputs.get(output.recipe_id) ?? []) {
      const product = input.component_product_id ? products.get(input.component_product_id) : undefined;
      const sku = input.component_sku_id ? skus.get(input.component_sku_id) : undefined;
      const subPrep = input.component_item_id ? items.get(input.component_item_id) : undefined;
      if (product) add(result.madeFromByItem, item.id, link(product, "product"));
      if (sku) add(result.madeFromByItem, item.id, link(sku, "sku", vendors.get(sku.vendor_id ?? "") ?? null));
      if (subPrep) add(result.madeFromByItem, item.id, link(subPrep, "item"));
      const usedProduct = product ?? (sku?.product_id ? products.get(sku.product_id) : undefined);
      if (usedProduct) add(result.usedInByProduct, usedProduct.id, link(item, "item"));
    }
  }
  for (const map of [result.madeFromByItem, result.usedInByProduct]) {
    for (const links of Object.values(map)) links.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  return result;
}
