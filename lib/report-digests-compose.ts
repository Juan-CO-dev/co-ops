/**
 * Report digests — the PURE composers (zero I/O). Facts in, lines + email out. Every visible
 * string goes through serverT in the RECIPIENT's language; every line carries a deep link into the
 * app (links never grant access: the app still asks for a sign-in).
 *
 * Juan, 2026-10-07: "a summary and then a link to each report saying things like all good, no
 * issues, or listing the issues for them to drill down into." Catering: "yesterday's summary and
 * today's outlook". Silence never means all good — every empty state is an explicit line.
 */
import type { ReportListItem, ReportTypeKey } from "@/lib/reports-hub";
import { reportIsFinalized } from "@/lib/report-summary";
import type { TaskType } from "@/lib/assignments-shared";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { escapeHtml, renderEmailLayout } from "@/lib/email-templates/_layout";
import { TENANT_NAME } from "@/lib/tenant";
import { LEAD_SOURCES } from "@/lib/catering/intake-shared";
import { timeWindowLabel, timeWindowMinutes } from "@/lib/midshift-shared";
import type { ShopV2Facts } from "@/lib/report-digests-v2-shared";
import { allShopsSection, composeV2Sections, plural } from "@/lib/report-digests-v2-compose";

export type DigestTone = "ok" | "issue" | "info";
export interface DigestLine { label: string; text: string; tone: DigestTone; href: string }
export interface DigestSection { title: string; lines: DigestLine[] }
export interface ComposedEmail { subject: string; html: string; text: string }

// ── Shop (GM / unified) ─────────────────────────────────────────────────────────────────────

export interface ShopDayFacts {
  location: { id: string; name: string };
  day: string;
  /** listReports for the shop and day (system viewer, so cash is included). */
  reports: ReportListItem[];
  receiving: { deliveries: number; discrepant: number; missingReceipt: number };
  tosses: number;
  storeRunsPending: number;
  /** Active report_assignments for the day. */
  tasks: TaskType[];
  /**
   * The PM report's findings (its employee evaluations — the list loader carries NO PM signals, its
   * gradient tally is detail-only). null = not loaded → the line says "not assessed", never "All good".
   */
  pmFindings: { evaluations: number; needsWork: number } | null;
  /**
   * Digest v2 (the management summary, GO 2026-10-08). Optional so a fact set without it (the
   * engine's own fixtures, a v2 load that never ran) renders the v1 layout unchanged.
   */
  v2?: ShopV2Facts;
}

export const SHOP_REPORT_FAMILIES: readonly ReportTypeKey[] = ["opening", "am_prep", "mid_day", "closing", "cash", "pm", "maintenance"];

/** Assigned tasks that have a report to prove them done. receiving is proven by a delivery. */
const TASK_REPORT: Partial<Record<TaskType, ReportTypeKey>> = {
  am_prep: "am_prep", mid_day_prep: "mid_day", cash_report: "cash", opening_report: "opening", pm_report: "pm",
};

function dayQuery(locationId: string, day: string, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ location: locationId, range: "custom", from: day, to: day, ...extra });
  return q.toString();
}

type Tr = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** The PM report's line (Operations in v1; People in v2). */
function pmLine(f: ShopDayFacts, t: Tr, baseUrl: string): DigestLine {
  const label = t("reports.type.pm");
  const listHref = `${baseUrl}/reports/operations?${dayQuery(f.location.id, f.day, { type: "pm" })}`;
  const items = f.reports.filter((r) => r.type === "pm");
  const item = items.find(reportIsFinalized) ?? items[0];
  if (!item) return { label, text: t("digest.line.not_submitted"), tone: "issue", href: listHref };
  const itemHref = items.length === 1 ? `${baseUrl}/reports/pm/${item.id}?${dayQuery(f.location.id, f.day)}` : listHref;
  if (!reportIsFinalized(item)) return { label, text: t("digest.line.not_finalized"), tone: "issue", href: itemHref };
  const pm = f.pmFindings;
  return pm === null ? { label, text: t("digest.pm.not_assessed"), tone: "info", href: itemHref }
    : pm.needsWork > 0 ? { label, text: plural(t, pm.needsWork, "digest.pm.needs_work_one", "digest.pm.needs_work_other", { evals: pm.evaluations }), tone: "issue", href: itemHref }
      : pm.evaluations === 0 ? { label, text: t("digest.pm.no_evals"), tone: "info", href: itemHref }
        : { label, text: plural(t, pm.evaluations, "digest.pm.all_good_one", "digest.pm.all_good_other"), tone: "ok", href: itemHref };
}

