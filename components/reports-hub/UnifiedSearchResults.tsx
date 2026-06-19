import Link from "next/link";

import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { chipHref } from "@/lib/nav-links";
import { ROLES } from "@/lib/roles";
import type { PageResult, PersonResult } from "@/lib/unified-search";

export function UnifiedSearchResults({
  people,
  peopleHasMore,
  pages,
  locationId,
  language,
}: {
  people: PersonResult[];
  peopleHasMore: boolean;
  pages: PageResult[];
  locationId: string;
  language: Language;
}) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  if (people.length === 0 && pages.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-4">
      {people.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {t("reports.search.people_heading", { n: people.length })}
          </h2>
          <ul className="flex flex-col gap-1">
            {people.map((p) => (
              <li key={p.userId}>
                <Link
                  href={`/profile/${p.userId}`}
                  className="flex items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text transition hover:border-co-text"
                >
                  <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-co-gold text-xs font-bold text-co-text">
                    {(p.name.charAt(0) || "?").toUpperCase()}
                  </span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-[11px] uppercase text-co-text-muted">{ROLES[p.role].shortLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
          {peopleHasMore ? (
            <Link href="/profile" className="mt-1 inline-block text-xs text-co-text-muted hover:underline">
              {t("reports.search.see_all_people")}
            </Link>
          ) : null}
        </section>
      ) : null}

      {pages.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {t("reports.search.pages_heading", { n: pages.length })}
          </h2>
          <div className="flex flex-wrap gap-2">
            {pages.map((pg) => (
              <a
                key={pg.href}
                href={chipHref(pg.href, pg.scoped, locationId)}
                className="rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text transition hover:border-co-text"
              >
                {pg.label}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
