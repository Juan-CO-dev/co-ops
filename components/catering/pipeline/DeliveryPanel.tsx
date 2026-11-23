"use client";

/**
 * Catering delivery D2 — a catering order's courier delivery, in the pipeline lead detail. Read with AGENTS.md
 * "Catering delivery".
 *
 *  - RENDERS NOTHING unless the server says delivery is on for the lead's shop (`panelShown`): the switch off, the
 *    shop off, migration 0356 missing, a role no gate admits (403) or nothing to see (404) all render nothing.
 *  - The server's response is the authority. `detail` arrives only for a person who may write (AGM / GM at the shop,
 *    the catering manager, MoO and up); `cost` only for a person who may read money — so money is shown only when the
 *    response carries it, and everyone else reads the status line.
 *  - CO-OPS books nothing and cancels nothing: a person books the courier on the courier's own site and RECORDS it
 *    here. On an ezCater order the form records the courier ezCater sent (`provider_native`), never a booking of ours.
 *  - Every POST names what the person saw (`expectedShopId`, `expectedStatus`, the cost row being corrected). A stale
 *    one is refused by name; after ANY answer the panel reloads, so the screen is what is true now.
 *  - A wrong tap is not undone (a terminal status closes the job): the fix is a new delivery. The screen says so.
 *  - A cost correction asks for the password (Tier A). The server drops an unlock on any read outside its step-up
 *    paths, so a refusal there asks once more and retries: the person is never left with a button that cannot work.
 * Summary row (state, courier, time) + a default-collapsed body (useState only). 44 px controls with items-center;
 * every action row wraps for a 375 px phone. en + es (tú). Times are ET through lib/i18n/format.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { isStepUpRefusal } from "@/lib/admin/step-up-shared";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import { deliveryWhen } from "./delivery-format";
import {
  alertJob, canWriteDelivery, deliveryChipTone, deliveryErrorKey, dollarsToCents, jobCostLines, jobsNewestFirst, panelShown, recordOffer, signedCents, statusTaps,
  type ChipTone, type DeliveryLeadView, type RecordOffer,
} from "@/lib/delivery/panel-shared";
import type { LeadDeliveryView } from "@/lib/delivery/jobs";
import { isTerminalStatus, type ManualDeliveryStatus } from "@/lib/delivery/status-shared";
import { MAX_DELIVERY_NOTE, MAX_EXTERNAL_REF, MAX_PROVIDER_LABEL, type DeliveryCostComponent, type DeliveryCostRow, type DeliveryJob, type DeliveryJobEvent } from "@/lib/delivery/types-shared";

type PostOutcome = { ok: true } | { ok: false; code: string };
type Tr = (key: TranslationKey, vars?: Record<string, string | number>) => string;
interface ShopOpt { id: string; name: string }

const BUTTON = "inline-flex min-h-[44px] items-center rounded-lg border px-3 text-xs font-bold tracking-[0.1em] disabled:opacity-50";
const PRIMARY = `${BUTTON} border-co-gold-deep bg-co-surface text-co-text`;
const QUIET = `${BUTTON} border-co-border bg-co-surface text-co-text-muted`;
const FIELD = "min-h-[44px] w-full min-w-0 rounded-lg border border-co-border bg-co-surface px-2 text-sm text-co-text";
const LABEL = "grid gap-1 text-xs text-co-text-muted";
const HEADING = "text-xs font-bold tracking-wide text-co-text-muted";
const CHIP: Record<ChipTone, string> = {
  alert: "bg-co-danger-surface text-co-cta-text", warn: "bg-co-warning-surface text-co-warning-text",
  ok: "bg-co-success-surface text-co-confirm-text", muted: "bg-co-surface-inset text-co-text-muted",
};
const k = (key: string) => `catering.delivery.${key}` as TranslationKey;

/**
 * `initial` seeds the first render (tests / server render); the panel still reloads from the route on mount.
 * `stage` and `eventDate` are the lead's, as the board shows them; `locations` only names shops in a moved-order alert.
 */
