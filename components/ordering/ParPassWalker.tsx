"use client";

/**
 * ParPassWalker — the shelf-walk client island (delivery-intake P3, spec D5/D6).
 *
 * A key holder walks the shelves with a phone. Per par'd SKU they set ONE thing:
 * the order qty needed to reach par. Vendors are CollapsibleSections (today's
 * order-day vendors open, the rest collapsed with i18n'd SKU counts — doctrine D5).
 * Each SKU row shows par + advisory on-hand + last order + a stepper input with a
 * one-tap "Suggest N" chip and a "Full" chip (explicit zero).
 *
 * ── EMPTY vs EXPLICIT ZERO (the design call) ──────────────────────────────────
 * EMPTY input  = not observed → the line is NOT submitted (never walked this SKU).
 * EXPLICIT 0   = the we're-full observation (tap − to 0, or tap the "Full" chip) →
 *                submitted with orderQty 0 (implied on-hand = full par). The two are
 *                visually unmistakable: empty renders a blank stepper; explicit 0
 *                renders a filled "0 · full" state with a success accent.
 * A per-SKU `marked` boolean tracks "observed" independent of the numeric value, so
 * a 0 that was TYPED (marked) submits, while a 0-valued-but-untouched row does not.
 *
 * ── SUBMIT LIFECYCLE ──────────────────────────────────────────────────────────
 * Sticky bottom bar: "{n} SKUs marked · Review order" (disabled at 0) → a full-screen
 * REVIEW overlay shows per-vendor draft cards (lines + delivery affordances: mailto /
 * open-link / tel, each with Copy) → Submit POSTs → success state re-renders the SAME
 * draft cards from the response + any shrinkage notices (advisory voice). "Start a new
 * walk" resets ALL client state explicitly (router.refresh does NOT reset useState —
 * house law).
 *
 * House laws: useState-only disclosure (no effects for prop resets); type-only server
 * imports; phone-first 390px; every string + aria i18n'd (ordering.* namespace).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AlertPill } from "@/components/ui/AlertPill";
import type {
  WalkerData,
  WalkerVendor,
  WalkerSku,
  DraftOrder,
  DraftOrderDelivery,
  ShrinkageNotice,
  ParPassSummary,
} from "@/lib/ordering";
import type { TranslationKey } from "@/lib/i18n/types";

/** One SKU's editable observation. `qty` is the raw input string; `marked` flags that
 *  the operator observed this SKU (so an explicit 0 submits, an untouched row doesn't). */
interface Obs {
  qty: string;
  marked: boolean;
}

/** Map the advisory anchor source to the short provenance word (matches the OnHandPanel
 *  SourceChip vocabulary: census→audited, par_estimate→par-pass, inferred→inferred). */
const SOURCE_KEY: Record<string, TranslationKey> = {
  census: "ordering.source.audited",
  par_estimate: "ordering.source.par_pass",
  inferred: "ordering.source.inferred",
};

