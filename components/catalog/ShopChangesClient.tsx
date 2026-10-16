"use client";

/**
 * THE SHOP CHANGES LIST — client body (catalog Phase 3b; spec §6, for the Director of Operations). Every live shop
 * recipe version and menu setting, newest first: what it changes against today's default, where, who, when. Promote =
 * "What this changes" (who it reaches, who stays untouched, the shop that goes back to the default) → Tier E save with
 * the preview's token; Leave folds the row away on this screen only (the shop keeps its version — nothing is written).
 *
 * LEAD DECISIONS this body carries:
 *  - Promote returns the source shop to the default — said on the row BEFORE the preview, and named in the preview.
 *  - A menu name promote shows the Spanish name before → after truthfully, with the optional "Spanish name" field and
 *    the English-fallback label (the menu page's own MenuPreviewPanel, reused). A promote refused AFTER its Spanish
 *    name saved says so plainly (menuRefusalText) and reloads the list, which then shows the shop's new label.
 *  - A preview binds the complete change: a Spanish name typed after it hides Save; a row that changes (or goes away)
 *    under an open preview drops it — Save goes with it — and asks to "Preview again" (the pages' rule, mirrored).
 *  - Every refusal is NAMED (the pages' one refusal map), a refused line by position, name and reason.
 *  - Every row deep-links to THAT shop's view of the recipe or menu item (?location=<shop>), never the default's.
 *  - Phone-first: rows and button rows WRAP, long names break, every control is 44px. Shops are ids and names.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { etDisplayDate } from "@/lib/operational-day";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { RecipePreviewPanel } from "@/components/catalog/RecipePreviewPanel";
import { MenuPreviewPanel, type PromoteNameEs } from "@/components/catalog/MenuPreviewPanel";
import { menuRefusalText } from "@/components/catalog/MenuItemClient";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { lineText, type MenuPreview, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import type { RecipeLineRefusal } from "@/lib/recipe-versions-shared";
import {
  menuItemPageHref, recipeErrorKey, recipeItemHref, shopChangeRowRevision,
  type MenuPromoteField, type ShopChangeMenuRow, type ShopChangeRecipeRow, type ShopChangesView,
} from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] max-w-full items-center justify-center break-words rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] max-w-full items-center justify-center break-words rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const linkRow = "flex min-h-[44px] min-w-0 items-center break-words rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";
const card = "flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-border bg-co-surface-inset p-2";

/** Refusals that mean "this row moved underneath": the list refreshes to show it as it is NOW. */
const REFRESH_ON: ReadonlySet<string> = new Set(["version_changed", "global_changed", "not_live", "recipe_inactive", "not_found", "invalid_source", "nothing_to_promote"]);
/** …and the ones where the SAME promote can simply be looked at again ("See what this changes"). */
const REPREVIEW_ON: ReadonlySet<string> = new Set(["preview_stale", "dependencies_changed"]);

/** One row's flow: its preview, why it can be looked at again, whether the row changed after it, and a refusal. */
export interface RowFlow<P> { preview: P | null; retry: string | null; dropped: boolean; message: string | null }

type Refusal = { code: string; line?: RecipeLineRefusal; spanishNameSaved?: { settingId: string; locationId: string } };
type RecipePromote = { kind: "promote"; sourceVersionId: string };
type MenuPromote = { kind: "promote"; settingId: string; fields: readonly MenuPromoteField[]; nameEs?: string };
/** The ONE promote being looked at: its row (key + the revision it was previewed against) and exactly what is posted. */
type Pending =
  | { kind: "recipe"; key: string; rev: string; shopName: string; recipeId: string; change: RecipePromote }
  | { kind: "menu"; key: string; rev: string; shopName: string; menuItemId: string; change: MenuPromote };

const recipeKey = (r: ShopChangeRecipeRow) => `recipe:${r.versionId}`;
const menuKey = (m: ShopChangeMenuRow) => `menu:${m.settingId}`;
/** Every shop the list names (ids and names — never codes), for menuRefusalText. */
const shopsOf = (view: ShopChangesView) =>
  [...new Map([...view.recipes, ...view.menu].map((r) => [r.shopId, { id: r.shopId, name: r.shopName }])).values()];