/**
 * The report-family lines (Operations). `v2Layout` moves PM to People and leaves receiving,
 * tosses and store runs to their own v2 sections, and adds WHO confirmed each report and LATE
 * (the system finalized it). Juan's rulings 10-08: AM prep counts ONLY skipped items as issues
 * (under/over par is a neutral line); cash flags ANY over/short.
 */
export function composeShopLines(f: ShopDayFacts, language: Language, baseUrl: string, opts: { v2Layout?: boolean } = {}): DigestLine[] {
  const t: Tr = (key, params) => serverT(language, key, params);
  const loc = f.location.id;
  const lines: DigestLine[] = [];
  for (const type of SHOP_REPORT_FAMILIES) {
    if (type === "pm") {
      if (!opts.v2Layout) lines.push(pmLine(f, t, baseUrl));
      continue;
    }
    const label = t(`reports.type.${type}` as TranslationKey);
    const listHref = `${baseUrl}/reports/operations?${dayQuery(loc, f.day, { type })}`;
    const items = f.reports.filter((r) => r.type === type);
    const item = items.find(reportIsFinalized) ?? items[0];
    if (!item) {
      lines.push(type === "maintenance"
        ? { label, text: t("digest.line.none_logged"), tone: "info", href: listHref }
        : { label, text: t("digest.line.not_submitted"), tone: "issue", href: listHref });
      continue;
    }
    const itemHref = items.length === 1 ? `${baseUrl}/reports/${type}/${item.id}?${dayQuery(loc, f.day)}` : listHref;
    if (type !== "maintenance" && !reportIsFinalized(item)) {
      lines.push({ label, text: t("digest.line.not_finalized"), tone: "issue", href: itemHref });
      continue;
    }
    const who = opts.v2Layout && item.submitterName ? t("digest.v2.ops.by", { name: item.submitterName }) : null;
    const lateNote = opts.v2Layout && item.status === "auto_finalized" ? t("digest.v2.ops.auto_finalized") : null;
    // "All good" needs evidence: an item whose signals were never computed is not assessed.
    const assessed = items.every((r) => r.signalSummary !== undefined);
    const detail: string[] = [];
    const info: string[] = [];
    let n = 0;
    let filter: string | null = null;
    const sum = (k: "underPar" | "overPar" | "skipped" | "tempFlags") => items.reduce((acc, r) => acc + (r.signalSummary?.[k] ?? 0), 0);
    const add = (count: number, one: TranslationKey, other: TranslationKey, sf: string, asIssue = true) => {
      if (count <= 0) return;
      if (!asIssue) { info.push(plural(t, count, one, other)); return; }
      n += count; detail.push(plural(t, count, one, other)); filter ??= sf;
    };
    // AM prep (Juan 10-08): under/over par is information; only a SKIPPED item is an issue.
    const parIsIssue = type !== "am_prep";
    add(sum("underPar"), "digest.signal.under_par_one", "digest.signal.under_par_other", "sf_underPar", parIsIssue);
    add(sum("overPar"), "digest.signal.over_par_one", "digest.signal.over_par_other", "sf_overPar", parIsIssue);
    add(sum("skipped"), "digest.signal.skipped_one", "digest.signal.skipped_other", "sf_skipped");
    add(sum("tempFlags"), "digest.signal.temp_flags_one", "digest.signal.temp_flags_other", "sf_tempFlag");
    for (const r of items) {
      const cents = r.signalSummary?.cashOverShortCents ?? 0;
      if (cents === 0) continue;
      n += 1;
      detail.push(t(cents > 0 ? "digest.signal.cash_over" : "digest.signal.cash_short", { amount: formatCents(Math.abs(cents), language) }));
      filter ??= cents > 0 ? "sf_cashOver" : "sf_cashShort";
    }
    const tail = (text: string) => [lateNote, text, info.length > 0 ? info.join(", ") : null, who].filter((x): x is string => !!x).join(" · ");
    if (n === 0) {
      lines.push(!assessed ? { label, text: tail(t("digest.line.not_assessed")), tone: lateNote ? "issue" : "info", href: itemHref }
        : { label, text: tail(t("digest.line.all_good")), tone: lateNote ? "issue" : info.length > 0 ? "info" : "ok", href: itemHref });
    } else lines.push({
      label, text: tail(plural(t, n, "digest.line.issues_one", "digest.line.issues_other", { detail: detail.join(", ") })), tone: "issue",
      href: items.length === 1 ? itemHref : `${baseUrl}/reports/operations?${dayQuery(loc, f.day, { type, [filter ?? "sf_underPar"]: "true" })}`,
    });
  }

  const receivingHref = `${baseUrl}/operations/receiving?location=${encodeURIComponent(loc)}`;
  const rec = f.receiving;
  if (!opts.v2Layout) {
    const recIssues = [
      rec.discrepant > 0 ? plural(t, rec.discrepant, "digest.receiving.discrepant_one", "digest.receiving.discrepant_other") : null,
      rec.missingReceipt > 0 ? plural(t, rec.missingReceipt, "digest.receiving.no_receipt_one", "digest.receiving.no_receipt_other") : null,
    ].filter((x): x is string => x !== null);
    lines.push({
      label: t("digest.family.receiving"), href: receivingHref,
      ...(rec.deliveries === 0 ? { text: t("digest.receiving.none"), tone: "info" as const }
        : recIssues.length > 0 ? { text: recIssues.join(", "), tone: "issue" as const }
          : { text: plural(t, rec.deliveries, "digest.receiving.ok_one", "digest.receiving.ok_other"), tone: "ok" as const }),
    });
    lines.push({
      label: t("digest.family.tosses"), href: `${baseUrl}/operations/counts?location=${encodeURIComponent(loc)}`,
      ...(f.tosses > 0 ? { text: plural(t, f.tosses, "digest.tosses.some_one", "digest.tosses.some_other"), tone: "issue" as const } : { text: t("digest.tosses.none"), tone: "ok" as const }),
    });
    lines.push({
      label: t("digest.family.store_runs"), href: receivingHref,
      ...(f.storeRunsPending > 0 ? { text: plural(t, f.storeRunsPending, "digest.store_runs.some_one", "digest.store_runs.some_other"), tone: "issue" as const } : { text: t("digest.store_runs.none"), tone: "ok" as const }),
    });
  }

  // Three states (Astra P2): DONE only with evidence (a finalized report of that family, or a
  // recorded delivery for receiving); NOT DONE when the report that proves it is missing or open;
  // UNVERIFIED when nothing in the day's data can prove it either way (counts, ordering, a
  // receiving task on a day with no delivery). "All done" requires evidence for EVERY task.
  const done: TaskType[] = [];
  const notDone: TaskType[] = [];
  const unverified: TaskType[] = [];
  for (const task of f.tasks) {
    if (task === "receiving") { (rec.deliveries > 0 ? done : unverified).push(task); continue; }
    const type = TASK_REPORT[task];
    if (!type) { unverified.push(task); continue; }
    (f.reports.some((r) => r.type === type && reportIsFinalized(r)) ? done : notDone).push(task);
  }
  const names = (list: TaskType[]) => list.map((x) => t(`assignments.task.${x}` as TranslationKey)).join(", ");
  const parts = [
    notDone.length > 0 ? plural(t, notDone.length, "digest.tasks.not_done_one", "digest.tasks.not_done_other", { tasks: names(notDone) }) : null,
    unverified.length > 0 ? plural(t, unverified.length, "digest.tasks.unverified_one", "digest.tasks.unverified_other", { tasks: names(unverified) }) : null,
    done.length > 0 && (notDone.length > 0 || unverified.length > 0) ? plural(t, done.length, "digest.tasks.done_some_one", "digest.tasks.done_some_other") : null,
  ].filter((x): x is string => x !== null);
  lines.push({
    label: t("digest.family.tasks"), href: `${baseUrl}/reports?${dayQuery(loc, f.day)}`,
    ...(f.tasks.length === 0 ? { text: t("digest.tasks.none"), tone: "info" as const }
      : parts.length === 0 ? { text: plural(t, done.length, "digest.tasks.all_done_one", "digest.tasks.all_done_other"), tone: "ok" as const }
        : { text: parts.join("; "), tone: notDone.length > 0 ? "issue" as const : "info" as const }),
  });
  return lines;
}

