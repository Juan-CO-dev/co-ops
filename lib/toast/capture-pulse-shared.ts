import type { CaptureSelection } from "./capture-reconciliation-shared";
import type { DaySalesAgg, SalesEventRow } from "../midshift-sales-shared";

export interface PulseCapturedOrder {
  deleted: boolean;
  voided: boolean;
  excessFood: boolean;
  selections: CaptureSelection[];
  checks: { checkGuid: string; amountCents: number | null; voided: boolean; deleted: boolean }[];
}

/** Capture amounts are net check amounts. Selection/modifier prices never enter money. */
export function capturedDayPulse(businessDate: string, orders: readonly PulseCapturedOrder[]): {
  aggregate: DaySalesAgg & { units: number }; rows: SalesEventRow[];
} {
  let netCents = 0;
  let checks = 0;
  let units = 0;
  const rows: SalesEventRow[] = [];
  for (const order of orders) {
    if (order.deleted || order.voided || order.excessFood) continue;
    const liveChecks = new Set<string>();
    for (const check of order.checks) {
      if (check.deleted || check.voided) continue;
      if (check.amountCents === null || !Number.isSafeInteger(check.amountCents)) throw new Error("capture_pulse_amount_missing");
      netCents += check.amountCents;
      checks += 1;
      liveChecks.add(check.checkGuid);
    }
    for (const selection of order.selections) {
      if (!liveChecks.has(selection.check_guid) || selection.deleted || selection.voided) continue;
      if (selection.parent_selection_guid === null) units += selection.quantity;
      rows.push({ business_date: businessDate, check_guid: selection.check_guid,
        selection_guid: selection.selection_guid, parent_selection_guid: selection.parent_selection_guid,
        item_name: selection.name, quantity: selection.quantity, price_cents: null, voided: false, snapshot_version: 1 });
    }
  }
  return { aggregate: { businessDate, netCents, checks, avgTicketCents: checks ? Math.round(netCents / checks) : null, units }, rows };
}
