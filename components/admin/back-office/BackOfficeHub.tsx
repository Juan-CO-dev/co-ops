/**
 * The Back office, grouped (nav spec r5 section 5; nav PR 4 plan r2 section 1). Server component, presentational:
 * it loads nothing. app/admin/page.tsx reads the session, the switches and the health loaders and hands it the view;
 * the render tests and the 375 px browser harness (tests/browser/back-office-hub-ui.mjs) render it from fixtures.
 *
 * Top to bottom: the title and its line; ONE "Needs attention" line (the words are exact: Issue, Healthy,
 * Unavailable, Not enabled), which opens to a row per check with its fix; the jobs row; the six headed groups of rows
 * (the first two the viewer sees open, the rest closed with their name, line, count and any issue badge); last, the
 * System group: System status and This week in CO-OPS (both collapsed) and the planned Audit log.
 *
 * Disclosure state is each CollapsibleSection's own useState (D9): nothing is stored, and a closed body is not
 * rendered (D10).
 */
import type { ReactNode } from "react";
import { InboundHealthPanel } from "@/components/admin/InboundSettings";
import { SystemStatusDisclosure, SystemStatusLink } from "@/components/admin/back-office/SystemStatusDisclosure";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  STATE_KEYS, SYSTEM_STATUS_HASH, attentionLine, checkSentence, needsAttention, summarize,
  type AttentionCheck, type CheckState, type Read, type SalesPullCheck,
} from "@/lib/admin/back-office-shared";
import type { CronHealth, InboundHealth } from "@/lib/admin/ops-health";
import { cronRunFailureTotal } from "@/lib/admin/ops-health-shared";
import {
  cellIsZero, ranAllWeek, WEEK_DETAIL_AREAS, WEEK_SUMMARY_AREAS, weekHasJobAlert, weekHasPeopleActivity,
  type ShopWeek, type WeekArea, type WeekCard, type WeekCell,
} from "@/lib/admin/week-card-shared";
import { formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type { BackOffice, BackOfficeGroup, BackOfficeRow } from "@/lib/nav/back-office";
import { etDisplayDate } from "@/lib/operational-day";

export interface BackOfficeHubView {
  lang: Language;
  /** ISO instant of the request (the all-clear line says "today" by the operational day of this instant). */
  now: string;
  deniedKey: TranslationKey | null;
  office: BackOffice;
  /** Every check the viewer may see, in display order (sales pull, inbound mail, vendor mail, not ready). */
  checks: readonly AttentionCheck[];
  sales: SalesPullCheck;
  cron: Read<CronHealth>;
  /** null: the viewer is not shown vendor mail (and it was not read). */
  vendorMail: Read<number> | null;
  /** null: the viewer is not shown inbound mail (and it was not read). */
  inbound: Read<InboundHealth> | null;
  /** ok with null: the viewer can read no active shop, so the panel is not drawn (as the old card was not). */
  week: Read<WeekCard | null>;
}

const TONE: Readonly<Record<CheckState, AlertPillTone>> = { issue: "danger", unavailable: "warn", healthy: "info", not_enabled: "info" };
const LINK_44 = "inline-flex min-h-[44px] items-center font-bold text-co-text underline";

/** The check behind a row's badge: the readiness rows and the Vendor mail row. */
const ROW_CHECK: Readonly<Record<string, AttentionCheck["id"]>> = {
  skus: "not_ready_skus", recipes: "not_ready_recipes", items: "not_ready_items", "vendor-mail": "vendor_mail",
};

function StatePill({ state, lang }: { state: CheckState; lang: Language }) {
  return <AlertPill tone={TONE[state]} uppercase={false}>{serverT(lang, STATE_KEYS[state])}</AlertPill>;
}

/** A row's badge: "N not ready" on a readiness row, the state word on Vendor mail, "Unavailable" on a failed read. */
function rowBadge(rowId: string, checks: readonly AttentionCheck[], lang: Language): ReactNode {
  const id = ROW_CHECK[rowId];
  const c = id ? checks.find((x) => x.id === id) : undefined;
  if (!c || !needsAttention(c)) return null;
  if (c.state === "issue" && c.id.startsWith("not_ready_")) {
    return <AlertPill tone="danger" uppercase={false}>{serverT(lang, "readiness.hub.count", { count: c.count ?? 0 })}</AlertPill>;
  }
  return <StatePill state={c.state} lang={lang} />;
}

function rowNeedsAttention(rowId: string, checks: readonly AttentionCheck[]): boolean {
  const id = ROW_CHECK[rowId];
  return checks.some((c) => c.id === id && c.state === "issue");
}

function FixLink({ check, lang }: { check: AttentionCheck; lang: Language }) {
  const name = serverT(lang, check.nameKey);
  return check.href === SYSTEM_STATUS_HASH
    ? <SystemStatusLink className={LINK_44}>{name}</SystemStatusLink>
    : <a href={check.href} className={LINK_44}>{name}</a>;
}

/** One row per check, each with its state word, its sentence, the per-shop entries and the link to its fix. */
function AttentionRows({ checks, lang }: { checks: readonly AttentionCheck[]; lang: Language }) {
  const t = (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
  return (
    <ul aria-label={t("admin.backoffice.attention.title")} className="divide-y divide-co-border/50">
      {checks.map((c) => {
        const sentence = checkSentence(c, lang, t);
        return (
          <li key={c.id} className="py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <FixLink check={c} lang={lang} />
              <StatePill state={c.state} lang={lang} />
            </div>
            {sentence ? <p className="text-sm text-co-text">{sentence}</p> : null}
            {c.where && c.where.length > 0 ? (
              // "1 in the default · 2 at P Street" (catalog Phase 3b lead decision): each shop by NAME, each entry
              // linking to that scope's list; the row wraps at 375px.
              <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label={t("readiness.hub.where")}>
                {c.where.map((e, i) => (
                  <li key={e.scope ?? "global"} className="flex items-center gap-x-2">
                    {i > 0 ? <span aria-hidden="true" className="text-co-text-muted">·</span> : null}
                    <a href={e.href} className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">
                      {t(e.key, e.params)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A group's rows: each one full-width link (48 px or taller) with its name, one muted line, any badge and a
 *  chevron; the buying path carries its step. Exported for the browser harness, which checks closed groups too. */
export function GroupRows({ rows, checks, lang }: { rows: readonly BackOfficeRow[]; checks: readonly AttentionCheck[]; lang: Language }) {
  return (
    <ul className="-mx-2 flex flex-col gap-1">
      {rows.map((r) => {
        const body = (
          <>
            {r.step !== undefined ? (
              <span aria-label={serverT(lang, "admin.backoffice.step_label", { n: r.step })}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-co-border text-xs font-bold text-co-text-muted">
                <span aria-hidden="true">{r.step}</span>
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-center gap-2">
                <span className={`text-base font-bold ${r.planned ? "text-co-text-muted" : "text-co-text"}`}>{serverT(lang, r.nameKey)}</span>
                {r.planned ? <span className="text-sm text-co-text-muted">{serverT(lang, "planned.label")}</span> : rowBadge(r.id, checks, lang)}
              </span>
              {r.lineKey ? <span className="text-sm text-co-text-muted">{serverT(lang, r.lineKey)}</span> : null}
            </span>
          </>
        );
        return (
          <li key={r.id}>
            {r.planned ? (
              // Honest muted row: the page is planned and not built, so it links nowhere (aria-disabled, no <a>).
              <div data-backoffice-row={r.id} aria-disabled="true" className="flex min-h-[48px] w-full cursor-default items-center gap-3 rounded-lg px-2 py-2 opacity-60">{body}</div>
            ) : (
              <a data-backoffice-row={r.id} href={r.href}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-co-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60">
                {body}
                <span aria-hidden="true" className="shrink-0 text-lg text-co-text-dim">›</span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Group({ group, checks, lang, defaultOpen }: { group: BackOfficeGroup; checks: readonly AttentionCheck[]; lang: Language; defaultOpen: boolean }) {
  const n = group.rows.length;
  const issues = group.rows.filter((r) => rowNeedsAttention(r.id, checks)).length;
  return (
    <CollapsibleSection idBase={`backoffice-${group.id}`} title={serverT(lang, group.nameKey)} description={serverT(lang, group.lineKey)}
      count={serverT(lang, n === 1 ? "admin.backoffice.group.count_one" : "admin.backoffice.group.count_other", { n })}
      badge={issues > 0 ? <AlertPill tone="danger" uppercase={false}>{serverT(lang, issues === 1 ? "admin.backoffice.group.issues_one" : "admin.backoffice.group.issues_other", { n: issues })}</AlertPill> : null}
      defaultOpen={defaultOpen}>
      <GroupRows rows={group.rows} checks={checks} lang={lang} />
    </CollapsibleSection>
  );
}

/** The worst state among some checks, for a panel's header badge (only Issue or Unavailable shout). */
function worstState(checks: readonly AttentionCheck[]): CheckState | null {
  if (checks.some((c) => c.state === "issue")) return "issue";
  if (checks.some((c) => c.state === "unavailable")) return "unavailable";
  return null;
}

export function BackOfficeHub({ view }: { view: BackOfficeHubView }) {
  const { lang, office, checks } = view;
  const t = (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
  const summary = summarize(checks, view.sales);
  const systemChecks = checks.filter((c) => c.id === "sales_pull" || c.id === "inbox" || c.id === "vendor_mail");
  const systemWorst = worstState(systemChecks);
  const week = view.week;
  return (
    <div>
      <PageHeader title={t("admin.hub.heading")} subtitle={t("admin.hub.subtitle")} />
      {view.deniedKey ? (
        <p role="status" className="mt-3 rounded-lg border-2 border-co-border bg-co-surface-inset px-3 py-2 text-sm text-co-text">
          {t(view.deniedKey)}
        </p>
      ) : null}

      <div className="mt-4">
        <CollapsibleSection idBase="backoffice-needs-attention" title={attentionLine(summary, view.now, lang, t)}
          badge={summary.kind === "attention" ? <StatePill state={summary.worst.state} lang={lang} /> : null}>
          <AttentionRows checks={checks} lang={lang} />
        </CollapsibleSection>
      </div>

      {office.jobs.length > 0 ? (
        <nav aria-label={t("admin.backoffice.jobs.label")} className="mt-4">
          <ul className="flex flex-wrap gap-2">
            {office.jobs.map((j) => (
              <li key={j.id}>
                <a data-backoffice-job={j.id} href={j.href}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-surface px-4 py-2 text-sm font-bold text-co-text hover:bg-co-surface-2">
                  {t(j.labelKey)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        {office.groups.map((g, i) => <Group key={g.id} group={g} checks={checks} lang={lang} defaultOpen={i < 2} />)}
      </div>

      <section aria-labelledby="backoffice-system" className="mt-6 flex flex-col gap-3">
        <div>
          <h2 id="backoffice-system" className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{t(office.system.nameKey)}</h2>
          <p className="mt-1 text-sm text-co-text-muted">{t(office.system.lineKey)}</p>
        </div>
        <SystemStatusDisclosure title={t("admin.backoffice.system_status.title")} description={t("admin.backoffice.system_status.line")}
          count={t(systemChecks.length === 1 ? "admin.backoffice.checks_one" : "admin.backoffice.checks_other", { n: systemChecks.length })}
          badge={systemWorst ? <StatePill state={systemWorst} lang={lang} /> : null}>
          <SystemStatusBody view={view} systemChecks={systemChecks} />
        </SystemStatusDisclosure>
        {week.state === "failed" ? (
          <CollapsibleSection idBase="admin-hub-week" title={t("admin.hub.week.title")} description={t("admin.backoffice.week.line")}
            count={t("admin.backoffice.state.unavailable")}>
            <p className="text-sm text-co-text">{t("admin.backoffice.attention.unavailable", { name: t("admin.hub.week.title") })}</p>
          </CollapsibleSection>
        ) : week.value ? (
          <CollapsibleSection idBase="admin-hub-week" title={t("admin.hub.week.title")} description={t("admin.backoffice.week.line")}
            count={weekHasPeopleActivity(week.value) || weekHasJobAlert(week.value)
              ? t("admin.hub.week.people_line", { n: formatQuantity(week.value.overallPeople, lang) })
              : t("admin.hub.week.all_quiet")}
            badge={weekHasJobAlert(week.value) ? <StatePill state="issue" lang={lang} /> : null}>
            <WeekBody card={week.value} lang={lang} />
          </CollapsibleSection>
        ) : null}
        {office.system.rows.length > 0 ? <div className="co-card p-2"><GroupRows rows={office.system.rows} checks={checks} lang={lang} /></div> : null}
      </section>
    </div>
  );
}

/** System status: each of its checks with its state word, then today's detail, moved without change: the cron card
 *  (with the error text), the vendor mail line and the inbound mail panel with its retry buttons. */
function SystemStatusBody({ view, systemChecks }: { view: BackOfficeHubView; systemChecks: readonly AttentionCheck[] }) {
  const { lang } = view;
  const t = (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {systemChecks.map((c) => (
          <li key={c.id} className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold text-co-text">{t(c.nameKey)}</span>
            <StatePill state={c.state} lang={lang} />
          </li>
        ))}
      </ul>
      {view.cron.state === "ok" ? <CronHealthCard health={view.cron.value} lang={lang} /> : null}
      {view.vendorMail ? (
        <a href="/operations/vendor-mail?stale=1" className="co-card mt-4 flex min-h-[44px] flex-wrap items-center gap-2 p-4">
          {t("vendorMail.health")}{" "}
          <strong className={view.vendorMail.state === "ok" && view.vendorMail.value ? "text-co-cta-text" : ""}>
            {view.vendorMail.state === "ok" ? view.vendorMail.value : t("admin.backoffice.state.unavailable")}
          </strong>
        </a>
      ) : null}
      {view.inbound?.state === "ok" ? <InboundHealthPanel health={view.inbound.value} /> : null}
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
 * Disclosure (docs/DISCLOSURE_DOCTRINE.md): the whole card is now a collapsed panel of the System group (nav PR 4);
 * its header carries the people line (or "All quiet") and, when an automatic job failed, an Issue badge, so the
 * alert still shows while it is closed (D2). Inside, the summary rows, then the breakdown (role bands, checklist
 * types, where automatic catering came from) as a default-collapsed CollapsibleSection with an i18n'd count (D3, D5).
 * A failed automatic job renders in the danger TEXT role on the summary.
 *
 * Phone: the table scrolls inside its own container when the shops outgrow the width — the
 * page body never scrolls sideways.
 */
function WeekBody({ card, lang }: { card: WeekCard; lang: Language }) {
  const peopleInShops = card.shops.reduce((n, s) => n + s.people.total, 0);
  const checklistsStarted = card.shops.reduce((n, s) => n + s.checklistsTotal.started, 0);
  return (
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
