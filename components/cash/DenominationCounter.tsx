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
  targetCents,
  language,
}: {
  value: Denominations;
  onChange: (next: Denominations) => void;
  targetCents: number;
  language: Language;
}) {
  const { t } = useTranslation();
  const total = sumDenominations(value);
  const delta = total - targetCents;
  const atTarget = delta === 0;

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
      <p className={`text-sm font-bold ${atTarget ? "text-co-success" : "text-co-cta"}`}>
        {atTarget
          ? t("cash.count.register_ok", { target: formatCents(targetCents, language) })
          : t(delta > 0 ? "cash.count.register_over" : "cash.count.register_short", {
              amount: formatCents(total, language),
              delta: formatCents(Math.abs(delta), language),
            })}
      </p>
    </div>
  );
}
