"use client";

/**
 * Catalog Phase 2b: "It arrives differently now" on the item page — THIS SHOP's version — from the
 * read-only pack line 2a shows a GM/AGM. The link carries the shop it is for (`?location=<shop>`, sim
 * QA: every way in lands on the right shop); with no shop known, the item page's one resolver picks.
 */
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";

export function ShopPackJobLink({ skuId, shopId }: { skuId: string; shopId: string | null }) {
  const { t } = useTranslation();
  return (
    <Link href={skuItemHref(skuId, { shopId: shopId ?? undefined, job: "pack" })} className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text">
      {t("admin.skus.chain.use_item_page")}
    </Link>
  );
}
