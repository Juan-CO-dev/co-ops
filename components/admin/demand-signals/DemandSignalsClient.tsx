"use client";
/**
 * The demand signals page (item 4 PR 5). Disclosure doctrine: the notice and every day's identity line (date,
 * weather or the reason there is none, the event count) are always visible; a day opens a drawer; the event
 * list is the page's work and is open; the feeds and the "tested adjustments" notes are secondary and collapsed.
 * Add / correct forms are TRIGGERED, never pre-rendered. useState only.
 *
 * This page shows NAMES, never a number about demand: an unknown is a sentence ("no forecast yet", "the source
 * is not verified"), never 0, and a list is "none" only when its read finished whole (the loader says so).
 * Text that came from a source (an alert's title, a forecast's condition) is shown as the source wrote it.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postJson } from "@/components/admin/vendors/shared";
import { WeatherSummary } from "@/components/admin/demand-signals/WeatherSummary";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  DEMAND_EVENT_CATEGORIES, DEMAND_EVENT_IMPACTS, DEMAND_EVENT_MAX_SPAN_DAYS, DEMAND_EVENT_TITLE_MAX, parseDemandEvent,
} from "@/lib/demand-signals/input-shared";
import { insightSentenceKey } from "@/lib/demand-signals/contracts-shared";
import type { InsightsView } from "@/lib/demand-signals/insights";
import type { InsightFact } from "@/lib/demand-signals/insights-shared";
import type { AdapterHealth, SignalsEvent, SignalsPageData } from "@/lib/demand-signals/signals-page";
import type { SignalsDay } from "@/lib/demand-signals/signals-view-shared";
import { rainLineOf, weatherIsOld } from "@/lib/demand-signals/weather-line-shared";
import { formatCents, formatClockTimeShort, formatDateLabel, formatDateLabelWithYear, formatTime, formatWeekday } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { etDisplayDate } from "@/lib/operational-day";

type OkData = Extract<SignalsPageData, { state: "ok" }>;
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const quiet = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text disabled:opacity-60";
const control = "min-h-[44px] items-center min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-text-muted";
const WARN_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";

const EVENT_ERRORS = ["demand_event_forbidden", "demand_event_shop_forbidden", "demand_event_invalid", "demand_event_moved", "demand_signals_off", "demand_signals_unavailable"];
const eventErrorKey = (code: string): TranslationKey => (EVENT_ERRORS.includes(code) ? `signals.event.error.${code}` : "signals.event.error.generic") as TranslationKey;
const known = <V extends string>(list: ReadonlyArray<V>, v: string): v is V => (list as ReadonlyArray<string>).includes(v);
const categoryLabel = (t: T, c: string) => t((known(DEMAND_EVENT_CATEGORIES, c) ? `signals.category.${c}` : "signals.category.other") as TranslationKey);
const impactLabel = (t: T, i: string) => t((known(DEMAND_EVENT_IMPACTS, i) ? `signals.impact.${i}` : "signals.impact.unknown") as TranslationKey);
const dateTime = (iso: string, language: Language) => `${formatDateLabel(etDisplayDate(iso), language)}, ${formatTime(iso, language)}`;

function eventWhen(t: T, e: SignalsEvent, language: Language): string {
  const day = e.validFrom === e.validTo ? formatDateLabelWithYear(e.validFrom, language)
    : t("signals.event.range", { from: formatDateLabelWithYear(e.validFrom, language), to: formatDateLabelWithYear(e.validTo, language) });
  if (e.startLocal && e.endLocal) return t("signals.event.when_between", { day, from: formatClockTimeShort(e.startLocal, language), to: formatClockTimeShort(e.endLocal, language) });
  if (e.startLocal) return t("signals.event.when_from", { day, from: formatClockTimeShort(e.startLocal, language) });
  return day;
}

export function DemandSignalsClient({ data, insights = null }: { data: OkData; insights?: InsightsView | null }) {
  const { t, language } = useTranslation();
  const [adding, setAdding] = useState(false);
  const byId = new Map((data.events ?? []).map((e) => [e.id, e]));
  return <div className="space-y-4">
    <p className="rounded-lg bg-co-surface-inset p-3 text-sm text-co-text">{t("signals.notice")}</p>

    <CollapsibleSection idBase="signals-days" title={t("signals.days.title")} count={t("signals.days.count", { n: data.days.length })} defaultOpen>
      <ul className="space-y-2">{data.days.map((day) => <li key={day.date}><DayRow day={day} events={byId} today={data.today} feeds={data.weatherFeeds} /></li>)}</ul>
    </CollapsibleSection>

    <CollapsibleSection idBase="signals-events" title={t("signals.events.title")} defaultOpen
      count={data.events === null ? null : t("signals.events.count", { n: data.events.length })}
      badge={data.events === null ? <span className={WARN_CHIP}>{t("signals.events.unreadable_badge")}</span> : null}>
      <div className="space-y-3">
        <p className="text-sm text-co-text-dim">{t("signals.events.window", { from: formatDateLabel(data.today, language) })}</p>
        {data.events === null && <p role="alert" className="font-bold text-co-cta-text">{t("signals.events.unreadable")}</p>}
        {data.events !== null && data.events.length === 0 && <p className="text-co-text-muted">{t("signals.events.none")}</p>}
        {data.events !== null && data.events.length > 0 && <ul className="space-y-2">{data.events.map((e) =>
          <li key={e.id}><EventRow event={e} data={data} /></li>)}</ul>}
        {data.can.enter && !adding && <button type="button" className={button} onClick={() => setAdding(true)}>{t("signals.event.add")}</button>}
        {data.can.enter && adding && <EventForm data={data} existing={null} onDone={() => setAdding(false)} />}
        {!data.can.enter && <p className="text-sm text-co-text-dim">{t("signals.event.read_only")}</p>}
      </div>
    </CollapsibleSection>

    <CollapsibleSection idBase="signals-feeds" title={t("signals.feeds.title")} count={t("signals.feeds.count", { verified: data.sources.verified, registered: data.sources.registered })}
      badge={data.adapters.some((a) => a.status === "verified" && (a.feeds === null || a.feeds.some((f) => f.state === "failed" || f.state === "stale")))
        ? <span className={WARN_CHIP}>{t("signals.feeds.attention_badge")}</span> : null}>
      <div className="space-y-3">
        <p className="text-sm text-co-text-muted">{t("signals.feeds.intro")}</p>
        {data.sources.registered === 0 && <p className="text-co-text-muted">{t("signals.feeds.none_registered")}</p>}
        <ul className="space-y-2">{data.adapters.map((a) => <li key={a.sourceId}><AdapterRow adapter={a} /></li>)}</ul>
        {data.sources.revoked > 0 && <p className="text-sm text-co-text-dim">{t("signals.feeds.revoked", { n: data.sources.revoked })}</p>}
        {data.can.mark && <Link href="/admin/demand-signals/sources" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{t("signals.feeds.manage")}</Link>}
      </div>
    </CollapsibleSection>

    {insights && <InsightsSection view={insights} locationId={data.shop.id} />}

    <CollapsibleSection idBase="signals-tested" title={t("signals.tested.title")} count={t("signals.tested.count")}>
      <div className="space-y-2 text-sm text-co-text">
        <p>{t("signals.tested.none")}</p>
        <p className="text-co-text-muted">{t("signals.tested.why")}</p>
        <p className="text-co-text-muted">{t("signals.tested.pars")}</p>
      </div>
    </CollapsibleSection>
  </div>;
}

function DayRow({ day, events, today, feeds }: { day: SignalsDay; events: Map<string, SignalsEvent>; today: string; feeds: OkData["weatherFeeds"] }) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = `signals-day-${day.date}`;
  const label = `${formatWeekday(day.date, language)}, ${formatDateLabel(day.date, language)}`;
  const list = day.eventIds === null ? null : day.eventIds.map((id) => events.get(id)).filter((e): e is SignalsEvent => e !== undefined);
  const w = day.weather;
  // A forecast is only as current as its feed's last run (the run ledger), never the row's own time.
  const old = w !== null && weatherIsOld(w.sourceIds, feeds);
  const rain = w === null ? null : rainLineOf(w);
  return <div className="rounded-lg border-2 border-co-border">
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={t("signals.days.aria.row", { day: label })} onClick={() => setOpen((o) => !o)}
      className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
      <span className="font-bold text-co-text">{label}</span>
      {day.date === today && <span className={CHIP}>{t("signals.days.today")}</span>}
      {/* The line and its qualifications come from ONE component (the walk uses the same one). */}
      {w ? <WeatherSummary weather={w} feeds={feeds} className="text-co-text" />
        : <span className="text-co-text-dim">{t(`signals.weather.gap.${day.weatherGap ?? "not_collected"}` as TranslationKey)}</span>}
      {list === null ? <span className={WARN_CHIP}>{t("signals.events.unreadable_badge")}</span>
        : list.length > 0 ? <span className={WARN_CHIP}>{t("signals.days.events", { n: list.length })}</span> : null}
    </button>
    {open && <div id={panelId} className="space-y-3 border-t-2 border-co-border p-3 text-sm text-co-text">
      <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.weather.title")}</h4>
        {!w && <p className="text-co-text-muted">{t(`signals.weather.gap_detail.${day.weatherGap ?? "not_collected"}` as TranslationKey)}</p>}
        {w && <ul className="space-y-1">
          <li>{t("signals.weather.detail_temps", { high: Math.round(w.highF), low: Math.round(w.lowF) })}</li>
          <li>{rain === null || rain.kind === "not_given" ? t("signals.weather.detail_rain_unknown")
            : rain.kind === "partial" ? t("signals.weather.detail_rain_partial", { rain: rain.pct, known: rain.known, hours: rain.hours })
              : t("signals.weather.detail_rain", { rain: rain.pct })}</li>
          <li>{t("signals.weather.detail_condition", { condition: w.condition })}</li>
          <li className={w.partial ? "font-bold text-co-warning-text" : "text-co-text-muted"}>{t(w.partial ? "signals.weather.detail_hours_partial" : "signals.weather.detail_hours", { hours: w.hours })}</li>
          <li className="text-co-text-muted">{t("signals.weather.detail_received", { when: dateTime(w.latestAvailableAt, language) })}</li>
          {old && <li className="font-bold text-co-warning-text">{t("signals.weather.detail_old")}</li>}
        </ul>}
      </div>
      <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.days.events_title")}</h4>
        {list === null && <p role="alert" className="font-bold text-co-cta-text">{t("signals.events.unreadable")}</p>}
        {list !== null && list.length === 0 && <p className="text-co-text-muted">{t("signals.days.no_events")}</p>}
        {list !== null && list.length > 0 && <ul className="space-y-1">{list.map((e) => <li key={e.id}>
          <span className="font-bold">{e.title}</span>{" "}
          <span className="text-co-text-muted">{t("signals.event.summary", { category: categoryLabel(t, e.category), impact: impactLabel(t, e.expectedImpact) })}</span>
        </li>)}</ul>}
      </div>
    </div>}
  </div>;
}

