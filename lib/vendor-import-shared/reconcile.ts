import type { Basis, CatalogSku, ExportRow } from "./model";

type Root = NonNullable<CatalogSku["root"]>;
type Contents = { quantity: number; unit: string; dimension: Root["dimension"] };
const positive = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Exact dimensions from the export only; never infer liquid mass or catch weight. */
export function vendorContents(row: ExportRow): Contents | null {
  if (row.pack_unparsed || row.pack_catch_weight || !positive(row.pack_qty) || !positive(row.pack_inner_qty ?? 1)) return null;
  if (typeof row.pack_size === "string" && /^#\d+$/.test(row.pack_size) && row.pack_unit === "CN") return { quantity: row.pack_qty * (row.pack_inner_qty ?? 1), unit: "can", dimension: "count" };
  if (typeof row.pack_size !== "number" || !positive(row.pack_size)) return null;
  const units: Record<string, [number, string, Root["dimension"]]> = { LB: [16, "oz", "weight"], OZ: [1, "oz", "weight"], GR: [1 / 28.349523125, "oz", "weight"], CT: [1, "each", "count"], EA: [1, "each", "count"], DZ: [12, "each", "count"], GA: [128, "fl oz", "volume"], QT: [32, "fl oz", "volume"], LT: [33.8140227, "fl oz", "volume"] };
  const unit = units[row.pack_unit ?? ""];
  if (!unit) return null;
  const quantity = row.pack_qty * (row.pack_inner_qty ?? 1) * row.pack_size * unit[0];
  return positive(quantity) ? { quantity, unit: unit[1], dimension: unit[2] } : null;
}

/** Resolve explicit denominations; unlike seed repair, never guess a basis from price proximity. */
export function reconcileBasis(row: ExportRow): Basis | null {
  const declared: Record<string, Basis> = { "per case": "per_case", "per each": "per_each", "per lb": "per_lb", "per dozen": "per_dozen", "per bundle": "per_bundle" };
  if (row.price_basis) return declared[row.price_basis] ?? null;
  if (row.price_per_lb_cents != null) return "per_lb";
  return ({ CS: "per_case", CA: "per_case", EA: "per_each", LB: "per_lb", DZ: "per_dozen", BD: "per_bundle", BNDL: "per_bundle" } as Record<string, Basis>)[row.uom.toUpperCase()] ?? null;
}

function purchaseContents(row: ExportRow, basis: Basis | null): Contents | null {
  const contents = vendorContents(row);
  if (!contents || !basis) return null;
  if (basis === "per_case") return contents;
  if (basis === "per_each") return { ...contents, quantity: contents.quantity / (row.pack_qty! * (row.pack_inner_qty ?? 1)) };
  if (basis === "per_dozen" && contents.unit === "each") return { ...contents, quantity: 12 };
  if (basis === "per_bundle" && reconcileBasis(row) === "per_bundle") return contents;
  return null;
}

export function packComparison(row: ExportRow, root: Root | null, basis: Basis | null = "per_case"): { same: boolean; dimensionMismatch: boolean; proposedQuantity?: number } {
  const contents = purchaseContents(row, basis);
  if (!root || !contents) return { same: false, dimensionMismatch: false };
  if (contents.dimension !== root.dimension) return { same: false, dimensionMismatch: true };
  if (contents.unit !== root.unit) return { same: false, dimensionMismatch: false };
  const same = Math.abs(contents.quantity - root.quantity) < 1e-8;
  return { same, dimensionMismatch: false, ...(same ? {} : { proposedQuantity: contents.quantity }) };
}

/** Dollars for ONE current purchase root; the declared purchase basis is mandatory. */
export function priceAtRoot(row: ExportRow, root: Root | null, basis: Basis | null): number | null {
  if (!root || !positive(root.quantity) || !basis) return null;
  if (row.price_per_lb_cents != null) {
    if (root.dimension !== "weight" || root.unit !== "oz" || !positive(row.price_per_lb_cents)) return null;
    return round(row.price_per_lb_cents / 100 * root.quantity / 16);
  }
  if (!positive(row.price_cents)) return null;
  const billed = reconcileBasis(row);
  const contents = purchaseContents(row, billed);
  if (!contents || contents.dimension !== root.dimension || contents.unit !== root.unit) return null;
  const result = row.price_cents / 100 * root.quantity / contents.quantity;
  return positive(result) ? round(result) : null;
}

export function priceComparison(row: ExportRow, root: Root | null, basis: Basis | null, latest: CatalogSku["latestPrice"]) {
  const proposed = priceAtRoot(row, root, basis);
  return { same: proposed != null && latest != null && Math.abs(proposed - latest.unit_price) <= 0.005 + Number.EPSILON, proposed };
}