export function countIssues(lines: readonly DigestLine[]): number {
  return lines.filter((l) => l.tone === "issue").length;
}

export interface Envelope {
  language: Language;
  baseUrl: string;
  /** Set in preview mode: who this digest was composed for. */
  previewFor?: { name: string; email: string | null } | null;
}

/**
 * One shop's sections: the v2 management layout when its facts carry v2, else the v1 single
 * section. `prefix` puts the shop name in front of every v2 title (the unified digest).
 */
export function composeShopSections(f: ShopDayFacts, language: Language, baseUrl: string, prefix: boolean): DigestSection[] {
  if (!f.v2) return [{ title: f.location.name, lines: composeShopLines(f, language, baseUrl) }];
  const t: Tr = (key, params) => serverT(language, key, params);
  const reportHref = (type: ReportTypeKey) => {
    const items = f.reports.filter((r) => r.type === type);
    const item = items.find(reportIsFinalized) ?? items[0];
    return items.length === 1 && item ? `${baseUrl}/reports/${type}/${item.id}?${dayQuery(f.location.id, f.day)}`
      : `${baseUrl}/reports/operations?${dayQuery(f.location.id, f.day, { type })}`;
  };
  const finalizedBy = (type: ReportTypeKey) => f.reports.find((r) => r.type === type && reportIsFinalized(r))?.submitterName ?? null;
  return composeV2Sections({
    shopName: f.location.name, locationId: f.location.id, day: f.day, v: f.v2, prefix,
    extras: {
      operations: composeShopLines(f, language, baseUrl, { v2Layout: true }),
      pmLine: pmLine(f, t, baseUrl),
      pendingItems: f.storeRunsPending,
      who: { openedBy: finalizedBy("opening"), closedBy: finalizedBy("closing"), openingHref: reportHref("opening"), closingHref: reportHref("closing") },
    },
  }, language, baseUrl);
}

