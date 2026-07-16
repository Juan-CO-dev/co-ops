/**
 * /catering — the catering hub. The nav entry (nav.catering) points here; this page links
 * the catering surfaces built across Wave 1 (pipeline, customers, quotes). Gated at the
 * catering read floor (>= 5); each sub-surface re-gates its own floor.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";

const CATERING_HUB_MIN = 5;

const CARDS: Array<{ href: string; titleKey: TranslationKey; descKey: TranslationKey }> = [
  { href: "/catering/pipeline", titleKey: "catering.pipeline.title", descKey: "catering.hub.pipeline_desc" },
  { href: "/catering/quotes", titleKey: "catering.quotes.title", descKey: "catering.hub.quotes_desc" },
  { href: "/catering/customers", titleKey: "catering.customers.title", descKey: "catering.hub.customers_desc" },
];

export default async function CateringHubPage() {
  const auth = await requireSessionFromHeaders("/catering");
  if (getRoleLevel(auth.user.role) < CATERING_HUB_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "catering.hub.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.hub.subtitle")}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="co-card-interactive flex flex-col gap-1 p-5">
            <span className="text-base font-extrabold text-co-text">{serverT(lang, c.titleKey)}</span>
            <span className="text-sm text-co-text-muted">{serverT(lang, c.descKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
