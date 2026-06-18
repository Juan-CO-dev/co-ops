import Link from "next/link";

import type { TeamOperatingHealth } from "@/lib/team-metrics";
import { ROLES } from "@/lib/roles";
import { ALL_CATEGORIES, expectedCategoriesFor } from "@/lib/team-scoring";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/**
 * Dashboard team widget (layout C, dense). Pure presentational Server
 * Component — no client JS, so each member's category breakdown renders
 * inline beneath its row rather than behind a JS toggle. Members are
 * already ranked by the loader. Renders nothing when the roster is empty.
 */
export function TeamRosterTable({
  health,
  locationId,
  language,
}: {
  health: TeamOperatingHealth;
  locationId: string;
  language: Language;
}) {
  if (health.members.length === 0) return null;

  return (
    <section aria-label={serverT(language, "reports.trends.team.title")} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="inline-block self-start border-b-2 border-co-gold-deep pb-0.5 text-lg font-bold uppercase tracking-[0.14em] text-co-text">
          {serverT(language, "reports.trends.team.title")}
        </h3>
        <Link
          href={`/reports/trends/team?location=${locationId}`}
          className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted hover:text-co-text"
        >
          {serverT(language, "reports.trends.team.nav_label")}
        </Link>
      </div>

      <p className="text-xs text-co-text-muted">
        {serverT(language, health.banner.key as TranslationKey, health.banner.params)}
      </p>

      <div className="divide-y divide-co-border rounded-xl border-2 border-co-border bg-co-surface">
        {health.members.map((m, i) => {
          const expectedSet = new Set(expectedCategoriesFor(m.role));
          const breakdown = ALL_CATEGORIES.filter(
            (c) => m.counts[c] > 0 || expectedSet.has(c),
          )
            .map((c) => `${serverT(language, `people.cat.${c}` as TranslationKey)} ${m.counts[c]}`)
            .join(" · ");
          const cardLine = serverT(language, m.cardLine.key as TranslationKey, m.cardLine.params);

          return (
            <div key={m.userId} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-co-text-dim">{i + 1}</span>
                <span className="text-sm font-semibold text-co-text">{m.name}</span>
                <span className="rounded-full bg-[#f1ede0] px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-dim">
                  {ROLES[m.role].shortLabel}
                </span>
                <span className="ml-auto text-base font-extrabold leading-none text-co-text">
                  {m.score}
                </span>
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background:
                      m.health === "on_track" ? "var(--co-success)" : "var(--co-warning)",
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-co-text-dim">
                {breakdown} — {cardLine}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
