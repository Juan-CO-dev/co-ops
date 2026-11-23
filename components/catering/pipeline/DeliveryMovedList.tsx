"use client";

/**
 * Catering delivery D2 — "Deliveries booked here for orders that moved": the pickup shop's way in after an order was
 * transferred away (it left that shop's pipeline, so the lead detail cannot be the entry point). AGM / GM only; the
 * rows come from `loadMovedDeliveries` (lib/delivery/jobs.ts) and the list is hidden when there are none or the
 * feature is off.
 *
 * It never widens access to the moved order: a row is the JOB only (courier, status, times), and opening it asks the
 * same route everyone uses, which answers this viewer the history-only view — that shop's jobs, their events and the
 * confirmation number. No customer, no order state, no cost, no other shop's job, no control.
 * Default-collapsed (useState only); full-row 44 px toggles; wraps at 375 px; en + es; ET times.
 */
import { useId, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DeliveryJobHistoryDto, LeadDeliveryView, MovedDeliveryRow } from "@/lib/delivery/jobs";
import { deliveryWhen } from "./delivery-format";

const k = (key: string) => `catering.delivery.${key}` as TranslationKey;
type Detail = { state: "loading" } | { state: "failed" } | { state: "ready"; jobs: DeliveryJobHistoryDto[] };

export function DeliveryMovedList({ rows, startOpen = false, initialDetail }: {
  rows: readonly MovedDeliveryRow[]; startOpen?: boolean;
  /** Tests / server render only: a job whose history starts open. */
  initialDetail?: { jobId: string; jobs: DeliveryJobHistoryDto[] };
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(startOpen);
  if (rows.length === 0) return null;
  return <section className="mt-4 co-card p-0">
    <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-left text-sm font-bold text-co-text"
      aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
      <span>{t(k("moved.title"))}</span>
      <span className="text-xs font-normal text-co-text-muted">{t(k("moved.count"), { n: rows.length })}</span>
    </button>
    <ul id={listId} hidden={!open} className="divide-y divide-co-border border-t border-co-border">
      {rows.map((row) => <Row key={row.jobId} row={row} initial={initialDetail?.jobId === row.jobId ? initialDetail.jobs : undefined} />)}
    </ul>
  </section>;
}

function Row({ row, initial }: { row: MovedDeliveryRow; initial?: DeliveryJobHistoryDto[] }) {
  const { t, language } = useTranslation();
  const bodyId = useId();
  const [open, setOpen] = useState(initial !== undefined);
  const [detail, setDetail] = useState<Detail | null>(initial ? { state: "ready", jobs: initial } : null);
  const other = t(k("other_shop"));

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || detail?.state === "ready" || detail?.state === "loading") return;
    setDetail({ state: "loading" });
    try {
      const res = await fetch(`/api/catering/pipeline/${row.leadId}/delivery`, { redirect: "error" });
      const view = res.ok ? ((await res.json()) as LeadDeliveryView) : null;
      // Only the history-only answer is rendered here: anything else (the order came back, the feature went off) shows nothing of the order.
      setDetail(view?.view === "history" ? { state: "ready", jobs: view.jobs } : { state: "failed" });
    } catch { setDetail({ state: "failed" }); }
  }

  return <li>
    <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-left text-sm text-co-text"
      aria-expanded={open} aria-controls={bodyId} onClick={() => void toggle()}>
      <span className="min-w-0 flex-1 basis-[10rem] font-bold">{t(k("moved.row"), { provider: row.providerLabel, status: t(k(`status.${row.status}`)) })}</span>
      <span className="text-xs text-co-text-muted">{t(k("moved.moved_to"), { shop: row.movedToShopName ?? other })}</span>
    </button>
    <div id={bodyId} hidden={!open} className="space-y-2 px-4 pb-3 text-xs text-co-text-muted">
      <p>{t(k("moved.history_only"), { from: row.pickupShopName ?? other, to: row.movedToShopName ?? other })}</p>
      {detail?.state === "loading" && <p role="status">{t(k("moved.loading"))}</p>}
      {detail?.state === "failed" && <p role="alert" className="text-co-cta-text">{t(k("moved.load_failed"))}</p>}
      {detail?.state === "ready" && <ul className="space-y-3">
        {detail.jobs.map((job) => <li key={job.jobId} className="space-y-1">
          <p className="text-sm font-bold text-co-text">{t(k("job.heading"), { n: job.attemptNo, provider: job.providerLabel })} · {t(k(`status.${job.status}`))}</p>
          {job.externalRef && <p className="break-words">{t(k("job.reference"), { ref: job.externalRef })}</p>}
          {(job.pickupAt || job.dropoffAt) && <p>
            {[job.pickupAt && t(k("job.pickup"), { when: deliveryWhen(job.pickupAt, language) }), job.dropoffAt && t(k("job.dropoff"), { when: deliveryWhen(job.dropoffAt, language) })]
              .filter(Boolean).join(" · ")}
          </p>}
          <ol className="space-y-1">
            {job.events.map((e) => <li key={e.id}>
              <span className="text-co-text">{t(k(`status.${e.status}`))}</span> · {deliveryWhen(e.occurredAt, language)}
              {e.note && <span className="block break-words">{t(k("history.note"), { note: e.note })}</span>}
            </li>)}
          </ol>
        </li>)}
      </ul>}
    </div>
  </li>;
}
