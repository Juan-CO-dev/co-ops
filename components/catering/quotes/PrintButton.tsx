"use client";

import { useTranslation } from "@/lib/i18n/provider";

/** Print trigger for the label sheet (hidden from the printout itself). */
export function PrintButton() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex min-h-[44px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90"
    >
      {t("catering.labels.print")}
    </button>
  );
}
