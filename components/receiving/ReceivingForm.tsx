"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { ReceivingFormData } from "@/lib/receiving";

interface LineDraft { skuId: string; qty: string; price: string; observed: string; }
const emptyLine = (): LineDraft => ({ skuId: "", qty: "", price: "", observed: "" });
const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function ReceivingForm({ formData, locationId, today }: { formData: ReceivingFormData; locationId: string; today: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState(today);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const vendorSkus = formData.skus.filter((s) => s.vendorId === vendorId || s.vendorId === null);
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
      lines: lines.filter((l) => l.skuId !== "" && l.qty.trim() !== "").map((l) => ({
        skuId: l.skuId, qtyReceived: Number(l.qty), unitPrice: num(l.price), observedOzPerEach: num(l.observed),
      })),
    };
    const res = await fetch("/api/operations/receiving", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) { router.refresh(); setVendorId(""); setInvoiceNumber(""); setInvoiceTotal(""); setLines([emptyLine()]); }
    else { const j = await res.json().catch(() => ({} as { code?: string })); setErr(t(("receiving.error." + (j?.code ?? "generic")) as never)); }
  };

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("receiving.form.title")}</h2>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.vendor")}</span>
        <select className={field} value={vendorId} disabled={busy} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{t("receiving.form.pick_vendor")}</option>
          {formData.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.date")}</span>
          <input className={field} type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_number")}</span>
          <input className={field} value={invoiceNumber} disabled={busy} onChange={(e) => setInvoiceNumber(e.target.value)} /></label>
      </div>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_total")}</span>
        <input className={field} type="number" min={0} step="any" inputMode="decimal" value={invoiceTotal} disabled={busy} onChange={(e) => setInvoiceTotal(e.target.value)} /></label>

      <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">{t("receiving.form.lines")}</h3>
      <div className="mt-2 flex flex-col gap-3">
        {lines.map((l, i) => (
          <div key={i} className="rounded-lg border-2 border-co-border-2 p-3">
            <select className={field} value={l.skuId} disabled={busy || vendorId === ""} onChange={(e) => setLine(i, { skuId: e.target.value })}>
              <option value="">{t("receiving.form.pick_sku")}</option>
              {vendorSkus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.qty")} value={l.qty} disabled={busy} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.price")} value={l.price} disabled={busy} onChange={(e) => setLine(i, { price: e.target.value })} />
              <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("receiving.form.observed")} value={l.observed} disabled={busy} onChange={(e) => setLine(i, { observed: e.target.value })} />
            </div>
            {lines.length > 1 ? (
              <button type="button" disabled={busy} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="mt-2 text-xs font-bold text-co-cta">{t("receiving.form.remove_line")}</button>
            ) : null}
          </div>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("receiving.form.add_line")}</button>

      {err ? <p className="mt-3 text-sm text-co-cta">{err}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("receiving.form.submit")}</button>
      </div>
    </div>
  );
}
