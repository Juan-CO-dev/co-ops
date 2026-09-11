"use client";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { JOURNEYS, worstSkuDataReadiness, type Journey, type SkuDataReadiness, type SkuDataShop } from "@/lib/sku-data-readiness";

const key = (suffix: string) => `admin.skus.data.${suffix}` as TranslationKey;

function JourneyChips({ row }: { row: Pick<SkuDataReadiness, Journey> }) {
  const { t } = useTranslation();
  return <>{JOURNEYS.map(journey => {
    const state = row[journey];
    const label = t(key("chip"), { journey: t(key(journey)), state: t(key(state)) });
    return <span key={journey} role="img" aria-label={label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${state === "usable" ? "text-co-confirm-text" : state === "degraded" ? "text-co-warning-text" : "text-co-cta-text"}`}>{label}</span>;
  })}</>;
}

export function SkuDataChips({ skuId, shops }: { skuId: string; shops: SkuDataShop[] }) {
  const row = worstSkuDataReadiness(shops.flatMap(shop => shop.bySku[skuId] ? [shop.bySku[skuId]!] : []));
  return row ? <JourneyChips row={row} /> : null;
}

export function SkuDataHeader({ shops, unavailable }: { shops: SkuDataShop[]; unavailable: boolean }) {
  const { t } = useTranslation();
  return <section className="text-sm text-co-text" aria-label={t(key("title"))}>
    <h2 className="text-xs font-bold tracking-wide text-co-text-muted">{t(key("title"))}</h2>
    {unavailable ? <p role="alert" className="text-co-cta-text">{t(key("unavailable"))}</p> : shops.map(shop => <p key={shop.id}>
      <span className="font-bold">{shop.name}</span>{" · "}
      {JOURNEYS.map(journey => t(key("counts"), { journey: t(key(journey)), blocked: String(shop.counts[journey].blocked), degraded: String(shop.counts[journey].degraded) })).join(" · ")}
    </p>)}
  </section>;
}

export function SkuDataDrawer({ skuId, shops }: { skuId: string; shops: SkuDataShop[] }) {
  const { t } = useTranslation();
  if (!shops.length) return null;
  const first = shops[0]!;
  const same = shops.every(shop => JSON.stringify(shop.bySku[skuId] ?? null) === JSON.stringify(first.bySku[skuId] ?? null));
  const rows = same ? [first] : shops;
  return <section className="mb-4 text-sm text-co-text" aria-label={t(key("title"))}>
    {rows.map(shop => {
      const row = shop.bySku[skuId];
      const context = same && shops.length > 1 ? t(key(shops.length === 2 ? "same_both" : "same_all")) : shop.name;
      return <div key={shop.id} className="mb-2">
        <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{context}</h3>
        {!row ? <p>{t(key("outside_launch"))}</p> : <>
          {!same && <div className="flex flex-wrap gap-1"><JourneyChips row={row} /></div>}
          {row.errands.length ? <ul className="list-disc space-y-1 pl-5">{row.errands.map(errand => <li key={errand.code}>{t(key(`errand.${errand.code}`), errand.code === "recipe_unresolved" ? { recipes: errand.recipes.join(", ") } : undefined)}</li>)}</ul> : <p>{t(key("no_errands"))}</p>}
        </>}
      </div>;
    })}
  </section>;
}
