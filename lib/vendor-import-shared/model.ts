/** Offline vendor observations, not SKU writes. Decimal cents retain /lb precision. */
export interface ExportRow {
  vendor: string;
  source_file: string;
  source_line: number;
  account_id: string;
  list_name: string;
  category: string;
  item_no: string;
  description: string;
  brand: string;
  pack: string;
  pack_qty: number | null;
  /** '#10' is a can designation, never ten pounds. */
  pack_size: number | string | null;
  pack_unit: string | null;
  pack_inner_qty?: number;
  pack_size_min?: number;
  pack_size_max?: number;
  pack_catch_weight?: true;
  pack_unparsed?: true;
  price_basis?: "per case" | "per lb" | "per each" | "per dozen" | "per bundle" | null;
  receipt_doc?: string;
  receipt_line?: number;
  net_wt_lb?: number;
  billed_unit?: string;
  billed_price_cents?: number;
  billed_price_basis?: string;
  notes?: string[];
  customer_product_no?: string;
  storage?: string;
  product_class?: string;
  uom: string;
  price_cents: number | null;
  price_per_lb_cents: number | null;
  last_purchase_qty: number | null;
  last_purchase_uom: string | null;
  last_purchase_date: string | null;
  /** Date precision only: the source supplies no clock or timezone. */
  exported_at: string;
}

export interface Adapter {
  id: string;
  vendor: string;
  detects(text: string): boolean;
  parse(text: string, sourceFile: string): ExportRow[];
}

export type Basis = "per_case" | "per_each" | "per_lb" | "per_dozen" | "per_bundle";
export type MatchRule = "item_number" | "name_exact" | "ambiguous" | "unmatched";
export interface CatalogSku { id: string; vendor_id: string; name: string; item_number: string | null; active: boolean;
  root: { levelId: string; label: string; quantity: number; unit: string; dimension: "weight" | "volume" | "count" } | null;
  latestPrice: { id: string; unit_price: number; effective_date: string } | null; price_basis: Basis | null }
export type ObservationKind = "price" | "item_number" | "pack" | "needs_person" | "noop";
export interface Observation { source_row: number; row: ExportRow; match: { rule: MatchRule; sku_id: string | null; candidates: string[] };
  kind: ObservationKind; reason: string;
  proposed: { unit_price?: number; effective_date?: string; item_number?: string; root?: { quantity: number; unit: string } } | null }
export type Decision = "accept" | "skip";
export interface PlanOp { action: "sku.price_supersede" | "sku.item_number_set" | "sku.pack_level_supersede"; sku_id: string; source_row: number;
  before: Record<string, unknown>; after: Record<string, unknown> }

/** All persisted observation reasons, including server-side pack review. */
export const REASONS = [
  "duplicate_item_number",
  "duplicate_name",
  "no_match",
  "inactive_sku",
  "item_number_conflict",
  "item_number_missing",
  "stale_price_evidence",
  "per_lb_on_count_root",
  "pack_dimension_mismatch",
  "price_date_missing",
  "price_basis_unresolved",
  "price_depends_on_pack",
  "price_same",
  "same_date_price_conflict",
  "price_changed",
  "pack_changed",
  "no_price_supplied",
  "stale_batch_evidence",
  "conflicting_batch_evidence",
  "pack_hierarchy_review"
] as const;
