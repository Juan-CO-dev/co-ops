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
import { EmptyState } from "@/components/EmptyState";
import { CopyButton, DeliveryRow } from "@/components/ordering/delivery-affordances";
import { ParSuggestionRow } from "@/components/ordering/ParSuggestionRow";
import { ParSilencePanel } from "@/components/ordering/ParSilencePanel";
import { formatDateLabel } from "@/lib/i18n/format";
import type {
  WalkerData,
  WalkerVendor,
  WalkerSku,
  DraftOrder,
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

/**
 * Half of `roundUnits`' one-decimal display grain — the point below which a negative
 * advisory is float residue rather than a receiving gap, and so must NOT trip the named
 * negative state. Anything closer to zero than this already renders as "0" / "-0", and a
 * lane that cries wolf gets scrolled past. The SUGGESTION's clamp is deliberately not
 * epsilon-gated (see `suggestedOrderQty`): naming a state and computing a case count have
 * different tolerances, and −0.0001 must still not buy a case.
 */
const DISPLAY_GRAIN = 0.05;

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
  const { t } = useTranslation();
  const router = useRouter();

  // Observation map, keyed by skuId. Born empty (nothing observed yet).
  const [obs, setObs] = useState<Record<string, Obs>>({});
  // UI phase: the walk, the review overlay, or the post-submit success state.
  const [phase, setPhase] = useState<"walk" | "review" | "done">("walk");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Filled from the POST response after a successful submit. poError = the walk saved but
  // draft-PO creation failed (the observation data is sacred; codes/POs can be regenerated).
  const [result, setResult] = useState<{
    draftOrders: DraftOrder[];
    shrinkage: ShrinkageNotice[];
    poError: boolean;
  } | null>(null);

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

  // ── Accepting a par suggestion (Dynamic Pars, Task 4.3) ─────────────────────
  // The server writes the par and returns it; the row's ORDER QTY is then recomputed
  // here through `suggestedOrderQty` — the SAME pure function the server used for the
  // Suggest chip, imported by ParSuggestionRow rather than re-derived, so the chip and
  // the new par can never disagree mid-walk. `router.refresh()` re-pulls the
  // server-authoritative par (the suggestion disappears with it, unmounting the block
  // and its local state); it does NOT reset this island's useState — house law — which
  // is exactly why the qty we just set survives the refresh.
  const onSuggestionAccepted = (skuId: string, _newPar: number, newQty: number | null) => {
    if (newQty != null) setSku(skuId, { qty: String(newQty), marked: true });
    router.refresh();
  };

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
  // "Empty" = the shelf-is-bare one-tap: order the FULL par (ceil to whole order units,
  // matching the suggest math). The complement of "We're full · 0" — the two extremes of
  // the walk. (Born of the first smoke: "Full" alone read as "order a full par".)
  const setOrderPar = (skuId: string, par: number) =>
    setSku(skuId, { qty: String(Math.max(Math.ceil(par), 0)), marked: true });
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
        poError?: boolean;
        code?: string;
      };
      if (!res.ok) {
        setErr(t(("ordering.error." + (j?.code ?? "generic")) as TranslationKey));
        setBusy(false);
        return;
      }
      setResult({ draftOrders: j.draftOrders ?? [], shrinkage: j.shrinkage ?? [], poError: j.poError ?? false });
      setPhase("done");
      // SIM-18b: a completed walk CREATES draft POs, so the server payload above
      // this island (OrderingSurfaces' "Today's orders" + the draftless-cutoff
      // list, both server props from app/ordering/page.tsx) is now stale — it
      // still shows the pre-walk board. Only `startNew` refreshed, so a manager
      // who finished a walk and scrolled up saw the old board until a hard
      // reload. router.refresh() re-pulls the server payload; it does NOT reset
      // this island's useState (house law), so the success state below survives.
      router.refresh();
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

        {result.poError && (
          // The walk saved but draft-PO creation failed — the observation data is sacred;
          // the codes/POs can be regenerated from the cutoff path. Advisory, non-blocking.
          <div role="status" className="rounded-xl border-2 border-co-warning bg-co-warning-surface px-4 py-3 text-[13px] text-co-text">
            {t("ordering.done.po_error")}
          </div>
        )}

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
      {/* Advisory-blackout banner (page-level notice position — first thing in the walk).
          INFO tone, not warn: the nightly sales-depletion run simply hasn't landed yet, so
          on-hand estimates + Suggest chips are thin BY DESIGN and return on their own. The
          owner himself once read this designed blackout as a regression — the banner exists
          to say so out loud. Server-derived (walker.advisoryPaused); dormant shops (no sales
          ledger at all) never trip it. Explains the silence; fabricates no number. */}
      {walker.advisoryPaused && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-info/40 bg-co-info/10 px-4 py-3 text-[13px] text-co-text"
        >
          {t("ordering.walker.advisory_paused")}
        </div>
      )}

      {/* Unroutable-demand notice (audit P4). WARN tone, unlike the blackout banner above:
          a par with no ordering path is a real gap that will not fix itself overnight.
          Each cause line names what to DO about it, and only non-zero causes render.
          Live at filing: Ham + Fresh Mozzarella both have their par on the deactivated
          twin, so the walker could never suggest them — and said nothing. */}
      {walker.unroutable.count > 0 && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-warning bg-co-warning-surface px-4 py-3 text-[13px] text-co-text"
        >
          <p className="font-bold">{t("ordering.walker.unroutable", { n: walker.unroutable.count })}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-co-warning-text">
            {walker.unroutable.skuInactive > 0 && (
              <li>{t("ordering.walker.unroutable_sku_inactive", { n: walker.unroutable.skuInactive })}</li>
            )}
            {walker.unroutable.vendorInactive > 0 && (
              <li>{t("ordering.walker.unroutable_vendor_inactive", { n: walker.unroutable.vendorInactive })}</li>
            )}
            {walker.unroutable.noVendor > 0 && (
              <li>{t("ordering.walker.unroutable_no_vendor", { n: walker.unroutable.noVendor })}</li>
            )}
            {walker.unroutable.productUnroutable > 0 && (
              <li>{t("ordering.walker.unroutable_product", { n: walker.unroutable.productUnroutable })}</li>
            )}
            {/* Discontinued (Juan's ruling, 2026-08-21). Not a routing FAILURE — the
                walk is obeying a decision — but it belongs in this lane because the
                demand is deliberately deleted and a stale par row is left behind, so
                there is a real errand. Last in the list: it is the one cause here
                that is working as intended. */}
            {walker.unroutable.productRetired > 0 && (
              <li>{t("ordering.walker.unroutable_product_retired", { n: walker.unroutable.productRetired })}</li>
            )}
          </ul>
        </div>
      )}

      {/* Failover notice (0179) — the POSITIVE half of the P4 story, and deliberately
          its own block with an INFORMATIONAL tone rather than a line inside the warn
          box above: nothing here needs fixing. A par whose own item could not be
          routed today was carried by another member of the same product, so the
          demand moved instead of evaporating. This is the vendor-down behavior the
          whole product layer exists for, and the manager should be told it worked. */}
      {walker.unroutable.reroutedToBackup > 0 && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-info/40 bg-co-info/10 px-4 py-3 text-[13px] text-co-text"
        >
          {walker.unroutable.reroutedToBackup === 1
            ? t("ordering.walker.rerouted_to_backup_one")
            : t("ordering.walker.rerouted_to_backup_other", { n: walker.unroutable.reroutedToBackup })}
        </div>
      )}

      {/* PAR-REVIEW lane (Juan, 2026-08-21) — its own ADVISORY block, gold, sitting
          between the warn box and the informational failover notice, which is exactly
          where it belongs in the severity ladder: nothing is broken (these rows order
          fine today), but something DID change and a standing number is now probably
          too high. "The system recognizes what's going on before the human does."
          Deliberately not inside the warn box — a par that wants tuning is not a
          routing failure, and mixing the two teaches managers to ignore both. */}
      {walker.unroutable.parReview > 0 && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-gold-deep bg-co-gold/20 px-4 py-3 text-[13px] text-co-text"
        >
          <p className="font-bold">{t("ordering.walker.par_review", { n: walker.unroutable.parReview })}</p>
          <p className="mt-0.5 text-co-gold-text">{t("ordering.walker.par_review_hint")}</p>
        </div>
      )}

      {/* THE SHADOW BANNER (Dynamic Pars, Task 4.5) — ONE GLOBAL BANNER, NEVER A PER-ROW
          REASON. In v1 100% of rows are in shadow, so a per-row shadow badge would badge
          everything and destroy the reason lane sitting right below it (r3). Info tone on
          the warning SURFACE token with the warning TEXT token — never `co-warning` as
          text, which measures 1.95:1. Nothing here is a fault: the machine is doing
          exactly what it was built to do first, which is watch. */}
      {walker.shadowMode && (
        <div
          role="status"
          className="rounded-xl border-2 border-co-warning bg-co-warning-surface px-4 py-3 text-[13px] text-co-text"
        >
          <p className="font-bold">{t("ordering.shadow.banner")}</p>
          <p className="mt-0.5 text-co-warning-text">{t("ordering.shadow.banner_hint")}</p>
        </div>
      )}

      {/* THE REASON LANE (Dynamic Pars, Task 4.6) — the aggregate line plus the
          default-collapsed per-cause errand list. Mounted here, beneath the unroutable
          notice block, because it answers the same class of question ("what is this walk
          not telling me, and why?") one layer deeper: unroutable is demand with no
          ordering path; this is a par with no opinion. */}
      <ParSilencePanel silence={walker.parSilence} />

      {/* Recent-passes history affordance — collapsible, default-collapsed (D3). Each
          links to its recorded draft orders via the eventId GET (opened in a new view). */}
      {recent.length > 0 && <HistoryPanel recent={recent} shopLabel={shopLabel} dateLabel={dateLabel} />}

      {walker.vendors.length === 0 ? (
        <EmptyState message={t("ordering.walk.no_skus")} />
      ) : (
        walker.vendors.map((v) => (
          <VendorSection
            key={v.vendorId}
            vendor={v}
            obs={obs}
            locationId={locationId}
            dayClass={walker.isWeekendPar ? "weekend" : "weekday"}
            shadowMode={walker.shadowMode}
            onStep={stepBy}
            onInput={(skuId, qty) => setSku(skuId, { qty, marked: true })}
            onSuggest={setSuggested}
            onFull={setFull}
            onOrderPar={setOrderPar}
            onClear={clearSku}
            onSuggestionAccepted={onSuggestionAccepted}
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
  locationId,
  dayClass,
  shadowMode,
  onStep,
  onInput,
  onSuggest,
  onFull,
  onOrderPar,
  onClear,
  onSuggestionAccepted,
}: {
  vendor: WalkerVendor;
  obs: Record<string, Obs>;
  locationId: string;
  /** The walk's own day-class — the slot every suggestion on this page is about. */
  dayClass: "weekday" | "weekend";
  shadowMode: boolean;
  onStep: (skuId: string, delta: number) => void;
  onInput: (skuId: string, qty: string) => void;
  onSuggest: (skuId: string, n: number) => void;
  onFull: (skuId: string) => void;
  onOrderPar: (skuId: string, par: number) => void;
  onClear: (skuId: string) => void;
  onSuggestionAccepted: (skuId: string, newPar: number, newQty: number | null) => void;
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
          {vendor.cutoffTimeToday && (
            <AlertPill tone={vendor.cutoffSoon ? "warn" : "info"} uppercase={false}>
              {t("ordering.vendor.cutoff", { time: vendor.cutoffTimeToday })}
            </AlertPill>
          )}
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
            locationId={locationId}
            dayClass={dayClass}
            shadowMode={shadowMode}
            onStep={(d) => onStep(s.skuId, d)}
            onInput={(q) => onInput(s.skuId, q)}
            onSuggest={() => s.suggestedQty != null && onSuggest(s.skuId, s.suggestedQty)}
            onFull={() => onFull(s.skuId)}
            onOrderPar={() => onOrderPar(s.skuId, s.parToday)}
            onClear={() => onClear(s.skuId)}
            onSuggestionAccepted={onSuggestionAccepted}
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
  locationId,
  dayClass,
  shadowMode,
  onStep,
  onInput,
  onSuggest,
  onFull,
  onOrderPar,
  onClear,
  onSuggestionAccepted,
}: {
  sku: WalkerSku;
  value: Obs;
  locationId: string;
  dayClass: "weekday" | "weekend";
  shadowMode: boolean;
  onStep: (delta: number) => void;
  onInput: (qty: string) => void;
  onSuggest: () => void;
  onFull: () => void;
  onOrderPar: () => void;
  onClear: () => void;
  onSuggestionAccepted: (skuId: string, newPar: number, newQty: number | null) => void;
}) {
  const { t, language } = useTranslation();
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
          {/* Product identity (0179): which PRODUCT this vendor's item is, and whether
              it is the designated primary or the backup lane. Silent for a singleton —
              ~95% of the catalog — so the row is unchanged for almost everything. */}
          {sku.productName != null && (
            <span className="mt-0.5 inline-flex items-center gap-1.5">
              <span className="rounded-md bg-co-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-co-gold-text">
                {sku.productName}
              </span>
              {sku.memberRole === "backup" && (
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-dim">
                  {t("ordering.row.member_backup")}
                </span>
              )}
            </span>
          )}
          <span className="block text-[12px] text-co-text-dim">{unit}</span>
          {/* The failover, said out loud: this row is here because ANOTHER member's
              par could not be routed today. Informational tone — it is the system
              working, not a fault. */}
          {sku.reroutedFromSkuId != null && (
            <span className="mt-0.5 block text-[12px] text-co-text-muted">
              {t("ordering.row.rerouted_here")}
            </span>
          )}
          {/* PAR-REVIEW ADVISORY (Juan, 2026-08-21) — the cause, on the row that owns
              the par. Gold/advisory, never danger: this row orders perfectly well
              today; what changed is that its demand lost a source, and the system is
              saying so before the walk-in fills up. It NAMES the recipe and points at
              the par edit — it never suggests a number (Dynamic Pars owns that). */}
          {sku.parAdvisory != null && (
            <span
              className="mt-1 block rounded-md bg-co-gold/20 px-2 py-1 text-[12px] font-medium text-co-gold-text"
              role="note"
              aria-label={t(
                sku.parAdvisory.code === "no_demand_source"
                  ? "ordering.row.par_review_none_aria"
                  : "ordering.row.par_review_aria",
                { sku: sku.name, recipes: sku.parAdvisory.removedSources.join(", ") },
              )}
            >
              {t(
                sku.parAdvisory.code === "no_demand_source"
                  ? "ordering.row.par_review_none"
                  : "ordering.row.par_review",
                { recipes: sku.parAdvisory.removedSources.join(", ") },
              )}
            </span>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className="rounded-md bg-co-surface-2 px-2 py-0.5 text-[12px] font-bold text-co-text">
            {t("ordering.row.par", { n: sku.parToday })}
          </span>
          {sku.parIsWeekend && (
            <span className="rounded-md bg-co-gold/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-co-gold-text">
              {t("ordering.row.weekend")}
            </span>
          )}
        </span>
      </div>

      {/* THE NUMBER PAIR (Dynamic Pars, Task 4.3) — directly beneath the par chip it is
          about. Mutually exclusive with the #283 cause advisory above by construction:
          the server nulls one when the other exists, so this row says ONE numeric thing. */}
      {sku.parSuggestion != null && (
        <ParSuggestionRow
          sku={sku}
          suggestion={sku.parSuggestion}
          locationId={locationId}
          dayClass={dayClass}
          shadowMode={shadowMode}
          onAccepted={onSuggestionAccepted}
        />
      )}

      {/* THE EVENT ADVISORY (Task 4.7) — NAMED, NEVER SUMMED. Booked catering inside the
          horizon this par has to survive. Its own line, deliberately not part of the
          suggestion block: it is true whether or not the engine has a number, and it is
          NOT an input to one (a fulfilled event's consumption already enters the base
          through toast/production, so adding it anywhere would double-count it). */}
      {sku.parEvent != null && (
        <p className="mt-1.5 text-[12px] text-co-text-dim">
          {t("ordering.suggestion.reason_event", {
            day: formatDateLabel(sku.parEvent.needDate, language),
            oz: Math.round(sku.parEvent.oz),
          })}
        </p>
      )}

      {/* Advisory on-hand + last-order hints. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        {/* No derivable order-unit→oz conversion (server: canImplyOz) → this SKU can never
            carry an on-hand estimate and never earns a Suggest chip. Muted microcopy, NOT a
            warning tone: it's a chronic data gap (fix it in SKU admin), not an incident. It
            occupies the slot the advisory line would have used, so the absence reads as
            explained rather than blank. Display-only — the stepper still works normally. */}
        {!sku.canImplyOz && (
          <span className="text-co-text-muted" aria-label={t("ordering.row.no_weight")}>
            {t("ordering.row.no_weight")}
          </span>
        )}
        {sku.advisoryOnHand &&
          sku.advisoryOnHand.orderUnits != null &&
          (sku.advisoryOnHand.orderUnits <= -DISPLAY_GRAIN ? (
            /* A NEGATIVE ADVISORY IS A DATA SIGNAL, AND IT NAMES ITSELF (Juan's walk
               smoke, 2026-08-31). The advisory is receipts-minus-consumption with no count
               anchor, so it runs negative wherever a SKU's receiving history is EMPTY
               while its consumption is real (prod: P St Prosciutto, 0 oz ever received vs
               407 oz consumed → ≈ −34 order units). Rendering "~-34 on hand" would state a
               falsehood a shelf cannot hold, and rendering nothing would hide the errand —
               so the STATE gets a name, and the name says which errand fixes it (the
               receiving history, not the par). Warn-lane VOICE without a warn surface:
               `co-warning-text` is the text role, `co-warning` is a fill/dot/border role
               and is never text. The Suggest chip beside this line is already the honest
               par-from-empty — `suggestedOrderQty` floors on-hand at 0 upstream — and the
               raw figure stays one hover away rather than being destroyed. */
            <span
              className="text-co-warning-text"
              title={t("ordering.row.advisory_negative_detail", {
                units: roundUnits(sku.advisoryOnHand.orderUnits),
                unit,
                source: t(SOURCE_KEY[sku.advisoryOnHand.source] ?? "ordering.source.inferred"),
              })}
              aria-label={t("ordering.row.advisory_negative_aria", { sku: sku.name })}
            >
              {t("ordering.row.advisory_negative")}
            </span>
          ) : (
            <span className="text-co-text-dim">
              {t("ordering.row.advisory", {
                units: roundUnits(sku.advisoryOnHand.orderUnits),
                unit,
                source: t(SOURCE_KEY[sku.advisoryOnHand.source] ?? "ordering.source.inferred"),
              })}
            </span>
          ))}
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
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-bold uppercase tracking-[0.08em] text-co-confirm-text">
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

        {/* One-tap chips — the two shelf extremes + the anchored middle: Suggest (par −
            on-hand, when an anchor exists) · Empty (order the FULL par — the bare-shelf
            tap) · We're-full (explicit 0: shelf at par, orders nothing, anchors on-hand)
            · Clear (un-observe — back to EMPTY, so the line is not submitted). */}
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
            onClick={onOrderPar}
            aria-label={t("ordering.row.order_par_aria", { sku: sku.name, n: Math.ceil(sku.parToday) })}
            className={`${chip} border-co-border bg-co-surface text-co-text hover:border-co-text`}
          >
            {t("ordering.row.order_par", { n: Math.ceil(sku.parToday) })}
          </button>
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

  // The plaintext order body: an optional "PO {code}" first line (spec §5b.3 — the
  // deterministic attribution key in every transmitted body), then the shop+date header,
  // then one line per SKU. The PO line is omitted when the draft PO failed to create
  // (displayCode null) — the order text still sends; only the code is missing.
  const bodyText = useMemo(() => {
    const poLine = order.displayCode ? `${t("ordering.email.body_po", { code: order.displayCode })}\n` : "";
    const header = t("ordering.email.body_header", { shop: shopLabel, date: dateLabel });
    const lines = order.lines.map((l) =>
      t("ordering.email.body_line", {
        sku: l.skuName,
        qty: l.orderQty,
        unit: l.orderUnitLabel ?? t("ordering.unit_generic"),
        item: l.itemNumber ?? "—",
      }),
    );
    return `${poLine}${header}\n\n${lines.join("\n")}`;
  }, [order, shopLabel, dateLabel, t]);

  const subject = t("ordering.email.subject", { shop: shopLabel, date: dateLabel });

  return (
    <section className="co-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="text-base font-bold text-co-text">{order.vendorName}</h3>
        {order.displayCode && (
          <span className="rounded-md bg-co-surface-2 px-2 py-0.5 font-mono text-[12px] font-bold tracking-wide text-co-text-dim">
            {t("ordering.done.po_code", { code: order.displayCode })}
          </span>
        )}
      </div>

      {/* The vendor's order minimum (migration 0184) — ADVISORY, and nothing more: the
          system does not compare this order against it, warn, or block. It sits under the
          vendor's name because that is the moment the question ("have we hit their
          minimum?") is actually asked. Neutral voice, not a warning surface: an
          unevaluated fact rendered as an alert would teach the walk to ignore alerts. */}
      {order.orderMinimum ? (
        <p className="mt-1 text-[13px] text-co-text-dim">
          {t("ordering.done.order_minimum", { value: order.orderMinimum })}
        </p>
      ) : null}

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
