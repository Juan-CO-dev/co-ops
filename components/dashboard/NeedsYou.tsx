/**
 * "Needs you" (nav PR 8, plan r2 2.6; spec r5 3.6; lead rulings r1 Q6, Q10, A8). Server component. GM, MoO, Owner and
 * CGS, by real role (the page renders it only when `needsYouFor(auth.role)`); the social media manager never.
 *
 * One line, collapsed (a native <details>): a count, "at least" a count when any source could not load, or "Nothing
 * needs you right now." ONLY when every source loaded and every count is 0. Open, one row per source with work:
 *   - stale vendor mail (the list the link opens);
 *   - tasks now or urgent with nobody on them (only when the whole board's assignments loaded; otherwise "Couldn't load
 *     who has it." and the line reads "at least", never 0);
 *   - recipe updates waiting;
 *   - catering inbox waiting at the shop, and, for a company-wide reader, the messages not tied to a shop, named apart;
 *   - catering deliveries that need a person at this shop (D3: a courier to book inside the lead window, to cancel, a
 *     failed delivery, a courier booked at another shop). The SAME rows and alerts the catering block draws
 *     (`deliveryNeedsOf`, from the day's facts: no second read). No row while delivery tracking is off here; a delivery
 *     read that failed is named and makes the line read "at least".
 * A source that failed is named ("<source>: Couldn't load right now"). A source the viewer's role does not read has no row.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsYouCells } from "@/lib/dashboard-blocks";
import { needsYouSummary, needsYouTasks, type NeedsYouCount } from "@/lib/dashboard-blocks-shared";
import { itemHref } from "@/lib/dashboard-day-shared";
import type { DayPlan } from "@/lib/day-plan-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

const ROW = "flex min-h-[44px] min-w-0 items-center text-sm text-co-text underline-offset-2 hover:underline";

export function NeedsYou({ cells, plan, tasksKnown, shopId, language, delivery }: {
  cells: NeedsYouCells;
  /** D3: `deliveryNeedsOf(input)`. Absent / null = delivery tracking is off here: no row. `count: null` = it did not load. */
  delivery?: NeedsYouCount | null;
  plan: Pick<DayPlan, "items">;
  /** The whole board's assignments loaded for the plan date (`assignmentsKnown`) and the day is not all failed. */
  tasksKnown: boolean;
  shopId: string;
  language: Language;
}) {
  const t = (k: TranslationKey, v?: Record<string, string | number>) => serverT(language, k, v);
  const loc = encodeURIComponent(shopId);
  const counts: NeedsYouCount[] = [];
  const rows: ReactNode[] = [];
  const failed = (key: string, name: TranslationKey) =>
    rows.push(<p key={key} data-needs-you={key} data-failed className="text-sm text-co-text-muted">{t("dashboard.needs_you.unavailable", { name: t(name) })}</p>);

  if (cells.vendorMail) {
    if (cells.vendorMail.kind === "ok") {
      const n = cells.vendorMail.value;
      counts.push({ count: n });
      if (n > 0) rows.push(<Link key="vendor_mail" data-needs-you="vendor_mail" href={`/operations/vendor-mail?location=${loc}&stale=1`} className={ROW}>
        {n === 1 ? t("admin.backoffice.attention.vendor_mail_one", { n }) : t("admin.backoffice.attention.vendor_mail_other", { n })}</Link>);
    } else { counts.push({ count: null }); failed("vendor_mail", "vendorMail.title"); }
  }

  if (tasksKnown) {
    const tasks = needsYouTasks(plan);
    counts.push({ count: tasks.length });
    if (tasks.length > 0) rows.push(<Link key="tasks" data-needs-you="tasks" href={itemHref(tasks[0]!, shopId)} className={ROW}>
      {tasks.length === 1 ? t("dashboard.needs_you.tasks_one") : t("dashboard.needs_you.tasks_other", { n: tasks.length })}</Link>);
  } else {
    counts.push({ count: null });
    rows.push(<p key="tasks" data-needs-you="tasks" data-failed className="text-sm text-co-text-muted">{t("dashboard.day.holder_unknown")}</p>);
  }

  if (cells.recipes) {
    if (cells.recipes.kind === "ok") {
      const n = cells.recipes.value;
      counts.push({ count: n });
      if (n > 0) rows.push(<Link key="recipes" data-needs-you="recipes" href={`/admin/catalog/notices?location=${loc}`} className={ROW}>
        {n === 1 ? t("dashboard.needs_you.recipes_one") : t("dashboard.needs_you.recipes_other", { n })}</Link>);
    } else { counts.push({ count: null }); failed("recipes", "catalog.notices.title"); }
  }

  if (cells.inbox) {
    if (cells.inbox.kind === "ok") {
      const { shop, unplaced } = cells.inbox.value;
      counts.push({ count: shop + (unplaced ?? 0) });
      if (shop > 0 || (unplaced ?? 0) > 0) rows.push(<Link key="inbox" data-needs-you="inbox" href="/catering/inbox" className={ROW}><span className="flex min-w-0 flex-col">
        {shop > 0 ? <span>{shop === 1 ? t("dashboard.needs_you.inbox_one") : t("dashboard.needs_you.inbox_other", { n: shop })}</span> : null}
        {unplaced ? <span data-needs-you="inbox_unplaced">{t("dashboard.needs_you.inbox_unplaced", { n: unplaced })}</span> : null}
      </span></Link>);
    } else { counts.push({ count: null }); failed("inbox", "catering.inbox.title"); }
  }

  if (delivery) {
    counts.push(delivery);
    if (delivery.count === null) failed("delivery", "dashboard.needs_you.delivery_name");
    else if (delivery.count > 0) rows.push(<Link key="delivery" data-needs-you="delivery" href="/catering/pipeline" className={ROW}>
      {delivery.count === 1 ? t("dashboard.needs_you.delivery_one") : t("dashboard.needs_you.delivery_other", { n: delivery.count })}</Link>);
  }

  const s = needsYouSummary(counts);
  const line = s.kind === "none" ? t("dashboard.needs_you.none")
    : s.kind === "count" ? t("dashboard.needs_you.summary", { n: s.n }) : t("dashboard.needs_you.summary_at_least", { n: s.n });
  return (
    <section aria-label={t("dashboard.needs_you.aria")} data-needs-you-line={s.kind} className="co-card min-w-0 px-4 py-2">
      <details>
        <summary className="flex min-h-[44px] cursor-pointer items-center text-base font-bold text-co-text">{line}</summary>
        {rows.length > 0 ? <div className="flex flex-col gap-1 pb-2">{rows}</div> : null}
      </details>
    </section>
  );
}
