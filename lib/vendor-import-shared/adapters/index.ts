import type { Adapter } from "../model";
import { pfg } from "./pfg";
import { usfoods } from "./usfoods";
import { usfoodsInvoice } from "./usfoods-invoice";
import { baldorSmartshop } from "./baldor";
import { receipts } from "./receipts";

export const ADAPTERS: readonly Adapter[] = [pfg, usfoods, usfoodsInvoice, baldorSmartshop, receipts];
/** Exactly one adapter must claim the upload; a text upload never reaches an xlsx adapter and vice versa. */
export function detectAdapter(text: string, hint?: string, format: "text" | "xlsx" = "text"): Adapter | null {
  const matches = ADAPTERS.filter(adapter => (adapter.format ?? "text") === format
    && (!hint || adapter.vendor === hint || adapter.id === hint) && adapter.detects(text));
  return matches.length === 1 ? matches[0]! : null;
}