export function DeliveryPanel({ leadId, stage, eventDate, locations, startOpen = false, initial }: {
  leadId: string; stage: PipelineStage; eventDate: string | null; locations: readonly ShopOpt[]; startOpen?: boolean; initial?: LeadDeliveryView | null;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const bodyId = useId();
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<{ leadId: string; view: LeadDeliveryView | null; failed: boolean } | null>(
    initial === undefined ? null : { leadId, view: initial, failed: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // 403 (a role no gate admits) and 404 (nothing to see) are "nothing here", never an error on the screen.
  const load = useCallback((signal?: AbortSignal) => fetch(`/api/catering/pipeline/${leadId}/delivery`, { signal, redirect: "error" })
    .then(async (r) => {
      if (r.status === 403 || r.status === 404) return null;
      if (!r.ok) throw new Error("unavailable");
      return (await r.json()) as LeadDeliveryView;
    })
    .then((view) => setState({ leadId, view, failed: false }))
    .catch(() => { if (!signal?.aborted) setState({ leadId, view: null, failed: true }); }), [leadId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const current = state?.leadId === leadId ? state : null;
  if (!current) return null;
  if (current.failed) return <p role="status" className="mt-3 text-xs text-co-warning-text">{t(k("unavailable"))}</p>;
  if (!panelShown(current.view, stage)) return null;
  const view: DeliveryLeadView = current.view;
  const shopId = view.shopId;
  const write = canWriteDelivery(view);
  const jobs = jobsNewestFirst(view.detail?.jobs ?? []);
  const offer = recordOffer(view, stage);
  const alert = alertJob(view);
  const shopName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? t(k("other_shop"));

  /** One write: show its refusal by name, then reload what is true now (a moved order also refreshes the board). */
  async function run(act: () => Promise<PostOutcome | null>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    let done = false;
    try {
      const result = await act();
      if (result && !result.ok) {
        setMessage(t(deliveryErrorKey(result.code) as TranslationKey));
        if (result.code === "shop_moved") router.refresh();
      }
      done = result?.ok === true;
    } finally {
      await load();
      setBusy(false);
    }
    return done;
  }

  const recordStatus = (job: DeliveryJob, status: ManualDeliveryStatus, time: string, note: string) => run(() =>
    post(`/api/catering/pipeline/${leadId}/delivery/${job.id}/status`, {
      expectedShopId: shopId, expectedStatus: job.status, status, note: note.trim() || null,
      occurredAt: time ? { date: etCalendarDate(new Date().toISOString()), time } : null,
    }));
  const keepPickup = (job: DeliveryJob) => run(() => post(`/api/catering/pipeline/${leadId}/delivery/${job.id}/keep-pickup`, { expectedShopId: shopId }));
  const addCost = (job: DeliveryJob, component: DeliveryCostComponent, cents: number) => run(() =>
    post(`/api/catering/pipeline/${leadId}/delivery/${job.id}/cost`, { expectedShopId: shopId, component, amountCents: signedCents(component, cents) }));
  const correctCost = (job: DeliveryJob, head: DeliveryCostRow, cents: number, reason: string) => run(async () => {
    const body = { expectedShopId: shopId, component: head.component, amountCents: signedCents(head.component, cents), correctsId: head.id, note: reason.trim() };
    if (await requestStepUp("A") !== "ok") return null;
    let result = await post(`/api/catering/pipeline/${leadId}/delivery/${job.id}/cost`, body);
    if (!result.ok && isStepUpRefusal(result.code)) {
      if (await requestStepUp("A") !== "ok") return null;
      result = await post(`/api/catering/pipeline/${leadId}/delivery/${job.id}/cost`, body);
    }
    return result;
  });
  const recordJob = async (body: Record<string, unknown>) => {
    if (await run(() => post(`/api/catering/pipeline/${leadId}/delivery`, { ...body, expectedShopId: shopId }))) setRecording(false);
  };

  const about = view.status;
  const summary = about
    ? [about.providerLabel, about.pickupAt && view.state === "booked" ? t(k("summary.pickup"), { time: formatTime(about.pickupAt, language) })
      : `${t(k(`status.${about.status}`))} ${formatTime(about.statusAt, language)}`].join(" · ")
    : null;

  return <section className="mt-3 border-t border-co-border pt-2" aria-busy={busy}>
    <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 text-left text-sm font-bold text-co-text"
      aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
      <span>{t(k("title"))}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs font-normal text-co-text-muted">
        {summary && <span>{summary}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${CHIP[deliveryChipTone(view.state)]}`}>{t(k(`state.${view.state}`))}</span>
      </span>
    </button>

    {/* Identity and alerts are never collapsed (D2): a courier still booked on a rejected order, or booked at a shop the order left. */}
    {view.state === "cancel_needed" && <div role="alert" className="mt-1 space-y-2 rounded-lg border border-co-cta-text bg-co-danger-surface p-3 text-xs text-co-text">
      <p className="font-bold text-co-cta-text">{t(k("alert.cancel_needed"), { provider: about?.providerLabel ?? t(k("the_courier")) })}</p>
      {write && alert && <button type="button" className={PRIMARY} disabled={busy} onClick={() => void recordStatus(alert, "cancelled", "", "")}>{t(k("alert.cancel_needed.action"))}</button>}
    </div>}
    {view.state === "pickup_mismatch" && <div role="alert" className="mt-1 space-y-2 rounded-lg border border-co-warning bg-co-warning-surface p-3 text-xs text-co-text">
      <p className="font-bold text-co-warning-text">{t(k("alert.pickup_mismatch"), { from: shopName(alert?.locationId ?? null), to: shopName(shopId) })}</p>
      {write && alert && <>
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => void keepPickup(alert)}>{t(k("alert.pickup_mismatch.keep"), { from: shopName(alert.locationId) })}</button>
        <p>{t(k("alert.pickup_mismatch.hint"))}</p>
      </>}
    </div>}

    <div id={bodyId} hidden={!open} className="space-y-3 pb-1 text-xs text-co-text-muted">
      {message && <p role="alert" className="text-co-cta-text">{message}</p>}
      {busy && <p role="status">{t(k("saving"))}</p>}
      {!write && <p>{t(k("view_only"))}</p>}
      {!write && about && <p className="text-co-text">{statusLine(about, t, language)}</p>}

      {offer?.kind === "blocked" && <p role="status" className="text-co-warning-text">{t(k(`record.blocked.${offer.reason}`))}</p>}
      {offer?.kind === "form" && (recording
        ? <RecordForm key={`${leadId}:${jobs.length}`} offer={offer} eventDate={eventDate} busy={busy} onCancel={() => setRecording(false)} onSubmit={(body) => void recordJob(body)} />
        : <button type="button" className={PRIMARY} disabled={busy} onClick={() => setRecording(true)}>{t(k(offer.mode === "provider_native" ? "record.title_ezcater" : "record.open"))}</button>)}

      {jobs.length > 0 && <ul className="space-y-3">
        {jobs.map((job) => <JobCard key={job.id} job={job} busy={busy} write={write} events={(view.detail?.events ?? []).filter((e) => e.jobId === job.id)}
          costs={view.cost?.costs} onStatus={(status, time, note) => void recordStatus(job, status, time, note)}
          onAddCost={(component, cents) => void addCost(job, component, cents)} onCorrect={(head, cents, reason) => void correctCost(job, head, cents, reason)} />)}
      </ul>}

      {write && <p>{t(k("mistap"))}</p>}
    </div>
  </section>;
}

function statusLine(s: NonNullable<DeliveryLeadView["status"]>, t: Tr, language: Language): string {
  const parts = [s.providerLabel, `${t(k(`status.${s.status}`))} ${deliveryWhen(s.statusAt, language)}`];
  if (s.pickupAt) parts.push(t(k("job.pickup"), { when: deliveryWhen(s.pickupAt, language) }));
  if (s.dropoffAt) parts.push(t(k("job.dropoff"), { when: deliveryWhen(s.dropoffAt, language) }));
  return parts.join(" · ");
}

/** Record a delivery booked outside CO-OPS (a courier from the shop's list), or the courier ezCater sent. */
function RecordForm({ offer, eventDate, busy, onSubmit, onCancel }: {
  offer: Extract<RecordOffer, { kind: "form" }>; eventDate: string | null; busy: boolean; onSubmit: (body: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const native = offer.mode === "provider_native";
  const [courier, setCourier] = useState(native ? "" : offer.providers[0] ?? "");
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(() => eventDate ?? etCalendarDate(new Date().toISOString()));
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const cents = cost.trim() === "" ? null : dollarsToCents(cost);
  const costValid = cost.trim() === "" || cents !== null;
  const dayValid = /^\d{4}-\d{2}-\d{2}$/.test(day) || (!pickup && !dropoff);
  const ready = courier.trim() !== "" && costValid && dayValid;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      providerLabel: courier.trim(), bookedVia: offer.mode, externalRef: reference.trim() || null, note: note.trim() || null, costCents: cents,
      pickupAt: pickup ? { date: day, time: pickup } : null, dropoffAt: dropoff ? { date: day, time: dropoff } : null,
    });
  }

  return <form className="grid gap-3 rounded-lg border border-co-border bg-co-surface-inset p-3" onSubmit={submit}>
    <h4 className={HEADING}>{t(k(native ? "record.title_ezcater" : "record.title"))}</h4>
    <p>{t(k(native ? "record.ezcater_note" : "record.manual_note"))}</p>
    {!native && offer.providers.length === 0 && <p role="status" className="text-co-warning-text">{t(k("record.no_couriers"))}</p>}
    <label className={LABEL}>{t(k("record.courier"))}
      {native
        ? <input className={FIELD} value={courier} maxLength={MAX_PROVIDER_LABEL} disabled={busy} onChange={(e) => setCourier(e.target.value)} />
        : <select className={FIELD} value={courier} disabled={busy || offer.providers.length === 0} onChange={(e) => setCourier(e.target.value)}>
          {offer.providers.length === 0 && <option value="">{t(k("record.courier_pick"))}</option>}
          {offer.providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>}
    </label>
    <label className={LABEL}>{t(k("record.reference"))}
      <input className={FIELD} value={reference} maxLength={MAX_EXTERNAL_REF} disabled={busy} onChange={(e) => setReference(e.target.value)} />
    </label>
    <div className="flex flex-wrap gap-3">
      <label className={`${LABEL} min-w-0 flex-1 basis-[9rem]`}>{t(k("record.day"))}
        <input type="date" className={FIELD} value={day} disabled={busy} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label className={`${LABEL} min-w-0 flex-1 basis-[7rem]`}>{t(k("record.pickup_time"))}
        <input type="time" className={FIELD} value={pickup} disabled={busy} onChange={(e) => setPickup(e.target.value)} />
      </label>
      <label className={`${LABEL} min-w-0 flex-1 basis-[7rem]`}>{t(k("record.dropoff_time"))}
        <input type="time" className={FIELD} value={dropoff} disabled={busy} onChange={(e) => setDropoff(e.target.value)} />
      </label>
    </div>
    <label className={LABEL}>{t(k("record.cost"))}
      <input className={FIELD} inputMode="decimal" value={cost} disabled={busy} onChange={(e) => setCost(e.target.value)} />
      <span>{t(k("record.cost_help"))}</span>
    </label>
    {!costValid && <p role="alert" className="text-co-cta-text">{t(k("cost.invalid"))}</p>}
    <label className={LABEL}>{t(k("record.note"))}
      <textarea className={`${FIELD} py-2`} rows={2} value={note} maxLength={MAX_DELIVERY_NOTE} disabled={busy} onChange={(e) => setNote(e.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={PRIMARY} disabled={busy || !ready}>{t(k("record.submit"))}</button>
      <button type="button" className={QUIET} disabled={busy} onClick={onCancel}>{t(k("record.cancel"))}</button>
    </div>
  </form>;
}

/** One delivery: what was booked, the taps that move it, what it cost us (when the response carries money), its history. */
function JobCard({ job, busy, write, events, costs, onStatus, onAddCost, onCorrect }: {
  job: DeliveryJob; busy: boolean; write: boolean; events: readonly DeliveryJobEvent[]; costs: readonly DeliveryCostRow[] | undefined;
  onStatus: (status: ManualDeliveryStatus, time: string, note: string) => void;
  onAddCost: (component: DeliveryCostComponent, cents: number) => void; onCorrect: (head: DeliveryCostRow, cents: number, reason: string) => void;
}) {
  const { t, language } = useTranslation();
  const [pending, setPending] = useState<ManualDeliveryStatus | null>(null);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyId = useId();
  const taps = write ? statusTaps(job) : [];

  return <li className="space-y-2 rounded-lg border border-co-border p-3">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h4 className="min-w-0 flex-1 basis-[8rem] text-sm font-bold text-co-text">{t(k("job.heading"), { n: job.attemptNo, provider: job.providerLabel })}</h4>
      <span className="text-co-text">{t(k(`status.${job.status}`))}</span>
    </div>
    {job.bookedVia === "provider_native" && <p>{t(k("job.native"))}</p>}
    {job.externalRef && <p className="break-words">{t(k("job.reference"), { ref: job.externalRef })}</p>}
    {(job.pickupAt || job.dropoffAt) && <p>
      {[job.pickupAt && t(k("job.pickup"), { when: deliveryWhen(job.pickupAt, language) }), job.dropoffAt && t(k("job.dropoff"), { when: deliveryWhen(job.dropoffAt, language) })]
        .filter(Boolean).join(" · ")}
    </p>}

    {taps.length > 0 && <div className="space-y-2">
      <h5 className={HEADING}>{t(k("tap.heading"))}</h5>
      {pending === null
        ? <div className="flex flex-wrap gap-2">
          {taps.map((s) => <button key={s} type="button" disabled={busy} className={s === "cancelled" || s === "failed" ? QUIET : PRIMARY}
            onClick={() => { setPending(s); setTime(""); setNote(""); }}>{t(k(`status.${s}`))}</button>)}
        </div>
        : <div className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3">
          <p className="text-co-text">{t(k(isTerminalStatus(pending) ? "tap.confirm_final" : "tap.confirm"), { status: t(k(`status.${pending}`)) })}</p>
          <label className={LABEL}>{t(k("tap.when"))}
            <input type="time" className={FIELD} value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} />
            <span>{t(k("tap.when_help"))}</span>
          </label>
          <label className={LABEL}>{t(k("record.note"))}
            <input className={FIELD} value={note} maxLength={MAX_DELIVERY_NOTE} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => { const s = pending; setPending(null); onStatus(s, time, note); }}>
              {t(k("tap.record"), { status: t(k(`status.${pending}`)) })}</button>
            <button type="button" className={QUIET} disabled={busy} onClick={() => setPending(null)}>{t(k("record.cancel"))}</button>
          </div>
        </div>}
    </div>}

    {costs !== undefined && <JobCosts job={job} costs={costs} busy={busy} write={write} onAddCost={onAddCost} onCorrect={onCorrect} />}

    {events.length > 0 && <div>
      <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-xs font-bold tracking-wide text-co-text-muted"
        aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryOpen(!historyOpen)}>
        <span>{t(k("history.heading"))}</span><span className="font-normal">{t(k("history.count"), { n: events.length })}</span>
      </button>
      <ol id={historyId} hidden={!historyOpen} className="space-y-1">
        {events.map((e) => <li key={e.id}>
          <span className="text-co-text">{t(k(`status.${e.status}`))}</span> · {deliveryWhen(e.occurredAt, language)}
          {e.note && <span className="block break-words">{t(k("history.note"), { note: e.note })}</span>}
        </li>)}
      </ol>
    </div>}
  </li>;
}

/** What the courier charged US for this job. Unknown is not zero: "No charge" is its own record. */
function JobCosts({ job, costs, busy, write, onAddCost, onCorrect }: {
  job: DeliveryJob; costs: readonly DeliveryCostRow[]; busy: boolean; write: boolean;
  onAddCost: (component: DeliveryCostComponent, cents: number) => void; onCorrect: (head: DeliveryCostRow, cents: number, reason: string) => void;
}) {
  const { t, language } = useTranslation();
  const lines = jobCostLines(job.id, costs);
  const [adding, setAdding] = useState(false);
  const [component, setComponent] = useState<DeliveryCostComponent>("base");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const cents = dollarsToCents(amount);
  const pick = lines.addable.includes(component) ? component : lines.addable[0] ?? "base";
  const money = (c: number) => formatCents(c, language);
  const start = (what: "add" | string) => { setAmount(""); setReason(""); setAdding(what === "add"); setCorrecting(what === "add" ? null : what); };
  const stop = () => { setAdding(false); setCorrecting(null); };

  return <div className="space-y-2">
    <h5 className={HEADING}>{t(k("cost.heading"))}</h5>
    {lines.cost.kind === "unknown" ? <p className="text-co-warning-text">{t(k("cost.unknown"))}</p>
      : <p className="text-sm font-bold text-co-text">{t(k("cost.total"), { amount: money(lines.cost.cents) })}</p>}
    {lines.cost.kind === "known" && lines.cost.differenceCents !== null && lines.cost.differenceCents !== 0
      && <p className="text-co-warning-text">{t(k("cost.difference"), { amount: money(Math.abs(lines.cost.differenceCents)) })}</p>}
    <ul className="space-y-2">
      {lines.heads.map((head) => <li key={head.id} className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1 basis-[8rem] text-co-text">{t(k("cost.line"), { component: t(k(`component.${head.component}`)), amount: money(head.amountCents) })}</span>
          {write && correcting !== head.id && <button type="button" className={QUIET} disabled={busy}
            aria-label={t(k("cost.correct_aria"), { component: t(k(`component.${head.component}`)) })} onClick={() => start(head.id)}>{t(k("cost.correct"))}</button>}
        </div>
        {write && correcting === head.id && <div className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3">
          <label className={LABEL}>{t(k("cost.amount"))}
            <input className={FIELD} inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={LABEL}>{t(k("cost.reason"))}
            <input className={FIELD} value={reason} maxLength={MAX_DELIVERY_NOTE} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </label>
          {head.component === "credit" && <p>{t(k("cost.credit_note"))}</p>}
          <p>{t(k("cost.password_note"))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy || cents === null || reason.trim() === ""}
              onClick={() => { if (cents !== null) { stop(); onCorrect(head, cents, reason); } }}>{t(k("cost.save_correction"))}</button>
            <button type="button" className={QUIET} disabled={busy} onClick={stop}>{t(k("record.cancel"))}</button>
          </div>
        </div>}
      </li>)}
    </ul>
    {write && lines.addable.length > 0 && (adding
      ? <div className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3">
        <label className={LABEL}>{t(k("cost.component"))}
          <select className={FIELD} value={pick} disabled={busy} onChange={(e) => setComponent(e.target.value as DeliveryCostComponent)}>
            {lines.addable.map((c) => <option key={c} value={c}>{t(k(`component.${c}`))}</option>)}
          </select>
        </label>
        <label className={LABEL}>{t(k("cost.amount"))}
          <input className={FIELD} inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {pick === "credit" && <p>{t(k("cost.credit_note"))}</p>}
        {amount.trim() !== "" && cents === null && <p role="alert" className="text-co-cta-text">{t(k("cost.invalid"))}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} disabled={busy || cents === null} onClick={() => { if (cents !== null) { stop(); onAddCost(pick, cents); } }}>{t(k("cost.save"))}</button>
          <button type="button" className={QUIET} disabled={busy} onClick={stop}>{t(k("record.cancel"))}</button>
        </div>
      </div>
      : <div className="flex flex-wrap gap-2">
        <button type="button" className={QUIET} disabled={busy} onClick={() => start("add")}>{t(k("cost.add"))}</button>
        {lines.cost.kind === "unknown" && <button type="button" className={QUIET} disabled={busy} onClick={() => onAddCost("base", 0)}>{t(k("cost.no_charge"))}</button>}
      </div>)}
  </div>;
}
