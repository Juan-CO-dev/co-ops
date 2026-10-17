"use client";

/**
 * THE RECIPE PAGE — client body (catalog Phase 3b; spec §3, §4, §6). Top: which version you see ("Global
 * default" / "P Street's version · based on …"), a shop switcher, the notices. Then "How it connects" (on
 * top on a phone, a side panel from md:), "What goes in" (edit / add / remove a line), "What it makes",
 * "Other shops' versions" (adopt; promote for MoO+), and History (Restore).
 *
 * EVERY CHANGE IS PREVIEWED FIRST: the page posts ONE RecipeChangeRequest to /preview (a read, through
 * createRequestGuard so a late answer is dropped), shows "What this changes", and Save posts exactly that
 * change with the preview's token to /apply (Tier E, useStepUpPost). Disclosure state is useState only.
 *
 * LEAD DECISIONS this body carries:
 *  - A preview binds the complete change, and a line edit keeps the baseline captured at Edit across any
 *    refresh. When something moved underneath (line_changed, a stale preview, a moved dependency) the page
 *    refreshes to show the recipe as it is now, keeps the draft, shows what the line was and is, and offers
 *    "Start over from the new version" (or "See what this changes" again).
 *  - Only ADDED lines are refused; a refusal names the line and why, in the message and beside the line.
 *    A carried broken line is FLAGGED (position, name, reason) and stays editable, so a recipe is repaired
 *    one line at a time.
 *  - No dead ends: a viewer who can't change this view reads it, with a plain sentence and a way forward
 *    ("Change it for <shop>").
 *  - Phone-first: shop chips and button rows WRAP; long names break; every control is 44px.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { etDisplayDate } from "@/lib/operational-day";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { RecipeLineEditor } from "@/components/admin/recipes/RecipeLineEditor";
import { RecipePreviewPanel } from "@/components/catalog/RecipePreviewPanel";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeLineDraft, RecipeLineFields } from "@/lib/recipe-line-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { lineText, type RecipePreview } from "@/lib/catalog/recipe-preview-shared";
import type { RecipeLineRefusal } from "@/lib/recipe-versions-shared";
import type { IngredientOption } from "@/lib/ingredient-picker-shared";
import {
  lineEditStale, menuItemPageHref, recipeErrorKey as errorKey, recipeItemHref, recipeLineKeys, recipeLineMatches, recipeVersionLabel,
  type RecipeChangeRequest, type RecipeItemView, type RecipeTarget,
} from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text disabled:opacity-50";
const linkRow = "flex min-h-[44px] items-center break-words rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
/** A shop chip. The row WRAPS (lead decision, 375px): no sideways scroller, and a long name breaks instead of clipping. */
const pill = (on: boolean) =>
  `inline-flex min-h-[44px] max-w-full items-center break-words rounded-full border-2 px-4 text-sm font-bold ${on ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`;

/**
 * Refusals that mean "something moved underneath": the page refreshes to show the recipe as it is NOW. The open
 * draft and its ORIGINAL baseline stay; a moved line then shows what it was and is, with "Start over".
 */
const REFRESH_ON: ReadonlySet<string> = new Set(["line_changed", "edge_not_found", "version_changed", "not_live", "recipe_inactive", "preview_stale", "dependencies_changed"]);
/** …and of those, the ones where the SAME change can simply be looked at again ("See what this changes"). */
const REPREVIEW_ON: ReadonlySet<string> = new Set(["preview_stale", "dependencies_changed"]);

type Sections = { lines: boolean; makes: boolean; others: boolean; history: boolean };
/**
 * An edit's BASELINE is captured when Edit is tapped (Astra 3b r5#1): `expected` is the line the person SAW and the
 * draft starts from it. A router.refresh() mid-edit never swaps it — the save still compares against what they saw, so
 * an intervening change is caught (line_changed), never silently overwritten. "Start over" rebases on purpose: a new
 * baseline, the editor remounted, any preview cleared.
 */
export type Editing = { mode: "add" } | { mode: "edit"; lineId: string; expected: RecipeLineFields; name: string } | null;

