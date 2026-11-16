/**
 * A JS twin of delivery_receipt_auto_link (migration 0327) for the lib tests' in-memory tables.
 * It answers what the function answers, in the function's order: the unlink history first, then the
 * delivery snapshot, then the receipt snapshot, and it writes BOTH sides or neither. The SQL itself
 * is proven on the real DDL in scripts/sql-harness-0327.mjs; keep the two in step.
 */
export type ModelRow = Record<string, unknown>;
export type AutoLinkTables = { vendor_deliveries?: ModelRow[]; email_receipts?: ModelRow[]; delivery_receipt_unlinks?: ModelRow[] };
export type AutoLinkAnswer = { linked: boolean; reason?: string; location_id?: unknown };

export function autoLinkModel(tables: AutoLinkTables, a: ModelRow): AutoLinkAnswer {
  const d = (tables.vendor_deliveries ?? []).find((row) => row.id === a.p_delivery);
  if (!d) return { linked: false, reason: "delivery_changed" };
  const r = (tables.email_receipts ?? []).find((row) => row.id === a.p_receipt);
  if (!r) return { linked: false, reason: "receipt_changed" };
  // A pair a manager unlinked is refused before anything else is looked at.
  if ((tables.delivery_receipt_unlinks ?? []).some((u) => u.delivery_id === d.id && u.receipt_id === r.id)) return { linked: false, reason: "pair_unlinked" };
  if ((d.email_receipt_id ?? null) !== null || d.location_id !== a.p_location || d.vendor_id !== a.p_vendor || d.delivery_date !== a.p_delivery_date) {
    return { linked: false, reason: "delivery_changed" };
  }
  if ((r.linked_delivery_id ?? null) !== null || r.attribution_conflict !== false || r.location_id !== a.p_location || r.vendor_guess_id !== a.p_vendor
    || r.parse_state !== a.p_parse_state || r.received_at !== a.p_received_at || r.doc_kind !== "invoice"
    || (tables.vendor_deliveries ?? []).some((other) => other.email_receipt_id === r.id)) {
    return { linked: false, reason: "receipt_changed" };
  }
  r.linked_delivery_id = d.id;
  d.email_receipt_id = r.id;
  return { linked: true, location_id: d.location_id };
}

/** delivery_receipt_unlink (0327), reduced to what these tests need: both sides cleared, the pair recorded. */
export function unlinkModel(tables: AutoLinkTables, deliveryId: string): void {
  const d = (tables.vendor_deliveries ?? []).find((row) => row.id === deliveryId);
  if (!d || d.email_receipt_id == null) throw new Error("no_receipt");
  const receiptId = d.email_receipt_id;
  const r = (tables.email_receipts ?? []).find((row) => row.id === receiptId);
  d.email_receipt_id = null; d.match_state = "counted_only";
  if (r && r.linked_delivery_id === d.id) r.linked_delivery_id = null;
  (tables.delivery_receipt_unlinks ??= []).push({ delivery_id: d.id, receipt_id: receiptId });
}

export const AUTO_LINK_RPC = "delivery_receipt_auto_link";
export const RPC_NOT_INSTALLED = { code: "PGRST202", message: "Could not find the function public.delivery_receipt_auto_link in the schema cache" };
