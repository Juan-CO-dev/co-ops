/**
 * Prep consumption units — PURE (catalog Phase 2a moved these out of ProductionConsumptionPanel so
 * the persisted ounces can be tested). "case" = the selected pack's content; "each" = content ÷ units
 * per pack, both from the SAME selected pack (lib/prep-consumption.ts DerivedSku).
 */
import type { DerivedSku } from "@/lib/prep-consumption";

export type DisplayUnit = "case" | "each" | "oz";

/** oz → display quantity in a given unit. Returns null when conversion is impossible. */
export function ozToUnit(oz: number, unit: DisplayUnit, d: DerivedSku): number | null {
  if (unit === "oz") return oz;
  if (unit === "case") {
    return d.contentOz && d.contentOz > 0 ? oz / d.contentOz : null;
  }
  if (d.contentOz && d.contentOz > 0 && d.unitsPerPack && d.unitsPerPack > 0) {
    return oz / (d.contentOz / d.unitsPerPack);
  }
  return null;
}

/** Display quantity in unit → oz. */
export function unitToOz(qty: number, unit: DisplayUnit, d: DerivedSku): number {
  if (unit === "oz") return qty;
  if (unit === "case") {
    return qty * (d.contentOz ?? 0);
  }
  const ozPerEach =
    d.contentOz && d.unitsPerPack && d.unitsPerPack > 0
      ? d.contentOz / d.unitsPerPack
      : 0;
  return qty * ozPerEach;
}

/** Best default display unit: case > each > oz. */
export function defaultDisplayUnit(d: DerivedSku): DisplayUnit {
  if (d.contentOz && d.contentOz > 0) return "case";
  if (d.contentOz && d.contentOz > 0 && d.unitsPerPack && d.unitsPerPack > 0) return "each";
  return "oz";
}
