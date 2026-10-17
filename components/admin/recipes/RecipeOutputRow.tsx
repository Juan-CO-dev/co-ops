"use client";

/**
 * RecipeOutputRow — one existing recipe_output edge with a remove (✕) button.
 * Matches RecipeInputRow's look (mirror of MadeFromEditor's MadeFromRow).
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { RecipeOutputView } from "@/lib/recipes-shared";
import type { TranslationKey } from "@/lib/i18n/types";

const rk = (k: string): TranslationKey => k as TranslationKey;

export function RecipeOutputRow({
  output,
  canEdit,
  onRemove,
  onSaveYield,
  onEditingChange,
}: {
  output: RecipeOutputView;
  canEdit: boolean;
  onRemove: (id: string) => void;
  /** Only the owned batch output has the existing serialized in-place yield writer. */
  onSaveYield?: (value: number) => Promise<{ ok: boolean; error?: string }>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [yieldText, setYieldText] = useState(String(output.yield));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveYield = async () => {
    if (busy || !canEdit || !onSaveYield) return;
    const value = Number(yieldText);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) { setError(t(rk("recipes.error.invalid_yield"))); return; }
    setBusy(true); setError(null);
    try {
      const result = await onSaveYield(value);
      if (result.ok) { setEditing(false); onEditingChange?.(false); }
      else setError(result.error ?? null);
    } catch { setError(t(rk("recipes.error.generic"))); }
    finally { setBusy(false); }
  };

  const label = `${output.yield} × ${output.outputName}`;
  const meta = [
    output.outputContainerLabel
      ? t(rk("recipes.output.container_label")) + ": " + output.outputContainerLabel
      : null,
    output.outputItemId ? t(rk("recipes.output.item_tag")) : t(rk("recipes.output.menu_item_tag")),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        {canEdit && onSaveYield && !editing ? <button type="button"
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 text-sm font-bold"
          onClick={() => { setYieldText(String(output.yield)); setError(null); setConfirming(false); setEditing(true); onEditingChange?.(true); }}>
          {t(rk("recipes.output.edit_yield"))}
        </button> : null}
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        ) : null}
      </div>
      {editing && canEdit && onSaveYield ? <div className="mt-3 min-w-0 space-y-2">
        <label className="block text-sm font-bold">{t(rk("recipes.output.yield"))}
          <input type="number" min={0.001} max={100000} step="any" inputMode="decimal" value={yieldText}
            aria-label={t(rk("recipes.output.yield"))}
            disabled={busy} onChange={e => setYieldText(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base" />
        </label>
        {error ? <p role="alert" className="break-words text-sm text-co-cta-text">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="min-h-[44px] rounded-lg border-2 border-co-border px-3 text-sm font-bold" onClick={() => { setEditing(false); onEditingChange?.(false); }}>{t(rk("recipes.builder.cancel"))}</button>
          <button type="button" disabled={busy} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-sm font-bold" onClick={() => void saveYield()}>{t(rk("recipes.builder.save"))}</button>
        </div>
      </div> : null}
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
              onClick={() => { setConfirming(false); onRemove(output.id); }}
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
