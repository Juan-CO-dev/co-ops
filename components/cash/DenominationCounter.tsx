"use client";

import { DENOMINATION_UNITS_CENTS, applyDenominationInput, sumDenominations, type Denominations } from "@/lib/cash-shared";
import { formatCents } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

function unitLabel(cents: number): string {
  return cents >= 100 ? `$${cents / 100}` : `${cents}¢`;
}

export function DenominationCounter({
  value,
  entered,
  onChange,
  language,
}: {
  value: Denominations;
  /** Units the closer has typed into (a typed 0 is an answer; `value` never stores zeros). */
  entered: readonly string[];
  onChange: (next: Denominations, entered: string[]) => void;
  language: Language;
}) {
  const { t } = useTranslation();
  const total = sumDenominations(value);

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DENOMINATION_UNITS_CENTS.map((unit) => (
          <li
            key={unit}
            className="flex items-center justify-between gap-2 rounded-md border-2 border-co-border bg-co-surface px-3 py-2"
          >
            <span className="text-sm font-bold text-co-text">{unitLabel(unit)}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={value[String(unit)] ?? (entered.includes(String(unit)) ? "0" : "")}
              onChange={(e) => {
                // Denomination counts are >= 0 - "-" is stripped and the parse clamps
                // (defense in depth); see applyDenominationInput for the zero handling.
                const next = applyDenominationInput(value, entered, String(unit), e.target.value);
                onChange(next.denoms, next.entered);
              }}
              aria-label={unitLabel(unit)}
              className="min-h-[44px] w-16 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
          </li>
        ))}
      </ul>
      {/* Live drawer total — deposit/over-short readout lives in the parent form (which has projected). */}
      <p className="text-sm font-bold text-co-text">
        {t("cash.count.drawer_total", { amount: formatCents(total, language) })}
      </p>
    </div>
  );
}
