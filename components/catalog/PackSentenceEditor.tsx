"use client";

/**
 * PackSentenceEditor — THE pack editor on the item page (catalog Phase 2b; spec §4 "the pack editor
 * is always the sentence editor": first time and every edit, the per-piece weight inline).
 *
 *     1 [case]  holds [6] [bag]  each bag weighs [5] [lb]
 *
 * Controlled: the parent owns the draft (useState-only disclosure law); this renders and reports
 * edits. The model is pure (lib/catalog/pack-sentence-shared.ts). On this path it replaces the raw
 * ChainEditor ("…of / Another level / A measure unit"); PackChainWizard keeps the first-time add flow
 * in SkuBuilder until Phase 4's "New item" job takes over.
 */
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { leafUnitChoices, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";

const field =
  "min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const smallBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const ERROR_KEY: Record<SentenceError, TranslationKey> = {
  empty_label: "catalog.pack.error.empty_label",
  duplicate_label: "catalog.pack.error.duplicate_label",
  label_is_measure_unit: "catalog.pack.error.label_is_measure_unit",
  bad_qty: "catalog.pack.error.bad_qty",
  no_leaf_unit: "catalog.pack.error.no_leaf_unit",
  unknown_measure: "catalog.pack.error.unknown_measure",
};
const MAX_LEVELS = 4;

export function PackSentenceEditor({
  draft,
  onChange,
  units,
  skuClass,
  currentLeafUnit,
  avgOzPerEach,
  error,
  busy,
}: {
  draft: SentenceDraft;
  onChange: (next: SentenceDraft) => void;
  units: ReadonlyArray<{ label: string; dimension: "weight" | "volume" | "count" }>;
  skuClass: string;
  currentLeafUnit: string | null;
  avgOzPerEach: number | null;
  error: { error: SentenceError; index: number } | null;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const n = draft.containers.length;
  const lastLabel = draft.containers[n - 1]?.label.trim() || "…";
  const choices = leafUnitChoices(units, skuClass, currentLeafUnit);
  const leafDimension = units.find((u) => u.label === draft.leafUnit)?.dimension ?? "weight";
  const bad = (i: number) => (error != null && error.index === i ? true : undefined);
  const setContainer = (i: number, patch: Partial<SentenceDraft["containers"][number]>) =>
    onChange({ ...draft, containers: draft.containers.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div role="group" aria-label={t("catalog.pack.sentence_aria")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-base font-bold text-co-text">1</span>
        <input
          className={`${field} w-40`}
          value={draft.containers[0]?.label ?? ""}
          disabled={busy}
          aria-invalid={bad(0)}
          aria-label={t("catalog.pack.container_label")}
          onChange={(e) => setContainer(0, { label: e.target.value })}
        />
      </div>
      {draft.containers.slice(1).map((c, k) => {
        const i = k + 1;
        const parent = draft.containers[i - 1]?.label.trim() || "…";
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 pl-4">
            <span className="text-sm text-co-text-muted">{t("catalog.pack.holds")}</span>
            <input
              className={`${field} w-24`}
              inputMode="decimal"
              value={c.qty}
              disabled={busy}
              aria-invalid={bad(i)}
              aria-label={t("catalog.pack.qty_aria", { container: parent })}
              onChange={(e) => setContainer(i, { qty: e.target.value })}
            />
            <input
              className={`${field} w-40`}
              value={c.label}
              disabled={busy}
              aria-invalid={bad(i)}
              aria-label={t("catalog.pack.inner_label")}
              onChange={(e) => setContainer(i, { label: e.target.value })}
            />
            <button
              type="button"
              className={smallBtn}
              disabled={busy}
              aria-label={t("catalog.pack.remove_level_aria", { container: c.label.trim() || "…" })}
              onClick={() => onChange({ ...draft, containers: draft.containers.filter((_, j) => j !== i) })}
            >
              {t("catalog.pack.remove_level")}
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pl-4">
        <span className="text-sm text-co-text-muted">
          {t(leafDimension === "weight" ? "catalog.pack.each_weighs" : "catalog.pack.each_holds", { container: lastLabel })}
        </span>
        <input
          className={`${field} w-24`}
          inputMode="decimal"
          value={draft.leafQty}
          disabled={busy}
          aria-invalid={bad(n - 1)}
          aria-label={t("catalog.pack.amount")}
          onChange={(e) => onChange({ ...draft, leafQty: e.target.value })}
        />
        <select
          className={`${field} w-28`}
          value={draft.leafUnit}
          disabled={busy}
          aria-label={t("catalog.pack.unit")}
          onChange={(e) => onChange({ ...draft, leafUnit: e.target.value })}
        >
          {draft.leafUnit === "" ? <option value="">—</option> : null}
          {choices.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      {leafDimension !== "weight" && avgOzPerEach != null ? (
        <p className="text-xs text-co-text-dim">{t("catalog.pack.leaf_uses_avg", { oz: String(avgOzPerEach) })}</p>
      ) : null}
      {n < MAX_LEVELS ? (
        <button
          type="button"
          className={`${smallBtn} self-start`}
          disabled={busy}
          onClick={() => onChange({ ...draft, containers: [...draft.containers, { label: "", qty: "" }] })}
        >
          {t("catalog.pack.add_level")}
        </button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-co-cta-text">{t(ERROR_KEY[error.error])}</p> : null}
    </div>
  );
}
