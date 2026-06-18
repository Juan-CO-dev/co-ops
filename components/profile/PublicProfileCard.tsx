/**
 * Public profile card — pure presentational Server Component (no client hooks).
 * Mobile-first, positive/celebratory framing. Renders a single user's public
 * stats: tenure, MVP wins, streaks, task velocity, and positive rating gradient.
 *
 * The PublicProfile contract deliberately omits needs-work ratings (see
 * lib/profiles.ts) — this card only surfaces positive signal.
 */

import { BarChart } from "@/components/trends/BarChart";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { PublicProfile } from "@/lib/profiles";
import { ROLES } from "@/lib/roles";

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 min-w-[96px] rounded-xl border border-co-border bg-co-surface p-3 text-center">
      <div className="text-xl font-extrabold text-co-text">{value}</div>
      <div className="text-[9px] uppercase text-co-text-dim">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-co-border bg-co-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-co-text-muted mb-2">{title}</div>
      {children}
    </div>
  );
}

export function PublicProfileCard({
  profile,
  language,
  isSelf,
}: {
  profile: PublicProfile;
  language: Language;
  isSelf: boolean;
}) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    serverT(language, key, params);

  const tenure =
    profile.tenureDays >= 60
      ? t("profile.tenure_months", { n: Math.round(profile.tenureDays / 30) })
      : t("profile.tenure_days", { n: profile.tenureDays });

  const total = profile.gradient.great + profile.gradient.good;

  return (
    <div className="rounded-2xl border-2 border-co-border bg-co-surface p-5">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl bg-co-warning-surface p-3 -m-1 mb-4">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-co-gold text-xl font-bold text-co-text"
        >
          {profile.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-extrabold text-co-text">{profile.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-muted"
              style={{ background: "#f1ede0" }}
            >
              {ROLES[profile.role].shortLabel}
            </span>
            {isSelf ? (
              <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-[10px] font-bold text-co-text">
                {t("profile.you")}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-co-text-muted">
            📍 {profile.locationCodes.join(" · ")} · {tenure}
          </div>
        </div>
      </div>

      {/* Highlight tiles */}
      <div className="flex flex-wrap gap-2">
        <Tile value={`⭐ ${profile.mvpWins}`} label={t("profile.mvp_wins")} />
        <Tile value={`🔥 ${profile.streaks.longest}`} label={t("profile.longest_streak")} />
        <Tile value={`${profile.tasksAllTime}`} label={t("profile.tasks_all_time")} />
      </div>

      {/* Smaller chips row */}
      <div className="mt-2 flex gap-2 text-[11px] text-co-text-muted">
        <span>
          {t("profile.current_streak")} {profile.streaks.current}
        </span>
        <span>
          {t("profile.personal_best")} {profile.streaks.personalBest}
        </span>
      </div>

      {/* Velocity card */}
      <div className="mt-4">
        <Section title={t("profile.velocity_title")}>
          <BarChart
            current={profile.velocity}
            colorCurrent="var(--co-success)"
            height={40}
            ariaLabel={t("profile.velocity_title")}
          />
          <div className="mt-1 text-[10px] text-co-text-dim">{t("profile.velocity_note")}</div>
        </Section>
      </div>

      {/* Ratings card — hidden for leadership (MoO+ aren't rated by managers) */}
      {profile.cardKind !== "leadership" ? (
        <div className="mt-3">
          <Section title={t("profile.ratings_title")}>
            {total === 0 ? (
              <div className="text-xs text-co-text-muted">{t("profile.ratings_none")}</div>
            ) : (
              <>
                <div className="flex h-3.5 overflow-hidden rounded">
                  <div
                    style={{ flex: profile.gradient.great, background: "var(--co-success)" }}
                  />
                  <div style={{ flex: profile.gradient.good, background: "#9ccc9c" }} />
                </div>
                <div className="mt-1 text-[10px] text-co-text-dim">
                  {t("profile.ratings_note", {
                    great: Math.round((profile.gradient.great / total) * 100),
                    good: Math.round((profile.gradient.good / total) * 100),
                  })}
                </div>
              </>
            )}
          </Section>
        </div>
      ) : null}

      {/* Footnotes */}
      <div className="mt-4 text-[10px] italic text-co-text-dim">{t("profile.toast_note")}</div>
      <div className="mt-1 text-center text-[10px] text-co-text-dim">{t("profile.reassure")}</div>
    </div>
  );
}