/** The part of a row that follows Promote: a refusal, "Preview again", a stale preview to look at again, or the panel. */
function FlowBlock({ kind, flow, busy, onRepreview, onDiscard, children }: {
  kind: "recipe" | "menu"; flow: RowFlow<unknown> | null; busy: boolean; onRepreview: () => void; onDiscard: () => void; children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!flow) return null;
  const again = kind === "recipe" ? t("catalog.recipe.preview_again") : t("catalog.menu.preview_again");
  const look = kind === "recipe" ? t("catalog.recipe.see_changes") : t("catalog.menu.see_changes");
  const notNow = kind === "recipe" ? t("catalog.recipe.preview.discard") : t("catalog.menu.cancel");
  const warn = "flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-2";
  return (
    <>
      {flow.message ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{flow.message}</p> : null}
      {flow.dropped ? (
        <div role="status" className={warn}>
          <p className="text-sm text-co-text">{t("catalog.changes.list_changed")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={onRepreview}>{again}</button>
            <button type="button" className={btn} disabled={busy} onClick={onDiscard}>{notNow}</button>
          </div>
        </div>
      ) : flow.retry ? (
        <div role="status" className={warn}>
          <p className="text-sm text-co-text">{flow.retry}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={onRepreview}>{look}</button>
            <button type="button" className={btn} disabled={busy} onClick={onDiscard}>{notNow}</button>
          </div>
        </div>
      ) : flow.preview ? children : null}
    </>
  );
}

/** One shop recipe version: where, who, what it changes (on demand), Promote or Leave. */
export function ShopChangeRecipeCard({ row, names, busy, flow, onPromote, onLeave, onSave, onDiscard, onRepreview }: {
  row: ShopChangeRecipeRow; names: Record<string, string>; busy: boolean; flow: RowFlow<RecipePreview> | null;
  onPromote: () => void; onLeave: () => void; onSave: () => void; onDiscard: () => void; onRepreview: () => void;
}) {
  const { t, language } = useTranslation();
  const [shown, setShown] = useState(false);
  const fmt = (n: number) => formatQuantity(n, language);
  const day = (iso: string) => formatDateLabel(etDisplayDate(iso), language); // the operational (ET) day
  return (
    <li className={card}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Link href={recipeItemHref(row.recipeId, { shopId: row.shopId })} className={linkRow}>{row.recipeName}</Link>
        <span className="min-w-0 break-words text-xs text-co-text-muted">{t("catalog.changes.by", { shop: row.shopName, who: row.createdByName ?? "—", date: day(row.validFrom) })}</span>
      </div>
      {row.adoptedFromShopName ? <p className="text-xs text-co-text-muted">{t("catalog.changes.adopted_from", { shop: row.adoptedFromShopName })}</p> : null}
      {row.sameAsDefault ? (
        <>
          <p className="text-sm text-co-text-muted">{t("catalog.changes.same_as_default")}</p>
          {/* Nothing to promote — the way forward is that shop's own page (Back to default lives there). */}
          <p className="text-sm text-co-text">{t("catalog.changes.same_as_default_hint", { shop: row.shopName })}</p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} aria-expanded={shown} onClick={() => setShown((s) => !s)}>
              {shown ? t("catalog.changes.hide") : t("catalog.changes.show")}
            </button>
          </div>
          {shown ? (
            <ul className="flex flex-col gap-1">
              {row.changes.map((c, i) => (
                <li key={`${c.key}-${i}`} className="text-sm text-co-text">
                  {c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: lineText(c.after, names, fmt) })
                    : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: lineText(c.before, names, fmt) })
                    : c.before && c.after ? t("catalog.recipe.preview.changed", { before: lineText(c.before, names, fmt), after: lineText(c.after, names, fmt) }) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!row.sameAsDefault ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={onPromote}>{t("catalog.changes.promote")}</button>
        ) : null}
        <button type="button" className={btn} disabled={busy} onClick={onLeave}>{t("catalog.changes.leave")}</button>
      </div>
      {/* Lead decision: promote returns the source shop to the default — said before the preview. */}
      {!row.sameAsDefault ? <p className="text-xs text-co-text-muted">{t("catalog.changes.promote_returns", { shop: row.shopName })}</p> : null}
      <FlowBlock kind="recipe" flow={flow} busy={busy} onRepreview={onRepreview} onDiscard={onDiscard}>
        {flow?.preview ? (
          <RecipePreviewPanel preview={flow.preview} saveLabel={t("catalog.recipe.preview.save.promote")} busy={busy} onSave={onSave} onDiscard={onDiscard} />
        ) : null}
      </FlowBlock>
    </li>
  );
}

/** One shop menu setting: where, who, its own price / sold here / names, Promote (price or name) or Leave. */
export function ShopChangeMenuCard({ row, busy, flow, promoteNameEs, onPromote, onLeave, onSave, onDiscard, onRepreview }: {
  row: ShopChangeMenuRow; busy: boolean; flow: RowFlow<MenuPreview> | null;
  /** Present only while a NAME promote of this row is open (the optional Spanish name). */
  promoteNameEs?: PromoteNameEs;
  onPromote: (fields: MenuPromoteField[]) => void; onLeave: () => void; onSave: () => void; onDiscard: () => void; onRepreview: () => void;
}) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(etDisplayDate(iso), language); // the operational (ET) day
  const canPromote = row.price !== null || row.nameOverride !== null;
  return (
    <li className={card}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Link href={menuItemPageHref(row.menuItemId, { shopId: row.shopId })} className={linkRow}>{row.menuItemName}</Link>
        <span className="min-w-0 break-words text-xs text-co-text-muted">{t("catalog.changes.by", { shop: row.shopName, who: row.createdByName ?? "—", date: day(row.validFrom) })}</span>
      </div>
      {row.price !== null ? <p className="text-sm text-co-text">{t("catalog.changes.price_here", { price: money(row.price), global: money(row.global.price) })}</p> : null}
      {!row.soldHere ? <p className="text-sm text-co-text">{t("catalog.changes.off_here")}</p> : null}
      {row.nameOverride ? <p className="text-sm text-co-text">{t("catalog.changes.name_here", { name: row.nameOverride })}</p> : null}
      {row.nameOverrideEs ? <p className="text-sm text-co-text">{t("catalog.changes.name_here_es", { name: row.nameOverrideEs })}</p> : null}
      <div className="flex flex-wrap gap-2">
        {row.price !== null ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => onPromote(["price"])}>
            {t("catalog.changes.promote_price", { price: money(row.price) })}
          </button>
        ) : null}
        {row.nameOverride ? (
          <button type="button" className={btn} disabled={busy} onClick={() => onPromote(["name"])}>
            {t("catalog.changes.promote_name", { name: row.nameOverride })}
          </button>
        ) : null}
        <button type="button" className={btn} disabled={busy} onClick={onLeave}>{t("catalog.changes.leave")}</button>
      </div>
      {/* Lead decision: promote returns the source shop to the default for what it shares — said before the preview. */}
      {canPromote ? <p className="text-xs text-co-text-muted">{t("catalog.menu.promote.hint", { shop: row.shopName })}</p> : null}
      <FlowBlock kind="menu" flow={flow} busy={busy} onRepreview={onRepreview} onDiscard={onDiscard}>
        {flow?.preview ? (
          <MenuPreviewPanel preview={flow.preview} saveLabel={t("catalog.menu.preview.save_promote")} busy={busy} onSave={onSave} onDiscard={onDiscard}
            promoteNameEs={promoteNameEs} />
        ) : null}
      </FlowBlock>
    </li>
  );
}