const fieldsOf = (d: RecipeLineDraft): RecipeLineFields => ({
  componentSkuId: d.componentSkuId, componentItemId: d.componentItemId, componentProductId: d.componentProductId,
  quantity: d.quantity, unit: d.unit, eachContainerLabel: d.eachContainerLabel, portioned: d.portioned,
});

/** The line under an open edit moved since Edit was tapped: what it was → what it is now, and "Start over from the new version". */
export function StaleLineNotice({
  expected, current, names, busy, onRebase,
}: { expected: RecipeLineFields; current: RecipeLineFields; names: Readonly<Record<string, string>>; busy: boolean; onRebase: () => void }) {
  const { t, language } = useTranslation();
  const fmt = (n: number) => formatQuantity(n, language);
  return (
    <div role="status" className="flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-2">
      <p className="text-sm text-co-text">{t("catalog.recipe.edit_conflict")}</p>
      <p className="text-xs text-co-text-muted">{lineText(expected, names, fmt)} → {lineText(current, names, fmt)}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={onRebase}>{t("catalog.recipe.edit_rebase")}</button>
      </div>
    </div>
  );
}

/**
 * "What goes in" — the lines, each with its flag, its refusal, and Edit / Remove (or the open editor).
 *
 * A LINE IS FOUND BY ITS LINEAGE (Astra chunks 3-4 P2 #1): a shop save writes the set again with NEW ids and keeps
 * the old in source_line_id, so the open edit (opened on the id seen then) is matched by recipeLineMatches and the row
 * keyed by recipeLineKeys — another manager's save never unmounts the editor or loses the draft. If the line itself
 * moved, StaleLineNotice shows was → now with "Start over from the new version"; only a line really removed says so.
 * `previewDropped`: the draft was edited after its preview, so that preview and its Save are gone — "Preview again".
 */
