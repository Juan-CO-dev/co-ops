import Link from "next/link";

import type { TeamOperatingHealth } from "@/lib/team-metrics";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/**
 * Trends landing surface — mobile-first entry point to the Ops and Team
 * trend views. Pure presentational Server Component. Shows entry cards, a
 * "relevant right now" attention block, and per-section snapshots. The Team
 * card + Team snapshot only render for viewers cleared to see team metrics.
 */
export function TrendsLanding({
  locationId,
  language,
  canSeeTeam,
  ops,
  team,
  attention,
}: {
  locationId: string;
  language: Language;
  canSeeTeam: boolean;
  ops: { underPar: number; tempFlags: number } | null;
  team: TeamOperatingHealth | null;
  attention: { kind: "ops" | "team"; titleKey: string; sub: string }[];
}) {
  const opsHref = `/reports/trends/ops?location=${locationId}`;
  const teamHref = `/reports/trends/team?location=${locationId}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {/* Entry cards */}
      <div className="flex gap-2">
        <Link
          href={opsHref}
          className="flex-1 rounded-2xl border-2 border-co-text bg-co-warning-surface p-4"
        >
          <p className="font-extrabold text-co-text">
            {serverT(language, "reports.trends.landing.ops_card")}
          </p>
          <p className="text-[11px] text-co-text-muted">
            {serverT(language, "reports.trends.landing.ops_desc")}
          </p>
        </Link>
        {canSeeTeam ? (
          <Link
            href={teamHref}
            className="flex-1 rounded-2xl border-2 border-co-text bg-co-surface p-4"
          >
            <p className="font-extrabold text-co-text">
              {serverT(language, "reports.trends.landing.team_card")}
            </p>
            <p className="text-[11px] text-co-text-muted">
              {serverT(language, "reports.trends.landing.team_desc")}
            </p>
          </Link>
        ) : null}
      </div>

      {/* Relevant right now */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-co-gold-deep">
          {serverT(language, "reports.trends.landing.relevant_now")}
        </p>
        {attention.length === 0 ? (
          <p className="text-xs text-co-text-muted">
            {serverT(language, "reports.trends.landing.nothing_urgent")}
          </p>
        ) : (
          attention.map((item, i) => (
            <Link
              key={i}
              href={item.kind === "ops" ? opsHref : teamHref}
              className="flex items-center gap-2 rounded-lg border border-co-border bg-co-surface p-2.5"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: "var(--co-warning)" }}
              />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-co-text">
                  {serverT(language, item.titleKey as TranslationKey)}
                </span>
                <span className="text-[10px] text-co-text-muted">{item.sub}</span>
              </div>
              <span aria-hidden className="ml-auto text-co-text-muted">
                →
              </span>
            </Link>
          ))
        )}
      </div>

      {/* Section snapshots */}
      {ops ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-co-border bg-co-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-co-text">
              {serverT(language, "reports.trends.landing.ops_snapshot")}
            </p>
            <Link
              href={opsHref}
              className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted hover:text-co-text"
            >
              {serverT(language, "reports.trends.landing.view_ops")}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniTile
              label={serverT(language, "reports.trends.par_title")}
              value={String(ops.underPar)}
            />
            <MiniTile
              label={serverT(language, "reports.trends.temps_title")}
              value={String(ops.tempFlags)}
            />
          </div>
        </div>
      ) : null}

      {canSeeTeam && team ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-co-border bg-co-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold uppercase tracking-[0.1em] text-co-text">
              {serverT(language, "reports.trends.landing.team_snapshot")}
            </p>
            <Link
              href={teamHref}
              className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted hover:text-co-text"
            >
              {serverT(language, "reports.trends.landing.view_team")}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniTile
              label={serverT(language, "people.on_track")}
              value={String(team.summary.onTrack)}
            />
            <MiniTile
              label={serverT(language, "people.needs_attention")}
              value={String(team.summary.needsAttention)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MiniTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-co-border p-2">
      <p className="text-[9px] uppercase text-co-text-dim">{label}</p>
      <p className="text-lg font-extrabold text-co-text">{value}</p>
    </div>
  );
}