export function ShopChangesClient({ view }: { view: ShopChangesView }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  // Both lists are this page's primary content (disclosure doctrine D3): open; each row folds its own detail.
  const [open, setOpen] = useState({ recipes: true, menu: true });
  /** Rows folded away by Leave — on this screen only; nothing is written. */
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<RecipePreview | MenuPreview | null>(null);
  /** Something moved under the pending promote: why, and an offer to look at the same promote again. */
  const [retry, setRetry] = useState<string | null>(null);
  /** The pending row changed after its preview: that preview and its Save no longer match it — Preview again. */
  const [dropped, setDropped] = useState(false);
  /** A refusal, shown on its own row (or at the top when that row is gone). */
  const [rowMessage, setRowMessage] = useState<{ key: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** The optional Spanish name typed on a NAME promote's preview (blank = the shop's own pair is copied as it is). */
  const [promoteEs, setPromoteEs] = useState("");
  const [busy, setBusy] = useState(false);
  // A late preview from a superseded request is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());

  const rowByKey = (key: string): ShopChangeRecipeRow | ShopChangeMenuRow | undefined =>
    key.startsWith("recipe:") ? view.recipes.find((r) => recipeKey(r) === key) : view.menu.find((m) => menuKey(m) === key);

  // A PREVIEW BELONGS TO THE ROW AS IT WAS (the pages' "Preview again", mirrored). A refresh (another manager's save,
  // a moved default) that brings the pending row back different drops the preview — Save goes with it — and asks to
  // Preview again; a row that is gone says so. React's prev-compare pattern: state set during render, once.
  const pendingRow = pending ? rowByKey(pending.key) : undefined;
  const pendingRev = pending ? (pendingRow ? shopChangeRowRevision(pendingRow) : "") : null;
  if (pending && pendingRev !== null && pendingRev !== pending.rev) {
    guard.invalidate();
    setPreview(null);
    setRetry(null);
    if (pendingRow) {
      setPending({ ...pending, rev: pendingRev });
      setDropped(true);
    } else {
      setPending(null);
      setDropped(false);
      setMessage(t("catalog.changes.row_gone", { shop: pending.shopName }));
    }
  }

  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setDropped(false); setPromoteEs(""); };

  /** The words for a refusal (named — the pages' one refusal map), and what the list does next. */
  const fail = (p: Pending, r: Refusal) => {
    const text = p.kind === "recipe"
      ? (r.line
        ? t("catalog.recipe.error.line_refused", { position: r.line.position, name: r.line.name, reason: t(recipeErrorKey(r.line.reason)) })
        : t(recipeErrorKey(r.code)))
      : menuRefusalText(t, r, shopsOf(view));
    if (r.spanishNameSaved) {
      // The shop's own label DID change (it is in History): say so plainly, and reload so the list shows it.
      reset(); setRowMessage(null); setMessage(text); router.refresh();
      return;
    }
    if (REPREVIEW_ON.has(r.code)) {
      setPreview(null); setRetry(text); router.refresh();
      return;
    }
    reset();
    setRowMessage({ key: p.key, text });
    if (REFRESH_ON.has(r.code)) router.refresh();
  };

  /** "What this changes" for ONE promote — a read, guarded against late answers. */
  const askPreview = async (p: Pending) => {
    setMessage(null); setRowMessage(null); setRetry(null); setPreview(null); setDropped(false); setPending(p); setBusy(true);
    const url = p.kind === "recipe" ? `/api/admin/catalog/recipe/${p.recipeId}/preview` : `/api/admin/catalog/menu-item/${p.menuItemId}/preview`;
    const r = await guard.run(() => postJson(url, { change: p.change }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request owns the panel
    if (r.ok) { setPreview(r.data.preview as RecipePreview | MenuPreview); return; }
    fail(p, r);
  };
  /** Save EXACTLY what the preview showed: its change and its token (Tier E). */
  const save = async () => {
    const p = pending;
    if (!p || !preview) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const url = p.kind === "recipe" ? `/api/admin/catalog/recipe/${p.recipeId}/apply` : `/api/admin/catalog/menu-item/${p.menuItemId}/apply`;
    const r = await send(url, { change: p.change, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { reset(); setMessage(t("catalog.recipe.saved")); router.refresh(); }
    else fail(p, r);
  };
  const promoteRecipe = (r: ShopChangeRecipeRow) => {
    setPromoteEs("");
    void askPreview({ kind: "recipe", key: recipeKey(r), rev: shopChangeRowRevision(r), shopName: r.shopName, recipeId: r.recipeId,
      change: { kind: "promote", sourceVersionId: r.versionId } });
  };
  const promoteMenu = (m: ShopChangeMenuRow, fields: MenuPromoteField[]) => {
    setPromoteEs("");
    void askPreview({ kind: "menu", key: menuKey(m), rev: shopChangeRowRevision(m), shopName: m.shopName, menuItemId: m.menuItemId,
      change: { kind: "promote", settingId: m.settingId, fields } });
  };
  /** Look again at the SAME menu promote with the Spanish name typed now (the preview — and its token — bind it). */
  const repreviewPromote = () => {
    if (pending?.kind !== "menu") return;
    const typed = promoteEs.trim();
    const change: MenuPromote = { kind: "promote", settingId: pending.change.settingId, fields: pending.change.fields, ...(typed ? { nameEs: typed } : {}) };
    void askPreview({ ...pending, change });
  };
  const repreview = () => { if (pending) void askPreview(pending); };
  const leave = (key: string) => {
    if (pending?.key === key) reset();
    if (rowMessage?.key === key) setRowMessage(null);
    setLeft((s) => new Set(s).add(key));
  };
  const unfold = (keys: string[]) => setLeft((s) => { const next = new Set(s); for (const k of keys) next.delete(k); return next; });

  /** This row's flow, or null when nothing is open on it. */
  const flowFor = <P,>(key: string): RowFlow<P> | null => {
    const msg = rowMessage?.key === key ? rowMessage.text : null;
    if (pending?.key === key) return { preview: preview as P | null, retry, dropped, message: msg };
    return msg ? { preview: null, retry: null, dropped: false, message: msg } : null;
  };
  const promoteNameEsFor = (m: ShopChangeMenuRow): PromoteNameEs | undefined =>
    pending?.kind === "menu" && pending.key === menuKey(m) && pending.change.fields.includes("name")
      ? { value: promoteEs, previewed: pending.change.nameEs ?? "", onChange: setPromoteEs, onRepreview: repreviewPromote }
      : undefined;

  const recipes = view.recipes.filter((r) => !left.has(recipeKey(r)));
  const menu = view.menu.filter((m) => !left.has(menuKey(m)));
  const leftRecipes = view.recipes.map(recipeKey).filter((k) => left.has(k));
  const leftMenu = view.menu.map(menuKey).filter((k) => left.has(k));
  // A refusal whose row has gone (refreshed away) is shown at the top instead.
  const orphan = rowMessage && !rowByKey(rowMessage.key) ? rowMessage.text : null;
  const showLeft = (keys: string[]) => keys.length > 0 ? (
    <li className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => unfold(keys)}>{t("catalog.changes.show_left", { n: keys.length })}</button>
    </li>
  ) : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-16">
      <p className="break-words text-sm text-co-text-muted">{t("catalog.changes.intro")}</p>
      {message ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}
      {orphan ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{orphan}</p> : null}

      <CollapsibleSection idBase="changes-recipes" title={t("catalog.changes.recipes")} count={t("catalog.changes.recipes_count", { n: recipes.length })}
        open={open.recipes} onToggle={() => setOpen((o) => ({ ...o, recipes: !o.recipes }))}>
        <ul className="flex min-w-0 flex-col gap-2 p-3">
          {recipes.length === 0 ? <li className="text-sm text-co-text-muted">{t("catalog.changes.none")}</li> : null}
          {recipes.map((r) => (
            <ShopChangeRecipeCard key={recipeKey(r)} row={r} names={view.names} busy={busy} flow={flowFor<RecipePreview>(recipeKey(r))}
              onPromote={() => promoteRecipe(r)} onLeave={() => leave(recipeKey(r))} onSave={() => void save()} onDiscard={reset} onRepreview={repreview} />
          ))}
          {showLeft(leftRecipes)}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection idBase="changes-menu" title={t("catalog.changes.menu")} count={t("catalog.changes.menu_count", { n: menu.length })}
        open={open.menu} onToggle={() => setOpen((o) => ({ ...o, menu: !o.menu }))}>
        <ul className="flex min-w-0 flex-col gap-2 p-3">
          {menu.length === 0 ? <li className="text-sm text-co-text-muted">{t("catalog.changes.none")}</li> : null}
          {menu.map((m) => (
            <ShopChangeMenuCard key={menuKey(m)} row={m} busy={busy} flow={flowFor<MenuPreview>(menuKey(m))} promoteNameEs={promoteNameEsFor(m)}
              onPromote={(fields) => promoteMenu(m, fields)} onLeave={() => leave(menuKey(m))} onSave={() => void save()} onDiscard={reset} onRepreview={repreview} />
          ))}
          {showLeft(leftMenu)}
        </ul>
      </CollapsibleSection>
    </div>
  );
}
