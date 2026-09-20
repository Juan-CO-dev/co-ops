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