/** Parse a raw qty string → a non-negative finite number, or null when blank/invalid. */
function parseQty(raw: string): number | null {
  const v = raw.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const stepBtn =
  "inline-flex h-12 w-12 min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-2xl font-bold text-co-text hover:border-co-text disabled:opacity-60";
const chip =
  "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition";

export function ParPassWalker({
  walker,
  recent,
  locationId,
  shopLabel,
  dateLabel,
}: {
  walker: WalkerData;
  recent: ParPassSummary[];
  locationId: string;
  shopLabel: string;
  dateLabel: string;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();

  // Observation map, keyed by skuId. Born empty (nothing observed yet).
  const [obs, setObs] = useState<Record<string, Obs>>({});
  // UI phase: the walk, the review overlay, or the post-submit success state.
  const [phase, setPhase] = useState<"walk" | "review" | "done">("walk");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Filled from the POST response after a successful submit.
  const [result, setResult] = useState<{ draftOrders: DraftOrder[]; shrinkage: ShrinkageNotice[] } | null>(null);

  const setSku = (skuId: string, patch: Partial<Obs>) =>
    setObs((m) => ({ ...m, [skuId]: { qty: "", marked: false, ...m[skuId], ...patch } }));

  // A SKU is "marked" (submitted) once the operator has touched it — typing, stepping,
  // tapping Suggest, or tapping Full. The count reflects observed SKUs, not vendors.
  const markedSkus = useMemo(() => Object.values(obs).filter((o) => o.marked), [obs]);
  const markedCount = markedSkus.length;

  // Index every walker SKU by id for the review payload (name/unit/vendor come from here).
  const skuIndex = useMemo(() => {
    const m = new Map<string, { sku: WalkerSku; vendor: WalkerVendor }>();
    for (const v of walker.vendors) for (const s of v.skus) m.set(s.skuId, { sku: s, vendor: v });
    return m;
  }, [walker]);

  // The lines to submit: every marked SKU with a valid numeric qty (explicit 0 included).
  const submitLines = useMemo(
    () =>
      Object.entries(obs)
        .filter(([, o]) => o.marked)
        .map(([skuId, o]) => ({ skuId, orderQty: parseQty(o.qty) }))
        .filter((l): l is { skuId: string; orderQty: number } => l.orderQty !== null),
    [obs],
  );

  // ── Stepper ops ──────────────────────────────────────────────────────────────
  const stepBy = (skuId: string, delta: number) => {
    setObs((m) => {
      const cur = m[skuId]?.qty ?? "";
      const base = parseQty(cur) ?? 0;
      const next = Math.max(0, base + delta);
      return { ...m, [skuId]: { qty: String(next), marked: true } };
    });
  };
  const setSuggested = (skuId: string, n: number) => setSku(skuId, { qty: String(n), marked: true });
  const setFull = (skuId: string) => setSku(skuId, { qty: "0", marked: true });
  const clearSku = (skuId: string) => setSku(skuId, { qty: "", marked: false });

  const goReview = () => {
    if (markedCount === 0) return;
    setErr(null);
    setPhase("review");
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    if (submitLines.length === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/operations/ordering", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId, lines: submitLines }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        draftOrders?: DraftOrder[];
        shrinkage?: ShrinkageNotice[];
        code?: string;
      };
      if (!res.ok) {
        setErr(t(("ordering.error." + (j?.code ?? "generic")) as TranslationKey));
        setBusy(false);
        return;
      }
      setResult({ draftOrders: j.draftOrders ?? [], shrinkage: j.shrinkage ?? [] });
      setPhase("done");
      window.scrollTo({ top: 0 });
    } catch {
      setErr(t("ordering.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  // Explicit reset — router.refresh() does NOT reset useState (house law). "Start a new
  // walk" clears every observation + result, then refreshes to re-pull the walker data
  // (last-order hints + advisory now reflect the just-submitted pass).
  const startNew = () => {
    setObs({});
    setResult(null);
    setErr(null);
    setPhase("walk");
    router.refresh();
    window.scrollTo({ top: 0 });
  };

  // ── DONE: success state ──────────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <div className="mt-4 flex flex-col gap-4">
        <div
          role="status"
          className="rounded-xl border-2 border-co-success bg-co-success-surface px-4 py-3 text-sm font-bold text-co-text"
        >
          {t("ordering.done.recorded", { n: submitLines.length })}
        </div>

        {result.shrinkage.length > 0 && (
          <div className="rounded-xl border-2 border-co-warning bg-co-warning-surface p-4">
            <div className="flex items-center gap-2">
              <AlertPill tone="warn">{t("ordering.shrinkage.badge")}</AlertPill>
              <span className="text-sm font-bold text-co-text">
                {t("ordering.shrinkage.title", { n: result.shrinkage.length })}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-co-text-dim">{t("ordering.shrinkage.help")}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {result.shrinkage.map((s) => (
                <li key={s.skuId} className="rounded-md bg-co-surface px-2 py-1 text-[12px] font-semibold text-co-text">
                  {s.skuName}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {t("ordering.done.orders_title")}
        </h2>
        {result.draftOrders.length === 0 ? (
          <p className="text-[13px] italic text-co-text-muted">{t("ordering.done.no_orders")}</p>
        ) : (
          result.draftOrders.map((o) => (
            <DraftOrderCard key={o.vendorId} order={o} shopLabel={shopLabel} dateLabel={dateLabel} />
          ))
        )}

        <button
          type="button"
          onClick={startNew}
          className="mt-2 inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text"
        >
          {t("ordering.done.new_walk")}
        </button>
      </div>
    );
  }

  // ── REVIEW: full-screen overlay with per-vendor draft cards ───────────────────
  if (phase === "review") {
    // Build the preview draft orders from the marked lines (orderQty > 0) grouped by
    // vendor. The server rebuilds these authoritatively at submit; this preview mirrors
    // its grouping so the manager sees exactly what will send. Delivery affordances are
    // NOT known client-side (they live server-side) — the review preview shows lines
    // only, and the authoritative cards (with affordances) render in the DONE state.
    const previewByVendor = new Map<string, { vendor: WalkerVendor; lines: WalkerSku[]; qty: Map<string, number> }>();
    for (const l of submitLines) {
      if (l.orderQty <= 0) continue; // explicit-full lines are recorded but not ordered.
      const entry = skuIndex.get(l.skuId);
      if (!entry) continue;
      const g = previewByVendor.get(entry.vendor.vendorId) ?? {
        vendor: entry.vendor,
        lines: [],
        qty: new Map<string, number>(),
      };
      g.lines.push(entry.sku);
      g.qty.set(l.skuId, l.orderQty);
      previewByVendor.set(entry.vendor.vendorId, g);
    }
    const previews = [...previewByVendor.values()].sort((a, b) => a.vendor.name.localeCompare(b.vendor.name));
    const fullCount = submitLines.filter((l) => l.orderQty === 0).length;

    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-co-bg">
        <div className="mx-auto max-w-2xl px-4 pb-40 pt-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-co-text">{t("ordering.review.title")}</h2>
            <button
              type="button"
              onClick={() => setPhase("walk")}
              className="inline-flex min-h-[44px] items-center px-2 text-sm font-bold text-co-text-dim hover:text-co-text"
            >
              {t("ordering.review.back")}
            </button>
          </div>
          <p className="mt-1 text-[13px] text-co-text-dim">
            {t("ordering.review.summary", { orders: previews.length, full: fullCount })}
          </p>

          {err && (
            <div role="alert" className="mt-3 rounded-lg border-2 border-co-danger bg-co-danger-surface px-3 py-3 text-sm text-co-text">
              {err}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-4">
            {previews.length === 0 ? (
              <p className="text-[13px] italic text-co-text-muted">{t("ordering.review.no_orders")}</p>
            ) : (
              previews.map((p) => (
                <section key={p.vendor.vendorId} className="co-card p-4">
                  <h3 className="text-base font-bold text-co-text">{p.vendor.name}</h3>
                  <table className="mt-2 w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-co-text-dim">
                        <th className="pb-1 font-bold">{t("ordering.review.col_sku")}</th>
                        <th className="pb-1 font-bold">{t("ordering.review.col_item")}</th>
                        <th className="pb-1 text-right font-bold">{t("ordering.review.col_qty")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lines.map((s) => (
                        <tr key={s.skuId} className="border-t border-co-border/50">
                          <td className="py-1 font-semibold text-co-text">{s.name}</td>
                          <td className="py-1 text-co-text-dim">{s.itemNumber ?? "—"}</td>
                          <td className="py-1 text-right font-bold text-co-text">
                            {t("ordering.review.qty_unit", {
                              qty: p.qty.get(s.skuId) ?? 0,
                              unit: s.orderUnitLabel ?? t("ordering.unit_generic"),
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[12px] text-co-text-muted">{t("ordering.review.affordance_hint")}</p>
                </section>
              ))
            )}
          </div>
        </div>

        {/* Sticky submit bar for the review overlay. */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-co-border bg-co-bg/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-2xl gap-2">
            <button
              type="button"
              onClick={() => setPhase("walk")}
              disabled={busy}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text-dim hover:border-co-text disabled:opacity-50"
            >
              {t("ordering.review.keep_walking")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || submitLines.length === 0}
              className="inline-flex min-h-[48px] flex-[2] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
            >
              {busy ? t("ordering.review.submitting") : t("ordering.review.submit", { n: submitLines.length })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── WALK: vendor sections + SKU rows ──────────────────────────────────────────
  return (
    <div className="mt-4 flex flex-col gap-4 pb-24">
      {/* Recent-passes history affordance — collapsible, default-collapsed (D3). Each
          links to its recorded draft orders via the eventId GET (opened in a new view). */}
      {recent.length > 0 && <HistoryPanel recent={recent} shopLabel={shopLabel} dateLabel={dateLabel} />}

      {walker.vendors.length === 0 ? (
        <p className="rounded-lg border-2 border-dashed border-co-border-2 px-3 py-6 text-center text-[13px] text-co-text-dim">
          {t("ordering.walk.no_skus")}
        </p>
      ) : (
        walker.vendors.map((v) => (
          <VendorSection
            key={v.vendorId}
            vendor={v}
            obs={obs}
            onStep={stepBy}
            onInput={(skuId, qty) => setSku(skuId, { qty, marked: true })}
            onSuggest={setSuggested}
            onFull={setFull}
            onClear={clearSku}
          />
        ))
      )}

      {/* Sticky bottom bar: marked-count + Review. Disabled until ≥1 SKU is observed. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-co-border bg-co-bg/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <span className="text-sm font-bold text-co-text">
            {t("ordering.walk.marked_count", { n: markedCount })}
          </span>
          <button
            type="button"
            onClick={goReview}
            disabled={markedCount === 0}
            className="ml-auto inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-5 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {t("ordering.walk.review")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Vendor section (CollapsibleSection; order-day open, others collapsed) ─────────
function VendorSection({
  vendor,
  obs,
  onStep,
  onInput,
  onSuggest,
  onFull,
  onClear,
}: {
  vendor: WalkerVendor;
  obs: Record<string, Obs>;
  onStep: (skuId: string, delta: number) => void;
  onInput: (skuId: string, qty: string) => void;
  onSuggest: (skuId: string, n: number) => void;
  onFull: (skuId: string) => void;
  onClear: (skuId: string) => void;
}) {
  const { t } = useTranslation();
  // Count of SKUs the operator has observed for THIS vendor (D2 alert, always visible).
  const markedHere = vendor.skus.filter((s) => obs[s.skuId]?.marked).length;

  return (
    <CollapsibleSection
      idBase={`ordering-vendor-${vendor.vendorId}`}
      title={vendor.name}
      count={t("ordering.vendor.sku_count", { n: vendor.skus.length })}
      defaultOpen={vendor.isOrderDay}
      badge={
        <>
          {vendor.isOrderDay && <AlertPill tone="info">{t("ordering.vendor.order_day")}</AlertPill>}
          {markedHere > 0 && (
            <AlertPill tone="ok" uppercase={false}>
              {t("ordering.vendor.marked", { n: markedHere })}
            </AlertPill>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {vendor.skus.map((s) => (
          <SkuRow
            key={s.skuId}
            sku={s}
            value={obs[s.skuId] ?? { qty: "", marked: false }}
            onStep={(d) => onStep(s.skuId, d)}
            onInput={(q) => onInput(s.skuId, q)}
            onSuggest={() => s.suggestedQty != null && onSuggest(s.skuId, s.suggestedQty)}
            onFull={() => onFull(s.skuId)}
            onClear={() => onClear(s.skuId)}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ── One SKU row (phone-first; the ONE input = order qty) ──────────────────────────
function SkuRow({
  sku,
  value,
  onStep,
  onInput,
  onSuggest,
  onFull,
  onClear,
}: {
  sku: WalkerSku;
  value: Obs;
  onStep: (delta: number) => void;
  onInput: (qty: string) => void;
  onSuggest: () => void;
  onFull: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const unit = sku.orderUnitLabel ?? t("ordering.unit_generic");
  const parsed = parseQty(value.qty);
  // Explicit-zero state: marked AND resolves to exactly 0 → the "0 · full" filled look.
  const isFull = value.marked && parsed === 0;
  const isEmpty = value.qty.trim() === "";

  return (
    <div
      className={
        "rounded-lg border-2 p-3 transition " +
        (isFull
          ? "border-co-success bg-co-success-surface"
          : value.marked
            ? "border-co-gold-deep bg-co-surface"
            : "border-co-border-2 bg-co-surface")
      }
    >
      {/* Identity + par + weekend + advisory + last-order (all read, never collapsed). */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-base font-bold text-co-text">{sku.name}</span>
          <span className="block text-[12px] text-co-text-dim">{unit}</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className="rounded-md bg-co-surface-2 px-2 py-0.5 text-[12px] font-bold text-co-text">
            {t("ordering.row.par", { n: sku.parToday })}
          </span>
          {sku.parIsWeekend && (
            <span className="rounded-md bg-co-gold/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-co-gold-deep">
              {t("ordering.row.weekend")}
            </span>
          )}
        </span>
      </div>

      {/* Advisory on-hand + last-order hints. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        {sku.advisoryOnHand && sku.advisoryOnHand.orderUnits != null && (
          <span className="text-co-text-dim">
            {t("ordering.row.advisory", {
              units: roundUnits(sku.advisoryOnHand.orderUnits),
              unit,
              source: t(SOURCE_KEY[sku.advisoryOnHand.source] ?? "ordering.source.inferred"),
            })}
          </span>
        )}
        {sku.lastOrderQty != null && (
          <span className="text-co-text-muted">{t("ordering.row.last", { n: sku.lastOrderQty })}</span>
        )}
      </div>

      {/* THE input: order qty. Stepper (44px+) + a direct field. */}
      <div className="mt-3">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {t("ordering.row.order_label", { unit })}
        </span>
        <div className="mt-1 flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label={t("ordering.row.decrement", { sku: sku.name })}
            className={stepBtn}
          >
            −
          </button>
          <div className="relative flex-1">
            <input
              className={
                "min-h-[44px] w-full rounded-lg border-2 px-3 text-center text-xl font-bold focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
                (isFull
                  ? "border-co-success bg-co-success-surface text-co-text"
                  : "border-co-border bg-co-surface text-co-text")
              }
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value.qty}
              placeholder={t("ordering.row.empty_hint")}
              onChange={(e) => onInput(e.target.value)}
              aria-label={t("ordering.row.order_label", { unit })}
            />
            {/* The explicit-zero overlay label — makes "0 · full" unmistakable vs empty. */}
            {isFull && (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-bold uppercase tracking-[0.08em] text-co-success">
                {t("ordering.row.full_tag")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label={t("ordering.row.increment", { sku: sku.name })}
            className={stepBtn}
          >
            +
          </button>
        </div>

        {/* One-tap chips: Suggest (fills the suggested qty) · Full (explicit 0) · Clear
            (un-observe — back to EMPTY, so the line is not submitted). */}
        <div className="mt-2 flex flex-wrap gap-2">
          {sku.suggestedQty != null && (
            <button
              type="button"
              onClick={onSuggest}
              aria-label={t("ordering.row.suggest_aria", { sku: sku.name, n: sku.suggestedQty })}
              className={`${chip} border-co-gold-deep bg-co-gold/20 text-co-text hover:bg-co-gold/40`}
            >
              {t("ordering.row.suggest", { n: sku.suggestedQty })}
            </button>
          )}
          <button
            type="button"
            onClick={onFull}
            aria-pressed={isFull}
            aria-label={t("ordering.row.full_aria", { sku: sku.name })}
            className={
              `${chip} ` +
              (isFull
                ? "border-co-success bg-co-success text-white"
                : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
            }
          >
            {t("ordering.row.full")}
          </button>
          {value.marked && !isEmpty && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t("ordering.row.clear_aria", { sku: sku.name })}
              className={`${chip} border-co-border bg-co-surface text-co-text-dim hover:border-co-text`}
            >
              {t("ordering.row.clear")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Round an advisory order-unit float for display — one decimal, trailing-zero trimmed. */
function roundUnits(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ── Draft-order card (DONE state): lines + delivery affordances ───────────────────
function DraftOrderCard({
  order,
  shopLabel,
  dateLabel,
}: {
  order: DraftOrder;
  shopLabel: string;
  dateLabel: string;
}) {
  const { t } = useTranslation();

  // The plaintext order body: a header line (shop + date) then one line per SKU.
  const bodyText = useMemo(() => {
    const header = t("ordering.email.body_header", { shop: shopLabel, date: dateLabel });
    const lines = order.lines.map((l) =>
      t("ordering.email.body_line", {
        sku: l.skuName,
        qty: l.orderQty,
        unit: l.orderUnitLabel ?? t("ordering.unit_generic"),
        item: l.itemNumber ?? "—",
      }),
    );
    return `${header}\n\n${lines.join("\n")}`;
  }, [order, shopLabel, dateLabel, t]);

  const subject = t("ordering.email.subject", { shop: shopLabel, date: dateLabel });

  return (
    <section className="co-card p-4">
      <h3 className="text-base font-bold text-co-text">{order.vendorName}</h3>

      <table className="mt-2 w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-co-text-dim">
            <th className="pb-1 font-bold">{t("ordering.review.col_sku")}</th>
            <th className="pb-1 font-bold">{t("ordering.review.col_item")}</th>
            <th className="pb-1 text-right font-bold">{t("ordering.review.col_qty")}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={`${l.skuName}-${i}`} className="border-t border-co-border/50">
              <td className="py-1 font-semibold text-co-text">{l.skuName}</td>
              <td className="py-1 text-co-text-dim">{l.itemNumber ?? "—"}</td>
              <td className="py-1 text-right font-bold text-co-text">
                {t("ordering.review.qty_unit", { qty: l.orderQty, unit: l.orderUnitLabel ?? t("ordering.unit_generic") })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Delivery affordances per ordering-detail method. */}
      <div className="mt-3 flex flex-col gap-2">
        {order.orderingDetails.length === 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-dashed border-co-border-2 px-3 py-2">
            <span className="text-[13px] text-co-text-dim">{t("ordering.deliver.none")}</span>
            <CopyButton text={bodyText} />
          </div>
        ) : (
          order.orderingDetails.map((d, i) => (
            <DeliveryRow key={`${d.method}-${i}`} detail={d} subject={subject} body={bodyText} copyText={bodyText} />
          ))
        )}
      </div>
    </section>
  );
}

// ── One delivery affordance row (method → link + Copy) ────────────────────────────
function DeliveryRow({
  detail,
  subject,
  body,
  copyText,
}: {
  detail: DraftOrderDelivery;
  subject: string;
  body: string;
  copyText: string;
}) {
  const { t } = useTranslation();
  const label = detail.label ?? methodLabel(detail.method, t);

  // mailto: subject + body are URL-encoded via encodeURIComponent (mailto injection
  // guard — a rogue vendor value can't smuggle headers). The address itself is the
  // raw value; only the query params are encoded.
  const mailtoHref = `mailto:${detail.value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const telHref = `tel:${detail.value}`;

  let action: React.ReactNode;
  if (detail.method === "email") {
    action = (
      <a href={mailtoHref} className={linkBtn}>
        {t("ordering.deliver.email")}
      </a>
    );
  } else if (detail.method === "url" || detail.method === "portal") {
    action = (
      <a href={detail.value} target="_blank" rel="noopener noreferrer" className={linkBtn}>
        {t("ordering.deliver.open")}
      </a>
    );
  } else if (detail.method === "phone") {
    action = (
      <a href={telHref} className={linkBtn}>
        {t("ordering.deliver.call")}
      </a>
    );
  } else {
    // other / none → copy only (no navigable affordance).
    action = null;
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
      <div className="min-w-0">
        <span className="block text-[13px] font-bold text-co-text">{label}</span>
        <span className="block truncate text-[12px] text-co-text-dim">{detail.value}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <CopyButton text={detail.method === "email" ? copyText : detail.value} />
      </div>
    </div>
  );
}

const linkBtn =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-sm font-bold text-co-text hover:bg-co-gold-deep";

/** Copy-to-clipboard with a textual fallback (older/insecure contexts have no
 *  navigator.clipboard). Shows a transient "Copied" state. */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: a hidden textarea + execCommand (deprecated but the last resort).
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — silently no-op (the link affordances still work).
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text-dim hover:border-co-text"
    >
      {copied ? t("ordering.deliver.copied") : t("ordering.deliver.copy")}
    </button>
  );
}

/** Fallback method label when a detail carries no explicit label. */
function methodLabel(method: string, t: (k: TranslationKey) => string): string {
  switch (method) {
    case "email":
      return t("ordering.deliver.method_email");
    case "url":
      return t("ordering.deliver.method_url");
    case "portal":
      return t("ordering.deliver.method_portal");
    case "phone":
      return t("ordering.deliver.method_phone");
    default:
      return t("ordering.deliver.method_other");
  }
}

// ── History panel: recent par-passes (collapsible, default-collapsed) ─────────────
function HistoryPanel({
  recent,
  shopLabel,
  dateLabel,
}: {
  recent: ParPassSummary[];
  shopLabel: string;
  dateLabel: string;
}) {
  const { t, language } = useTranslation();
  // Which event's detail is expanded (its draft orders lazy-fetched on first open).
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, DraftOrder[] | "loading" | "error">>({});

  const toggle = async (eventId: string) => {
    if (openEvent === eventId) {
      setOpenEvent(null);
      return;
    }
    setOpenEvent(eventId);
    if (detail[eventId]) return; // already loaded / loading.
    setDetail((m) => ({ ...m, [eventId]: "loading" }));
    try {
      const res = await fetch(`/api/operations/ordering?eventId=${encodeURIComponent(eventId)}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        setDetail((m) => ({ ...m, [eventId]: "error" }));
        return;
      }
      const j = (await res.json()) as { detail?: { draftOrders?: DraftOrder[] } };
      setDetail((m) => ({ ...m, [eventId]: j.detail?.draftOrders ?? [] }));
    } catch {
      setDetail((m) => ({ ...m, [eventId]: "error" }));
    }
  };

  return (
    <CollapsibleSection
      idBase="ordering-history"
      title={t("ordering.history.title")}
      count={t("ordering.history.count", { n: recent.length })}
      defaultOpen={false}
    >
      <ul className="flex flex-col gap-2">
        {recent.map((p) => {
          const isOpen = openEvent === p.eventId;
          const d = detail[p.eventId];
          return (
            <li key={p.eventId} className="rounded-lg border-2 border-co-border-2 bg-co-surface">
              <button
                type="button"
                onClick={() => void toggle(p.eventId)}
                aria-expanded={isOpen}
                aria-controls={`ordering-history-${p.eventId}`}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-co-text">
                    {formatWalkedAt(p.walkedAt, language)}
                  </span>
                  <span className="block text-[12px] text-co-text-dim">
                    {t("ordering.history.by", { name: p.walkedByName ?? t("ordering.history.unknown") })}
                    {" · "}
                    {t("ordering.history.lines", { n: p.lineCount })}
                  </span>
                </span>
                <span aria-hidden className="text-xs text-co-text-dim">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <div id={`ordering-history-${p.eventId}`} className="border-t border-co-border/50 px-3 pb-3 pt-2">
                  {d === "loading" || d === undefined ? (
                    <p className="text-[12px] italic text-co-text-muted">{t("ordering.history.loading")}</p>
                  ) : d === "error" ? (
                    <p className="text-[12px] italic text-co-danger">{t("ordering.history.error")}</p>
                  ) : d.length === 0 ? (
                    <p className="text-[12px] italic text-co-text-muted">{t("ordering.history.no_orders")}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {d.map((o) => (
                        <DraftOrderCard key={o.vendorId} order={o} shopLabel={shopLabel} dateLabel={dateLabel} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}

/** Locale-aware date+time for a walked_at ISO timestamp (never toLocale*(undefined)). */
function formatWalkedAt(iso: string, language: "en" | "es"): string {
  const dt = new Date(iso);
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}