export function RecipeLinesList({
  view, target, editing, refused, busy, previewDropped, options, measures,
  onStartEdit, onRemove, onSubmitEdit, onRebase, onCancel, onDraftChange,
}: {
  view: RecipeItemView;
  target: RecipeTarget | null;
  editing: Editing;
  refused: RecipeLineRefusal | null;
  busy: boolean;
  previewDropped: boolean;
  options: IngredientOption[];
  measures: Map<string, MeasureUnitFactor>;
  onStartEdit: (l: RecipeItemView["lines"][number]) => void;
  onRemove: (l: RecipeItemView["lines"][number]) => void;
  onSubmitEdit: (l: RecipeItemView["lines"][number], d: RecipeLineDraft) => void;
  onRebase: (l: RecipeItemView["lines"][number]) => void;
  onCancel: () => void;
  onDraftChange: () => void;
}) {
  const { t, language } = useTranslation();
  const fmt = (n: number) => formatQuantity(n, language);
  const canEditLines = target !== null && view.recipe.active;
  const keys = recipeLineKeys(view.lines);
  // The line under an open edit is gone (someone removed it): say so, and let the draft go.
  const editedLineGone = editing?.mode === "edit" && !view.lines.some((l) => recipeLineMatches(l, editing.lineId));
  return (
    <>
      {editedLineGone ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border-2 border-co-warning bg-co-warning-surface p-2">
          <p className="text-sm text-co-text">{t(errorKey("edge_not_found"))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={onCancel}>{t("catalog.recipe.preview.discard")}</button>
          </div>
        </div>
      ) : null}
      {previewDropped ? (
        <p role="status" className="break-words text-sm text-co-text">{t("catalog.recipe.preview_again_hint")}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {view.lines.map((l, i) => {
          const isEditing = editing?.mode === "edit" && recipeLineMatches(l, editing.lineId);
          return (
            <li key={keys[i]} className="flex min-w-0 flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm text-co-text">
                  {lineText(l.fields, view.names, fmt)}
                  {l.vendorName ? <span className="text-co-text-muted"> · {l.vendorName}</span> : null}
                </span>
                {l.changedHere ? <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("catalog.recipe.changed_here")}</span> : null}
              </div>
              {/* Lead decision (b): a saved line that would not pass an add today is FLAGGED, never hidden; Edit fixes it. */}
              {l.problem ? (
                <p className="break-words text-xs font-bold text-co-cta-text">
                  {t("catalog.recipe.line_problem", { position: i + 1, name: l.name, reason: t(errorKey(l.problem)) })}
                </p>
              ) : null}
              {refused && refused.position === i + 1 && isEditing ? (
                <p role="alert" className="break-words text-xs font-bold text-co-cta-text">{t(errorKey(refused.reason))}</p>
              ) : null}
              {canEditLines ? (
                isEditing && editing?.mode === "edit" ? (
                  <>
                    {lineEditStale(editing.expected, l.fields) ? (
                      <StaleLineNotice expected={editing.expected} current={l.fields} names={view.names} busy={busy} onRebase={() => onRebase(l)} />
                    ) : null}
                    {/* Keyed by the id the edit was OPENED on (never the row's new id), so a refresh keeps the draft mounted. */}
                    <RecipeLineEditor key={`edit-${editing.lineId}-${JSON.stringify(editing.expected)}`}
                      title={t("catalog.recipe.edit_title")} submitLabel={t(previewDropped ? "catalog.recipe.preview_again" : "catalog.recipe.see_changes")}
                      options={options} skus={view.picker.skus} products={view.picker.products} measures={measures}
                      activeMeasureLabels={view.picker.activeMeasureLabels} initial={{ ...editing.expected, componentName: editing.name }}
                      busy={busy} errorMsg={null}
                      onSubmit={(d) => onSubmitEdit(l, d)}
                      onCancel={onCancel} onDraftChange={onDraftChange} />
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => onStartEdit(l)}>{t("catalog.recipe.edit_line")}</button>
                    <button type="button" className={btnDanger} disabled={busy} onClick={() => onRemove(l)}>
                      {t("catalog.recipe.remove_line")}
                    </button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * History — every version of this scope and the default. Restore makes a NEW version (offered only to who may save
 * `target`). A version that ENDED a link to another shop's recipe says so, from what 0262 recorded on it
 * (adoption_ended_from_version_id — lead decision: History reads only that).
 */
export function RecipeHistoryList({
  view, target, busy, onRestore,
}: { view: RecipeItemView; target: RecipeTarget | null; busy: boolean; onRestore: (fromVersionId: string) => void }) {
  const { t, language } = useTranslation();
  const day = (iso: string) => formatDateLabel(etDisplayDate(iso), language); // the operational (ET) day, never the UTC date
  return (
    <ul className="flex flex-col gap-2 p-3">
      {view.history.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
          <span className="min-w-0 break-words text-sm text-co-text">
            {t("catalog.recipe.history_by", { scope: h.scope === "global" ? t("catalog.recipe.history_global") : (h.shopName ?? ""), date: day(h.validFrom), who: h.who ?? "—" })}
            {" · "}{t("catalog.recipe.history_lines", { n: h.lineCount })}
            {h.promotedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.promoted_from", { shop: h.promotedFromShopName })}</span> : null}
            {h.adoptedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.adopted_from", { shop: h.adoptedFromShopName })}</span> : null}
            {h.linkEndedFromShopName ? <span className="block text-xs text-co-text-muted">{t("catalog.recipe.history.link_ended", { shop: h.linkEndedFromShopName })}</span> : null}
          </span>
          {h.active ? (
            <span className="text-xs font-bold text-co-confirm-text">{t("catalog.recipe.current")}</span>
          ) : target && h.scope === "global" && target.kind === "shop" ? (
            // An old DEFAULT version restored for a shop becomes that shop's own version (CC note 5 #2) — said on the button.
            <button type="button" className={`${btn} max-w-full break-words`} disabled={busy} onClick={() => onRestore(h.id)}>
              {t("catalog.recipe.restore_as_shop", { shop: view.shops.find((s) => s.id === target.shopId)?.name ?? view.scopeName ?? "" })}
            </button>
          ) : target && (h.scope === "global" || (target.kind === "shop" && h.shopId === target.shopId)) ? (
            // The default's own history (global view) or THIS shop's. Another shop's version is never restored here — that is adopt.
            <button type="button" className={btn} disabled={busy} onClick={() => onRestore(h.id)}>
              {t("catalog.recipe.restore")}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RecipeItemClient({ view }: { view: RecipeItemView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/recipe/${view.recipe.id}`;
  const [open, setOpen] = useState<Sections>({ lines: true, makes: false, others: false, history: false });
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<RecipeChangeRequest | null>(null);
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Something moved under the pending change: why, and an offer to look at the same change again. */
  const [retry, setRetry] = useState<string | null>(null);
  // A late preview from a superseded request (an edited line, a left editor) is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());

  const measures = useMemo(() => new Map<string, MeasureUnitFactor>(view.picker.measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }])), [view.picker.measures]);
  const options = useMemo(() => buildIngredientOptions({ skus: view.picker.skus, items: view.picker.items, products: view.picker.products }), [view.picker]);
  const money = (n: number | null) => (n == null ? "—" : formatCents(Math.round(n * 100), language));
  const day = (iso: string) => formatDateLabel(etDisplayDate(iso), language); // the operational (ET) day, never the UTC date
  const fmt = (n: number) => formatQuantity(n, language);
  const shopName = (id: string) => view.shops.find((s) => s.id === id)?.name ?? "";
  // A refused LINE is named — position, name, why — in the message AND beside that line (lead decision (b)).
  const [refused, setRefused] = useState<RecipeLineRefusal | null>(null);
  const fail = (code: string, line?: RecipeLineRefusal) => {
    setRefused(line ?? null);
    const text = line
      ? t("catalog.recipe.error.line_refused", { position: line.position, name: line.name, reason: t(errorKey(line.reason)) })
      : t(errorKey(code));
    if (REPREVIEW_ON.has(code)) {
      // The same change can be looked at again — against the recipe as it is now (the draft's baseline unchanged).
      setPreview(null); setMessage(null); setRetry(text); router.refresh();
      return;
    }
    setMessage(text);
    if (REFRESH_ON.has(code)) {
      // Show the page as it is NOW. An open editor keeps its draft and ORIGINAL baseline; a moved line shows Start over.
      guard.invalidate(); setPreview(null); setPending(null); router.refresh();
    }
  };

  // The ONE target this viewer may save lines to here: their shop, or (MoO+) everyone in the global view.
  const target: RecipeTarget | null = view.scope !== null
    ? (view.can.editShop ? { kind: "shop", shopId: view.scope } : null)
    : (view.can.editGlobal ? { kind: "global" } : null);
  const canEditLines = target !== null && view.recipe.active;
  const hasOwn = view.scope !== null && !view.version.ridesDefault;

  /** The draft was edited after its preview (Astra chunks 3-4 P2 #2): that preview and its Save no longer match it. */
  const [previewDropped, setPreviewDropped] = useState(false);
  const reset = () => { guard.invalidate(); setPending(null); setPreview(null); setEditing(null); setRetry(null); setPreviewDropped(false); };
  // ANY edit after a preview drops pending AND preview — Save goes with them — and the editor asks to Preview again.
  const dropPreview = () => { if (pending === null && preview === null) return; guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setPreviewDropped(true); };
  const done = () => { reset(); setMessage(t("catalog.recipe.saved")); router.refresh(); };

  // D10 (docs/DISCLOSURE_DOCTRINE.md): a section holding an unsaved draft stays MOUNTED and LOCKED OPEN.
  // CollapsibleSection unmounts closed content, so collapsing "What goes in" with a line editor open (or a
  // line change waiting in its preview) would throw the draft away (Astra 3b r1#8). Save or discard first.
  const linesDirty = editing !== null || pending?.kind === "lines";
  const toggle = (s: keyof Sections) => {
    if (s === "lines" && linesDirty) return;
    setOpen((o) => ({ ...o, [s]: !o[s] }));
  };

  /** "What this changes" for ONE act — a read, guarded against late answers. */
  const askPreview = async (change: RecipeChangeRequest) => {
    setMessage(null); setRetry(null); setPreview(null); setPending(change); setPreviewDropped(false); setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { change }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request owns the panel
    if (r.ok) { setRefused(null); setPreview(r.data.preview as RecipePreview); return; }
    // A one-tap act (remove, restore, adopt…) refused outright leaves nothing to keep: drop it, so "What goes in" unlocks.
    if (!REPREVIEW_ON.has(r.code) && !(change.kind === "lines" && change.op.kind !== "remove")) setPending(null);
    fail(r.code, r.line);
  };
  /** Save EXACTLY what the preview showed: its change and its token (Tier E). */
  const save = async () => {
    if (!preview || !pending) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/apply`, { change: pending, previewToken: preview.token });
    setBusy(false);
    if (r.ok) done(); else fail(r.code, r.line);
  };
  const dismissNotice = async (kind: "source_changed" | "source_retired" | "new_default", seenVersionId: string) => {
    if (view.scope === null) return;
    setBusy(true);
    const r = await postJson(`${base}/notices/dismiss`, { locationId: view.scope, kind, seenVersionId });
    setBusy(false);
    if (r.ok) router.refresh(); else fail(r.code);
  };

  const saveLabel = (p: RecipePreview): string => {
    switch (p.kind) {
      case "lines": return p.target.kind === "shop" ? t("catalog.recipe.preview.save.lines_shop", { shop: shopName(p.target.shopId) }) : t("catalog.recipe.preview.save.lines_global");
      // Destination-aware (Astra chunks 3-4 P3 #3): a restore for a shop says whose version it becomes.
      case "restore": return p.target.kind === "shop" ? t("catalog.recipe.restore_as_shop", { shop: shopName(p.target.shopId) }) : t("catalog.recipe.preview.save.restore");
      case "back_to_default": return t("catalog.recipe.preview.save.back_to_default", { shop: p.target.kind === "shop" ? shopName(p.target.shopId) : "" });
      case "adopt": return t("catalog.recipe.preview.save.adopt", { shop: p.target.kind === "shop" ? shopName(p.target.shopId) : "" });
      case "promote": return t("catalog.recipe.preview.save.promote");
    }
  };

  const label = recipeVersionLabel({ scope: view.scope, scopeName: view.scopeName, hasOwn, adoptedFromShopName: view.version.adoptedFromShopName });
  const versionText = label.kind === "global" ? t("catalog.recipe.version.global")
    : label.kind === "shop_default" ? t("catalog.recipe.version.shop_default", { shop: label.shop })
    : label.kind === "shop_own" ? t("catalog.recipe.version.shop_own", { shop: label.shop })
    : t("catalog.recipe.version.shop_adopted", { shop: label.shop, from: label.from });

  const retryBlock = retry && pending ? (
    <div role="status" className="flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-warning bg-co-warning-surface p-3">
      <p className="text-sm text-co-text">{retry}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void askPreview(pending)}>{t("catalog.recipe.see_changes")}</button>
        <button type="button" className={btn} disabled={busy} onClick={reset}>{t("catalog.recipe.preview.discard")}</button>
      </div>
    </div>
  ) : null;
  const panel = preview && pending ? (
    <RecipePreviewPanel preview={preview} saveLabel={saveLabel(preview)} busy={busy} onSave={() => void save()} onDiscard={reset}
      becomesShopVersion={pending.kind === "restore" && pending.target.kind === "shop" ? shopName(pending.target.shopId) : null} />
  ) : retryBlock;

  // NO DEAD ENDS: the shops this viewer may change the recipe for, offered wherever this view is read-only.
  const elsewhere = view.can.shopsToEdit.filter((s) => s.id !== view.scope);
  const changeForShopLinks = elsewhere.length === 1 ? (
    <Link href={recipeItemHref(view.recipe.id, { shopId: elsewhere[0]!.id })} className={`${btnPrimary} w-fit max-w-full break-words`}>
      {t("catalog.item.change_for_shop", { shop: elsewhere[0]!.name })}
    </Link>
  ) : elsewhere.length > 1 ? (
    <>
      <p className={eyebrow}>{t("catalog.item.pick_shop")}</p>
      <div className="flex flex-wrap gap-2">
        {elsewhere.map((s) => (
          <Link key={s.id} href={recipeItemHref(view.recipe.id, { shopId: s.id })} className={`${btnPrimary} max-w-full break-words`}>
            {t("catalog.item.change_for_shop", { shop: s.name })}
          </Link>
        ))}
      </div>
    </>
  ) : null;
  const readOnly = target === null ? (
    <div className="flex flex-col gap-2">
      <p role="note" className="text-sm text-co-text">
        {view.can.shopsToEdit.length === 0 ? t("catalog.recipe.view_only")
          : view.scope === null ? t("catalog.recipe.global_moo_hint")
          : t("catalog.recipe.pick_shop_hint")}
      </p>
      {changeForShopLinks}
    </div>
  ) : null;

  const connections = (
    <section aria-label={t("catalog.recipe.connections")} className="min-w-0 break-words rounded-xl border-2 border-co-border bg-co-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.recipe.connections")}</h2>
      <p className={`mt-2 ${eyebrow}`}>{t("catalog.recipe.ingredients_from")}</p>
      <p className="px-2 text-sm text-co-text">{view.vendors.length === 0 ? t("catalog.recipe.vendors_none") : view.vendors.join(", ")}</p>
      <p className={`mt-2 ${eyebrow}`}>{t("catalog.recipe.makes")}</p>
      {view.makes.map((m) => (
        m.kind === "menu_item"
          ? <Link key={m.id} href={menuItemPageHref(m.id, { shopId: view.scope })} className={linkRow}>{language === "es" && m.nameEs ? m.nameEs : m.name}</Link>
          : <p key={m.id} className="flex min-h-[44px] items-center px-2 text-sm text-co-text">{m.name}</p>
      ))}
      <p className={`mt-2 ${eyebrow}`}>{t("catalog.recipe.used_in")}</p>
      {view.usedIn.length === 0 ? (
        <p className="px-2 text-sm text-co-text-muted">{t("catalog.recipe.used_in_none")}</p>
      ) : view.usedIn.map((r) => (
        <Link key={r.id} href={recipeItemHref(r.id, { shopId: view.scope })} className={linkRow}>{r.name}</Link>
      ))}
    </section>
  );

  const changeText = (c: RecipeItemView["differsFromDefault"][number]) =>
    c.kind === "added" && c.after ? t("catalog.recipe.preview.added", { line: lineText(c.after, view.names, fmt) })
      : c.kind === "removed" && c.before ? t("catalog.recipe.preview.removed", { line: lineText(c.before, view.names, fmt) })
      : c.before && c.after ? t("catalog.recipe.preview.changed", { before: lineText(c.before, view.names, fmt), after: lineText(c.after, view.names, fmt) }) : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-16">
      {/* Identity — always visible (D2). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="max-w-full break-words rounded-lg bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        {view.version.validFrom ? <span className="text-xs text-co-text-muted">{day(view.version.validFrom)}</span> : null}
        {!view.recipe.active ? <span className="text-xs font-bold text-co-cta-text">{t("catalog.recipe.inactive")}</span> : null}
      </div>

      {/* The shop switcher WRAPS — the chips never scroll sideways or clip at 375px (lead decision). */}
      <nav aria-label={t("catalog.recipe.shop_switcher")} className="flex flex-wrap gap-2">
        <Link href={recipeItemHref(view.recipe.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined} className={pill(view.scope === null)}>
          {t("catalog.recipe.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={recipeItemHref(view.recipe.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined} className={pill(view.scope === s.id)}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      {/* Notices — alerts, always visible. */}
      {view.notices.length > 0 ? (
        <section aria-label={t("catalog.recipe.notices")} className="min-w-0 break-words rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
          <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{t("catalog.recipe.notices")}</h2>
          {view.notices.map((n) => (
            <div key={`${n.kind}-${n.seenVersionId}`} className="mt-2 flex flex-col gap-2">
              {n.kind === "source_changed" ? (
                <>
                  <p className="text-sm text-co-text">
                    {n.sourceLiveVersionId
                      ? t("catalog.recipe.notice.source_changed", { shop: n.sourceShopName, recipe: n.recipeName })
                      : n.promotedToDefault
                        ? t("catalog.recipe.notice.source_promoted", { shop: n.sourceShopName, recipe: n.recipeName })
                        : t("catalog.recipe.notice.source_gone", { shop: n.sourceShopName, recipe: n.recipeName })}
                  </p>
                  {/* Lead decision: editing an adopted copy keeps the link, and the notice says so. */}
                  {n.editedSinceAdopting ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.notice.edited_since")}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {n.sourceLiveVersionId && view.scope !== null ? (
                      <button type="button" className={btnPrimary} disabled={busy}
                        onClick={() => void askPreview({ kind: "adopt", shopId: view.scope!, sourceVersionId: n.sourceLiveVersionId! })}>
                        {t("catalog.recipe.notice.take_update")}
                      </button>
                    ) : view.scope !== null && hasOwn ? (
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                        {t("catalog.recipe.notice.back_to_default")}
                      </button>
                    ) : null}
                    <button type="button" className={btn} disabled={busy} onClick={() => void dismissNotice(n.dismissKind, n.seenVersionId)}>{t("catalog.recipe.notice.keep_mine")}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-co-text">{t("catalog.recipe.notice.new_default", { recipe: n.recipeName, shop: n.fromShopName ?? "" })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => void dismissNotice("new_default", n.seenVersionId)}>{t("catalog.recipe.notice.got_it")}</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {/* A preview opened from a notice, the history or another shop shows here, above the sections. */}
      {pending && pending.kind !== "lines" ? panel : null}

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="order-1 min-w-0 md:order-2">{connections}</aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          {/* What goes in — the primary content, open by default. */}
          <CollapsibleSection idBase="recipe-lines" title={t("catalog.recipe.section.lines")}
            count={t("catalog.recipe.lines_count", { n: view.lines.length })} open={open.lines || linesDirty} onToggle={() => toggle("lines")}
            badge={linesDirty ? <span className="text-xs text-co-text-muted">{t("catalog.recipe.lines_locked")}</span> : undefined}>
            <div className="flex min-w-0 flex-col gap-2 p-3">
              {readOnly}
              <RecipeLinesList view={view} target={target} editing={editing} refused={refused} busy={busy} previewDropped={previewDropped}
                options={options} measures={measures}
                onStartEdit={(l) => { reset(); setEditing({ mode: "edit", lineId: l.lineId, expected: l.fields, name: l.name }); }}
                onRemove={(l) => { if (target) { setEditing(null); void askPreview({ kind: "lines", target, op: { kind: "remove", lineId: l.lineId, expected: l.fields } }); } }}
                onSubmitEdit={(l, d) => {
                  // The CURRENT row id (a save may have renewed it) with the baseline captured at Edit (Astra 3b r5#1).
                  if (target && editing?.mode === "edit") void askPreview({ kind: "lines", target, op: { kind: "update", lineId: l.lineId, line: fieldsOf(d), expected: editing.expected } });
                }}
                onRebase={(l) => { guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setPreviewDropped(false); setEditing({ mode: "edit", lineId: l.lineId, expected: l.fields, name: l.name }); }}
                onCancel={reset} onDraftChange={dropPreview} />
              {canEditLines && target ? (
                editing?.mode === "add" ? (
                  <RecipeLineEditor title={t("catalog.recipe.add_title")} submitLabel={t(previewDropped ? "catalog.recipe.preview_again" : "catalog.recipe.see_changes")}
                    options={options} skus={view.picker.skus} products={view.picker.products} measures={measures}
                    activeMeasureLabels={view.picker.activeMeasureLabels} initial={null} busy={busy} errorMsg={null}
                    onSubmit={(d) => void askPreview({ kind: "lines", target, op: { kind: "add", line: fieldsOf(d) } })}
                    onCancel={reset} onDraftChange={dropPreview} />
                ) : (
                  <button type="button" className={`${btnPrimary} w-fit`} disabled={busy} onClick={() => { reset(); setEditing({ mode: "add" }); }}>{t("catalog.recipe.add_line")}</button>
                )
              ) : null}
              {pending?.kind === "lines" ? panel : null}
              {hasOwn ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className={eyebrow}>{t("catalog.recipe.differs_title")}</p>
                  {view.differsFromDefault.length === 0 ? (
                    <p className="text-sm text-co-text-muted">{t("catalog.recipe.differs_none")}</p>
                  ) : view.differsFromDefault.map((c, i) => (
                    <p key={`${c.key}-${i}`} className="break-words text-sm text-co-text">{changeText(c)}</p>
                  ))}
                  {view.can.editShop && view.scope !== null ? (
                    <div className="mt-1 flex flex-col gap-1">
                      <button type="button" className={`${btnDanger} w-fit`} disabled={busy} onClick={() => void askPreview({ kind: "back_to_default", shopId: view.scope! })}>
                        {t("catalog.recipe.back_to_default")}
                      </button>
                      <p className="text-xs text-co-text-muted">{t("catalog.recipe.back_to_default_hint")}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CollapsibleSection>

          {/* What it makes */}
          <CollapsibleSection idBase="recipe-makes" title={t("catalog.recipe.section.makes")}
            count={String(view.makes.length)} open={open.makes} onToggle={() => toggle("makes")}>
            <ul className="flex flex-col gap-2 p-3">
              {view.makes.map((m) => (
                <li key={m.id} className="break-words text-sm text-co-text">
                  {language === "es" && m.nameEs ? m.nameEs : m.name} · {t("catalog.recipe.yield", { n: fmt(m.yield) })} · {t("catalog.recipe.cost_here", { cost: money(m.costHere) })}
                </li>
              ))}
              <li>
                <Link href={`/admin/recipes/${view.recipe.id}?location=${encodeURIComponent(view.scope ?? "global")}`} className={linkRow}>{t("catalog.recipe.edit_outputs")}</Link>
              </li>
            </ul>
          </CollapsibleSection>

          {/* Other shops' versions — adopt (a GM at its shop), promote (MoO+). */}
          <CollapsibleSection idBase="recipe-others" title={t("catalog.recipe.section.others")}
            count={t("catalog.recipe.others_count", { n: view.otherShopVersions.length })} open={open.others} onToggle={() => toggle("others")}>
            <div className="flex flex-col gap-3 p-3">
              {view.otherShopVersions.length === 0 ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.others_none")}</p> : null}
              {view.otherShopVersions.map((o) => (
                <div key={o.versionId} className="flex min-w-0 flex-col gap-2 break-words rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                  <p className="text-sm font-bold text-co-text">{o.shopName} · {day(o.validFrom)}{o.createdByName ? ` · ${o.createdByName}` : ""}</p>
                  {o.changes.length === 0 ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.differs_none")}</p> : o.changes.map((c, i) => (
                    <p key={`${c.key}-${i}`} className="text-sm text-co-text">{changeText(c)}</p>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {view.scope !== null && view.can.editShop ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "adopt", shopId: view.scope!, sourceVersionId: o.versionId })}>
                        {t("catalog.recipe.adopt", { shop: o.shopName })}
                      </button>
                    ) : null}
                    {view.can.editGlobal ? (
                      <button type="button" className={btn} disabled={busy} onClick={() => void askPreview({ kind: "promote", sourceVersionId: o.versionId })}>
                        {t("catalog.recipe.promote")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {/* No dead ends: who can't adopt from this view is pointed at a shop they can. */}
              {view.otherShopVersions.length > 0 && !(view.scope !== null && view.can.editShop) && !view.can.editGlobal ? changeForShopLinks : null}
              {view.can.editGlobal && hasOwn && view.version.scopeVersionId ? (
                <button type="button" className={`${btn} w-fit`} disabled={busy} onClick={() => void askPreview({ kind: "promote", sourceVersionId: view.version.scopeVersionId! })}>
                  {t("catalog.recipe.promote")}
                </button>
              ) : null}
            </div>
          </CollapsibleSection>

          {/* History — every version of this scope and the default; Restore makes a NEW version. */}
          <CollapsibleSection idBase="recipe-history" title={t("catalog.recipe.section.history")}
            count={t("catalog.recipe.history_count", { n: view.history.length })} open={open.history} onToggle={() => toggle("history")}>
            <RecipeHistoryList view={view} target={target} busy={busy}
              onRestore={(fromVersionId) => { if (target) void askPreview({ kind: "restore", target, fromVersionId }); }} />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
