"use client";

/** The bar's "Go to" button (nav PR 9, plan r2 3.1). A no-op under a foreign modal (arbitration lives in `open()`). */
import { useRef } from "react";

import { useTranslation } from "@/lib/i18n/provider";

import { useGoTo } from "./NavShell";

export const GO_TO_SHEET_ID = "co-nav-goto-sheet";

export function GoToButton() {
  const { t } = useTranslation();
  const { open, isOpen } = useGoTo();
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      ref={ref}
      type="button"
      data-co-goto-button=""
      onClick={() => open(ref.current)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={GO_TO_SHEET_ID}
      aria-label={t("nav.goto.open_aria")}
      className="
        inline-flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-co-border-2 bg-co-surface px-3
        text-sm font-bold text-co-text transition hover:border-co-text
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
      "
    >
      {t("nav.goto.open")}
    </button>
  );
}
