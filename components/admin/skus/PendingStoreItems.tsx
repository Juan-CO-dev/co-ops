"use client";

import { storeErrorKey } from "@/lib/receiving-stores-shared";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ReceivingSkuOption } from "@/lib/receiving";

interface PendingItem { id: string; name: string; unit: string | null; vendorName: string }
const control = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text";

/** A deliberate review lane; opening it never resolves or mutates an item. */
export function PendingStoreItems({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [skus, setSkus] = useState<ReceivingSkuOption[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [ounces, setOunces] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  async function load() {
    if (busy || !locationId) return;
    setBusy(true); setError(null); setResolved(false);
    try {
      const response = await fetch(`/api/admin/skus/pending?locationId=${encodeURIComponent(locationId)}`);
      if (!response.ok) {
        const body = await response.json() as { code?: string };
        setError(t(storeErrorKey(body.code))); return;
      }
      const data = await response.json() as { items: PendingItem[]; skus: ReceivingSkuOption[] };
      setItems(data.items); setSkus(data.skus); setTargets({});
    } catch { setError(t("receivingStore.load_error")); }
    finally { setBusy(false); }
  }

  async function resolve(skuId: string) {
    const referenceSkuId = targets[skuId];
    if (busy || !referenceSkuId) return;
    setBusy(true); setError(null); setResolved(false);
    try {
      if ((await requestStepUp("B")) !== "ok") return;
      const response = await fetch("/api/admin/skus/pending", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId, skuId, referenceSkuId, contentOz: Number(ounces[skuId]) }),
      });
      if (!response.ok) {
        const body = await response.json() as { code?: string; error?: string };
        setError(t(storeErrorKey(body.code))); return;
      }
      setItems((previous) => previous?.filter((item) => item.id !== skuId) ?? null);
      setResolved(true); router.refresh();
    } catch { setError(t("receivingStore.save_error")); }
    finally { setBusy(false); }
  }

  return <details className="my-4 rounded-xl border-2 border-co-border bg-co-surface p-4">
    <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-bold text-co-text">{t("receivingStore.pending_title")}</summary>
    <p className="my-2 text-sm text-co-text-dim">{t("receivingStore.review_help")}</p>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex flex-wrap items-center gap-2 text-sm font-bold">
        {t("receivingStore.location")}
        <select className={control} value={locationId} disabled={busy} onChange={(e) => {
          setLocationId(e.target.value); setItems(null); setTargets({}); setError(null); setResolved(false);
        }}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </label>
      <button type="button" className={control} disabled={busy || !locationId} onClick={() => void load()}>
        {t(items === null ? "receivingStore.load_pending" : "receivingStore.refresh")}
      </button>
    </div>
    {error ? <p role="alert" className="mt-2 text-sm text-co-cta-text">{error}</p> : null}
    {resolved ? <p role="status" className="mt-2 text-sm text-co-confirm-text">{t("receivingStore.resolved")}</p> : null}
    {items?.length === 0 ? <p className="mt-2 text-sm">{t("receivingStore.empty")}</p> : null}
    {items?.map((item) => <div key={item.id} className="mt-3 rounded-lg border-2 border-co-border p-3">
      <p className="font-bold">{item.name}</p>
      <p className="text-sm text-co-text-dim">{item.vendorName}{item.unit ? ` · ${item.unit}` : ""}</p>
      <label className="mt-2 flex flex-col gap-1 text-sm">
        {t("receivingStore.link_target")}
        <select className={control} disabled={busy} value={targets[item.id] ?? ""} onChange={(e) => setTargets((previous) => ({ ...previous, [item.id]: e.target.value }))}>
          <option value="">{t("receivingStore.link_target")}</option>
          {skus.filter((sku) => sku.id !== item.id && !sku.pendingReview && (!sku.locationId || sku.locationId === locationId) && !items.some((pending) => pending.id === sku.id)).map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
        </select>
      </label>
      <label className="mt-2 flex flex-col gap-1 text-sm">{t("receivingStore.required_oz")}
        <input type="number" min="0.000001" step="any" className={control} value={ounces[item.id] ?? ""} onChange={(e) => setOunces((previous) => ({ ...previous, [item.id]: e.target.value }))} />
      </label>
      <button type="button" className={`${control} mt-2 font-bold`} disabled={busy || !targets[item.id] || !(Number(ounces[item.id]) > 0)} onClick={() => void resolve(item.id)}>{t("receivingStore.resolve")}</button>
    </div>)}
  </details>;
}
