"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "@/components/ActionButton";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { CountSkuOption, CountProductOption } from "@/lib/counts";
import { twinVendorLabels } from "@/lib/counts-shared";
import type { TranslationKey, TranslationParams } from "@/lib/i18n/types";

/**
 * C-MODE (spec 2026-08-20, "Counting UX (locked: option C)").
 *
 * The sheet's default row is the PRODUCT with ONE number ("HAM … [ ] oz"). When 2+
 * members carry expected stock here, a full-row TAP-TO-SPLIT toggle turns that one
 * row into one row per vendor, each labeled with PR #267's twin labels (reused, never
 * re-derived). Splitting is REVERSIBLE: the product entry and the per-vendor entries
 * live side by side in the same draft, so a mis-tap costs nothing.
 *
 * Disclosure Doctrine D6/D9: the toggle is a full-row <button> with aria-expanded +
 * aria-controls, and its state is useState only — no URL, no storage.
 */

interface MemberDraft {
  skuId: string;
  level: string;
  qty: string;
  isLoose: boolean;
  partial: string;
}
interface LineDraft {
  /** "" until something is picked; "product:<id>" or "sku:<id>" thereafter. */
  pick: string;
  level: string;
  qty: string;
  isLoose: boolean;
  partial: string; // "" = whole container; "0.5" = half, etc.
  /** Product rows only: the operator chose to count each vendor separately. */
  split: boolean;
  /** Product rows only: the per-vendor entries, preserved across a split toggle. */
  members: MemberDraft[];
}
const emptyLine = (): LineDraft => ({ pick: "", level: "", qty: "", isLoose: false, partial: "", split: false, members: [] });
const emptyMember = (skuId: string): MemberDraft => ({ skuId, level: "", qty: "", isLoose: false, partial: "" });
const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const subLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

/** The wire shape of one count line — a SKU pointer or a PRODUCT pointer, never both
 *  (the route rejects a body naming two pointers). */
type PayloadLine = { levelLabel: string; qty: number; isLoose: boolean; partialFraction: number | null } & (
  | { skuId: string }
  | { productId: string }
);

type Advisory = {
  code: string;
  productName?: string;
  unallocatedOz?: number;
  absorbedByVendorName?: string | null;
};

