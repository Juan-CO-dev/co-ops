"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { ProductionFormData } from "@/lib/production";

const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function ProductionForm({ formData, locationId }: { formData: ProductionFormData; locationId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [skuId, setSkuId] = useState("");
  const [itemId, setItemId] = useState("");
  const [inputQty, setInputQty] = useState("");
  const [outputQty, setOutputQty] = useState("");
  const [predicted, setPredicted] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = skuId ? (formData.skuToItems[skuId] ?? []) : [];
  const num = (s: string): number | null => { const v = s.trim(); return v === "" ? null : Number(v); };

  const refreshPredict = async (sId: string, iId: string, qStr: string) => {
    const q = num(qStr);
    if (!sId || !iId || q == null || !(q > 0)) { setPredicted(null); return; }
    const res = await fetch("/api/operations/production/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputSkuId: sId, outputItemId: iId, inputQty: q }) });
    if (!res.ok) { setPredicted(null); return; }
    const j = await res.json().catch(() => ({ predicted: null }));
    const p = typeof j?.predicted === "number" ? j.predicted : null;
    setPredicted(p);
    if (p != null && outputQty.trim() === "") setOutputQty(String(Number(p.toFixed(2)))); // prefill only when empty
  };

  const canSubmit = skuId !== "" && itemId !== "" && num(inputQty) != null && num(outputQty) != null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    const res = await fetch("/api/operations/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId, inputSkuId: skuId, inputQty: Number(inputQty), outputItemId: itemId, outputQty: Number(outputQty), notes: notes.trim() || null }) });
    setBusy(false);
    if (res.ok) { router.refresh(); setSkuId(""); setItemId(""); setInputQty(""); setOutputQty(""); setPredicted(null); setNotes(""); }
    else { const j = await res.json().catch(() => ({} as { code?: string })); setErr(t(("production.error." + (j?.code ?? "generic")) as never)); }
  };

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("production.form.title")}</h2>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.sku")}</span>
        <select className={field} value={skuId} disabled={busy} onChange={(e) => { setSkuId(e.target.value); setItemId(""); setPredicted(null); }}>
          <option value="">{t("production.form.pick_sku")}</option>
          {formData.skus.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.inStockPacks} {t("production.form.in_stock")})</option>)}
        </select>
      </label>
      {skuId ? (
        <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.makes")}</span>
          <select className={field} value={itemId} disabled={busy} onChange={(e) => { setItemId(e.target.value); void refreshPredict(skuId, e.target.value, inputQty); }}>
            <option value="">{t("production.form.pick_item")}</option>
            {items.map((it) => <option key={it.itemId} value={it.itemId}>{it.name}</option>)}
          </select>
        </label>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block"><span className="text-sm font-bold text-co-text">{t("production.form.input_qty")}</span>
          <input className={field} type="number" min={0} step="any" inputMode="decimal" value={inputQty} disabled={busy} onChange={(e) => { setInputQty(e.target.value); void refreshPredict(skuId, itemId, e.target.value); }} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("production.form.output_qty")}{predicted != null ? ` · ${t("production.form.predicted")}: ${Number(predicted.toFixed(2))}` : ""}</span>
          <input className={field} type="number" min={0} step="any" inputMode="decimal" value={outputQty} disabled={busy} onChange={(e) => setOutputQty(e.target.value)} /></label>
      </div>
      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("production.form.notes")}</span>
        <textarea className={`${field} min-h-[60px] py-2`} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /></label>
      {err ? <p className="mt-3 text-sm text-co-cta">{err}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("production.form.submit")}</button>
      </div>
    </div>
  );
}