function EventRow({ event, data }: { event: SignalsEvent; data: OkData }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const panelId = `signals-event-${event.id}`;
  // A drawer with an open form stays mounted and locked open (D10).
  const isOpen = open || editing;

  async function retract() {
    setBusy(true); setError(null);
    const result = await postJson("/api/admin/demand-signals/events", { supersedesId: event.id, retract: true });
    setBusy(false);
    if (!result.ok) { setError(eventErrorKey(result.code)); return; }
    setConfirming(false);
    startTransition(() => router.refresh());
  }

  return <div className="rounded-lg border-2 border-co-border">
    <button type="button" aria-expanded={isOpen} aria-controls={panelId} aria-label={t("signals.event.aria.row", { title: event.title })}
      onClick={() => { if (!editing) setOpen((o) => !o); }} className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
      <span className="font-bold text-co-text">{event.title}</span>
      <span className="text-co-text">{eventWhen(t, event, language)}</span>
      <span className={CHIP}>{impactLabel(t, event.expectedImpact)}</span>
      <span className={CHIP}>{t(event.origin === "manual" ? "signals.event.origin.manual" : "signals.event.origin.feed")}</span>
    </button>
    {isOpen && <div id={panelId} className="space-y-3 border-t-2 border-co-border p-3 text-sm text-co-text">
      <ul className="space-y-1">
        <li>{t("signals.event.detail_category", { category: categoryLabel(t, event.category) })}</li>
        <li>{t("signals.event.detail_scope", { scope: event.locationId === null ? t("signals.event.scope.all") : data.shop.name })}</li>
        {event.severity && <li>{t("signals.event.detail_severity", { severity: t(`signals.severity.${["minor", "moderate", "severe", "extreme"].includes(event.severity) ? event.severity : "unknown"}` as TranslationKey) })}</li>}
        {event.origin === "feed" && <li className="text-co-text-muted">{t("signals.event.feed_text")}</li>}
      </ul>
      {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
      {event.canEdit && !editing && <div className="flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={busy} onClick={() => { setEditing(true); setConfirming(false); setError(null); }}>{t("signals.event.correct")}</button>
        {!confirming && <button type="button" className={quiet} disabled={busy} onClick={() => setConfirming(true)}>{t("signals.event.retract")}</button>}
        {confirming && <button type="button" disabled={busy} onClick={retract}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text disabled:opacity-60">{t("signals.event.retract_confirm")}</button>}
        {confirming && <button type="button" className={quiet} disabled={busy} onClick={() => setConfirming(false)}>{t("signals.event.cancel")}</button>}
      </div>}
      {event.canEdit && editing && <EventForm data={data} existing={event} onDone={() => setEditing(false)} />}
      {event.origin === "manual" && !event.canEdit && <p className="text-co-text-dim">{t("signals.event.not_yours")}</p>}
    </div>}
  </div>;
}

function EventForm({ data, existing, onDone }: { data: OkData; existing: SignalsEvent | null; onDone: () => void }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [category, setCategory] = useState<string>(existing?.category ?? "other");
  const [impact, setImpact] = useState<string>(existing?.expectedImpact ?? "unknown");
  const [from, setFrom] = useState(existing?.validFrom ?? data.today);
  const [to, setTo] = useState(existing?.validTo ?? data.today);
  const [start, setStart] = useState(existing?.startLocal?.slice(0, 5) ?? "");
  const [end, setEnd] = useState(existing?.endLocal?.slice(0, 5) ?? "");
  const [allShops, setAllShops] = useState(existing ? existing.locationId === null : false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const name = existing?.title ?? t("signals.event.new");
  const payload = { locationId: allShops ? null : data.shop.id, category, validFrom: from, validTo: to, startLocal: start === "" ? null : start,
    endLocal: end === "" ? null : end, title, impact, supersedesId: existing?.id ?? null, retract: false };
  // The same rule the route parses with (input-shared.ts); the writer decides again on the rows.
  const ready = parseDemandEvent(payload) !== null;

  async function save() {
    setBusy(true); setError(null);
    const result = await postJson("/api/admin/demand-signals/events", payload);
    setBusy(false);
    if (!result.ok) { setError(eventErrorKey(result.code)); return; }
    onDone();
    startTransition(() => router.refresh());
  }

  return <div className="space-y-3 rounded-lg bg-co-surface-inset p-3">
    <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{existing ? t("signals.event.form.correct_title") : t("signals.event.form.add_title")}</h4>
    <div className="flex flex-wrap gap-3">
      <label className={fieldLabel}>{t("signals.event.field.title")}
        <input type="text" className={control} value={title} maxLength={DEMAND_EVENT_TITLE_MAX} aria-label={t("signals.event.aria.title", { name })} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={fieldLabel}>{t("signals.event.field.category")}
        <select className={control} value={category} aria-label={t("signals.event.aria.category", { name })} onChange={(e) => setCategory(e.target.value)}>
          {DEMAND_EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(t, c)}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{t("signals.event.field.impact")}
        <select className={control} value={impact} aria-label={t("signals.event.aria.impact", { name })} onChange={(e) => setImpact(e.target.value)}>
          {DEMAND_EVENT_IMPACTS.map((i) => <option key={i} value={i}>{impactLabel(t, i)}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{t("signals.event.field.from")}
        <input type="date" className={control} value={from} aria-label={t("signals.event.aria.from", { name })}
          onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
      </label>
      <label className={fieldLabel}>{t("signals.event.field.to")}
        <input type="date" className={control} value={to} min={from} aria-label={t("signals.event.aria.to", { name })} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className={fieldLabel}>{t("signals.event.field.start")}
        <input type="time" className={control} value={start} aria-label={t("signals.event.aria.start", { name })} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className={fieldLabel}>{t("signals.event.field.end")}
        <input type="time" className={control} value={end} aria-label={t("signals.event.aria.end", { name })} onChange={(e) => setEnd(e.target.value)} />
      </label>
    </div>
    {data.can.enterAllShops && <label className="flex min-h-[44px] items-center gap-3 text-co-text">
      <input type="checkbox" className="h-5 w-5" checked={allShops} aria-label={t("signals.event.aria.all_shops", { name })} onChange={(e) => setAllShops(e.target.checked)} />
      <span>{t("signals.event.field.all_shops")}</span>
    </label>}
    {!data.can.enterAllShops && <p className="text-sm text-co-text-dim">{t("signals.event.for_shop", { shop: data.shop.name })}</p>}
    <p className="text-sm text-co-text-dim">{t("signals.event.form.help", { days: DEMAND_EVENT_MAX_SPAN_DAYS, from: formatDateLabel(data.today, language) })}</p>
    {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || !ready} onClick={save}>{existing ? t("signals.event.save_correction") : t("signals.event.save")}</button>
      <button type="button" className={quiet} disabled={busy} onClick={onDone}>{t("signals.event.cancel")}</button>
    </div>
  </div>;
}

function AdapterRow({ adapter }: { adapter: AdapterHealth }) {
  const { t, language } = useTranslation();
  return <div className="rounded-lg border-2 border-co-border p-3 text-sm text-co-text">
    <p className="flex flex-wrap items-center gap-2"><span className="font-bold">{adapter.name}</span>
      <span className={adapter.status === "verified" ? CHIP : WARN_CHIP}>{t(`signals.source.status.${adapter.status}` as TranslationKey)}</span></p>
    {adapter.status !== "verified" && <p className="text-co-text-muted">{t("signals.feeds.not_verified")}</p>}
    {adapter.feeds === null && <p role="alert" className="font-bold text-co-cta-text">{t("signals.feeds.unreadable")}</p>}
    {adapter.feeds !== null && <ul className="mt-1 space-y-1">{adapter.feeds.map((f) => <li key={f.feed}>
      <span className="font-bold">{t(`signals.feeds.feed.${f.feed}` as TranslationKey)}:</span>{" "}
      {f.state === "never" && t("signals.feeds.state.never")}
      {f.state === "fresh" && f.last && t("signals.feeds.state.fresh", { when: dateTime(f.last.finishedAt, language) })}
      {f.state === "stale" && f.last && <span className="font-bold text-co-warning-text">{t("signals.feeds.state.stale", { when: dateTime(f.lastGoodAt ?? f.last.finishedAt, language) })}</span>}
      {f.state === "failed" && f.last && <span className="font-bold text-co-cta-text">{f.lastGoodAt
        ? t("signals.feeds.state.failed", { when: dateTime(f.last.finishedAt, language), good: dateTime(f.lastGoodAt, language) })
        : t("signals.feeds.state.failed_never_good", { when: dateTime(f.last.finishedAt, language) })}</span>}
    </li>)}</ul>}
  </div>;
}

const AI_ERRORS = ["demand_ai_forbidden", "demand_ai_shop_forbidden", "demand_ai_daily_limit", "demand_ai_cap_reached", "demand_ai_not_configured", "demand_ai_model_unpriced",
  "demand_ai_off", "demand_ai_unavailable", "demand_ai_facts_incomplete", "demand_ai_nothing_to_say", "demand_ai_input_too_large", "demand_ai_timeout", "demand_ai_auth",
  "demand_ai_rate_limited", "demand_ai_refused_request", "demand_ai_answer_unreadable", "demand_ai_usage_unreadable", "demand_ai_not_recorded", "demand_signals_off",
  "demand_signals_unavailable"];
const aiErrorKey = (code: string): TranslationKey => (AI_ERRORS.includes(code) ? `signals.ai.error.${code}` : "signals.ai.error.generic") as TranslationKey;
/** Microdollars as whole cents, rounded UP (a cost is never shown smaller than it is). */
const microToCents = (micro: number) => Math.ceil(micro / 10_000);

/**
 * AI insights (item 4 PR 7). The section exists only when DEMAND_AI is on. Without a key it says "not
 * configured" and offers nothing. A sentence here is OURS: a template filled from the facts a validated claim
 * cites. Nothing the model wrote is on this page. Asking is a button a person presses, once a day per shop.
 */
function InsightsSection({ view, locationId }: { view: InsightsView; locationId: string }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const when = (f: InsightFact) => (f.date === f.endDate ? formatDateLabel(f.date, language)
    : t("signals.event.range", { from: formatDateLabel(f.date, language), to: formatDateLabel(f.endDate, language) }));

  async function ask() {
    setBusy(true); setError(null);
    const result = await postJson("/api/admin/demand-signals/insights", { locationId });
    setBusy(false);
    if (!result.ok) setError(aiErrorKey(result.code));
    // Whatever happened, the day's one attempt may now be used: show the stored row.
    startTransition(() => router.refresh());
  }

  const count = view.status !== "ready" ? t("signals.ai.count.off") : view.attempt?.state === "ok" ? t("signals.ai.count.n", { n: view.attempt.claims.length }) : t("signals.ai.count.none");
  return <CollapsibleSection idBase="signals-ai" title={t("signals.ai.title")} count={count}>
    <div className="space-y-3 text-sm text-co-text">
      {view.status !== "ready" && <p className="text-co-text-muted">{t(`signals.ai.status.${view.status}` as TranslationKey)}</p>}
      {view.status === "ready" && <>
        <p className="text-co-text-muted">{t("signals.ai.intro")}</p>
        {view.attempt?.state === "ok" && view.attempt.claims.length === 0 && <p>{t("signals.ai.nothing_picked")}</p>}
        {view.attempt?.state === "ok" && view.attempt.claims.length > 0 && <ul className="list-disc space-y-1 pl-5">{view.attempt.claims.flatMap((claim, i) => claim.facts.map((fact) =>
          <li key={`${i}-${fact.id}`}>{fact.kind === "named_event"
            ? t(insightSentenceKey(claim.type) as TranslationKey, { when: when(fact), category: categoryLabel(t, fact.category), impact: impactLabel(t, fact.impact) })
            : t(insightSentenceKey(claim.type) as TranslationKey, { when: when(fact), reason: t(`signals.weather.gap.${fact.reason}` as TranslationKey) })}</li>))}</ul>}
        {view.attempt && view.attempt.state !== "ok" && <p className="font-bold text-co-warning-text">{t(`signals.ai.attempt.${view.attempt.state}` as TranslationKey)}</p>}
        {view.attempt && <p className="text-co-text-muted">{t("signals.ai.asked_at", { when: dateTime(view.attempt.askedAt, language) })}{view.attempt.factsChanged ? ` ${t("signals.ai.facts_changed")}` : ""}</p>}
        {view.attempt && view.attempt.rejected > 0 && <p className="text-co-text-muted">{t("signals.ai.rejected", { n: view.attempt.rejected })}</p>}
        {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
        {view.blocked === null && <button type="button" className={button} disabled={busy} onClick={ask}>{busy ? t("signals.ai.asking") : t("signals.ai.ask")}</button>}
        {view.blocked !== null && <p className="text-co-text-dim">{t(`signals.ai.blocked.${view.blocked}` as TranslationKey)}</p>}
        <p className="text-co-text-dim">{t("signals.ai.spend", { spent: formatCents(microToCents(view.monthSpentMicro), language), cap: formatCents(microToCents(view.capMicro), language) })}</p>
      </>}
    </div>
  </CollapsibleSection>;
}
