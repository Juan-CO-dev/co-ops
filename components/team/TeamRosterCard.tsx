import Link from "next/link";

import { BarChart } from "@/components/trends/BarChart";
import type { TeamMember } from "@/lib/team-metrics";
import { ROLES } from "@/lib/roles";
import { ALL_CATEGORIES, expectedCategoriesFor, type ActionCategory } from "@/lib/team-scoring";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/**
 * One member's roster card (layout B). Pure presentational Server Component,
 * styled like the trends TrendCard chrome. The whole card is a tap target
 * linking to the member's detail page. Shows name + role chip + health dot +
 * score, a sparkline of per-bucket scored activity, the role-aware category
 * breakdown, and the narrative card line.
 */
export function TeamRosterCard({
  member,
  locationId,
  language,
}: {
  member: TeamMember;
  locationId: string;
  language: Language;
}) {
  const expected = expectedCategoriesFor(member.role);
  const expectedSet = new Set<ActionCategory>(expected);
  const visible = ALL_CATEGORIES.filter(
    (cat) => member.counts[cat] > 0 || expectedSet.has(cat),
  );

  return (
    <Link
      href={`/reports/trends/team/${member.userId}?location=${locationId}`}
      className="block rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm transition-colors hover:border-co-border-2 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-co-text">{member.name}</span>
          <span className="rounded-full bg-[#f1ede0] px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-dim">
            {ROLES[member.role].shortLabel}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background:
                member.health === "on_track" ? "var(--co-success)" : "var(--co-warning)",
            }}
          />
          <span className="text-2xl font-extrabold leading-none text-co-text">
            {member.score}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <BarChart
          current={member.sparkline.map((n) => n)}
          colorCurrent="var(--co-gold-deep)"
          height={40}
          ariaLabel={member.name}
        />
      </div>

      <p className="mt-2 text-[11px]">
        {visible.map((cat, i) => {
          const isExpected = expectedSet.has(cat);
          return (
            <span key={cat}>
              {i > 0 ? <span className="text-co-text-dim"> · </span> : null}
              <span className={isExpected ? "font-semibold text-co-text" : "text-co-text-dim"}>
                {serverT(language, `people.cat.${cat}` as TranslationKey)} {member.counts[cat]}
              </span>
            </span>
          );
        })}
      </p>

      <p className="mt-2 text-xs italic text-co-text-muted">
        {serverT(language, member.cardLine.key as TranslationKey, member.cardLine.params)}
      </p>
    </Link>
  );
}
