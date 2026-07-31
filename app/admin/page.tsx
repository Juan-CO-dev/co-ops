/**
 * /admin hub (C.44 Module 1) — card grid of admin sections the viewer can
 * reach. Renders inside app/admin/layout.tsx (auth + role gate + chrome).
 * Re-calls requireSessionFromHeaders for typed auth access (the C.39 pattern;
 * ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 */

import { countNotReady } from "@/lib/admin/readiness-load";
import { loadCronHealth, loadAdoption, type CronHealth } from "@/lib/admin/ops-health";
import type { AdoptionSurfaceCount } from "@/lib/admin/ops-health-shared";
import { adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import { requireSessionFromHeaders } from "@/lib/session";
import type { Language } from "@/lib/i18n/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertPill } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

export default async function AdminHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const lang = auth.user.language;
  const sections = adminSectionsFor(auth.level);

  const wantsCounts = sections.some(
    (s) => s.id === "skus" || s.id === "recipes" || s.id === "items",
  );
  let counts: Record<string, number> = {};
  if (wantsCounts) {
    try {
      const c = await countNotReady(auth);
      counts = { skus: c.skus, recipes: c.recipes, items: c.items };
    } catch (e) {
      console.error("hub readiness counts failed (rendering without pills)", e);
    }
  }

  // Ops-health cards (derive-on-read over audit_log). Each fails SOFT — an ops signal
  // must never take down the admin hub (mirrors the readiness-counts posture above).
  let cronHealth: CronHealth | null = null;
  try {
    cronHealth = await loadCronHealth();
  } catch (e) {
    console.error("hub cron health failed (rendering without card)", e);
  }
  let adoption: AdoptionSurfaceCount[] = [];
  try {
    adoption = await loadAdoption();
  } catch (e) {
    console.error("hub adoption failed (rendering without card)", e);
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.hub.heading")}
        subtitle={serverT(lang, "admin.hub.subtitle")}
      />

      <CronHealthCard health={cronHealth} lang={lang} />
      <AdoptionCard surfaces={adoption} lang={lang} />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) =>
          s.comingSoon ? (
            // Honest muted card — the section is a live PlaceholderCard stub, so
            // the hub does not pretend it links anywhere (council convergence 4;
            // mirrors checklist-templates deep_cleaning). No <a>, aria-disabled.
            <div
              key={s.id}
              aria-disabled="true"
              className="co-card flex cursor-default items-center justify-between p-4 opacity-60"
            >
              <span className="text-base font-bold text-co-text-muted">
                {serverT(lang, s.i18nKey)}
              </span>
              <span className="text-sm text-co-text-muted">
                {serverT(lang, "admin.hub.arrives")}
              </span>
            </div>
          ) : (
            <a
              key={s.id}
              href={s.href}
              className="co-card co-card-interactive p-4 text-base font-bold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            >
              {serverT(lang, s.i18nKey)}
              {(counts[s.id] ?? 0) > 0 ? (
                <AlertPill tone="danger" uppercase={false} className="ml-2">
                  {serverT(lang, "readiness.hub.count", { count: counts[s.id]! })}
                </AlertPill>
              ) : null}
            </a>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Cron-failure visibility (Ops guardrails NOW #3). Renders ONLY when there is something
 * to say: a recent (≤48h) toast-sales-pull failure → a danger AlertPill line; else, if
 * the cron has ever succeeded, a quiet "last run OK <date>" heartbeat. DORMANT (never
 * run) → renders nothing (no false alarm before Toast creds land).
 */
function CronHealthCard({ health, lang }: { health: CronHealth | null; lang: Language }) {
  if (!health) return null;
  if (health.hasRecentFailure) {
    const dateLabel = health.lastFailureAt ? formatDateLabel(health.lastFailureAt.slice(0, 10), lang) : "";
    return (
      <div className="co-card mt-5 flex flex-col gap-1 border-2 border-co-danger-surface p-4">
        <div className="flex items-center gap-2">
          <AlertPill tone="danger" uppercase={false}>
            {serverT(lang, "admin.hub.cron.failed")}
          </AlertPill>
          <span className="text-sm font-bold text-co-text">
            {serverT(lang, "admin.hub.cron.failed_line", { date: dateLabel })}
          </span>
        </div>
        {health.lastFailureError ? (
          <p className="text-xs text-co-text-muted break-words">{health.lastFailureError}</p>
        ) : null}
      </div>
    );
  }
  if (health.lastSuccessAt) {
    return (
      <p className="mt-4 text-xs text-co-text-dim">
        {serverT(lang, "admin.hub.cron.ok_line", { date: formatDateLabel(health.lastSuccessAt.slice(0, 10), lang) })}
      </p>
    );
  }
  return null;
}

/**
 * Adoption card ("Used this week", Ops guardrails NOW #3). Answers "is anyone using it?"
 * — the curated surfaces with their 7-day event counts. Zero-count surfaces render muted
 * (the roster stays stable). Renders nothing when the derive failed (empty list).
 */
function AdoptionCard({ surfaces, lang }: { surfaces: AdoptionSurfaceCount[]; lang: Language }) {
  if (surfaces.length === 0) return null;
  const list = (
    <ul className="flex flex-col gap-1">
      {surfaces.map((s) => {
        const zero = s.count === 0;
        return (
          <li
            key={s.id}
            className={`flex items-center justify-between gap-3 text-sm ${zero ? "text-co-text-dim" : "text-co-text"}`}
          >
            <span>{serverT(lang, s.labelKey)}</span>
            <span className="tabular-nums font-bold">{s.count}</span>
          </li>
        );
      })}
    </ul>
  );

  // When NOTHING moved in 7 days the card is low-signal secondary content →
  // collapse it by default (Disclosure Doctrine D3) so a quiet week doesn't
  // clutter the hub. With any activity, show the full card.
  if (surfaces.every((s) => s.count === 0)) {
    return (
      <div className="mt-4">
        <CollapsibleSection
          idBase="admin-hub-adoption"
          title={serverT(lang, "admin.hub.adoption.title")}
          count={serverT(lang, "admin.hub.adoption.all_quiet")}
          defaultOpen={false}
        >
          {list}
        </CollapsibleSection>
      </div>
    );
  }

  return (
    <div className="co-card mt-4 p-4">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">
        {serverT(lang, "admin.hub.adoption.title")}
      </h2>
      <div className="mt-2">{list}</div>
    </div>
  );
}
