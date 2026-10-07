"use client";
import { storeErrorKey } from "@/lib/receiving-stores-shared";
import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
type Store = { id: string; name: string; active: boolean };
const control = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text";
export function StoreManagement({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [stores, setStores] = useState<Store[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch(`/api/admin/stores?locationId=${encodeURIComponent(locationId)}`);
    const body = await response.json() as { stores?: Store[]; code?: string };
    if (!response.ok) { setMessage(t(storeErrorKey(body.code))); return; }
    setStores(body.stores ?? []);
  }
  async function run(store?: Store, action?: "rename" | "retire" | "merge") {
    if (busy || !locationId) return;
    setBusy(true); setMessage("");
    try {
      if (store && action) {
        if (await requestStepUp("B") !== "ok") return;
        const response = await fetch("/api/admin/stores", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ locationId, storeId: store.id, action, name: names[store.id] ?? store.name, targetId: targets[store.id] }) });
        const body = await response.json() as { code?: string; store?: { regular_vendor_name_match?: boolean } };
        if (!response.ok) { setMessage(t(storeErrorKey(body.code))); return; }
        setMessage(t(body.store?.regular_vendor_name_match ? "receivingStore.vendor_name_warning" : "receivingStore.store_saved"));
      }
      await load();
    } catch { setMessage(t("receivingStore.save_error")); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-xl border-2 border-co-border bg-co-surface p-4">
    <summary className="flex min-h-[44px] cursor-pointer items-center font-bold">{t("receivingStore.manage_title")}</summary>
    <p className="my-2 text-sm text-co-text-dim">{t("receivingStore.manage_help")}</p>
    <label className="flex items-center gap-2">{t("receivingStore.location")}
      <select className={control} value={locationId} disabled={busy} onChange={(e) => { setLocationId(e.target.value); setStores([]); setMessage(""); }}>
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
    <button type="button" className={`${control} mt-2`} disabled={busy} onClick={() => void run()}>{t("receivingStore.load_stores")}</button>
    {message ? <p role="status" className="my-2 text-sm">{message}</p> : null}
    {stores.map((store) => <div key={store.id} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border-2 border-co-border p-3">
      <label className="flex items-center gap-2">{t("receivingStore.store_name")}<input className={control} disabled={busy || !store.active} value={names[store.id] ?? store.name} onChange={(e) => setNames((old) => ({ ...old, [store.id]: e.target.value }))} /></label>
      {!store.active ? <span>{t("receivingStore.retired")}</span> : <>
        <button type="button" className={control} disabled={busy} onClick={() => void run(store, "rename")}>{t("receivingStore.rename")}</button>
        <button type="button" className={control} disabled={busy} onClick={() => void run(store, "retire")}>{t("receivingStore.retire")}</button>
        <label className="flex items-center gap-2">{t("receivingStore.merge_into")}<select className={control} disabled={busy} value={targets[store.id] ?? ""} onChange={(e) => setTargets((old) => ({ ...old, [store.id]: e.target.value }))}>
          <option value="">{t("receivingStore.choose_store")}</option>
          {stores.filter((s) => s.active && s.id !== store.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <button type="button" className={control} disabled={busy || !targets[store.id]} onClick={() => void run(store, "merge")}>{t("receivingStore.merge")}</button>
      </>}
    </div>)}
  </details>;
}
