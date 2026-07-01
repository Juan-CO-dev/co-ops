"use client";

/**
 * ProductionConsumptionPanel
 *
 * Collapsed-by-default "Uses: …" summary that expands to editable per-SKU
 * rows with a Case⇄Each toggle. Controlled component: parent owns value/onChange;
 * this component owns only expanded/collapsed + per-row unit selection.
 *
 * DerivedSku / ConfirmedInput are type-only imports from lib/prep-consumption
 * (server-only module — `import type` is erased at compile, so no server code
 * reaches the client bundle).
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { DerivedSku, ConfirmedInput } from "@/lib/prep-consumption";

type DisplayUnit = "case" | "each" | "oz";

/** oz → display quantity in a given unit. Returns null when conversion is impossible. */
function ozToUnit(oz: number, unit: DisplayUnit, d: DerivedSku): number | null {
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
function unitToOz(qty: number, unit: DisplayUnit, d: DerivedSku): number {
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
function defaultDisplayUnit(d: DerivedSku): DisplayUnit {
  if (d.contentOz && d.contentOz > 0) return "case";
  if (d.contentOz && d.contentOz > 0 && d.unitsPerPack && d.unitsPerPack > 0) return "each";
  return "oz";
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtQty(oz: number, unit: DisplayUnit, d: DerivedSku): string {
  const q = ozToUnit(oz, unit, d);
  if (q === null) return `${r2(oz)} oz`;
  return String(r2(q));
}

export function ProductionConsumptionPanel(props: {
  derived: DerivedSku[];
  outputQty: number;
  value: ConfirmedInput[] | null;
  onChange: (rows: ConfirmedInput[]) => void;
}): React.JSX.Element | null {
  const { derived, outputQty, value, onChange } = props;
  const { t } = useTranslation();

  const [expanded, setExpanded] = useState(false);
  const [unitMap, setUnitMap] = useState<Record<string, DisplayUnit>>(() => {
    const m: Record<string, DisplayUnit> = {};
    for (const d of derived) m[d.skuId] = defaultDisplayUnit(d);
    return m;
  });

  if (derived.length === 0) return null;

  const safeOutputQty = Number.isFinite(outputQty) && outputQty > 0 ? outputQty : 0;

  function derivedOzForSku(d: DerivedSku): number {
    return d.perUnitOz * safeOutputQty;
  }

  function resolveDisplayQty(d: DerivedSku): number {
    const unit = unitMap[d.skuId] ?? defaultDisplayUnit(d);
    if (value !== null) {
      const entry = value.find((e) => e.skuId === d.skuId);
      if (entry) {
        if (entry.unitEntered === unit && entry.qtyEntered !== null) return entry.qtyEntered;
        const converted = ozToUnit(entry.qtyOz, unit, d);
        return converted !== null ? r2(converted) : r2(entry.qtyOz);
      }
    }
    const oz = derivedOzForSku(d);
    const q = ozToUnit(oz, unit, d);
    return q !== null ? r2(q) : r2(oz);
  }

  function resolveDisplayUnit(d: DerivedSku): DisplayUnit {
    return unitMap[d.skuId] ?? defaultDisplayUnit(d);
  }

  function buildRows(changedSkuId: string, changedQtyEntered: number | null, changedUnit: DisplayUnit): ConfirmedInput[] {
    return derived.map((d) => {
      if (d.skuId === changedSkuId) {
        const derivedOz = derivedOzForSku(d);
        const qtyOz =
          changedQtyEntered !== null && Number.isFinite(changedQtyEntered)
            ? unitToOz(changedQtyEntered, changedUnit, d)
            : derivedOz;
        return { skuId: d.skuId, qtyOz, qtyEntered: changedQtyEntered, unitEntered: changedUnit, derivedOz };
      }
      if (value !== null) {
        const existing = value.find((e) => e.skuId === d.skuId);
        if (existing) return existing;
      }
      const derivedOz = derivedOzForSku(d);
      const unit = unitMap[d.skuId] ?? defaultDisplayUnit(d);
      return {
        skuId: d.skuId,
        qtyOz: derivedOz,
        qtyEntered: r2(ozToUnit(derivedOz, unit, d) ?? derivedOz),
        unitEntered: unit,
        derivedOz,
      };
    });
  }

  function handleInputChange(d: DerivedSku, raw: string) {
    const unit = unitMap[d.skuId] ?? defaultDisplayUnit(d);
    const parsed = raw.trim() === "" ? null : Number(raw);
    const qtyEntered = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    onChange(buildRows(d.skuId, qtyEntered, unit));
  }

  function handleUnitSwitch(d: DerivedSku, next: DisplayUnit) {
    setUnitMap((prev) => ({ ...prev, [d.skuId]: next }));
    if (value !== null) {
      const existing = value.find((e) => e.skuId === d.skuId);
      if (existing) {
        const qtyEntered = r2(ozToUnit(existing.qtyOz, next, d) ?? existing.qtyOz);
        onChange(buildRows(d.skuId, qtyEntered, next));
        return;
      }
    }
    const oz = derivedOzForSku(d);
    const qtyEntered = r2(ozToUnit(oz, next, d) ?? oz);
    onChange(buildRows(d.skuId, qtyEntered, next));
  }

  const summaryParts = derived.map((d) => {
    const unit = defaultDisplayUnit(d);
    const oz = derivedOzForSku(d);
    return `${fmtQty(oz, unit, d)} ${d.skuName}`;
  });

  return (
    <div className="mt-2 rounded-lg border border-co-border bg-co-surface">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-co-gold/40 bg-co-gold/5 px-3 py-2 text-left text-sm text-co-text-dim hover:bg-co-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60"
      >
        <span aria-hidden className={`text-co-gold transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>▸</span>
        <span className="flex-1 truncate">
          <span className="font-medium text-co-text">{t("production.panel.uses")}: </span>
          <span>{summaryParts.join(" · ")}</span>
        </span>
        <span className="shrink-0 text-xs text-co-text-muted">{t("production.panel.confirm_cue")}</span>
      </button>

      {expanded && (
        <div className="divide-y divide-co-border px-3 pb-2 pt-1">
          {derived.map((d) => {
            const unit = resolveDisplayUnit(d);
            const displayQty = resolveDisplayQty(d);
            const canCase = !!(d.contentOz && d.contentOz > 0);
            const canEach = canCase && !!(d.unitsPerPack && d.unitsPerPack > 0);

            return (
              <div key={d.skuId} className="flex min-h-[44px] items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-co-text">{d.skuName}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={displayQty}
                  onChange={(e) => handleInputChange(d, e.target.value)}
                  className="w-20 rounded-md border border-co-border bg-co-surface px-2 py-1 text-right text-sm text-co-text focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60"
                  aria-label={d.skuName}
                />
                <div className="flex items-center rounded-md border border-co-border bg-co-surface text-xs">
                  {canCase && (
                    <button
                      type="button"
                      onClick={() => handleUnitSwitch(d, "case")}
                      className={`min-h-[36px] min-w-[44px] rounded-l-md px-2 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60 ${unit === "case" ? "bg-co-gold text-co-text" : "text-co-text-dim hover:bg-co-gold/10"}`}
                    >
                      {t("production.panel.unit_case")}
                    </button>
                  )}
                  {canEach && (
                    <button
                      type="button"
                      onClick={() => handleUnitSwitch(d, "each")}
                      className={`min-h-[36px] min-w-[44px] px-2 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60 ${canCase ? "" : "rounded-l-md"} ${unit === "each" ? "bg-co-gold text-co-text" : "text-co-text-dim hover:bg-co-gold/10"}`}
                    >
                      {t("production.panel.unit_each")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleUnitSwitch(d, "oz")}
                    className={`min-h-[36px] min-w-[44px] px-2 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60 ${canCase || canEach ? "hidden" : "rounded-md"} ${unit === "oz" ? "bg-co-gold text-co-text" : "text-co-text-dim hover:bg-co-gold/10"}`}
                  >
                    oz
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
