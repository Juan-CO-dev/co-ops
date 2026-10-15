"use client";

/**
 * THE MENU ITEM PAGE — client body (catalog Phase 3b; spec §3 "menu items incl. shop price and sold here", §4).
 * Top: whose settings you see, a shop switcher. Then "How it connects" (its recipe, its food cost here, its Toast
 * link; on top on a phone, a side panel from md:), "At this shop" (price here, sold here, both names here → What
 * this changes → Save for this shop; back to the global menu; for the Director of Operations, make this shop's own
 * price or name everyone's), and History (Restore).
 *
 * EVERY CHANGE IS PREVIEWED FIRST: the page posts ONE MenuChangeRequest to /preview (a read, through
 * createRequestGuard so a late answer is dropped), shows "What this changes" (MenuPreviewPanel), and Save posts
 * exactly that change with the preview's token to /apply (Tier E, useStepUpPost). Disclosure state is useState only.
 *
 * LEAD DECISIONS this body carries:
 *  - The form follows the committed row after every refresh (Astra 3b r1#6) — unless the person TYPED and the shop's
 *    row moved underneath (another manager's save): then the draft keeps its ORIGINAL baseline, the page shows what
 *    moved (was → now) and offers "Start over from the new version" (keepMenuDraft). A preview binds the complete
 *    change, and any edit after a preview drops it — pending, preview and Save — and asks to "Preview again".
 *  - Promote returns the source shop to the default; its preview shows the Spanish name truthfully, with the optional
 *    "Spanish name" field (MenuPreviewPanel). A promote refused AFTER its Spanish name saved says plainly that the
 *    shop's label changed (in History) but the promote did not happen, and the page reloads to show the new label.
 *  - No dead ends: a viewer who can't change this view reads it, with a plain sentence and "Change it for <shop>".
 *  - Phone-first: shop chips and button rows WRAP; long names break; every control is 44px. Shops are ids and names.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey, TranslationParams } from "@/lib/i18n/types";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { MenuPreviewPanel } from "@/components/catalog/MenuPreviewPanel";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import type { MenuPreview } from "@/lib/catalog/recipe-preview-shared";
import {
  keepMenuDraft, menuDraftFrom, menuErrorKey, menuFormRevision, menuItemPageHref, menuRowMoves, recipeItemHref,
  type MenuChangeRequest, type MenuItemPageView, type MenuPromoteField, type MenuRowMove,
} from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text disabled:opacity-50";
const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const linkRow = "flex min-h-[44px] items-center break-words rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";
/** A shop chip. The row WRAPS (lead decision, 375px): no sideways scroller, and a long name breaks instead of clipping. */
const pill = (on: boolean) =>
  `inline-flex min-h-[44px] max-w-full items-center break-words rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;

/** Refusals that mean "something moved underneath": the page refreshes to show the item as it is NOW. */
const REFRESH_ON: ReadonlySet<string> = new Set(["version_changed", "not_live", "global_changed", "preview_stale", "dependencies_changed", "not_found"]);
/** …and of those, the ones where the SAME change can simply be looked at again ("See what this changes"). */
const REPREVIEW_ON: ReadonlySet<string> = new Set(["preview_stale", "dependencies_changed"]);

type T = (key: TranslationKey, params?: TranslationParams) => string;
type Refusal = { code: string; spanishNameSaved?: { settingId: string; locationId: string } };

/**
 * The words for a refusal (house rule: every named refusal has its OWN message — menuErrorKey). A promote refused AFTER
 * its typed Spanish name saved (CC note 2 #3) first says plainly that the shop's own label changed (it is in History)
 * but the promote did not happen, then why.
 */
export function menuRefusalText(t: T, r: Refusal, shops: ReadonlyArray<{ id: string; name: string }>): string {
  const reason = t(menuErrorKey(r.code));
  if (!r.spanishNameSaved) return reason;
  const shop = shops.find((s) => s.id === r.spanishNameSaved!.locationId)?.name ?? "";
  return `${t("catalog.menu.promote.es_saved_not_promoted", { shop })} ${reason}`;
}

/** The shop's row moved under a typed draft: each field was → now, and "Start over from the new version". */
export function MenuStaleNotice({ moves, busy, onRebase }: { moves: MenuRowMove[]; busy: boolean; onRebase: () => void }) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const yesNo = (b: boolean) => t(b ? "catalog.menu.preview.yes" : "catalog.menu.preview.no");
  const line = (m: MenuRowMove) =>
    m.field === "price" ? t("catalog.menu.preview.price", { before: money(m.before), after: money(m.after) })
      : m.field === "soldHere" ? t("catalog.menu.preview.sold", { before: yesNo(m.before), after: yesNo(m.after) })
      : m.field === "name" ? t("catalog.menu.preview.name", { before: m.before ?? "—", after: m.after ?? "—" })
      : t("catalog.menu.preview.name_es", { before: m.before ?? "—", after: m.after ?? "—" });
  return (
    <div role="status" className="flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-2">
      <p className="text-sm text-co-text">{t("catalog.menu.edit_conflict")}</p>
      <ul className="flex flex-col gap-1">
        {moves.map((m) => <li key={m.field} className="text-xs text-co-text-muted">{line(m)}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={onRebase}>{t("catalog.menu.edit_rebase")}</button>
      </div>
    </div>
  );
}

/** History — every setting this shop has had; Restore (a NEW row) on the past ones, for who may save here. */
export function MenuHistoryList({ view, busy, onRestore }: { view: MenuItemPageView; busy: boolean; onRestore: (fromSettingId: string) => void }) {
  const { t, language } = useTranslation();
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(iso.slice(0, 10), language);
  return (
    <ul className="flex flex-col gap-2 p-3">
      {view.history.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
          <span className="min-w-0 break-words text-sm text-co-text">
            {day(h.validFrom)} · {h.who ?? "—"}
            {h.price !== null ? <span className="block text-xs">{t("catalog.menu.history_price", { price: money(h.price) })}</span> : null}
            {!h.soldHere ? <span className="block text-xs">{t("catalog.menu.history_off")}</span> : null}
            {h.nameOverride ? <span className="block text-xs">{t("catalog.menu.history_name", { name: h.nameOverride })}</span> : null}
          </span>
          {h.active ? (
            <span className="text-xs font-bold text-co-confirm-text">{t("catalog.menu.current")}</span>
          ) : view.can.editShop ? (
            <button type="button" className={btn} disabled={busy} onClick={() => onRestore(h.id)}>{t("catalog.menu.restore")}</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MenuItemClient({ view }: { view: MenuItemPageView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/menu-item/${view.item.id}`;
  const [priceText, setPriceText] = useState(view.here.price === null ? "" : String(view.here.price));
  const [soldHere, setSoldHere] = useState(view.here.soldHere);
  const [nameText, setNameText] = useState(view.here.nameOverride ?? "");
  const [nameEsText, setNameEsText] = useState(view.here.nameOverrideEs ?? "");
  const [pending, setPending] = useState<MenuChangeRequest | null>(null);
  const [preview, setPreview] = useState<MenuPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Something moved under the pending change: why, and an offer to look at the same change again. */
  const [retry, setRetry] = useState<string | null>(null);
  /** The form was edited after its preview (Astra chunks 3-4 P2 #2): that preview and its Save no longer match it. */
  const [previewDropped, setPreviewDropped] = useState(false);
  /** The optional Spanish name typed on a NAME promote's preview (blank = the shop's own pair is copied as it is). */
  const [promoteEs, setPromoteEs] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // A late preview from a superseded request is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());

  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const shopName = (id: string | null) => (id === null ? "" : (view.shops.find((s) => s.id === id)?.name ?? ""));
  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setPreviewDropped(false); };
  // ANY edit after a preview drops pending AND preview — Save goes with them — and the button asks to Preview again.
  const touched = () => { if (pending === null && preview === null) return; reset(); setPreviewDropped(true); };

  // THE FORM FOLLOWS THE COMMITTED ROW (Astra 3b r1#6). A save, Back to default, Restore or a promote ends in
  // router.refresh(), which brings a new `view.here` WITHOUT a remount (the key is per item and shop). When the
  // committed revision moves, every field resets to it — React's prev-compare pattern — so a retired price or
  // "not sold here" never rides into the next save. ONE exception (lead decision): a draft the person TYPED, under
  // which ANOTHER manager moved the shop's row, keeps its original baseline — the page shows what moved and offers
  // "Start over from the new version" (keepMenuDraft). `follow` = this person's own act just saved: always follow.
  const revision = menuFormRevision(view);
  const [formRevision, setFormRevision] = useState(revision);
  const [baseline, setBaseline] = useState(view.here);
  const [follow, setFollow] = useState(false);
  if (formRevision !== revision) {
    setFormRevision(revision);
    setFollow(false);
    guard.invalidate();
    setPreview(null);
    const draft = { price: priceText, soldHere, name: nameText, nameEs: nameEsText };
    if (!keepMenuDraft({ draft, was: baseline, now: view.here, follow })) {
      setPriceText(view.here.price === null ? "" : String(view.here.price));
      setSoldHere(view.here.soldHere);
      setNameText(view.here.nameOverride ?? "");
      setNameEsText(view.here.nameOverrideEs ?? "");
      setBaseline(view.here);
    }
    // A save built from the old form can't be looked at again; another act (back to default, restore, promote) can.
    if (pending?.kind === "save") { setPending(null); setRetry(null); }
  }
  // The shop's row moved under the typed draft (its baseline is the row the person started from).
  const moves = menuRowMoves(baseline, view.here);
  const stale = moves.length > 0;
  const startOver = () => {
    reset();
    const d = menuDraftFrom(view.here);
    setPriceText(d.price); setSoldHere(d.soldHere); setNameText(d.name); setNameEsText(d.nameEs);
    setBaseline(view.here);
  };

  const fail = (r: Refusal) => {
    if (r.spanishNameSaved) {
      // The shop's own label DID change: say so plainly, and reload so the page shows it (the form follows it).
      setMessage(menuRefusalText(t, r, view.shops));
      guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setFollow(true); router.refresh();
      return;
    }
    const text = menuRefusalText(t, r, view.shops);
    if (REPREVIEW_ON.has(r.code)) {
      setPreview(null); setMessage(null); setRetry(text); router.refresh();
      return;
    }
    setMessage(text);
    if (REFRESH_ON.has(r.code)) { guard.invalidate(); setPreview(null); setPending(null); router.refresh(); }
  };

  /** "What this changes" for ONE act — a read, guarded against late answers. */
  const askPreview = async (change: MenuChangeRequest) => {
    setMessage(null); setRetry(null); setPreview(null); setPending(change); setPreviewDropped(false); setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { change }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request owns the panel
    if (r.ok) { setPreview(r.data.preview as MenuPreview); return; }
    if (!REPREVIEW_ON.has(r.code)) setPending(null);
    fail(r);
  };
  const previewSave = () => {
    if (view.scope === null) return;
    const trimmed = priceText.trim();
    const price = trimmed === "" ? null : Number(trimmed);
    if (price !== null && !Number.isFinite(price)) { setMessage(t(menuErrorKey("invalid_menu_price"))); return; }
    void askPreview({ kind: "save", shopId: view.scope, patch: { price, soldHere, nameOverride: nameText.trim() || null, nameOverrideEs: nameEsText.trim() || null } });
  };
  const askPromote = (fields: MenuPromoteField[]) => {
    if (!view.here.settingId) return;
    setPromoteEs("");
    void askPreview({ kind: "promote", settingId: view.here.settingId, fields });
  };
  /** Look again at the SAME promote with the Spanish name typed now (the preview — and its token — bind it). */
  const repreviewPromote = () => {
    if (pending?.kind !== "promote") return;
    const typed = promoteEs.trim();
    const rest = { kind: "promote" as const, settingId: pending.settingId, fields: pending.fields };
    void askPreview(typed ? { ...rest, nameEs: typed } : rest);
  };
  /** Save EXACTLY what the preview showed: its change and its token (Tier E). */
  const save = async () => {
    if (!preview || !pending) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/apply`, { change: pending, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { reset(); setFollow(true); setMessage(t("catalog.menu.saved")); router.refresh(); } else fail(r);
  };

  const versionText = view.scope === null ? t("catalog.menu.version.global")
    : view.here.settingId ? t("catalog.menu.version.shop_own", { shop: view.scopeName ?? "" })
    : t("catalog.menu.version.shop_default", { shop: view.scopeName ?? "" });
  const saveLabel = (p: MenuPreview) =>
    p.kind === "save" ? t("catalog.menu.preview.save_shop", { shop: view.scopeName ?? "" })
      : p.kind === "back_to_default" ? t("catalog.menu.preview.save_back")
      : p.kind === "restore" ? t("catalog.menu.preview.save_restore") : t("catalog.menu.preview.save_promote");

  const retryBlock = retry && pending ? (
    <div role="status" className="flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-3">
      <p className="text-sm text-co-text">{retry}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void askPreview(pending)}>{t("catalog.menu.see_changes")}</button>
        <button type="button" className={btn} disabled={busy} onClick={reset}>{t("catalog.menu.cancel")}</button>
      </div>
    </div>
  ) : null;
  const panel = preview && pending ? (
    <MenuPreviewPanel preview={preview} saveLabel={saveLabel(preview)} busy={busy} onSave={() => void save()} onDiscard={reset}
      promoteNameEs={pending.kind === "promote" && pending.fields.includes("name")
        ? { value: promoteEs, previewed: pending.nameEs ?? "", onChange: setPromoteEs, onRepreview: repreviewPromote }
        : undefined} />
  ) : retryBlock;

  // NO DEAD ENDS: the shops this viewer may change the item for, offered wherever this view is read-only.
  const elsewhere = view.can.shopsToEdit.filter((s) => s.id !== view.scope);
  const changeForShopLinks = elsewhere.length === 1 ? (
    <Link href={menuItemPageHref(view.item.id, { shopId: elsewhere[0]!.id })} className={`${btnPrimary} w-fit max-w-full break-words`}>
      {t("catalog.item.change_for_shop", { shop: elsewhere[0]!.name })}
    </Link>
  ) : elsewhere.length > 1 ? (
    <>
      <p className={eyebrow}>{t("catalog.item.pick_shop")}</p>
      <div className="flex flex-wrap gap-2">
        {elsewhere.map((s) => (
          <Link key={s.id} href={menuItemPageHref(view.item.id, { shopId: s.id })} className={`${btnPrimary} max-w-full break-words`}>
            {t("catalog.item.change_for_shop", { shop: s.name })}
          </Link>
        ))}
      </div>
    </>
  ) : null;
  const canEdit = view.scope !== null && view.can.editShop;
  const readOnly = !canEdit ? (
    <div className="mt-2 flex flex-col gap-2">
      <p role="note" className="text-sm text-co-text">
        {view.can.shopsToEdit.length === 0 ? t("catalog.menu.view_only")
          : view.scope === null ? t("catalog.menu.global_view_hint")
          : t("catalog.menu.pick_shop_hint")}
      </p>
      {changeForShopLinks}
    </div>
  ) : null;

  // Promote (MoO+): this shop's OWN price / name becomes everyone's; the shop then follows the global menu for it.
  const canPromote = view.can.promote && view.scope !== null && view.here.settingId !== null
    && (view.here.price !== null || view.here.nameOverride !== null);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-16">
      {/* Identity — always visible (D2). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="max-w-full break-words rounded-lg bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        <span className="text-xs text-co-text-muted">{t("catalog.menu.kind")}</span>
      </div>

      {/* The shop switcher WRAPS — the chips never scroll sideways or clip at 375px (lead decision). */}
      <nav aria-label={t("catalog.menu.shop_switcher")} className="flex flex-wrap gap-2">
        <Link href={menuItemPageHref(view.item.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined} className={pill(view.scope === null)}>
          {t("catalog.recipe.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={menuItemPageHref(view.item.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined} className={pill(view.scope === s.id)}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      {/* A preview opened from History or a promote shows here, above the sections. */}
      {pending && pending.kind !== "save" ? panel : null}

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="order-1 min-w-0 md:order-2">
          <section aria-label={t("catalog.recipe.connections")} className="min-w-0 break-words rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.connections")}</h2>
            <p className={`mt-2 ${eyebrow}`}>{t("catalog.menu.recipe")}</p>
            {view.recipe ? (
              <Link href={recipeItemHref(view.recipe.id, { shopId: view.scope })} className={linkRow}>{view.recipe.name}</Link>
            ) : (
              <p className="px-2 text-sm text-co-text-muted">{t("catalog.menu.recipe_none")}</p>
            )}
            <p className="mt-2 px-2 text-sm text-co-text">{view.cost === null ? t("catalog.menu.cost_unknown") : t("catalog.menu.cost", { cost: money(view.cost) })}</p>
            <p className="px-2 text-sm text-co-text">{t("catalog.menu.toast_links", { n: view.toastLinks })}</p>
          </section>
        </aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          <section aria-label={t("catalog.menu.section.here")} className="min-w-0 break-words rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.menu.section.here")}</h2>
            {!canEdit ? readOnly : (
              <div className="mt-2 flex flex-col gap-3">
                {stale ? <MenuStaleNotice moves={moves} busy={busy} onRebase={startOver} /> : null}
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.price_here")}</span>
                  <input className={field} inputMode="decimal" value={priceText} disabled={busy}
                    onChange={(e) => { setPriceText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.price_hint", { price: money(view.item.menuPrice) })}</span>
                </label>
                <label className="flex min-h-[44px] items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={soldHere} disabled={busy} onChange={(e) => { setSoldHere(e.target.checked); touched(); }} />
                  <span className="text-sm text-co-text">{t("catalog.menu.sold_here")}</span>
                </label>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.name_here")}</span>
                  <input className={field} value={nameText} maxLength={120} disabled={busy} onChange={(e) => { setNameText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.name_hint", { name: view.item.name })}</span>
                </label>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.menu.name_here_es")}</span>
                  <input className={field} value={nameEsText} maxLength={120} disabled={busy} onChange={(e) => { setNameEsText(e.target.value); touched(); }} />
                  <span className="text-xs text-co-text-muted">{t("catalog.menu.name_hint", { name: view.item.nameEs ?? view.item.name })}</span>
                </label>
                {previewDropped ? <p role="status" className="text-sm text-co-text">{t("catalog.menu.preview_again_hint")}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {/* A typed draft under a moved row saves nothing until Start over (the notice above is the way forward). */}
                  {!stale ? (
                    <button type="button" className={btnPrimary} disabled={busy} onClick={previewSave}>
                      {t(previewDropped ? "catalog.menu.preview_again" : "catalog.menu.see_changes")}
                    </button>
                  ) : null}
                  {view.here.settingId ? (
                    <button type="button" className={btnDanger} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                      {t("catalog.menu.back_to_default")}
                    </button>
                  ) : null}
                </div>
                {pending?.kind === "save" ? panel : null}
              </div>
            )}
            {canPromote ? (
              <div className="mt-3 flex min-w-0 flex-col gap-2 border-t-2 border-co-border pt-3">
                <p className={eyebrow}>{t("catalog.menu.promote.title")}</p>
                <p className="text-sm text-co-text-muted">{t("catalog.menu.promote.hint", { shop: view.scopeName ?? "" })}</p>
                <div className="flex flex-wrap gap-2">
                  {view.here.price !== null ? (
                    <button type="button" className={`${btn} max-w-full break-words`} disabled={busy} onClick={() => askPromote(["price"])}>
                      {t("catalog.changes.promote_price", { price: money(view.here.price) })}
                    </button>
                  ) : null}
                  {view.here.nameOverride !== null ? (
                    <button type="button" className={`${btn} max-w-full break-words`} disabled={busy} onClick={() => askPromote(["name"])}>
                      {t("catalog.changes.promote_name", { name: view.here.nameOverride })}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          {view.scope !== null ? (
            <CollapsibleSection idBase="menu-history" title={t("catalog.menu.section.history")}
              count={t("catalog.menu.history_count", { n: view.history.length })} open={historyOpen} onToggle={() => setHistoryOpen((o) => !o)}>
              <MenuHistoryList view={view} busy={busy}
                onRestore={(fromSettingId) => { if (view.scope !== null) void askPreview({ kind: "restore", shopId: view.scope, fromSettingId }); }} />
            </CollapsibleSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}
