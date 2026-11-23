"use client";

/**
 * Catering delivery D2 — the delivery settings card (/admin/catering/delivery; Owner / CGS / MoO only). One card per shop.
 *
 *  - Identity and state are always visible: the shop, On / Off, how many couriers, the driver's share. The form is a
 *    drawer; while it holds unsaved changes it cannot be closed by the header (D10), only by Save or Cancel.
 *  - The couriers are the SHOP'S OWN list, typed by a person (tenant data: no courier name lives in code).
 *  - The driver's share of the gratuity is RECORDED ONLY. The sentence beside it says so, and that its payroll and legal
 *    treatment is not verified. Nothing here pays, pools or exports anything.
 *  - Save asks for the password every time (Tier B), then posts the shop's WHOLE row with the `updatedAt` the person
 *    saw. Someone else's change in between is refused ("settings_moved") and the page reloads the row.
 * en + es (tú); 44 px controls with items-center; flex-wrap rows for a 375 px phone; useState only.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { bpsToPercent, deliveryErrorKey, percentToBps } from "@/lib/delivery/panel-shared";
import { manualProvidersValid } from "@/lib/delivery/parse-shared";
import type { DeliveryShopCard } from "@/lib/delivery/settings";
import { MAX_MANUAL_PROVIDERS, MAX_PROVIDER_LABEL } from "@/lib/delivery/types-shared";

const BUTTON = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-60";
const PRIMARY = `${BUTTON} border-co-gold-deep bg-co-gold text-co-text`;
const QUIET = `${BUTTON} border-co-border bg-co-surface text-co-text`;
const FIELD = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const k = (key: string) => `admin.catering.delivery.${key}` as TranslationKey;

export function DeliverySettings({ shops, initialOpen = null }: {
  shops: readonly DeliveryShopCard[];
  /** SSR tests only: a shop whose form starts open. */
  initialOpen?: string | null;
}) {
  return <ul className="grid gap-4">
    {shops.map((shop) => <ShopCard key={shop.locationId} shop={shop} startOpen={initialOpen === shop.locationId} />)}
  </ul>;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function ShopCard({ shop, startOpen }: { shop: DeliveryShopCard; startOpen: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const formId = useId();
  const [open, setOpen] = useState(startOpen);
  const [enabled, setEnabled] = useState(shop.enabled);
  const [couriers, setCouriers] = useState<string[]>(shop.manualProviders);
  const [adding, setAdding] = useState("");
  const [percent, setPercent] = useState(bpsToPercent(shop.gratuityDriverBps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  // The server's row moved (a save, or someone else's): start again from it. During-render prev-compare, not an effect.
  const [seen, setSeen] = useState(shop.updatedAt);
  if (seen !== shop.updatedAt) {
    setSeen(shop.updatedAt); setEnabled(shop.enabled); setCouriers(shop.manualProviders); setPercent(bpsToPercent(shop.gratuityDriverBps)); setAdding("");
  }

  const bps = percentToBps(percent);
  const name = adding.trim();
  const canAdd = name !== "" && manualProvidersValid([...couriers, name]);
  const dirty = bps === null || bps !== shop.gratuityDriverBps || enabled !== shop.enabled || !sameList(couriers, shop.manualProviders) || name !== "";

  function reset() {
    setEnabled(shop.enabled); setCouriers(shop.manualProviders); setPercent(bpsToPercent(shop.gratuityDriverBps)); setAdding(""); setError(null); setOpen(false);
  }
  async function save() {
    if (bps === null || name !== "") return;
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const r = await post("/api/admin/catering/delivery", {
        locationId: shop.locationId, values: { enabled, manualProviders: couriers, gratuityDriverBps: bps }, expectedUpdatedAt: shop.updatedAt,
      });
      if (!r.ok) {
        setError(deliveryErrorKey(r.code) as TranslationKey);
        // Someone else changed the row: show theirs (the draft is kept until the person cancels or the row arrives).
        if (r.code === "settings_moved") router.refresh();
        return;
      }
      setSaved(true); setOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  return <li className="co-card grid gap-3 p-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="min-w-0 flex-1 basis-[8rem] text-base font-bold text-co-text">{shop.name}</h2>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${shop.enabled ? "bg-co-gold/20 text-co-text" : "bg-co-surface-inset text-co-text-muted"}`}>
        {t(k(shop.enabled ? "state.on" : "state.off"))}
      </span>
      {dirty && open && <span className="rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text">{t(k("unsaved"))}</span>}
      <button type="button" className={QUIET} aria-expanded={open} aria-controls={formId} disabled={busy || (open && dirty)}
        onClick={() => { setOpen(!open); setSaved(false); }}>{t(k(open ? "close" : "edit"))}</button>
    </div>
    <p className="text-sm text-co-text-muted">{t(k("summary"), { n: shop.manualProviders.length, pct: bpsToPercent(shop.gratuityDriverBps) })}</p>
    {saved && !open && <p role="status" className="text-sm font-bold text-co-confirm-text">{t(k("saved"))}</p>}
    {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}

    <form id={formId} hidden={!open} className="grid gap-4 border-t border-co-border pt-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <p className="text-sm font-bold text-co-text">{t(k("enabled.label"))}</p>
          <p className="text-sm text-co-text-muted">{t(k("enabled.help"))}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} disabled={busy}
          aria-label={t(k("enabled.aria"), { setting: t(k("enabled.label")), shop: shop.name })}
          className={`${BUTTON} min-w-[72px] ${enabled ? "border-co-gold-deep bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text-muted"}`}
          onClick={() => setEnabled(!enabled)}>{t(k(enabled ? "state.on" : "state.off"))}</button>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-co-text">{t(k("couriers.legend"))}</legend>
        <p className="text-sm text-co-text-muted">{t(k("couriers.help"))}</p>
        {couriers.length === 0 ? <p className="text-sm text-co-text-muted">{t(k("couriers.none"))}</p>
          : <ul className="grid gap-2">
            {couriers.map((c) => <li key={c} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="min-w-0 flex-1 basis-[8rem] break-words text-sm text-co-text">{c}</span>
              <button type="button" className={QUIET} disabled={busy} aria-label={t(k("couriers.remove_aria"), { name: c })}
                onClick={() => setCouriers(couriers.filter((x) => x !== c))}>{t(k("couriers.remove"))}</button>
            </li>)}
          </ul>}
        {couriers.length < MAX_MANUAL_PROVIDERS && <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 basis-[10rem] gap-1 text-sm text-co-text">{t(k("couriers.add_label"))}
            <input className={FIELD} value={adding} maxLength={MAX_PROVIDER_LABEL} disabled={busy} onChange={(event) => setAdding(event.target.value)} />
          </label>
          <button type="button" className={QUIET} disabled={busy || !canAdd} onClick={() => { setCouriers([...couriers, name]); setAdding(""); }}>{t(k("couriers.add"))}</button>
        </div>}
        {name !== "" && !canAdd && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(k("couriers.invalid"))}</p>}
        {name !== "" && canAdd && <p role="status" className="text-sm text-co-warning-text">{t(k("couriers.pending"))}</p>}
      </fieldset>

      <div className="grid gap-2">
        <label className="grid gap-1 text-sm font-bold text-co-text">{t(k("share.label"))}
          <input inputMode="decimal" className={FIELD} disabled={busy} value={percent} onChange={(event) => setPercent(event.target.value)} />
        </label>
        {bps === null && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(k("share.invalid"))}</p>}
        <p className="rounded-lg border border-co-warning bg-co-warning-surface p-3 text-sm text-co-text">{t(k("share.unverified"))}</p>
      </div>

      <p className="text-sm text-co-text-muted">{t(k("password_note"))}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !dirty || bps === null || name !== ""}>{t(k(busy ? "saving" : "save"))}</button>
        <button type="button" className={QUIET} disabled={busy} onClick={reset}>{t(k("cancel"))}</button>
      </div>
    </form>
  </li>;
}
