/**
 * /admin hub (C.44 Module 1) — card grid of admin sections the viewer can
 * reach. Renders inside app/admin/layout.tsx (auth + role gate + chrome).
 * Re-calls requireSessionFromHeaders for typed auth access (the C.39 pattern;
 * ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 */

import { countNotReady } from "@/lib/admin/readiness-load";
import { readinessWhereEntries, type ReadinessByScope } from "@/lib/admin/readiness-scope-shared";
import { loadCronHealth, type CronHealth } from "@/lib/admin/ops-health";
import { cronRunFailureTotal } from "@/lib/admin/ops-health-shared";
import { loadWeekCard } from "@/lib/admin/week-card";
import {
  cellIsZero,
  ranAllWeek,
  WEEK_DETAIL_AREAS,
  WEEK_SUMMARY_AREAS,
  weekHasJobAlert,
  weekHasPeopleActivity,
  type ShopWeek,
  type WeekArea,
  type WeekCard,
  type WeekCell,
} from "@/lib/admin/week-card-shared";
import { adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { requireSessionFromHeaders } from "@/lib/session";
import type { Language } from "@/lib/i18n/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertPill } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { etDisplayDate } from "@/lib/operational-day";

const DENIED_KEYS = {
  users: "admin.hub.denied.users",
  pricing: "admin.hub.denied.pricing",
  rate_rules: "admin.hub.denied.rate_rules",
} as const;

export default async function AdminHubPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  // A level-8 page (users · pricing · rate rules) sends a GM here with ?denied= instead of
  // bouncing to the dashboard with no message (guide-walk finding, 2026-09-08).
  const { denied } = await searchParams;
  const deniedKey = denied && denied in DENIED_KEYS ? DENIED_KEYS[denied as keyof typeof DENIED_KEYS] : null;
  const lang = auth.user.language;
  const sections = adminSectionsFor(auth.level, auth.role);

  const wantsCounts = sections.some(
    (s) => s.id === "skus" || s.id === "recipes" || s.id === "items",
  );
  let counts: Record<string, number> = {};
  let byScope: ReadinessByScope[] = [];
  if (wantsCounts) {
    try {
      const c = await countNotReady(auth);
      counts = { skus: c.skus, recipes: c.recipes, items: c.items };
      byScope = c.byScope;
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
  // "This week in CO-OPS" — the shops side by side, bound to the shops this viewer may read.
  let week: WeekCard | null = null;
  try {
    week = await loadWeekCard({ role: auth.role, locations: auth.locations, level: auth.level });
  } catch (e) {
    console.error("hub week card failed (rendering without card)", e);
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.hub.heading")}
        subtitle={serverT(lang, "admin.hub.subtitle")}
      />
      {deniedKey ? (
        <p role="status" className="mt-3 rounded-lg border-2 border-co-border bg-co-surface-inset px-3 py-2 text-sm text-co-text">
          {serverT(lang, deniedKey)}
        </p>
      ) : null}

      <CronHealthCard health={cronHealth} lang={lang} />
      <WeekInCoopsCard card={week} lang={lang} />

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
            <div key={s.id} className="flex flex-col gap-1">
              <a
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
              {(s.id === "skus" || s.id === "recipes" || s.id === "items") && (counts[s.id] ?? 0) > 0 && byScope.length > 0 ? (
                // "1 in the default · 2 at P Street" (catalog Phase 3b lead decision): each shop by NAME, each entry
                // linking to that scope's list; the row wraps at 375px.
                <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm" aria-label={serverT(lang, "readiness.hub.where")}>
                  {readinessWhereEntries(s.id, s.href, byScope).map((e, i) => (
                    <li key={e.scope ?? "global"} className="flex items-center gap-x-2">
                      {i > 0 ? <span aria-hidden="true" className="text-co-text-muted">·</span> : null}
                      <a href={e.href}
                        className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">
                        {serverT(lang, e.key, e.params)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Cron-failure visibility (Ops guardrails NOW #3). Renders ONLY when there is something
 * to say: a recent (≤48h) toast-sales-pull failure → a danger AlertPill line; else, if
 * the last run swallowed a per-location failure → a warn line naming how many steps
 * failed; else, if the cron has ever succeeded, a quiet "last run OK <date>" heartbeat.
 * DORMANT (never run) → renders nothing (no false alarm before Toast creds land).
 *
 * THE MIDDLE STATE IS THE POINT (wiring audit 2026-08-29). The cron writes one
 * `cron.success` row per run whatever happened to the individual locations, so a night
 * where a shop's whole sales pull died — no depletion ledger, no par run, a frozen
 * watermark — used to land in the quiet OK line below, indefinitely. Three states, not
 * two: failed · ran-with-failures · OK.
 */
function CronHealthCard({ health, lang }: { health: CronHealth | null; lang: Language }) {
  if (!health) return null;
  if (health.hasRecentFailure) {
    const dateLabel = health.lastFailureAt ? formatDateLabel(etDisplayDate(health.lastFailureAt), lang) : "";
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
  if (health.lastSuccessAt && health.lastRunDegraded) {
    return (
      <div className="co-card mt-5 flex flex-col gap-1 border-2 border-co-warning-surface p-4">
        <div className="flex items-center gap-2">
          <AlertPill tone="warn" uppercase={false}>
            {serverT(lang, "admin.hub.cron.degraded")}
          </AlertPill>
          <span className="text-sm font-bold text-co-text">
            {serverT(lang, "admin.hub.cron.degraded_line", {
              date: formatDateLabel(etDisplayDate(health.lastSuccessAt), lang),
              count: cronRunFailureTotal(health.lastRunFailures),
            })}
          </span>
        </div>
      </div>
    );
  }
  if (health.lastSuccessAt) {
    return (
      <p className="mt-4 text-xs text-co-text-dim">
        {serverT(lang, "admin.hub.cron.ok_line", { date: formatDateLabel(etDisplayDate(health.lastSuccessAt), lang) })}
      </p>
    );
  }
  return null;
}


/**
 * "This week in CO-OPS" (B11a-admin; replaced "Used this week"). One column per shop the
 * viewer may read, rows grouped by area. Where every number comes from is documented in
 * lib/admin/week-card.ts; what each one means is decided (and tested) in week-card-shared.ts.
 *
 * Disclosure (docs/DISCLOSURE_DOCTRINE.md): the summary rows are always visible; the
 * breakdown (role bands, checklist types, where automatic catering came from) is a
 * default-collapsed CollapsibleSection with an i18n'd count (D3, D5). A failed automatic
 * job is an alert: it renders in the danger TEXT role on the summary and never hides (D2).
 * A week where no PERSON did anything collapses the whole card, as the old card did,
 * unless a job failed.
 *
 * Phone: the table scrolls inside its own container when the shops outgrow the width — the
 * page body never scrolls sideways.
 */
function WeekInCoopsCard({ card, lang }: { card: WeekCard | null; lang: Language }) {
  if (!card) return null;
  const peopleInShops = card.shops.reduce((n, s) => n + s.people.total, 0);
  const checklistsStarted = card.shops.reduce((n, s) => n + s.checklistsTotal.started, 0);
  const body = (
    <>
      <p className="text-xs text-co-text-dim">{serverT(lang, "admin.hub.week.window")}</p>
      <p className="mt-1 text-sm font-bold text-co-text">
        {serverT(lang, "admin.hub.week.people_line", { n: formatQuantity(card.overallPeople, lang) })}
      </p>
      <div className="mt-2">
        <WeekTable areas={WEEK_SUMMARY_AREAS} shops={card.shops} lang={lang} />
      </div>
      {card.shops.length > 1 ? (
        <p className="mt-2 text-xs text-co-text-dim">{serverT(lang, "admin.hub.week.people_note")}</p>
      ) : null}
      <div className="mt-3">
        <CollapsibleSection
          idBase="admin-hub-week-details"
          title={serverT(lang, "admin.hub.week.details")}
          count={serverT(lang, "admin.hub.week.details_count", {
            people: formatQuantity(peopleInShops, lang),
            checklists: formatQuantity(checklistsStarted, lang),
          })}
          defaultOpen={false}
        >
          <WeekTable areas={WEEK_DETAIL_AREAS} shops={card.shops} lang={lang} />
        </CollapsibleSection>
      </div>
    </>
  );

  if (!weekHasPeopleActivity(card) && !weekHasJobAlert(card)) {
    return (
      <div className="mt-4">
        <CollapsibleSection
          idBase="admin-hub-week"
          title={serverT(lang, "admin.hub.week.title")}
          count={serverT(lang, "admin.hub.week.all_quiet")}
          defaultOpen={false}
        >
          {body}
        </CollapsibleSection>
      </div>
    );
  }

  return (
    <section className="co-card mt-4 p-4" aria-labelledby="admin-hub-week-title">
      <h2 id="admin-hub-week-title" className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">
        {serverT(lang, "admin.hub.week.title")}
      </h2>
      <div className="mt-2">{body}</div>
    </section>
  );
}

/**
 * Label column + one column per shop. The rem min-width keeps each shop column readable;
 * past the card's width the wrapper scrolls (inside the card, never the page).
 */
function WeekTable({ areas, shops, lang }: { areas: readonly WeekArea[]; shops: ShopWeek[]; lang: Language }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${9 + shops.length * 6}rem` }}>
        <caption className="sr-only">{serverT(lang, "admin.hub.week.caption")}</caption>
        <colgroup>
          <col />
          {shops.map((s) => (
            <col key={s.shopId} className="w-24 sm:w-32" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              <span className="sr-only">{serverT(lang, "admin.hub.week.activity")}</span>
            </th>
            {shops.map((s) => (
              <th
                key={s.shopId}
                scope="col"
                className="pb-1 pl-2 text-right align-bottom text-xs font-bold break-words text-co-text"
              >
                {s.shopName}
              </th>
            ))}
          </tr>
        </thead>
        {areas.map((area) => (
          <tbody key={area.id}>
            <tr>
              <th
                scope="colgroup"
                colSpan={shops.length + 1}
                className="pt-3 pb-1 text-left text-xs font-bold tracking-wide text-co-text-muted"
              >
                {serverT(lang, area.labelKey)}
              </th>
            </tr>
            {area.rows.map((row) => (
              <tr key={row.id} className="border-t border-co-border">
                <th
                  scope="row"
                  className={`py-1.5 pr-2 text-left font-normal ${area.automatic ? "text-co-text-muted" : "text-co-text"}`}
                >
                  {serverT(lang, row.labelKey)}
                </th>
                {shops.map((s) => (
                  <td key={s.shopId} className="py-1.5 pl-2 text-right">
                    <WeekValue cell={row.cell(s)} lang={lang} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Zero renders "0" muted (as the old card did); an alert renders in the danger TEXT role. */
function WeekValue({ cell, lang }: { cell: WeekCell; lang: Language }) {
  if (cell.kind === "days") {
    // A job's health line: "Ran all week" / "Ran 6 of 7 days", plus "· N failed" (danger text).
    const ran = ranAllWeek(cell)
      ? serverT(lang, "admin.hub.week.ran_all")
      : serverT(lang, "admin.hub.week.ran_days", { ran: formatQuantity(cell.ran, lang), of: formatQuantity(cell.of, lang) });
    return (
      <span className="font-bold tabular-nums">
        <span className={ranAllWeek(cell) ? "text-co-text" : "text-co-warning-text"}>{ran}</span>
        {cell.failed > 0 ? (
          <span className="block text-co-cta-text">
            {serverT(lang, "admin.hub.week.failed_suffix", { n: formatQuantity(cell.failed, lang) })}
          </span>
        ) : null}
      </span>
    );
  }
  const tone =
    cell.kind === "count" && cell.alert ? "text-co-cta-text" : cellIsZero(cell) ? "text-co-text-dim" : "text-co-text";
  const text =
    cell.kind === "count"
      ? formatQuantity(cell.n, lang)
      : cell.total === 0
        ? formatQuantity(0, lang)
        : serverT(lang, "admin.hub.week.of", {
            done: formatQuantity(cell.done, lang),
            total: formatQuantity(cell.total, lang),
          });
  return <span className={`font-bold tabular-nums ${tone}`}>{text}</span>;
}
