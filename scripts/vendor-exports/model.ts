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
  pack_unparsed?: true;
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
