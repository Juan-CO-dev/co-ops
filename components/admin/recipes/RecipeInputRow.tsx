"use client";

/**
 * RecipeInputRow — one existing recipe_input edge with a remove (✕) button.
 * Matches MadeFromEditor's MadeFromRow look (border-2 border-co-border card).
 * Calls onRemove(edgeId) on confirm.
 *
 * LOUD ON A DISCONTINUED PIN (Juan's ruling A+, 2026-08-21 — "the recipe should be
 * loud too, so that they know they have a discontinued sku in the recipe that needs
 * to be updated"). A retired product or a deactivated SKU turns the whole row
 * danger-adjacent — a red-outline card plus an inline badge — because the fault is
 * the LINE, not a detail inside it, and a quiet chip on a normal-looking card is how
 * a manager scrolls past the one row that is broken.
 *
 * DANGER-ADJACENT, NOT DANGER-FILLED (AGENTS.md token roles): the edge and the label
 * both take `co-cta-text` — `co-cta` is a fill token and falls under the 3:1 floor as
 * an edge on a light ground — and the tint is `co-danger-surface`, the badge tint the
 * product registry's own danger Pill already uses.
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { RecipeInputView } from "@/lib/recipes-shared";
import type { TranslationKey } from "@/lib/i18n/types";

const rk = (k: string): TranslationKey => k as TranslationKey;

export function RecipeInputRow({
  input,
  canEdit,
  onRemove,
}: {
  input: RecipeInputView;
  canEdit: boolean;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const label = [
    input.quantity > 0 ? String(input.quantity) : null,
    input.unit ?? null,
    input.componentName,
  ]
    .filter(Boolean)
    .join(" ");

  const meta = [
    input.eachContainerLabel ? t(rk("recipes.input.container_label")) + ": " + input.eachContainerLabel : null,
    input.portioned ? t(rk("recipes.input.portioned_tag")) : null,
    // Which of the three targets this line names (0179). `kind` comes off the
    // server view — the row does not re-derive it from which id is non-null.
    input.kind === "product" ? t(rk("recipes.input.product_tag"))
      : input.kind === "sku" ? t(rk("recipes.input.sku_tag"))
        : t(rk("recipes.input.item_tag")),
  ]
    .filter(Boolean)
    .join(" · ");

  const retired = input.componentRetired;

  return (
    <div
      className={`rounded-lg border-2 p-3 ${
        retired ? "border-co-cta-text bg-co-danger-surface" : "border-co-border bg-co-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {retired ? (
            <p
              className="mt-1 inline-flex items-center rounded-full bg-co-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-cta-text"
              // The badge is the whole message, so it needs no separate label — but
              // the row it indicts does: a screen reader must hear WHICH ingredient
              // is discontinued, not just that something on the page is.
              aria-label={t(rk("recipes.input.retired_aria"), { name: input.componentName })}
            >
              {t(rk("recipes.input.retired_badge"))}
            </p>
          ) : null}
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        ) : null}
      </div>
      {confirming && canEdit ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta-text bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text"
            >
              {t(rk("recipes.row.cancel"))}
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); onRemove(input.id); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text"
            >
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