export function CountForm({ skus, products, locationId }: {
  skus: CountSkuOption[];
  /** The PRODUCT rows. EMPTY before migration 0180 applies — the sheet then renders
   *  exactly as it did before this arc, which is the point of the gate. */
  products: CountProductOption[];
  locationId: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  // Tier-A step-up (council A4): the counts POST asserts it server-side, but this
  // form lives outside /admin's StepUpProvider — it carries its own modal (the
  // SalesTab idiom: stash the pending submit, prompt, replay on confirm). Found
  // live 2026-08-10: the route demanded a password confirm the UI never offered.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const skuById = new Map(skus.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.productId, p]));
  // A member SKU is reachable ONLY through its product's split — listing it beside
  // the product row would invite counting the same stock twice.
  const singletonSkus = skus.filter((s) => s.productId == null || !productById.has(s.productId));
  // P8: only names that exist under 2+ vendors get a vendor suffix. Computed ONCE for the
  // whole option set, not per row — and empty for the ~95% single-vendor catalog, so the
  // common case renders exactly as before.
  const twinLabels = twinVendorLabels(skus);
  const skuLabel = (s: CountSkuOption) => {
    const v = twinLabels.get(s.id);
    return v ? `${s.name} — ${v}` : s.name;
  };
  const vendorOf = (skuId: string) => twinLabels.get(skuId) ?? skuById.get(skuId)?.vendorName ?? null;

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setMember = (i: number, mi: number, patch: Partial<MemberDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, members: l.members.map((m, k) => (k === mi ? { ...m, ...patch } : m)) } : l)));

  const productOf = (l: LineDraft): CountProductOption | undefined =>
    l.pick.startsWith("product:") ? productById.get(l.pick.slice(8)) : undefined;
  const skuOf = (l: LineDraft): CountSkuOption | undefined =>
    l.pick.startsWith("sku:") ? skuById.get(l.pick.slice(4)) : undefined;

  /** Splitting seeds one entry per member, preserving anything already typed. */
  const toggleSplit = (i: number) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const p = productOf(l);
    if (!p) return l;
    const existing = new Map(l.members.map((m) => [m.skuId, m]));
    return { ...l, split: !l.split, members: p.memberSkuIds.map((id) => existing.get(id) ?? emptyMember(id)) };
  }));

  const entryFilled = (e: { level: string; qty: string }) => e.level.trim() !== "" && e.qty.trim() !== "";
  /** Every entry this line will actually submit. A split product line submits its
   *  member entries; everything else submits itself. */
  const filledEntries = (l: LineDraft): number =>
    l.pick === "" ? 0 : l.split ? l.members.filter(entryFilled).length : entryFilled(l) ? 1 : 0;

  const canSubmit = !busy && lines.some((l) => filledEntries(l) > 0);

  // Council P2: submit() silently drops any line that's only partially filled (started
  // but not finished) — the operator got a clean success having lost lines. A line with
  // NOTHING touched is an untouched spare row, never counted/warned about; a line with
  // SOME but not all of pick/level/qty filled is what gets silently dropped below. A
  // SPLIT line counts each half-filled VENDOR entry, so a dropped vendor is surfaced too.
  const incompleteCount = lines.reduce((n, l) => {
    if (l.split) {
      const started = l.members.filter((m) => m.level.trim() !== "" || m.qty.trim() !== "");
      return n + started.filter((m) => !entryFilled(m)).length;
    }
    const touched = l.pick !== "" || l.level.trim() !== "" || l.qty.trim() !== "";
    return n + (touched && filledEntries(l) === 0 ? 1 : 0);
  }, 0);

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setAdvisories([]); setBusy(true);
    const payloadLines = lines.flatMap((l): PayloadLine[] => {
      if (l.pick === "") return [];
      const common = (e: { level: string; qty: string; isLoose: boolean; partial: string }) => ({
        levelLabel: e.level.trim(),
        qty: Number(e.qty),
        isLoose: e.isLoose,
        partialFraction: e.partial.trim() === "" ? null : Number(e.partial),
      });
      if (l.split) {
        return l.members.filter(entryFilled).map((m) => ({ skuId: m.skuId, ...common(m) }));
      }
      if (!entryFilled(l)) return [];
      const p = productOf(l);
      return p ? [{ productId: p.productId, ...common(l) }] : [{ skuId: l.pick.slice(4), ...common(l) }];
    });
    const res = await fetch("/api/operations/counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId, note: note.trim() || null, lines: payloadLines }) });
    setBusy(false);
    if (res.ok) {
      const body = await res.json().catch(() => ({} as { advisories?: Advisory[] }));
      setStepUpOpen(false); pendingRef.current = null; router.refresh();
      setNote(""); setLines([emptyLine()]);
      // Non-blocking findings the count RAISED (count_exceeds_lots). The record
      // succeeded — these say what the delivery ledger could not place.
      setAdvisories(Array.isArray(body?.advisories) ? body.advisories : []);
      return;
    }
    const j = await res.json().catch(() => ({} as { code?: string }));
    if (j?.code === "step_up_required" || j?.code === "step_up_stale") {
      pendingRef.current = () => void submit();
      setStepUpOpen(true);
      return;
    }
    setErr(t(("counts.error." + (j?.code ?? "generic")) as never));
  };

  return (
    <div className="rounded-2xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("counts.form.title")}</h2>
      {/* Disjoint-by-law guidance (council L5): full containers + loose-below,
          never double-counted. */}
      <p className="mt-2 rounded-lg border-2 border-co-border-2 bg-white px-3 py-2 text-[11px] text-co-text-dim">{t("counts.form.disjoint_hint")}</p>

      <div className="mt-3 flex flex-col gap-3">
        {lines.map((l, i) => {
          const product = productOf(l);
          const sku = skuOf(l);
          const levels = product ? product.chainLabels : sku?.chainLabels ?? [];
          const primaryVendor = product?.defaultSkuId != null ? vendorOf(product.defaultSkuId) : null;
          return (
            <div key={i} className="rounded-lg border-2 border-co-border-2 p-3">
              <select className={field} value={l.pick} disabled={busy} onChange={(e) => setLine(i, { pick: e.target.value, level: "", split: false, members: [] })} aria-label={t("counts.form.pick_sku")}>
                <option value="">{t("counts.form.pick_sku")}</option>
                {products.length > 0 ? (
                  <optgroup label={t("counts.form.group_products")}>
                    {products.map((p) => <option key={p.productId} value={`product:${p.productId}`}>{p.name}</option>)}
                  </optgroup>
                ) : null}
                {products.length > 0 ? (
                  <optgroup label={t("counts.form.group_skus")}>
                    {singletonSkus.map((s) => <option key={s.id} value={`sku:${s.id}`}>{skuLabel(s)}</option>)}
                  </optgroup>
                ) : (
                  singletonSkus.map((s) => <option key={s.id} value={`sku:${s.id}`}>{skuLabel(s)}</option>)
                )}
              </select>

              {product ? (
                <>
                  <p className="mt-2 text-[11px] text-co-text-muted">
                    {product.lotBearingMemberCount > 0
                      ? t("counts.form.vendors_carry_stock", { n: product.lotBearingMemberCount })
                      : t("counts.form.vendors_carry_stock_none")}
                  </p>
                  {product.splitAvailable ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleSplit(i)}
                      aria-expanded={l.split}
                      aria-controls={`count-split-${i}`}
                      aria-label={t(l.split ? "counts.form.collapse_aria" : "counts.form.split_aria", { name: product.name })}
                      className="mt-2 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-left text-xs font-bold tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-60"
                    >
                      <span>{t(l.split ? "counts.form.collapse_to_product" : "counts.form.split_by_vendor")}</span>
                      <span aria-hidden className="flex h-6 w-6 items-center justify-center text-xs text-co-text-dim">{l.split ? "▾" : "▸"}</span>
                    </button>
                  ) : null}
                  {!l.split && product.chainsDiffer && primaryVendor ? (
                    <p className="mt-2 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-[11px] text-co-text">
                      {t("counts.form.chains_differ", { vendor: primaryVendor })}
                    </p>
                  ) : null}
                </>
              ) : null}

              {l.split && product ? (
                <div id={`count-split-${i}`} className="mt-3 flex flex-col gap-3 border-t-2 border-co-border-2 pt-3">
                  <p className={subLabel}>{t("counts.form.split_group", { name: product.name })}</p>
                  {l.members.map((m, mi) => {
                    const ms = skuById.get(m.skuId);
                    const mLevels = ms?.chainLabels ?? [];
                    const label = ms ? skuLabel(ms) : m.skuId;
                    return (
                      <div key={m.skuId} className="rounded-lg border-2 border-co-border bg-co-surface-inset p-3">
                        <p className="text-[12px] font-semibold text-co-text">{label}</p>
                        <EntryFields
                          idPrefix={`split-${i}-${mi}`}
                          levels={mLevels}
                          value={m}
                          busy={busy}
                          onChange={(patch) => setMember(i, mi, patch)}
                          t={t}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EntryFields
                  idPrefix={`line-${i}`}
                  levels={levels}
                  value={l}
                  busy={busy}
                  onChange={(patch) => setLine(i, patch)}
                  t={t}
                />
              )}

              {lines.length > 1 ? (
                <button type="button" disabled={busy} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="mt-2 inline-flex min-h-[44px] items-center text-xs font-bold text-co-cta-text disabled:opacity-60">{t("counts.form.remove_line")}</button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("counts.form.add_line")}</button>

      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("counts.form.note")}</span>
        <textarea className={`${field} min-h-[60px] py-2`} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder={t("counts.form.note_hint")} aria-label={t("counts.form.note")} /></label>

      {err ? <p className="mt-3 text-sm text-co-cta-text">{err}</p> : null}
      {/* count_exceeds_lots and friends: the audit RECORDED — these are findings, not
          failures (lead ruling: a count is ground truth and theory yields to it). */}
      {advisories.length > 0 ? (
        <div role="status" className="mt-3 flex flex-col gap-2">
          {advisories.map((a, k) => (
            <p key={k} className="rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-3 text-sm text-co-text">
              {a.absorbedByVendorName
                ? t("counts.advisory.count_exceeds_lots", {
                    product: a.productName ?? "",
                    oz: Math.round((a.unallocatedOz ?? 0) * 10) / 10,
                    vendor: a.absorbedByVendorName,
                  })
                : t("counts.advisory.count_exceeds_lots_unattributed", {
                    product: a.productName ?? "",
                    oz: Math.round((a.unallocatedOz ?? 0) * 10) / 10,
                  })}
            </p>
          ))}
        </div>
      ) : null}
      {/* Pre-submit visibility for the drop that submit() still performs (council P2):
          submit stays enabled — an operator may legitimately skip a line they started —
          but the notice surfaces the drop BEFORE they tap Record. */}
      {incompleteCount > 0 ? (
        <div role="status" className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-3 text-sm text-co-text">
          {t("counts.form.incomplete_lines", { n: incompleteCount })}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <ActionButton disabled={!canSubmit} onClick={() => void submit()}>{t("counts.form.submit")}</ActionButton>
      </div>
      {/* PasswordModal posts /api/auth/step-up itself and confirms only on 200. */}
      <PasswordModal
        open={stepUpOpen}
        onConfirm={() => { setStepUpOpen(false); const p = pendingRef.current; pendingRef.current = null; p?.(); }}
        onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }}
      />
    </div>
  );
}

/** The level / qty / loose / partial block — identical for a product row and for each
 *  vendor row of a split, so the two modes can never drift apart. */
function EntryFields({ idPrefix, levels, value, busy, onChange, t }: {
  idPrefix: string;
  levels: string[];
  value: { level: string; qty: string; isLoose: boolean; partial: string };
  busy: boolean;
  onChange: (patch: { level?: string; qty?: string; isLoose?: boolean; partial?: string }) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}) {
  return (
    <>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className={subLabel}>{t("counts.form.level")}</span>
          {levels.length > 0 ? (
            <select className={field} value={value.level} disabled={busy} onChange={(e) => onChange({ level: e.target.value })} aria-label={t("counts.form.level")}>
              <option value="">{t("counts.form.pick_level")}</option>
              {levels.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          ) : (
            <input className={field} value={value.level} disabled={busy} onChange={(e) => onChange({ level: e.target.value })} placeholder={t("counts.form.level_freeform")} aria-label={t("counts.form.level")} />
          )}
        </label>
        <label className="block">
          <span className={subLabel}>{t("counts.form.qty")}</span>
          <input className={field} type="number" min={0} step="any" inputMode="decimal" value={value.qty} disabled={busy} onChange={(e) => onChange({ qty: e.target.value })} aria-label={t("counts.form.qty")} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-[44px] items-center gap-2 text-[12px] text-co-text">
          <input id={`${idPrefix}-loose`} type="checkbox" checked={value.isLoose} disabled={busy} onChange={(e) => onChange({ isLoose: e.target.checked })} className="h-5 w-5" aria-label={t("counts.form.is_loose")} />
          {t("counts.form.is_loose")}
        </label>
        <label className="inline-flex min-h-[44px] items-center gap-2 text-[12px] text-co-text">
          <span>{t("counts.form.partial")}</span>
          <input className="min-h-[44px] w-20 rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm text-co-text disabled:opacity-60" type="number" min={0} max={1} step="any" inputMode="decimal" value={value.partial} disabled={busy} onChange={(e) => onChange({ partial: e.target.value })} placeholder={t("counts.form.partial_hint")} aria-label={t("counts.form.partial")} />
        </label>
      </div>
    </>
  );
}
