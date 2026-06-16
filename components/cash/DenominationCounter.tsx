"use client";

import { DENOMINATION_UNITS_CENTS, sumDenominations, type Denominations } from "@/lib/cash";
import { formatCents } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

function unitLabel(cents: number): string {
  return cents >= 100 ? `$${cents / 100}` : `${cents}¢`;
}

export function DenominationCounter({
  value,
  onChange,
  language,
}: {
  value: Denominations;
  onChange: (next: Denominations) => void;
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
              value={value[String(unit)] ?? ""}
              onChange={(e) => {
                const trimmed = e.target.value.trim();
                const next = { ...value };
                if (trimmed === "") {
                  delete next[String(unit)];
                } else {
                  const q = Math.max(0, Math.floor(Number(trimmed)));
                  if (Number.isFinite(q) && q > 0) next[String(unit)] = q;
                  else delete next[String(unit)];
                }
                onChange(next);
              }}
              aria-label={unitLabel(unit)}
              className="h-10 w-16 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
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
