"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { WhatsLeftEntry, WhatsLeftResult } from "@/lib/whats-left-shared";

/** Opens the parent first; the row remains mounted inside hidden checklist panels. */
export function focusWhatsLeft(entry: WhatsLeftEntry, openSection: (id: string) => void) {
  openSection(entry.sectionId);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-whats-left-item]"))
      .find((node) => node.dataset.whatsLeftItem === entry.itemId);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    const field = row?.querySelector<HTMLElement>(`[data-whats-left-field="${entry.targetField}"]`)
      ?? row?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)");
    if (field) field.focus({ preventScroll: true });
    else if (row) {
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
    }
  }));
}

export function WhatsLeft({ result, onJump }: { result: WhatsLeftResult; onJump: (entry: WhatsLeftEntry) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const total = result.left.length + result.needsHigherRole.length;
  if (total === 0) return null;
  return <section className="rounded-xl border border-co-border bg-co-surface px-3 py-1">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-sm font-bold text-co-text focus-visible:ring-4 focus-visible:ring-co-gold/60">
      <span>{t(result.left.length === 1 ? "whats_left.count_one" : "whats_left.count", { n: result.left.length })}{result.needsHigherRole.length > 0
        ? ` · ${t("whats_left.higher_role", { n: result.needsHigherRole.length })}` : ""}</span>
      <span aria-hidden>{open ? "▾" : "▸"}</span>
    </button>
    {open ? <div className="pb-2">
      {result.left.length > 0 ? <ul>
        {result.left.map((entry) => <li key={entry.itemId}><button type="button" onClick={() => onJump(entry)}
          className="flex min-h-[44px] w-full items-center text-left text-sm text-co-text underline focus-visible:ring-4 focus-visible:ring-co-gold/60">{entry.label}</button></li>)}
      </ul> : null}
      {result.needsHigherRole.length > 0 ? <div className="border-t border-co-border pt-2">
        <p className="text-xs font-bold text-co-text-muted">{t("whats_left.higher_role", { n: result.needsHigherRole.length })}</p>
        <ul>{result.needsHigherRole.map((entry) => <li key={entry.itemId}><button type="button" onClick={() => onJump(entry)}
          className="flex min-h-[44px] w-full items-center text-left text-sm text-co-text-muted underline focus-visible:ring-4 focus-visible:ring-co-gold/60">
          {entry.label} · {t("whats_left.key_holder")}</button></li>)}</ul>
      </div> : null}
    </div> : null}
  </section>;
}
