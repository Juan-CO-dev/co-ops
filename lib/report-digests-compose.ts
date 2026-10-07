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

export function composeShopLines(f: ShopDayFacts, language: Language, baseUrl: string): DigestLine[] {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  const loc = f.location.id;
  const lines: DigestLine[] = [];
  for (const type of SHOP_REPORT_FAMILIES) {
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
    const detail: string[] = [];
    let n = 0;
    let filter: string | null = null;
    const sum = (k: "underPar" | "overPar" | "skipped" | "tempFlags") => items.reduce((acc, r) => acc + (r.signalSummary?.[k] ?? 0), 0);
    const add = (count: number, key: TranslationKey, sf: string) => {
      if (count <= 0) return;
      n += count; detail.push(t(key, { n: count })); filter ??= sf;
    };
    add(sum("underPar"), "digest.signal.under_par", "sf_underPar");
    add(sum("overPar"), "digest.signal.over_par", "sf_overPar");
    add(sum("skipped"), "digest.signal.skipped", "sf_skipped");
    add(sum("tempFlags"), "digest.signal.temp_flags", "sf_tempFlag");
    for (const r of items) {
      const cents = r.signalSummary?.cashOverShortCents ?? 0;
      if (cents === 0) continue;
      n += 1;
      detail.push(t(cents > 0 ? "digest.signal.cash_over" : "digest.signal.cash_short", { amount: formatCents(Math.abs(cents), language) }));
      filter ??= cents > 0 ? "sf_cashOver" : "sf_cashShort";
    }
    if (n === 0) lines.push({ label, text: t("digest.line.all_good"), tone: "ok", href: itemHref });
    else lines.push({
      label, text: t("digest.line.issues", { n, detail: detail.join(", ") }), tone: "issue",
      href: items.length === 1 ? itemHref : `${baseUrl}/reports/operations?${dayQuery(loc, f.day, { type, [filter ?? "sf_underPar"]: "true" })}`,
    });
  }

  const receivingHref = `${baseUrl}/operations/receiving?location=${encodeURIComponent(loc)}`;
  const rec = f.receiving;
  const recIssues = [
    rec.discrepant > 0 ? t("digest.receiving.discrepant", { n: rec.discrepant }) : null,
    rec.missingReceipt > 0 ? t("digest.receiving.no_receipt", { n: rec.missingReceipt }) : null,
  ].filter((x): x is string => x !== null);
  lines.push({
    label: t("digest.family.receiving"), href: receivingHref,
    ...(rec.deliveries === 0 ? { text: t("digest.receiving.none"), tone: "info" as const }
      : recIssues.length > 0 ? { text: recIssues.join(", "), tone: "issue" as const }
        : { text: t("digest.receiving.ok", { n: rec.deliveries }), tone: "ok" as const }),
  });

  lines.push({
    label: t("digest.family.tosses"), href: `${baseUrl}/operations/counts?location=${encodeURIComponent(loc)}`,
    ...(f.tosses > 0 ? { text: t("digest.tosses.some", { n: f.tosses }), tone: "issue" as const } : { text: t("digest.tosses.none"), tone: "ok" as const }),
  });
  lines.push({
    label: t("digest.family.store_runs"), href: receivingHref,
    ...(f.storeRunsPending > 0 ? { text: t("digest.store_runs.some", { n: f.storeRunsPending }), tone: "issue" as const } : { text: t("digest.store_runs.none"), tone: "ok" as const }),
  });

  const notDone = f.tasks.filter((task) => {
    if (task === "receiving") return rec.deliveries === 0;
    const type = TASK_REPORT[task];
    if (!type) return false; // counts / ordering leave no report to prove them — never guessed
    return !f.reports.some((r) => r.type === type && reportIsFinalized(r));
  });
  lines.push({
    label: t("digest.family.tasks"), href: `${baseUrl}/reports?${dayQuery(loc, f.day)}`,
    ...(f.tasks.length === 0 ? { text: t("digest.tasks.none"), tone: "info" as const }
      : notDone.length === 0 ? { text: t("digest.tasks.all_done", { n: f.tasks.length }), tone: "ok" as const }
        : { text: t("digest.tasks.not_done", { n: notDone.length, tasks: notDone.map((x) => t(`assignments.task.${x}` as TranslationKey)).join(", ") }), tone: "issue" as const }),
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

export function renderShopDigest(f: ShopDayFacts, env: Envelope): ComposedEmail {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(env.language, key, params);
  const lines = composeShopLines(f, env.language, env.baseUrl);
  const date = formatDateLabel(f.day, env.language);
  const issues = countIssues(lines);
  return renderDigest(env, {
    subject: t("digest.shop.subject", { shop: f.location.name, date }),
    heading: t("digest.shop.heading", { shop: f.location.name, date }),
    preheader: issues === 0 ? t("digest.shop.preheader_ok", { shop: f.location.name }) : t("digest.shop.preheader_issues", { n: issues }),
    intro: [],
    sections: [{ title: f.location.name, lines }],
    cta: { label: t("digest.cta.open_reports"), url: `${env.baseUrl}/reports?${dayQuery(f.location.id, f.day)}` },
  });
}

export function renderUnifiedDigest(args: {
  day: string; shops: ShopDayFacts[]; notFinalized: Array<{ id: string; name: string }>;
}, env: Envelope): ComposedEmail {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(env.language, key, params);
  const date = formatDateLabel(args.day, env.language);
  const sections = args.shops.map((f) => ({ title: f.location.name, lines: composeShopLines(f, env.language, env.baseUrl) }));
  const issues = sections.reduce((n, s) => n + countIssues(s.lines), 0);
  const intro: DigestLine[] = [args.notFinalized.length === 0
    ? { label: t("reports.type.closing"), text: t("digest.unified.all_finalized"), tone: "ok", href: `${env.baseUrl}/reports` }
    : { label: t("reports.type.closing"), text: t("digest.unified.not_finalized", { shops: args.notFinalized.map((s) => s.name).join(", ") }), tone: "issue", href: `${env.baseUrl}/reports?${dayQuery("all", args.day)}` }];
  return renderDigest(env, {
    subject: t("digest.unified.subject", { date }),
    heading: t("digest.unified.heading", { date }),
    preheader: issues + (args.notFinalized.length > 0 ? 1 : 0) === 0 ? t("digest.unified.preheader_ok") : t("digest.shop.preheader_issues", { n: issues }),
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
  /** Prep-demand ledger lines (reserved|consumed) for the event; null = no ledger rows. */
  prepLines: number | null;
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
  const who = (l: CateringLeadFact) => l.company ? `${l.contactName} (${l.company})` : l.contactName;
  const size = (l: CateringLeadFact) => l.headcount !== null ? t("digest.catering.size", { n: l.headcount }) : t("digest.catering.size_unknown");
  const time = (l: CateringLeadFact) => l.timeWindow?.trim() || t("digest.catering.time_unknown");
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
    const ran = leads.filter((l) => l.eventDate === yesterday && RAN.has(l.stage));
    if (ran.length === 0) y.push({ label: t("digest.catering.yesterday_label"), text: t("digest.catering.none_yesterday"), tone: "info", href: pipeline });
    else {
      y.push({
        label: t("digest.catering.yesterday_label"), tone: s.confirmedCents > 0 || ran.some((l) => l.stage !== "completed") ? "issue" : "ok", href: pipeline,
        text: t("digest.catering.ran_summary", {
          n: s.ran, guests: s.guests === null ? "—" : s.guests, completed: money(s.completedCents), confirmed: money(s.confirmedCents),
        }),
      });
      for (const l of ran) y.push({
        label: who(l), href: leadHref(l), tone: l.stage === "completed" ? "ok" : "issue",
        text: `${time(l)} · ${size(l)} · ${money(l.valueCents)} · ${t(l.stage === "completed" ? "digest.catering.fulfilled" : "digest.catering.not_completed")}`,
      });
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
        text: t("digest.catering.new_inquiries", { n: created.length, sources: [...bySource].map(([k, v]) => `${k} ${v}`).join(", ") }),
      });
    }
    const quotes = f.quotesSentYesterday.filter((q) => q.locationId === shop.id);
    if (quotes.length > 0) y.push({
      label: t("digest.catering.quotes_label"), tone: "info", href: quotesHref,
      text: t("digest.catering.quotes_sent", { n: quotes.length, money: money(quotes.reduce((a, q) => a + q.totalCents, 0)) }),
    });
    for (const l of leads.filter((x) => (x.leadSource === "ezcater" || x.leadSource === "toast_catering") && (x.createdDay === yesterday || x.eventDate === yesterday))) {
      y.push({ label: source(l.leadSource), tone: "info", href: leadHref(l), text: t("digest.catering.scan_order", { ref: l.externalRef ?? "—", contact: who(l) }) });
    }
    const refunds = f.refundsYesterday.filter((r) => r.locationId === shop.id);
    if (refunds.length > 0) y.push({
      label: t("digest.catering.issues_label"), tone: "issue", href: pipeline,
      text: t("digest.catering.refunds", { n: refunds.length, money: money(refunds.reduce((a, r) => a + r.amountCents, 0)) }),
    });
    const overdue = leads.filter((l) => OPEN.has(l.stage) && l.followUpDate !== null && l.followUpDate < f.today);
    if (overdue.length > 0) y.push({ label: t("digest.catering.issues_label"), tone: "issue", href: pipeline, text: t("digest.catering.overdue_followups", { n: overdue.length }) });

    const outlook = (day: string, emptyKey: TranslationKey, label: TranslationKey): DigestLine[] => {
      const list = leads.filter((l) => l.eventDate === day && UPCOMING.has(l.stage))
        .sort((a, b) => (a.timeWindow ?? "").localeCompare(b.timeWindow ?? ""));
      if (list.length === 0) return [{ label: t(label), text: t(emptyKey), tone: "info", href: pipeline }];
      return list.map((l) => ({
        label: who(l), href: leadHref(l), tone: "info" as const,
        text: `${time(l)} · ${size(l)} · ${t(l.isDelivery ? "digest.catering.delivery" : "digest.catering.pickup")} · ${l.prepLines !== null ? t("digest.catering.prep_lines", { n: l.prepLines }) : t("digest.catering.no_prep")}`,
      }));
    };

    const action: DigestLine[] = [];
    for (const l of leads.filter((x) => OPEN.has(x.stage) && x.eventDate !== null && x.eventDate >= f.today && x.eventDate <= tomorrow)) {
      action.push({ label: who(l), tone: "issue", href: leadHref(l), text: t("digest.catering.unconfirmed", { date: formatDateLabel(l.eventDate!, language) }) });
    }
    for (const l of leads.filter((x) => UPCOMING.has(x.stage) && x.dueCents > 0 && x.eventDate !== null && x.eventDate >= yesterday && x.eventDate <= tomorrow)) {
      action.push({ label: who(l), tone: "issue", href: leadHref(l), text: t("digest.catering.unpaid", { money: money(l.dueCents), date: formatDateLabel(l.eventDate!, language) }) });
    }
    const open = f.openQuotes.filter((q) => q.locationId === shop.id).length;
    if (open > 0) action.push({ label: t("digest.catering.quotes_label"), tone: "info", href: quotesHref, text: t("digest.catering.awaiting_customer", { n: open }) });
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
