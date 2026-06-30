"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "./shared";

export interface SkuCostInfo { currentPrice: number | null; costPerOz: number | null; usedBy: string[]; }

export function SkuCostPanel({ skuId, cost, canRecord }: { skuId: string; cost: SkuCostInfo; canRecord: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const record = async () => {
    if (busy) return;
    setErr(null);
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { setErr(t(resolveErrorKey("invalid_price"))); return; }
    if (!date) { setErr(t(resolveErrorKey("invalid_date"))); return; }
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const res = await postJson(`/api/admin/skus/${skuId}/price`, { unitPrice: p, effectiveDate: date }, "POST");
    setBusy(false);
    if (res.ok) { setPrice(""); setDate(""); setOpen(false); router.refresh(); }
    else setErr(t(resolveErrorKey(res.code)));
  };

  const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="mt-2 rounded-lg border-2 border-co-border bg-co-surface p-3 text-sm">
      <p className="text-co-text">
        {t("admin.skus.cost.per_oz")}: <span className="font-bold">{cost.costPerOz == null ? "—" : `$${cost.costPerOz.toFixed(4)}/oz`}</span>
        {cost.currentPrice != null ? <span className="text-co-text-muted"> · {t("admin.skus.cost.current")}: ${cost.currentPrice.toFixed(2)}</span> : null}
      </p>
      {cost.usedBy.length > 0 ? (
        <p className="mt-1 text-xs text-co-text-muted">{t("admin.skus.cost.used_by")}: {cost.usedBy.join(", ")}</p>
      ) : null}
      {canRecord ? (
        open ? (
          <div className="mt-2 flex flex-col gap-2">
            <input className={field} type="number" min={0} step="any" inputMode="decimal" placeholder={t("admin.skus.cost.price_placeholder")} value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} />
            <input className={field} type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
            {err ? <p className="text-sm text-co-cta">{err}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => { setOpen(false); setErr(null); }} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50">{t("admin.skus.cancel")}</button>
              <button type="button" disabled={busy} onClick={() => void record()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.skus.cost.record")}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("admin.skus.cost.record")}</button>
        )
      ) : null}
    </div>
  );
}
