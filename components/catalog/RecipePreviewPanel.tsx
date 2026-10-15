"use client";

/**
 * "WHAT THIS CHANGES" for a recipe act (catalog Phase 3b; spec §4). Renders the server's preview: the
 * ingredient changes in plain words, every reached scope's sandwich cost moves (and the prep items it
 * makes), the shops left untouched, the shop a promote returns to the default, the link a restore drops
 * (lead decision: said BEFORE saving), the carried lines that still need fixing (flagged, not refused —
 * lead decision (b)), and ONE save button for THE previewed act and target.
 *
 * Phone-first: every row breaks long words and every button row wraps, so nothing clips at 375px.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatQuantity } from "@/lib/i18n/format";
import { lineText, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import { recipeErrorKey } from "@/lib/catalog/recipe-item-shared";

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

export function RecipePreviewPanel({
  preview, saveLabel, busy, onSave, onDiscard, becomesShopVersion = null,
}: {
  preview: RecipePreview; saveLabel: string; busy: boolean; onSave: () => void; onDiscard: () => void;
  /** A restore for a shop: that shop's name — the restored version becomes ITS own, never the default (CC note 5 #2). */
  becomesShopVersion?: string | null;
}) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const fmt = (n: number) => formatQuantity(n, language);
  const line = (f: Parameters<typeof lineText>[0]) => lineText(f, preview.names, fmt);
  return (
    <section aria-label={t("catalog.recipe.preview.title")} className="min-w-0 break-words rounded-xl border-2 border-co-text bg-co-surface p-3">
      <h3 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.preview.title")}</h3>
      <p className={`mt-2 ${eyebrow}`}>{t("catalog.recipe.preview.changes")}</p>
      {preview.changes.length === 0 ? (
        <p className="text-sm text-co-text">{t("catalog.recipe.preview.none")}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {preview.changes.map((c, i) => (
            <li key={`${c.key}-${i}`} className="text-sm text-co-text">
              {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: line(c.after) })
                : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: line(c.before) })
                : c.before && c.after ? t("catalog.recipe.preview.changed", { before: line(c.before), after: line(c.after) }) : null}
            </li>
          ))}
        </ul>
      )}
      {preview.reached.map((r) => (
        <div key={r.scope ?? "global"} className="mt-3">
          <p className={eyebrow}>{r.scope === null ? t("catalog.recipe.preview.scope_global") : r.scopeName}</p>
          {r.items.map((it) => (
            <p key={it.itemId} className="text-sm text-co-text">
              {t("catalog.recipe.preview.item_cost", { name: it.name, before: money(it.before), after: money(it.after) })}
            </p>
          ))}
          {r.menu.length === 0 ? (
            <p className="text-sm text-co-text-muted">{t("catalog.recipe.preview.no_cost_change")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {r.menu.map((m) => (
                <li key={m.menuItemId} className="text-sm text-co-text">
                  {t("catalog.recipe.preview.cost_row", { name: language === "es" && m.nameEs ? m.nameEs : m.name, before: money(m.before), after: money(m.after) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {preview.untouched.length > 0 ? (
        <p className="mt-3 text-sm text-co-text-muted">{t("catalog.recipe.preview.untouched", { shops: preview.untouched.map((u) => u.shopName).join(", ") })}</p>
      ) : null}
      {becomesShopVersion ? (
        <p role="note" className="mt-2 text-sm font-bold text-co-text">{t("catalog.recipe.preview.becomes_shop_version", { shop: becomesShopVersion })}</p>
      ) : null}
      {preview.returnedShop ? (
        <p className="mt-2 text-sm text-co-text">{t("catalog.recipe.preview.returned", { shop: preview.returnedShop.shopName })}</p>
      ) : null}
      {preview.dropsLinkTo !== null ? (
        <p role="note" className="mt-2 rounded-lg border-2 border-co-warning bg-co-warning-surface p-2 text-sm font-bold text-co-text">
          {t("catalog.recipe.preview.drops_link", { shop: preview.dropsLinkTo })}
        </p>
      ) : null}
      {preview.flagged.length > 0 ? (
        <div className="mt-2">
          <p className={eyebrow}>{t("catalog.recipe.preview.flagged_title")}</p>
          <ul className="mt-1 flex flex-col gap-1" aria-label={t("catalog.recipe.preview.flagged_title")}>
            {preview.flagged.map((f) => (
              <li key={f.position} className="text-sm font-bold text-co-cta-text">
                {t("catalog.recipe.line_problem", { position: f.position, name: f.name, reason: t(recipeErrorKey(f.reason)) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>{saveLabel}</button>
        <button type="button" className={btn} disabled={busy} onClick={onDiscard}>{t("catalog.recipe.preview.discard")}</button>
      </div>
    </section>
  );
}
