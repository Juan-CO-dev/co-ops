/** Read-only Pars DTO and presentation rules. No server imports. */
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { resolveParSlot, resolveParWithLane, type GlobalSkuPar, type LocationSkuOverlay, type ParLane } from "@/lib/location-sku-shared";
import { compareByGuide, type GuideSortKey } from "@/lib/order-guide-sort";
import type { ParSilenceSummary, WalkerParSuggestion } from "@/lib/dynamic-pars-shared";

export const PARS_VIEW_ROLES: readonly RoleCode[] = ["agm", "prep_mgr", "catering_mgr", "gm", "moo", "owner", "cgs"];
export function canViewPars(role: RoleCode): boolean {
  return getRoleLevel(role) >= 6 && PARS_VIEW_ROLES.includes(role);
}
export interface ParsSlot { value: number | null; lane: ParLane; pounds: number | null }
export interface ParsRow extends GuideSortKey {
  skuId: string;
  vendorId: string;
  vendorName: string;
  unit: string | null;
  weekday: ParsSlot;
  weekend: ParsSlot;
  weekendFallback: boolean;
  suggestion: WalkerParSuggestion | null;
  reroutedFromName: string | null;
}
export interface ParsView { rows: ParsRow[]; silence: ParSilenceSummary }

export function parSlots(overlay: LocationSkuOverlay | null, global: GlobalSkuPar, oz: number | null) {
  const weekday = resolveParSlot(overlay, global, "weekday");
  const weekend = resolveParWithLane(overlay, global, true);
  const slot = (value: number | null, lane: ParLane): ParsSlot => ({
    value, lane, pounds: value != null && oz != null && Number.isFinite(oz) && oz > 0 ? value * oz / 16 : null,
  });
  return {
    weekday: slot(weekday.value, weekday.lane),
    weekend: slot(weekend.par, weekend.lane),
    weekendFallback: resolveParSlot(overlay, global, "weekend").value == null && weekday.value != null,
  };
}

export function filterPars(rows: readonly ParsRow[], vendorId: string, section: string): ParsRow[] {
  return rows.filter((r) => (!vendorId || r.vendorId === vendorId) && (!section || r.section === section))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId.localeCompare(b.vendorId) || compareByGuide(a, b) || a.skuId.localeCompare(b.skuId));
}