function issueCount(sections: readonly DigestSection[]): number {
  return sections.reduce((n, s) => n + countIssues(s.lines), 0);
}

export function renderShopDigest(f: ShopDayFacts, env: Envelope): ComposedEmail {
  const t: Tr = (key, params) => serverT(env.language, key, params);
  const sections = composeShopSections(f, env.language, env.baseUrl, false);
  const date = formatDateLabel(f.day, env.language);
  const issues = issueCount(sections);
  return renderDigest(env, {
    subject: t("digest.shop.subject", { shop: f.location.name, date }),
    heading: t("digest.shop.heading", { shop: f.location.name, date }),
    preheader: issues === 0 ? t("digest.shop.preheader_ok", { shop: f.location.name }) : plural(t, issues, "digest.shop.preheader_issues_one", "digest.shop.preheader_issues_other"),
    intro: [],
    sections,
    cta: { label: t("digest.cta.open_reports"), url: `${env.baseUrl}/reports?${dayQuery(f.location.id, f.day)}` },
  });
}

export function renderUnifiedDigest(args: {
  day: string; shops: ShopDayFacts[]; notFinalized: Array<{ id: string; name: string }>;
}, env: Envelope): ComposedEmail {
  const t: Tr = (key, params) => serverT(env.language, key, params);
  const date = formatDateLabel(args.day, env.language);
  const v2 = args.shops.some((f) => f.v2);
  const sections = [
    ...(v2 ? [allShopsSection(args.shops, env.language, env.baseUrl)] : []),
    ...args.shops.flatMap((f) => composeShopSections(f, env.language, env.baseUrl, true)),
  ];
  const issues = issueCount(sections);
  // Polish item 1: the label is said ONCE ("Closing not finalized: Capitol Hill, P Street").
  const intro: DigestLine[] = [args.notFinalized.length === 0
    ? { label: t("reports.type.closing"), text: t("digest.unified.all_finalized"), tone: "ok", href: `${env.baseUrl}/reports` }
    : { label: t("digest.unified.not_finalized_label"), text: args.notFinalized.map((s) => s.name).join(", "), tone: "issue", href: `${env.baseUrl}/reports?${dayQuery("all", args.day)}` }];
  const total = issues + (args.notFinalized.length > 0 ? 1 : 0);
  return renderDigest(env, {
    subject: t("digest.unified.subject", { date }),
    heading: t("digest.unified.heading", { date }),
    preheader: total === 0 ? t("digest.unified.preheader_ok") : plural(t, total, "digest.shop.preheader_issues_one", "digest.shop.preheader_issues_other"),
    intro, sections,
    cta: { label: t("digest.cta.open_reports"), url: `${env.baseUrl}/reports?${dayQuery("all", args.day)}` },
  });
}

// ── Catering ────────────────────────────────────────────────────────────────────────────────

