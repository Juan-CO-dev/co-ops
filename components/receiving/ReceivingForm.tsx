"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { ReceivingFormData, ReceivingSkuOption } from "@/lib/receiving";

interface LineDraft { skuId: string; level: string; qty: string; price: string; observed: string; note: string; }
const emptyLine = (): LineDraft => ({ skuId: "", level: "", qty: "", price: "", observed: "", note: "" });
const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function ReceivingForm({ formData, locationId, today }: { formData: ReceivingFormData; locationId: string; today: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState(today);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const vendorSkus = formData.skus.filter((s) => s.vendorId === vendorId || s.vendorId === null);
  const skuById = new Map<string, ReceivingSkuOption>(formData.skus.map((s) => [s.id, s]));
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (s: string): number | null => { const v = s.trim(); return v === "" ? null : Number(v); };

  const canSubmit = vendorId !== "" && date !== "" && lines.some((l) => l.skuId !== "" && l.qty.trim() !== "") && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    const payload = {
      vendorId, locationId, deliveryDate: date,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceTotal: num(invoiceTotal),
      notes: notes.trim() || null,
      lines: lines.filter((l) => l.skuId !== "" && l.qty.trim() !== "").map((l) => ({
        skuId: l.skuId, qtyReceived: Number(l.qty), unitPrice: num(l.price), observedOzPerEach: num(l.observed),
        notes: l.note.trim() || null, receivedLevelLabel: l.level.trim() || null,
      })),
    };
    const res = await fetch("/api/operations/receiving", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) { router.refresh(); setVendorId(""); setInvoiceNumber(""); setInvoiceTotal(""); setNotes(""); setLines([emptyLine()]); }
    else { const j = await res.json().catch(() => ({} as { code?: string })); setErr(t(("receiving.error." + (j?.code ?? "generic")) as never)); }
  };

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("receiving.form.title")}</h2>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.vendor")}</span>
        <select className={field} value={vendorId} disabled={busy} onChange={(e) => setVendorId(e.target.value)} aria-label={t("receiving.form.vendor")}>
          <option value="">{t("receiving.form.pick_vendor")}</option>
          {formData.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.date")}</span>
          <input className={field} type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} aria-label={t("receiving.form.date")} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_number")}</span>
          <input className={field} value={invoiceNumber} disabled={busy} onChange={(e) => setInvoiceNumber(e.target.value)} aria-label={t("receiving.form.invoice_number")} /></label>
      </div>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_total")}</span>
        <input className={field} type="number" min={0} step="any" inputMode="decimal" value={invoiceTotal} disabled={busy} onChange={(e) => setInvoiceTotal(e.target.value)} aria-label={t("receiving.form.invoice_total")} /></label>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.notes")}</span>
        <textarea className={`${field} min-h-[72px] py-2`} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} placeholder={t("receiving.form.notes_hint")} aria-label={t("receiving.form.notes")} /></label>

      {/* Receipt attachment — DISABLED Phase-6 stub (A1): column + plumbing land in
          this PR (vendor_deliveries.receipt_url); no bucket/uploader yet. */}
      <div className="mt-3">
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("receiving.form.receipt_label")}</span>
        <button type="button" disabled aria-label={t("receiving.form.receipt_stub")}
          className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-dashed border-co-border-2 bg-white px-4 text-sm font-semibold text-co-text-dim opacity-70">
          {t("receiving.form.receipt_stub")}
        </button>
      </div>

      <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">{t("receiving.form.lines")}</h3>
      <div className="mt-2 flex flex-col gap-3">
        {lines.map((l, i) => {
          const sku = l.skuId ? skuById.get(l.skuId) : undefined;
          const levels = sku?.chainLabels ?? [];
          return (
            <div key={i} className="rounded-lg border-2 border-co-border-2 p-3">
              <select className={field} value={l.skuId} disabled={busy || vendorId === ""} onChange={(e) => setLine(i, { skuId: e.target.value, level: "" })} aria-label={t("receiving.form.pick_sku")}>
                <option value="">{t("receiving.form.pick_sku")}</option>
                {vendorSkus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {/* Level picker: from the SKU's pack chain (root→leaf). Chain-less SKUs
                  show a single "packs" option (legacy semantics). */}
              {levels.length > 0 ? (
                <label className="mt-2 block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("receiving.form.level")}</span>
                  <select className={field} value={l.level} disabled={busy} onChange={(e) => setLine(i, { level: e.target.value })} aria-label={t("receiving.form.level")}>
                    <option value="">{t("receiving.form.pick_level")}</option>
                    {levels.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                  </select>
                </label>
              ) : (
                <p className="mt-2 text-[11px] italic text-co-text-muted">{t("receiving.form.level_legacy")}</p>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={levels.length > 0 ? t("receiving.form.qty_level") : t("receiving.form.qty")} value={l.qty} disabled={busy} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={t("receiving.form.qty")} />
                <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.price")} value={l.price} disabled={busy} onChange={(e) => setLine(i, { price: e.target.value })} aria-label={t("receiving.form.price")} />
                <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.observed")} value={l.observed} disabled={busy} onChange={(e) => setLine(i, { observed: e.target.value })} aria-label={t("receiving.form.observed")} />
              </div>
              <input className={field} value={l.note} disabled={busy} onChange={(e) => setLine(i, { note: e.target.value })} placeholder={t("receiving.form.line_note")} aria-label={t("receiving.form.line_note")} />
              {/* Per-line photo — DISABLED Phase-6 stub (A1). */}
              <button type="button" disabled aria-label={t("receiving.form.photo_stub")}
                className="mt-2 inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 border-dashed border-co-border-2 bg-white px-3 text-xs font-semibold text-co-text-dim opacity-70">
                {t("receiving.form.photo_stub")}
              </button>
              {lines.length > 1 ? (
                <button type="button" disabled={busy} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="mt-2 ml-3 text-xs font-bold text-co-cta">{t("receiving.form.remove_line")}</button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("receiving.form.add_line")}</button>

      {err ? <p className="mt-3 text-sm text-co-cta">{err}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("receiving.form.submit")}</button>
      </div>
    </div>
  );
}
