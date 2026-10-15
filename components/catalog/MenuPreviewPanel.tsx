"use client";

/**
 * "WHAT THIS CHANGES" for a menu item act (catalog Phase 3b; spec §4) — the twin of RecipePreviewPanel. Renders
 * the server's preview in full: the price and the margin over this scope's food cost, sold here, BOTH names, what
 * the shop inherits after the save, and — on a promote — the shops whose menu changes and the shop that goes back to
 * the default. ONE save button for THE previewed act.
 *
 * LEAD DECISIONS this panel carries:
 *  - A promote shows the Spanish name before → after TRUTHFULLY (CC note 1 #2): the shop's pair copied exactly,
 *    never the old default's Spanish name; when the Spanish result is empty it says "Spanish users will see the
 *    English name until you add one." A name promote offers the optional "Spanish name" field in the same step.
 *  - The preview binds the COMPLETE change: a Spanish name typed here but not yet previewed hides Save and asks to
 *    look again, so what is saved is always what was shown.
 *
 * Phone-first: every row breaks long words and every button row wraps, so nothing clips at 375px.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import type { MenuPreview } from "@/lib/catalog/recipe-preview-shared";

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

/** The optional Spanish name on a NAME promote: what is typed, and what the shown preview was computed with. */
export interface PromoteNameEs {
  value: string;
  previewed: string;
  onChange: (v: string) => void;
  onRepreview: () => void;
}

export function MenuPreviewPanel({
  preview, saveLabel, busy, onSave, onDiscard, promoteNameEs,
}: {
  preview: MenuPreview;
  saveLabel: string;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Present only on a promote that includes the name. */
  promoteNameEs?: PromoteNameEs;
}) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const yesNo = (b: boolean) => t(b ? "catalog.menu.preview.yes" : "catalog.menu.preview.no");
  const promote = preview.kind === "promote";
  // Typed but not yet shown: the save would not be what this panel shows, so Save waits for a fresh look.
  const unpreviewed = promoteNameEs !== undefined && promoteNameEs.value.trim() !== promoteNameEs.previewed.trim();
  const fallsBack = preview.spanishFallsBackToEnglish || preview.after.nameEs === null;
  return (
    <section aria-label={t("catalog.menu.preview.title")} className="min-w-0 break-words rounded-xl border-2 border-co-text bg-co-surface p-3">
      <h3 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.menu.preview.title")}</h3>
      <p className="mt-2 text-sm text-co-text">{t("catalog.menu.preview.price", { before: money(preview.before.price), after: money(preview.after.price) })}</p>
      <p className="text-sm text-co-text">{t("catalog.menu.preview.margin", { before: money(preview.marginBefore), after: money(preview.marginAfter) })}</p>
      {!promote ? (
        <p className="text-sm text-co-text">{t("catalog.menu.preview.sold", { before: yesNo(preview.before.soldHere), after: yesNo(preview.after.soldHere) })}</p>
      ) : null}
      <p className="text-sm text-co-text">{t("catalog.menu.preview.name", { before: preview.before.name, after: preview.after.name })}</p>
      <p className="text-sm text-co-text">{t("catalog.menu.preview.name_es", { before: preview.before.nameEs ?? "—", after: preview.after.nameEs ?? "—" })}</p>
      {fallsBack ? (
        <p role="note" className="mt-1 rounded-lg border-2 border-co-warning bg-co-warning-surface p-2 text-sm text-co-text">
          {t("catalog.menu.preview.name_es_fallback")}
        </p>
      ) : null}
      {!promote && (preview.before.inherits.price !== preview.after.inherits.price || preview.before.inherits.name !== preview.after.inherits.name) ? (
        <p className="text-sm text-co-text-muted">
          {t("catalog.menu.preview.inherits", {
            price: t(preview.after.inherits.price ? "catalog.menu.preview.inherits_default" : "catalog.menu.preview.inherits_own"),
            name: t(preview.after.inherits.name ? "catalog.menu.preview.inherits_default" : "catalog.menu.preview.inherits_own"),
          })}
        </p>
      ) : null}
      {promote ? (
        <p className="mt-2 text-sm text-co-text">{t("catalog.menu.preview.shops", { shops: preview.changedShops.map((s) => s.shopName).join(", ") || "—" })}</p>
      ) : null}
      {preview.returnedShop ? (
        <p className="text-sm text-co-text">{t("catalog.menu.preview.returned", { shop: preview.returnedShop.shopName })}</p>
      ) : null}
      {promoteNameEs ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="block">
            <span className={fieldLabel}>{t("catalog.menu.promote.name_es_field")}</span>
            <input className={field} value={promoteNameEs.value} maxLength={120} disabled={busy} onChange={(e) => promoteNameEs.onChange(e.target.value)} />
          </label>
          {unpreviewed ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-sm text-co-text">{t("catalog.menu.promote.name_es_unpreviewed")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={promoteNameEs.onRepreview}>{t("catalog.menu.see_changes")}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {!unpreviewed ? <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>{saveLabel}</button> : null}
        <button type="button" className={btn} disabled={busy} onClick={onDiscard}>{t("catalog.menu.cancel")}</button>
      </div>
    </section>
  );
}