export interface CateringLeadFact {
  id: string; contactName: string; company: string | null;
  eventDate: string | null; timeWindow: string | null; headcount: number | null;
  stage: string; leadSource: string | null; locationId: string | null;
  /** ET calendar day the lead was created. */
  createdDay: string;
  followUpDate: string | null; externalRef: string | null;
  /** Delivery address set, or the accepted quote says delivery. */
  isDelivery: boolean;
  /** 0195 rule: the live accepted quote's total, else estimated_revenue_cents, else 0. */
  valueCents: number;
  /** Sum of catering_payments due on the live accepted quote. */
  dueCents: number;
  /** The W4a prep-demand ledger for the event (reserved|consumed), aggregated per need date + ref +
   *  portion with quantities and units; null = no ledger rows. */
  prep: PrepLoadLine[] | null;
}
export interface PrepLoadLine {
  needDate: string;
  name: string;
  nameEs: string | null;
  qty: number;
  /** The item's par unit for an item ref (e.g. "qt"); null for a sub or a choice slot. */
  unit: string | null;
  portion: "quarter" | "half" | "whole" | null;
}

export interface CateringFacts {
  today: string;
  leads: CateringLeadFact[];
  /** Leads moved to lost during yesterday (ET), from catering_pipeline_events. */
  lostYesterdayIds: string[];
  quotesSentYesterday: Array<{ id: string; locationId: string; totalCents: number }>;
  /** status sent, live, not expired. */
  openQuotes: Array<{ id: string; locationId: string }>;
  refundsYesterday: Array<{ locationId: string | null; amountCents: number }>;
}

const UPCOMING = new Set(["confirmed", "out"]);
const RAN = new Set(["confirmed", "out", "completed"]);
const OPEN = new Set(["inquiry", "quote_sent"]);
/** Orders a platform took and paid for (the scan / webhook tributaries). */
const PLATFORM = new Set(["ezcater", "toast_catering"]);

/**
 * Polish item 9: a platform order (ezCater / Toast catering, paid on the platform) whose date has
 * passed is moved to `completed` by the nightly rollover (completeElapsedCateringEvents, which
 * selects by stage, so scanned leads are covered). Until that run, the digest does not call it a
 * problem: money still splits by the REAL stage (0195), only the tone stops crying wolf.
 */
export function awaitingAutoComplete(l: Pick<CateringLeadFact, "leadSource" | "stage">): boolean {
  return !!l.leadSource && PLATFORM.has(l.leadSource) && UPCOMING.has(l.stage);
}

/**
 * Polish item 6: machine placeholder names never reach a manager as a name. "EZCater order
 * VPCTM5" → "ezCater #VPCTM5"; "Toast order <guid>" → "Toast order". A real name stays.
 */
export function cateringDisplayName(l: Pick<CateringLeadFact, "contactName" | "company" | "leadSource">): string {
  const ez = /^ezcater order\s+(\S+)$/i.exec(l.contactName.trim());
  const base = ez ? `ezCater #${ez[1]}`
    : /^toast order\s+\S+$/i.test(l.contactName.trim()) ? "Toast order"
      : l.contactName;
  return l.company ? `${base} (${l.company})` : base;
}

/** The order code a manager can find on the platform (polish item 4): never a raw UUID. */
export function cateringOrderCode(l: Pick<CateringLeadFact, "contactName" | "leadSource">): string | null {
  const ez = /^ezcater order\s+(\S+)$/i.exec(l.contactName.trim());
  return ez ? `#${ez[1]}` : null;
}

export interface CateringShopSummary {
  locationId: string | null;
  ran: number; guests: number | null; completedCents: number; confirmedCents: number;
  today: number; tomorrow: number;
}

/** The numbers (no strings) — what the tests pin for the summary and outlook math. */
export function summarizeCateringShop(f: CateringFacts, locationId: string | null): CateringShopSummary {
  const yesterday = addDay(f.today, -1);
  const tomorrow = addDay(f.today, 1);
  const leads = f.leads.filter((l) => l.locationId === locationId);
  const ran = leads.filter((l) => l.eventDate === yesterday && RAN.has(l.stage));
  const heads = ran.map((l) => l.headcount).filter((h): h is number => h !== null);
  return {
    locationId,
    ran: ran.length,
    guests: heads.length > 0 ? heads.reduce((a, b) => a + b, 0) : null,
    completedCents: ran.filter((l) => l.stage === "completed").reduce((a, l) => a + l.valueCents, 0),
    confirmedCents: ran.filter((l) => UPCOMING.has(l.stage)).reduce((a, l) => a + l.valueCents, 0),
    today: leads.filter((l) => l.eventDate === f.today && UPCOMING.has(l.stage)).length,
    tomorrow: leads.filter((l) => l.eventDate === tomorrow && UPCOMING.has(l.stage)).length,
  };
}

function addDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

export function composeCateringSections(
  f: CateringFacts,
  scope: { locations: Array<{ id: string; name: string }>; includeUnassigned: boolean },
  language: Language,
  baseUrl: string,
): DigestSection[] {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  const money = (c: number) => formatCents(c, language);
  const yesterday = addDay(f.today, -1);
  const tomorrow = addDay(f.today, 1);
  const pipeline = `${baseUrl}/catering/pipeline`;
  const leadHref = (l: CateringLeadFact) => `${pipeline}?q=${encodeURIComponent(l.contactName)}`;
  const quotesHref = `${baseUrl}/catering/quotes`;
  const who = (l: CateringLeadFact) => cateringDisplayName(l);
  const size = (l: CateringLeadFact) => l.headcount !== null ? plural(t, l.headcount, "digest.catering.size_one", "digest.catering.size_other") : t("digest.catering.size_unknown");
  // Polish item 3: one clock format for Toast "16:00", ezCater labels and ISO instants.
  const time = (l: CateringLeadFact) => timeWindowLabel(l.timeWindow?.trim() || null, language) ?? t("digest.catering.time_unknown");
  const source = (s: string | null) => t(`catering.intake.source.${s && (LEAD_SOURCES as readonly string[]).includes(s) ? s : "other"}` as TranslationKey);

  const shops: Array<{ id: string | null; name: string }> = [
    ...scope.locations,
    ...(scope.includeUnassigned && f.leads.some((l) => l.locationId === null) ? [{ id: null, name: t("digest.catering.no_shop") }] : []),
  ];
  const sections: DigestSection[] = [];
  for (const shop of shops) {
    const leads = f.leads.filter((l) => l.locationId === shop.id);
    const s = summarizeCateringShop(f, shop.id);
    const y: DigestLine[] = [];
    const ran = leads.filter((l) => l.eventDate === yesterday && RAN.has(l.stage))
      .sort((a, b) => timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow));
    if (ran.length === 0) y.push({ label: t("digest.catering.yesterday_label"), text: t("digest.catering.none_yesterday"), tone: "info", href: pipeline });
    else {
      const problem = ran.some((l) => l.stage !== "completed" && !awaitingAutoComplete(l));
      y.push({
        label: t("digest.catering.yesterday_label"), tone: problem ? "issue" : "ok", href: pipeline,
        text: plural(t, s.ran, "digest.catering.ran_summary_one", "digest.catering.ran_summary_other", {
          guests: s.guests === null ? "—" : s.guests, completed: money(s.completedCents), confirmed: money(s.confirmedCents),
        }),
      });
      for (const l of ran) {
        const status = l.stage === "completed" ? "digest.catering.fulfilled" : awaitingAutoComplete(l) ? "digest.catering.auto_completes" : "digest.catering.not_completed";
        y.push({
          label: who(l), href: leadHref(l), tone: l.stage === "completed" ? "ok" : awaitingAutoComplete(l) ? "info" : "issue",
          text: `${time(l)} · ${size(l)} · ${money(l.valueCents)} · ${t(status)}`,
        });
      }
    }
    for (const l of leads.filter((x) => f.lostYesterdayIds.includes(x.id))) {
      y.push({ label: who(l), text: t("digest.catering.lost"), tone: "issue", href: leadHref(l) });
    }
    const created = leads.filter((l) => l.createdDay === yesterday);
    if (created.length === 0) y.push({ label: t("digest.catering.inquiries_label"), text: t("digest.catering.no_new_inquiries"), tone: "info", href: pipeline });
    else {
      const bySource = new Map<string, number>();
      for (const l of created) bySource.set(source(l.leadSource), (bySource.get(source(l.leadSource)) ?? 0) + 1);
      y.push({
        label: t("digest.catering.inquiries_label"), tone: "info", href: pipeline,
        text: plural(t, created.length, "digest.catering.new_inquiries_one", "digest.catering.new_inquiries_other", { sources: [...bySource].map(([k, v]) => `${k} ${v}`).join(", ") }),
      });
    }
    const quotes = f.quotesSentYesterday.filter((q) => q.locationId === shop.id);
    if (quotes.length > 0) y.push({
      label: t("digest.catering.quotes_label"), tone: "info", href: quotesHref,
      text: plural(t, quotes.length, "digest.catering.quotes_sent_one", "digest.catering.quotes_sent_other", { money: money(quotes.reduce((a, q) => a + q.totalCents, 0)) }),
    });
    // Polish item 4: the order code + customer, never "toast:<uuid>"; an order already listed
    // under "ran" is not repeated here.
    const ranIds = new Set(ran.map((l) => l.id));
    for (const l of leads.filter((x) => x.leadSource && PLATFORM.has(x.leadSource) && !ranIds.has(x.id) && (x.createdDay === yesterday || x.eventDate === yesterday))) {
      const code = cateringOrderCode(l);
      y.push({ label: source(l.leadSource), tone: "info", href: leadHref(l), text: code ? t("digest.catering.scan_order", { ref: code, contact: who(l) }) : t("digest.catering.scan_order_nocode", { contact: who(l) }) });
    }
    const refunds = f.refundsYesterday.filter((r) => r.locationId === shop.id);
    if (refunds.length > 0) y.push({
      label: t("digest.catering.issues_label"), tone: "issue", href: pipeline,
      text: plural(t, refunds.length, "digest.catering.refunds_one", "digest.catering.refunds_other", { money: money(refunds.reduce((a, r) => a + r.amountCents, 0)) }),
    });
    const overdue = leads.filter((l) => OPEN.has(l.stage) && l.followUpDate !== null && l.followUpDate < f.today);
    if (overdue.length > 0) y.push({ label: t("digest.catering.issues_label"), tone: "issue", href: pipeline, text: plural(t, overdue.length, "digest.catering.overdue_followups_one", "digest.catering.overdue_followups_other") });

    const qty = (n: number) => new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 }).format(n);
    /** The prep ledger for one order, or null when it has none (said ONCE per list — item 5). */
    const prepText = (l: CateringLeadFact): string | null => {
      if (l.prep === null || l.prep.length === 0) return null;
      const byDate = new Map<string, PrepLoadLine[]>();
      for (const p of l.prep) byDate.set(p.needDate, [...(byDate.get(p.needDate) ?? []), p]);
      return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
        const shown = list.slice(0, 6).map((p) => {
          const name = language === "es" && p.nameEs ? p.nameEs : p.name;
          if (p.portion) return `${qty(p.qty)} × ${name} (${t(`digest.catering.portion.${p.portion}` as TranslationKey)})`;
          return p.unit ? `${qty(p.qty)} ${p.unit} ${name}` : `${qty(p.qty)} × ${name}`;
        });
        if (list.length > 6) shown.push(t("digest.catering.prep_more", { n: list.length - 6 }));
        return t("digest.catering.prep_load", { date: formatDateLabel(date, language), items: shown.join(", ") });
      }).join(" · ");
    };
    const outlook = (day: string, emptyKey: TranslationKey, label: TranslationKey): DigestLine[] => {
      const list = leads.filter((l) => l.eventDate === day && UPCOMING.has(l.stage))
        .sort((a, b) => timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow));
      if (list.length === 0) return [{ label: t(label), text: t(emptyKey), tone: "info", href: pipeline }];
      const out: DigestLine[] = list.map((l) => ({
        label: who(l), href: leadHref(l), tone: "info" as const,
        text: [time(l), size(l), t(l.isDelivery ? "digest.catering.delivery" : "digest.catering.pickup"), prepText(l)].filter((x): x is string => !!x).join(" · "),
      }));
      const noPrep = list.filter((l) => prepText(l) === null).length;
      if (noPrep > 0) out.push({ label: t(label), href: pipeline, tone: "info", text: plural(t, noPrep, "digest.catering.no_prep_footnote_one", "digest.catering.no_prep_footnote_other") });
      return out;
    };

    const action: DigestLine[] = [];
    for (const l of leads.filter((x) => OPEN.has(x.stage) && x.eventDate !== null && x.eventDate >= f.today && x.eventDate <= tomorrow)) {
      action.push({ label: who(l), tone: "issue", href: leadHref(l), text: t("digest.catering.unconfirmed", { date: formatDateLabel(l.eventDate!, language) }) });
    }
    for (const l of leads.filter((x) => UPCOMING.has(x.stage) && x.dueCents > 0 && x.eventDate !== null && x.eventDate >= yesterday && x.eventDate <= tomorrow)) {
      action.push({ label: who(l), tone: "issue", href: leadHref(l), text: t("digest.catering.unpaid", { money: money(l.dueCents), date: formatDateLabel(l.eventDate!, language) }) });
    }
    const open = f.openQuotes.filter((q) => q.locationId === shop.id).length;
    if (open > 0) action.push({ label: t("digest.catering.quotes_label"), tone: "info", href: quotesHref, text: plural(t, open, "digest.catering.awaiting_customer_one", "digest.catering.awaiting_customer_other") });
    if (action.length === 0) action.push({ label: t("digest.catering.needs_action"), text: t("digest.catering.none_action"), tone: "ok", href: pipeline });

    sections.push(
      { title: `${shop.name} · ${t("digest.catering.yesterday", { date: formatDateLabel(yesterday, language) })}`, lines: y },
      { title: `${shop.name} · ${t("digest.catering.today", { date: formatDateLabel(f.today, language) })}`, lines: outlook(f.today, "digest.catering.none_today", "digest.catering.today_label") },
      { title: `${shop.name} · ${t("digest.catering.tomorrow", { date: formatDateLabel(tomorrow, language) })}`, lines: outlook(tomorrow, "digest.catering.none_tomorrow", "digest.catering.tomorrow_label") },
      { title: `${shop.name} · ${t("digest.catering.needs_action")}`, lines: action },
    );
  }
  return sections;
}

