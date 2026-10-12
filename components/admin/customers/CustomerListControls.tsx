"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { CUSTOMER_LIST_CHANNELS, CUSTOMER_LIST_SEGMENTS, CUSTOMER_LIST_SORTS, listParamsQuery, type CustomerListParams } from "@/lib/customers/list-params-shared";

const field = "min-h-[44px] min-w-0 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const label = "grid min-w-0 gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const pill = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text";

/** GET navigation keeps every applied control shareable and restores it with browser history. */
export function CustomerListControls({ params, level, shops }: { params: CustomerListParams; level: number; shops: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const [key, value] of data) if (typeof value === "string" && value !== "" && key !== "min_spend") query.set(key, value);
    const spend = data.get("min_spend");
    if (typeof spend === "string" && spend !== "") query.set("min_spend_cents", String(Math.round(Number(spend) * 100)));
    router.push(`/admin/customers?${query}`);
  };
  const segmentHref = (segment: string) => {
    const query = listParamsQuery(params);
    query.set("segment", segment); query.delete("page");
    return `/admin/customers?${query}`;
  };
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2" aria-label={t("customers.filter.segment")}>
      {CUSTOMER_LIST_SEGMENTS.map((s) => <Link key={s} href={segmentHref(s)} aria-current={params.filters.segment === s ? "true" : undefined} className={`${pill} ${params.filters.segment === s ? "bg-co-gold" : "bg-co-surface"}`}>{t(`customers.filter.${s}`)}</Link>)}
    </div>
    <form key={listParamsQuery(params).toString()} action="/admin/customers" onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className={label}>{t("customers.search")}<input name="q" aria-label={t("customers.search")} defaultValue={params.search} className={field} /></label>
      <label className={label}>{t("customers.filter.sort")}<select name="sort" defaultValue={params.sort} className={field}>
        {CUSTOMER_LIST_SORTS.map((s) => <option key={s} value={s}>{t(`customers.sort.${s}` as TranslationKey)}</option>)}
      </select></label>
      {level >= 8 ? <label className={label}>{t("customers.filter.shop")}<select name="location" defaultValue={params.locationId ?? ""} className={field}>
        <option value="">{t("customers.filter.allShops")}</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label> : <div className={label}>{t("customers.filter.shop")}<p className="break-words text-base text-co-text">{shops.map((s) => s.name).join(", ")}</p></div>}
      <label className={label}>{t("customers.filter.channel")}<select name="channel" defaultValue={params.filters.channel ?? ""} className={field}>
        <option value="">{t("customers.filter.all")}</option>{CUSTOMER_LIST_CHANNELS.map((c) => <option key={c} value={c}>{t(`customers.filter.channel.${c}` as TranslationKey)}</option>)}
      </select></label>
      <label className={label}>{t("customers.filter.segment")}<select name="segment" defaultValue={params.filters.segment ?? ""} className={field}>
        <option value="">{t("customers.filter.all")}</option>{CUSTOMER_LIST_SEGMENTS.map((s) => <option key={s} value={s}>{t(`customers.filter.${s}`)}</option>)}
      </select></label>
      <label className={label}>{t("customers.filter.minVisits")}<input type="number" name="min_visits" aria-label={t("customers.filter.minVisits")} min={1} max={1000} step={1} defaultValue={params.filters.min_visits ?? ""} className={field} /></label>
      <label className={label}>{t("customers.filter.minSpend")}<input type="number" name="min_spend" aria-label={t("customers.filter.minSpend")} min={0} step="0.01" defaultValue={params.filters.min_spend_cents === undefined ? "" : params.filters.min_spend_cents / 100} className={field} /></label>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text"><input type="checkbox" name="guests" aria-label={t("customers.filter.guests")} value="1" defaultChecked={params.filters.guests} />{t("customers.filter.guests")}</label>
      {level >= 9 && (["reachable", "opted_in"] as const).map((key) => <label key={key} className={label}>{t(`customers.filter.${key}`)}<select name={key} defaultValue={params.filters[key] === undefined ? "" : params.filters[key] ? "1" : "0"} className={field}>
        <option value="">{t("customers.filter.all")}</option><option value="1">{t("customers.filter.yes")}</option><option value="0">{t("customers.filter.no")}</option>
      </select></label>)}
      <div className="flex flex-wrap items-end gap-2"><button type="submit" className={`${pill} border-co-gold-deep bg-co-gold`}>{t("customers.filter.apply")}</button><Link href="/admin/customers" className={`${pill} bg-co-surface`}>{t("customers.filter.clear")}</Link></div>
    </form>
  </div>;
}
