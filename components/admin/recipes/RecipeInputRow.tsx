"use client";

/**
 * RecipeInputRow — one existing recipe_input edge with a remove (✕) button.
 * Matches MadeFromEditor's MadeFromRow look (border-2 border-co-border card).
 * Calls onRemove(edgeId) on confirm.
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { RecipeInputView } from "@/lib/recipes";
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
    input.componentSkuId ? t(rk("recipes.input.sku_tag")) : t(rk("recipes.input.item_tag")),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        ) : null}
      </div>
      {confirming && canEdit ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
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
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface"
            >
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