export function renderCateringDigest(
  f: CateringFacts,
  scope: { locations: Array<{ id: string; name: string }>; includeUnassigned: boolean },
  env: Envelope,
): ComposedEmail {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(env.language, key, params);
  const sections = composeCateringSections(f, scope, env.language, env.baseUrl);
  const ids: Array<string | null> = [...scope.locations.map((l) => l.id), ...(scope.includeUnassigned ? [null] : [])];
  const sums = ids.map((id) => summarizeCateringShop(f, id));
  const date = formatDateLabel(f.today, env.language);
  return renderDigest(env, {
    subject: t("digest.catering.subject", { date, yesterday: sums.reduce((a, s) => a + s.ran, 0), today: sums.reduce((a, s) => a + s.today, 0) }),
    heading: t("digest.catering.heading", { date }),
    preheader: t("digest.catering.preheader"),
    intro: [], sections,
    cta: { label: t("digest.cta.open_pipeline"), url: `${env.baseUrl}/catering/pipeline` },
  });
}

// ── Email shell ─────────────────────────────────────────────────────────────────────────────

const TONE = {
  ok: { mark: "✓", color: "#14532D" },
  issue: { mark: "!", color: "#B42318" },
  info: { mark: "•", color: "#5B5B5B" },
} as const;

function renderDigest(env: Envelope, d: {
  subject: string; heading: string; preheader: string; intro: DigestLine[]; sections: DigestSection[];
  cta: { label: string; url: string };
}): ComposedEmail {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(env.language, key, params);
  const preview = env.previewFor ? t("digest.preview_banner", { name: env.previewFor.name, email: env.previewFor.email ?? "—" }) : null;
  const row = (l: DigestLine) =>
    `<tr><td style="width:20px;vertical-align:top;font-weight:700;color:${TONE[l.tone].color};">${TONE[l.tone].mark}</td>` +
    `<td style="padding:0 0 8px;"><a href="${escapeHtml(l.href)}" style="color:#141414;font-weight:700;">${escapeHtml(l.label)}</a>: ${escapeHtml(l.text)}</td></tr>`;
  const table = (lines: DigestLine[]) => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${lines.map(row).join("")}</table>`;
  const bodyHtml = [
    preview ? `<p style="margin:0 0 16px;padding:8px 12px;background:#FFF3D4;font-weight:700;">${escapeHtml(preview)}</p>` : "",
    d.intro.length > 0 ? table(d.intro) : "",
    ...d.sections.map((s) => `<h2 style="margin:20px 0 8px;font-size:17px;">${escapeHtml(s.title)}</h2>${table(s.lines)}`),
  ].join("");
  const textLine = (l: DigestLine) => `${TONE[l.tone].mark} ${l.label}: ${l.text}\n  ${l.href}`;
  const text = [
    ...(preview ? [preview, ""] : []),
    d.heading, "",
    ...d.intro.map(textLine),
    ...d.sections.flatMap((s) => ["", s.title, ...s.lines.map(textLine)]),
    "", `${d.cta.label}: ${d.cta.url}`, "", t("digest.footer", { tenant: TENANT_NAME }),
  ].join("\n");
  const html = renderEmailLayout({
    preheader: d.preheader, heading: d.heading, bodyHtml,
    cta: { label: d.cta.label, url: escapeHtml(d.cta.url) },
    footerNote: t("digest.footer", { tenant: TENANT_NAME }),
  });
  return { subject: preview ? `${t("digest.preview_subject_prefix")} ${d.subject}` : d.subject, html, text };
}
