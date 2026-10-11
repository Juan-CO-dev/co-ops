"use client";

import { useTranslation } from "@/lib/i18n/provider";
import { registryLinkHref, type RegistryLink } from "@/lib/admin/product-item-links-shared";

export function RegistryRelationships({ kind, links }: { kind: "item" | "product"; links: RegistryLink[] }) {
  const { t, language } = useTranslation();
  return (
    <span className="block text-xs text-co-text-muted">
      <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]">
        {kind === "item" ? t("admin.relationships.prep_item") : t("admin.relationships.purchased_product")}
      </span>
      {links.length > 0 ? (
        <span className="mt-1 flex flex-wrap items-center gap-x-2">
          <span className="font-bold">{kind === "item" ? t("admin.relationships.made_from") : t("admin.relationships.used_in")}</span>
          {links.map(link => (
            // A document navigation resets the destination's local filters/tabs,
            // so its server-rendered fragment target is present before scrolling.
            <a key={`${link.kind}:${link.id}`} href={registryLinkHref(link)}
              className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-co-text underline underline-offset-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60">
              {language === "es" && link.nameEs ? link.nameEs : link.name}
              {link.vendorName ? ` · ${link.vendorName}` : ""}
              {link.kind === "item" && kind === "item" ? ` (${t("admin.relationships.sub_prep")})` : ""}
            </a>
          ))}
        </span>
      ) : null}
    </span>
  );
}
