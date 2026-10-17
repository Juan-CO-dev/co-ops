"use client";

/**
 * THE CONNECTED ITEM PAGE for a bought item — client body (catalog Phase 2b; spec §4, §5 jobs 1 + 5).
 * Top: what it is, which version you're seeing, a shop switcher. Then "How it connects" (a strip on a
 * phone, a side panel from md:), "What's missing" with fix-it buttons, and the sections How it
 * arrives / Price / Ordering / Counting / Barcodes / History. Jobs: "It arrives differently now"
 * (sentence editor → What this changes → Save for my shop / for everyone) and "Price changed".
 *
 * Every write asks Tier E (the 15-minute catalog edit window) and goes through useStepUpPost, which
 * forgets a refused unlock. The preview is a read (postJson, no step-up) for ONE target — this shop,
 * or everyone — and a save posts exactly that preview's target and token (D4). Late answers are
 * dropped (createRequestGuard); the page remounts this body per (SKU, shop). Disclosure state is useState only.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatDateLabel, formatQuantity, formatWeekday } from "@/lib/i18n/format";
import { etDisplayDate } from "@/lib/operational-day";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { PackSentenceEditor } from "@/components/catalog/PackSentenceEditor";
import { ChangePreviewPanel } from "@/components/catalog/ChangePreviewPanel";
import { DoorPhoto } from "@/components/catalog/DoorPhoto";
import { levelsFromSentence, sentenceFromLevels, type SentenceDraft, type SentenceError } from "@/lib/catalog/pack-sentence-shared";
import { proposalToSentence } from "@/lib/pack-change-requests-shared";
import {
  CATALOG_ITEM_ERROR_CODES, fixItSection, PRICE_BASES, skuItemHref, sundayAnchoredDate, versionLabelKind,
  type ItemJob, type ItemSection, type SkuItemView,
} from "@/lib/catalog/sku-item-shared";
import { conversionKey, type PackPreview, type PreviewTarget, type PricePreview } from "@/lib/catalog/change-preview-shared";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import type { DataErrandCode } from "@/lib/sku-data-readiness";
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
import { ItemJobsStrip } from "@/components/catalog/ItemJobsStrip";
import type { ItemJobsStripView } from "@/lib/catalog/jobs-shared";

const btn =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text disabled:opacity-50";
const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const linkRow = "flex min-h-[44px] items-center rounded-lg px-2 text-sm font-bold text-co-text underline hover:bg-co-surface-2";

// EVERY named refusal the server half and its routes can return has its OWN message (the closed
// list in lib/catalog/sku-item-shared.ts, pinned both ways); "generic" is only for a 500.
const CATALOG_ERRORS = new Set<string>(CATALOG_ITEM_ERROR_CODES);
const errorKey = (code: string): TranslationKey =>
  (CATALOG_ERRORS.has(code) ? `catalog.error.${code}` : "catalog.error.generic") as TranslationKey;

type SectionState = Record<ItemSection, boolean>;

type SkuItemProps = { view: SkuItemView; job: ItemJob | null; requestId: string | null; jobs?: ItemJobsStripView };
export function SkuItemClient(props: SkuItemProps) {
  return <>{props.jobs && <ItemJobsStrip view={props.jobs} />}<SkuItemBody {...props} /></>;
}
function SkuItemBody({ view, job, requestId }: SkuItemProps) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const base = `/api/admin/catalog/sku/${view.sku.id}`;
  const measureLabels = new Set(view.measures.map((m) => m.label));
  const firstWeight = view.measures.find((m) => m.dimension === "weight")?.label ?? "oz";
  // At a SHOP the job is that shop's version; at GLOBAL scope it is the global value — offered only
  // where the writers would take it (sim QA: no editor that can never save).
  const canEditPack = view.scope === null ? view.can.editGlobalPack : view.can.editShop;
  const canEditPrice = view.scope === null ? view.can.editGlobalPrice : view.can.editShop;
  const globalPackLocked = view.scope === null && !view.can.editGlobalPack;
  const globalPriceLocked = view.scope === null && !view.can.editGlobalPrice;
  const canSaveShop = view.can.editShop;

  const [activeRequestId, setActiveRequestId] = useState<string | null>(requestId);
  const draftFor = (reqId: string | null): SentenceDraft => {
    const current = sentenceFromLevels(view.pack.levels);
    const seeded: SentenceDraft = current ?? { containers: [{ label: view.pack.orderUnit ?? "case", qty: "1" }], leafQty: "", leafUnit: firstWeight };
    const req = reqId ? view.openRequests.find((r) => r.id === reqId) : undefined;
    return req?.proposal ? proposalToSentence(req.proposal, seeded) : seeded;
  };
  const [open, setOpen] = useState<SectionState>({
    arrives: job === "pack", price: job === "price", ordering: false, counting: false, barcodes: false, connections: false, history: false,
  });
  const [editing, setEditing] = useState<ItemJob | null>(job);
  const [draft, setDraft] = useState<SentenceDraft>(() => draftFor(requestId));
  const [sentenceError, setSentenceError] = useState<{ error: SentenceError; index: number } | null>(null);
  const [preview, setPreview] = useState<PackPreview | PricePreview | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // A late preview from a superseded request (an edited draft, a left job) is dropped, never shown.
  const [guard] = useState(() => createRequestGuard());
  const [priceText, setPriceText] = useState("");
  const [priceDate, setPriceDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"pack" | "price" | null>(null);

  const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
  const oz = (n: number | null) => (n == null ? "—" : `${formatQuantity(n, language)} oz`);
  // The operational (ET) day, never the UTC date (CC note 9; the menu page's helper).
  const day = (iso: string) => formatDateLabel(etDisplayDate(iso), language);
  const toggle = (s: ItemSection) => setOpen((o) => ({ ...o, [s]: !o[s] }));
  const fail = (code: string) => setMessage(t(errorKey(code)));
  const done = (key: TranslationKey) => { guard.invalidate(); setMessage(t(key)); setEditing(null); setPreview(null); router.refresh(); };

  const startJob = (j: ItemJob, reqId: string | null = activeRequestId) => {
    guard.invalidate(); setEditing(j); setPreview(null); setMessage(null); setChosen(new Set()); setSentenceError(null);
    setOpen((o) => ({ ...o, [j === "pack" ? "arrives" : "price"]: true }));
    if (j === "pack") { setActiveRequestId(reqId); setDraft(draftFor(reqId)); }
  };

  const fixIt = (code: DataErrandCode) => {
    const s = fixItSection(code);
    setOpen((o) => ({ ...o, [s]: true }));
    if (s === "arrives" && canEditPack) startJob("pack");
    if (s === "price" && canEditPrice) startJob("price");
    document.getElementById(`item-${s}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Pack ──
  const builtLevels = () => {
    const built = levelsFromSentence(draft, measureLabels);
    if (!built.ok) { setSentenceError({ error: built.error, index: built.index }); return null; }
    setSentenceError(null);
    return built.levels;
  };
  /** "What this changes" for ONE target: this shop only, or everyone riding the global default (D4). */
  const previewPack = async (target: PreviewTarget) => {
    setMessage(null); setPreview(null); setChosen(new Set());
    const levels = builtLevels();
    if (!levels) return;
    setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { kind: "pack", target, levels }));
    setBusy(false);
    if (r === null) return; // superseded — a newer request (or an edited draft) owns the panel
    if (r.ok) setPreview(r.data.preview as PackPreview); else fail(r.code);
  };
  /** Save exactly what the preview showed: its target, its token, the conversions the person chose. */
  const savePack = async () => {
    if (preview?.kind !== "pack") return;
    const levels = builtLevels();
    if (!levels) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/pack/apply`, {
      target: preview.target,
      levels,
      conversions: preview.conversions.filter((c) => chosen.has(conversionKey(c))),
      requestId: activeRequestId,
      previewToken: preview.token,
    });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Price ──
  const priceValue = () => Number(priceText);
  const previewPrice = async (target: PreviewTarget) => {
    setMessage(null); setPreview(null);
    if (!(priceValue() > 0)) { fail("invalid_price"); return; }
    // The date is part of WHAT this changes: a back-dated price may never become today's (Astra 2b r3#2).
    if (!priceDate) { fail("invalid_date"); return; }
    setBusy(true);
    const r = await guard.run(() => postJson(`${base}/preview`, { kind: "price", target, unitPrice: priceValue(), effectiveDate: priceDate }));
    setBusy(false);
    if (r === null) return;
    if (r.ok) setPreview(r.data.preview as PricePreview); else fail(r.code);
  };
  const savePrice = async () => {
    if (preview?.kind !== "price") return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/price/apply`, { target: preview.target, unitPrice: preview.newPrice, effectiveDate: preview.effectiveDate, previewToken: preview.token });
    setBusy(false);
    if (r.ok) { setPriceText(""); setPriceDate(""); done("catalog.item.saved"); } else fail(r.code);
  };
  const setBasis = async (value: string) => {
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/price-basis`, { basis: value === "" ? null : value });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Back to default / Restore / door reports ──
  const backToDefault = async (kind: "pack" | "price") => {
    if (confirming !== kind) { setConfirming(kind); return; }
    setConfirming(null);
    if (view.scope === null) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = kind === "pack"
      ? await send(`${base}/pack/back-to-default`, { locationId: view.scope, versionId: view.pack.versionId })
      : await send(`${base}/price/back-to-default`, { locationId: view.scope });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };
  const restore = async (h: SkuItemView["history"][number]) => {
    if ((await requestStepUp("E")) !== "ok") return;
    const shop = h.scope === "shop";
    setBusy(true);
    const r = await send(`${base}/pack/restore`, {
      locationId: shop ? view.scope : null,
      fromVersionId: h.id,
      expectedLiveVersionId: shop ? (view.pack.isShopVersion ? view.pack.versionId : null) : view.pack.globalVersionId,
    });
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };
  const dismissRequest = async (id: string) => {
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const r = await send(`${base}/pack-requests/${id}/dismiss`, {});
    setBusy(false);
    if (r.ok) done("catalog.item.saved"); else fail(r.code);
  };

  // ── Header bits ──
  const labelKind = versionLabelKind(view.scope, view.pack.isShopVersion, view.price.isShopLane);
  const versionText = labelKind === "global"
    ? t("catalog.item.version_global")
    : labelKind === "shop_own"
      ? t("catalog.item.version_shop", { shop: view.scopeName ?? "" })
      : t("catalog.item.version_shop_default", { shop: view.scopeName ?? "" });
  // The two save targets this actor may preview (and so save): their shop, and — MoO+ — everyone.
  const shopTarget: PreviewTarget | null = view.scope !== null && canSaveShop ? { kind: "shop", shopId: view.scope } : null;
  const globalPackTarget: PreviewTarget | null = view.can.editGlobalPack ? { kind: "global" } : null;
  const globalPriceTarget: PreviewTarget | null = view.can.editGlobalPrice ? { kind: "global" } : null;
  const toggleConversion = (key: string, on: boolean) =>
    setChosen((c) => { const next = new Set(c); if (on) next.add(key); else next.delete(key); return next; });
  const canSaveFor = (p: PackPreview | PricePreview) =>
    (p.target.kind === "global" ? (p.kind === "pack" ? view.can.editGlobalPack : view.can.editGlobalPrice) : canSaveShop);
  /**
   * GLOBAL scope below MoO, a global value already set (sim QA dead end): the job is READ-ONLY — the
   * refusal in plain words, and the way to the actor's own shop with the job open (one shop: straight
   * there; several: pick one).
   */
  const globalLocked = (job: ItemJob) => (
    <div className="flex flex-col gap-2">
      <p role="note" className="text-sm text-co-text">{t("catalog.error.global_requires_moo")}</p>
      {view.can.shopsToEdit.length === 1 ? (
        <Link href={skuItemHref(view.sku.id, { shopId: view.can.shopsToEdit[0]!.id, job })} className={`${btnPrimary} w-fit`}>
          {t("catalog.item.change_for_shop", { shop: view.can.shopsToEdit[0]!.name })}
        </Link>
      ) : view.can.shopsToEdit.length > 1 ? (
        <>
          <p className={fieldLabel}>{t("catalog.item.pick_shop")}</p>
          <div className="flex flex-wrap gap-2">
            {view.can.shopsToEdit.map((s) => (
              <Link key={s.id} href={skuItemHref(view.sku.id, { shopId: s.id, job })} className={btnPrimary}>
                {t("catalog.item.change_for_shop", { shop: s.name })}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
  const days = view.ordering.orderDays.map((d) => formatWeekday(sundayAnchoredDate(d), language)).join(", ");
  const laneKey = (lane: "human" | "auto" | "global" | "none"): TranslationKey | null =>
    lane === "human" ? "catalog.ordering.lane.human" : lane === "auto" ? "catalog.ordering.lane.auto" : lane === "global" ? "catalog.ordering.lane.global" : null;
  const slotName = (s: "weekday" | "weekend") => t(s === "weekday" ? "catalog.preview.slot.weekday" : "catalog.preview.slot.weekend");
  const weekdayPar = view.ordering.slots.find((s) => s.slot === "weekday")?.value ?? null;

  const connections = (
    <section aria-label={t("catalog.item.connections")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.item.connections")}</h2>
      <div className="mt-1 flex flex-col">
        {view.vendor ? (
          <Link href={`/admin/vendors/${view.vendor.id}`} className={linkRow}>{t("catalog.item.comes_from", { vendor: view.vendor.name })}</Link>
        ) : (
          <p className="flex min-h-[44px] items-center px-2 text-sm text-co-cta-text">{t("catalog.item.no_vendor")}</p>
        )}
        {view.product ? (
          <Link href={`/admin/products?product=${view.product.id}#${view.product.id}`} className={linkRow}>
            {t("catalog.item.part_of_product", { product: view.product.name })}
            {" · "}
            {view.product.primarySkuName ? t("catalog.item.buys_other", { sku: view.product.primarySkuName }) : t("catalog.item.buys_this_one")}
          </Link>
        ) : null}
        {view.ordering.offHere ? <p className="flex min-h-[44px] items-center px-2 text-sm font-bold text-co-warning-text">{t("catalog.item.off_here")}</p> : null}
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.item.used_in")}</p>
        {view.connections.uses.length === 0 ? (
          <p className="px-2 text-sm text-co-text-muted">{t("catalog.item.used_in_none")}</p>
        ) : view.connections.uses.map((r) => (
          <Link key={r.id} href={`/admin/recipes/${r.id}`} className={linkRow}>{r.name}</Link>
        ))}
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {view.connections.menuItems.length === 0 ? t("catalog.item.menu_none") : t("catalog.item.menu_count", { n: view.connections.menuItems.length })}
        </p>
        {view.connections.menuItems.map((m) => (
          <Link key={m.id} href="/admin/menu-costing" className={`${linkRow} justify-between`}>
            <span>{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
            <span className="text-co-text-muted no-underline">{money(m.cost)}</span>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      {/* Identity — always visible (D2). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-co-gold/20 px-3 py-1 text-xs font-bold text-co-text">{versionText}</span>
        {view.pack.isShopVersion ? <span className="text-xs text-co-text-muted">{t("catalog.item.based_on_global")}</span> : null}
        {view.sku.itemNumber ? <span className="text-xs text-co-text-muted">{t("catalog.item.item_number", { n: view.sku.itemNumber })}</span> : null}
        {!view.sku.active ? <span className="text-xs font-bold text-co-cta-text">{t("catalog.item.inactive")}</span> : null}
      </div>

      <nav aria-label={t("catalog.item.shop_switcher")} className="flex flex-wrap gap-2">
        <Link href={skuItemHref(view.sku.id, { shopId: null })} aria-current={view.scope === null ? "page" : undefined}
          className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${view.scope === null ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`}>
          {t("catalog.item.shop_global")}
        </Link>
        {view.shops.map((s) => (
          <Link key={s.id} href={skuItemHref(view.sku.id, { shopId: s.id })} aria-current={view.scope === s.id ? "page" : undefined}
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${view.scope === s.id ? "border-co-text bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text"}`}>
            {s.name}
          </Link>
        ))}
      </nav>

      {message ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}

      {/* Door reports — alerts, always visible. */}
      {view.openRequests.length > 0 ? (
        <section aria-label={t("catalog.requests.title")} className="rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
          <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{t("catalog.requests.title")}</h2>
          {view.openRequests.map((r) => (
            <div key={r.id} className="mt-2 flex flex-col gap-1">
              <p className="text-sm text-co-text">{t("catalog.requests.by", { who: r.filedBy ?? "—", date: day(r.filedAt) })}</p>
              {r.note ? <p className="text-sm italic text-co-text">&ldquo;{r.note}&rdquo;</p> : null}
              {r.photoId ? <DoorPhoto requestId={r.id} /> : null}
              {r.proposal?.innerCount != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_count", { n: formatQuantity(r.proposal.innerCount, language) })}</p> : null}
              {r.proposal?.eachWeight != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_weight", { w: formatQuantity(r.proposal.eachWeight, language), unit: r.proposal.eachUnit ?? "" })}</p> : null}
              {/* What later reports of the same case ADDED (chunk-3 review P3a). */}
              {r.additions.map((a, k) => (
                <div key={`${r.id}-add-${k}`} className="ml-3 flex flex-col gap-1 border-l-2 border-co-warning pl-3">
                  <p className="text-xs text-co-text-muted">{t("catalog.requests.added_by", { who: a.filedBy ?? "—", date: day(a.filedAt) })}</p>
                  {a.note ? <p className="text-sm italic text-co-text">&ldquo;{a.note}&rdquo;</p> : null}
                  {a.photoId ? <DoorPhoto requestId={r.id} additionId={a.id} /> : null}
                  {a.proposal?.innerCount != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_count", { n: formatQuantity(a.proposal.innerCount, language) })}</p> : null}
                  {a.proposal?.eachWeight != null ? <p className="text-xs text-co-text-muted">{t("catalog.requests.proposal_weight", { w: formatQuantity(a.proposal.eachWeight, language), unit: a.proposal.eachUnit ?? "" })}</p> : null}
                </div>
              ))}
              {canSaveShop ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => startJob("pack", r.id)}>{t("catalog.requests.review")}</button>
                  <button type="button" className={btn} disabled={busy} onClick={() => void dismissRequest(r.id)}>{t("catalog.requests.dismiss")}</button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Connections: first on a phone (a strip at the top), a side panel from md:. */}
        <aside className="order-1 md:order-2">{connections}</aside>

        <div className="order-2 flex min-w-0 flex-col gap-3 md:order-1">
          {/* What's missing — alerts, always visible. */}
          <section aria-label={t("catalog.item.missing")} className="rounded-xl border-2 border-co-border bg-co-surface p-3">
            <h2 className="text-[12px] font-bold tracking-wide text-co-text-muted">{t("catalog.item.missing")}</h2>
            {view.missing.length === 0 ? (
              <p className="mt-1 text-sm text-co-text">{t("catalog.item.missing_none")}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {view.missing.map((e) => (
                  <li key={e.code} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-co-text">
                      {e.code === "recipe_unresolved"
                        ? t("admin.skus.data.errand.recipe_unresolved", { recipes: e.recipes.join(", ") })
                        : t(`admin.skus.data.errand.${e.code}` as TranslationKey)}
                    </span>
                    <button type="button" className={btn} onClick={() => fixIt(e.code)}>{t("catalog.item.fix")}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* How it arrives */}
          <div id="item-arrives" className="scroll-mt-24">
            <CollapsibleSection idBase="item-arrives-panel" title={t("catalog.item.section.arrives")}
              count={view.pack.descriptor ?? t("catalog.item.no_pack")} open={open.arrives} onToggle={() => toggle("arrives")}>
              <div className="flex flex-col gap-3 p-3">
                {view.pack.orderUnit ? <p className="text-sm text-co-text">{t("catalog.item.order_unit", { unit: view.pack.orderUnit, oz: oz(view.pack.orderUnitOz) })}</p> : null}
                {globalPackLocked ? globalLocked("pack") : editing === "pack" ? (
                  <>
                    <PackSentenceEditor draft={draft} onChange={(d) => { setDraft(d); setPreview(null); guard.invalidate(); }} units={view.measures}
                      skuClass={view.sku.skuClass} currentLeafUnit={view.pack.levels.find((l) => l.containsLevelId == null)?.containsMeasureUnit ?? null}
                      avgOzPerEach={view.sku.avgOzPerEach} error={sentenceError} busy={busy} />
                    <div className="flex flex-wrap gap-2">
                      {shopTarget ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void previewPack(shopTarget)}>{t("catalog.item.see_changes")}</button> : null}
                      {globalPackTarget ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => void previewPack(globalPackTarget)}>
                          {t(view.scope === null ? "catalog.item.see_changes" : "catalog.item.see_changes_everyone")}
                        </button>
                      ) : null}
                      <button type="button" className={btn} disabled={busy} onClick={() => { guard.invalidate(); setEditing(null); setPreview(null); }}>{t("catalog.item.cancel")}</button>
                    </div>
                    {preview?.kind === "pack" ? (
                      <ChangePreviewPanel preview={preview} canSave={canSaveFor(preview)} canEditPar={view.can.editPar}
                        chosen={chosen} onToggleConversion={toggleConversion} onSave={() => void savePack()} busy={busy} />
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canEditPack ? <button type="button" className={btnPrimary} onClick={() => startJob("pack", null)}>{t("catalog.item.job_pack")}</button> : null}
                    {view.pack.isShopVersion && canSaveShop ? (
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void backToDefault("pack")}>
                        {confirming === "pack" ? t("catalog.item.back_to_default_confirm", { shop: view.scopeName ?? "" }) : t("catalog.item.back_to_default")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </div>

          {/* Price */}
          <div id="item-price" className="scroll-mt-24">
            <CollapsibleSection idBase="item-price-panel" title={t("catalog.item.section.price")}
              count={view.price.value == null ? t("catalog.price.none") : t("catalog.price.current", { price: money(view.price.value), unit: view.pack.orderUnit ?? "" })}
              open={open.price} onToggle={() => toggle("price")}>
              <div className="flex flex-col gap-3 p-3">
                {view.price.isShopLane ? (
                  <p className="text-sm text-co-text">{t("catalog.price.shop_own", { shop: view.scopeName ?? "" })} · {t("catalog.price.global_is", { price: money(view.price.globalValue) })}</p>
                ) : null}
                <p className="text-sm text-co-text">{t("catalog.price.cost_per_oz", { cost: view.price.costPerOz == null ? "—" : `$${view.price.costPerOz.toFixed(4)}` })}</p>
                <label className="block">
                  <span className={fieldLabel}>{t("catalog.price.basis")}</span>
                  <select className={field} value={view.sku.priceBasis ?? ""} disabled={busy || !view.can.editBasis} onChange={(e) => void setBasis(e.target.value)}>
                    <option value="">{t("catalog.price.basis.unset")}</option>
                    {PRICE_BASES.map((b) => <option key={b} value={b}>{t(`catalog.price.basis.${b}` as TranslationKey)}</option>)}
                  </select>
                </label>
                {globalPriceLocked ? globalLocked("price") : editing === "price" ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className={fieldLabel}>{t("catalog.price.new")}</span>
                        <input className={field} type="number" min={0} step="any" inputMode="decimal" value={priceText} disabled={busy} aria-label={t("catalog.price.new")}
                          onChange={(e) => { setPriceText(e.target.value); setPreview(null); guard.invalidate(); }} />
                      </label>
                      <label className="block">
                        <span className={fieldLabel}>{t("catalog.price.date")}</span>
                        <input className={field} type="date" value={priceDate} disabled={busy} aria-label={t("catalog.price.date")} onChange={(e) => { setPriceDate(e.target.value); setPreview(null); guard.invalidate(); }} />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shopTarget ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void previewPrice(shopTarget)}>{t("catalog.item.see_changes")}</button> : null}
                      {globalPriceTarget ? (
                        <button type="button" className={btn} disabled={busy} onClick={() => void previewPrice(globalPriceTarget)}>
                          {t(view.scope === null ? "catalog.item.see_changes" : "catalog.item.see_changes_everyone")}
                        </button>
                      ) : null}
                      <button type="button" className={btn} disabled={busy} onClick={() => { guard.invalidate(); setEditing(null); setPreview(null); }}>{t("catalog.item.cancel")}</button>
                    </div>
                    {preview?.kind === "price" ? (
                      <ChangePreviewPanel preview={preview} canSave={canSaveFor(preview)} canEditPar={false}
                        chosen={chosen} onToggleConversion={toggleConversion} onSave={() => void savePrice()} busy={busy} />
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canEditPrice ? <button type="button" className={btnPrimary} onClick={() => startJob("price")}>{t("catalog.item.job_price")}</button> : null}
                    {view.price.isShopLane && canSaveShop ? (
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void backToDefault("price")}>
                        {confirming === "price" ? t("catalog.item.back_to_default_confirm", { shop: view.scopeName ?? "" }) : t("catalog.item.back_to_default")}
                      </button>
                    ) : null}
                  </div>
                )}
                {view.price.history.length > 0 ? (
                  <div>
                    <p className={fieldLabel}>{t("catalog.price.history")}</p>
                    <ul className="mt-1 flex flex-col">
                      {view.price.history.map((p) => (
                        <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1 text-sm text-co-text">
                          <span>{formatDateLabel(p.effectiveDate, language)} · {t(p.shop ? "catalog.price.history_shop" : "catalog.price.history_global")}</span>
                          <span className="font-bold">{money(p.unitPrice)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Ordering */}
          <div id="item-ordering" className="scroll-mt-24">
            <CollapsibleSection idBase="item-ordering-panel" title={t("catalog.item.section.ordering")}
              count={weekdayPar == null ? t("catalog.ordering.par_none", { slot: slotName("weekday") }) : t("catalog.ordering.par", { slot: slotName("weekday"), n: formatQuantity(weekdayPar, language) })}
              open={open.ordering} onToggle={() => toggle("ordering")}>
              <div className="flex flex-col gap-2 p-3 text-sm text-co-text">
                {view.ordering.slots.map((s) => {
                  const lane = laneKey(s.lane);
                  return (
                    <p key={s.slot}>
                      {s.value == null ? t("catalog.ordering.par_none", { slot: slotName(s.slot) }) : t("catalog.ordering.par", { slot: slotName(s.slot), n: `${formatQuantity(s.value, language)} ${view.pack.orderUnit ?? ""}` })}
                      {lane ? <span className="text-co-text-muted"> · {t(lane)}</span> : null}
                    </p>
                  );
                })}
                <p>{days ? t("catalog.ordering.order_days", { days }) : t("catalog.ordering.no_days")}</p>
                {view.can.editPar ? <Link href={skuCatalogHref(view.sku.id)} className={linkRow}>{t("catalog.ordering.change_pars")}</Link> : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Counting */}
          <div id="item-counting" className="scroll-mt-24">
            <CollapsibleSection idBase="item-counting-panel" title={t("catalog.item.section.counting")}
              count={view.counting.unit ?? "—"} open={open.counting} onToggle={() => toggle("counting")}>
              <div className="flex flex-col gap-2 p-3 text-sm text-co-text">
                {view.counting.unit ? <p>{t("catalog.counting.unit", { unit: view.counting.unit })}</p> : null}
                {view.scope ? <Link href={`/operations/counts?location=${view.scope}`} className={linkRow}>{t("catalog.counting.open")}</Link> : null}
              </div>
            </CollapsibleSection>
          </div>

          {/* Barcodes */}
          <div id="item-barcodes" className="scroll-mt-24">
            <CollapsibleSection idBase="item-barcodes-panel" title={t("catalog.item.section.barcodes")}
              count={String(view.barcodes.length)} open={open.barcodes} onToggle={() => toggle("barcodes")}>
              <div className="flex flex-col gap-1 p-3 text-sm text-co-text">
                {view.barcodes.length === 0 ? <p>{t("catalog.barcodes.none")}</p> : view.barcodes.map((b) => (
                  <p key={`${b.code}-${b.level}`} className="break-all">{b.code} · {t(b.level === "case" ? "catalog.barcodes.level.case" : "catalog.barcodes.level.inner")}</p>
                ))}
              </div>
            </CollapsibleSection>
          </div>

          {/* History */}
          <div id="item-history" className="scroll-mt-24">
            <CollapsibleSection idBase="item-history-panel" title={t("catalog.item.section.history")}
              count={String(view.history.length)} open={open.history} onToggle={() => toggle("history")}>
              <div className="flex flex-col gap-2 p-3">
                {view.history.length === 0 ? <p className="text-sm text-co-text">{t("catalog.history.empty")}</p> : view.history.map((h) => {
                  const canRestore = !h.active && (h.scope === "shop" ? canSaveShop : view.can.editGlobalPack);
                  return (
                    <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-co-border py-2 text-sm text-co-text">
                      <div className="min-w-0">
                        <p className="font-bold">{t(h.scope === "shop" ? "catalog.history.scope_shop" : "catalog.history.scope_global")} · {h.labels.join(" → ")}</p>
                        <p className="text-xs text-co-text-muted">
                          {day(h.effectiveFrom)}{h.who ? ` · ${h.who}` : ""} · {h.active ? t("catalog.history.live") : t("catalog.history.retired", { date: h.retiredAt ? day(h.retiredAt) : "—" })}
                        </p>
                      </div>
                      {canRestore ? <button type="button" className={btn} disabled={busy} onClick={() => void restore(h)}>{t("catalog.history.restore")}</button> : null}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}
