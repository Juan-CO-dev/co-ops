/**
 * The open "This case looks different" reports for the actor's shops, on /admin/skus (catalog
 * Phase 2b). Server component; each link opens "It arrives differently now" on the item, at that
 * shop, prefilled from the report. Renders nothing when there are none (no empty chrome).
 */
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { skuItemHref } from "@/lib/catalog/sku-item-shared";
import type { OpenPackRequest } from "@/lib/pack-change-requests";

export function PackChangeRequestsList({ requests, shops, language }: {
  requests: OpenPackRequest[];
  shops: Array<{ id: string; name: string }>;
  language: Language;
}) {
  if (requests.length === 0) return null;
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const title = serverT(language, "admin.skus.pack_requests.title");
  return (
    <section aria-label={title} className="mb-4 rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
      <h2 className="text-[12px] font-bold tracking-wide text-co-warning-text">{title}</h2>
      <ul className="mt-1 flex flex-col">
        {requests.map((r) => (
          <li key={r.id}>
            <Link href={skuItemHref(r.skuId, { shopId: r.locationId, job: "pack", requestId: r.id })}
              className="flex min-h-[44px] items-center text-sm font-bold text-co-text underline">
              {serverT(language, "admin.skus.pack_requests.review", { item: r.skuName, shop: shopName.get(r.locationId) ?? "" })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
