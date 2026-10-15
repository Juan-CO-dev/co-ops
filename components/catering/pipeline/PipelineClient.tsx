"use client";

import { useState, useEffect, useCallback, useId, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { LEAD_EMAIL_MAX, LEAD_PHONE_MAX, LEGAL_TRANSITIONS, PIPELINE_STAGES, cateringStageOverlay, projectedCateringStage, leadEditPatch, shopChipLabel, showQuoteNotAccepted, stageMoveNeedsConfirm, type CateringStageMove, type CateringStageOverlay, type PipelineStage } from "@/lib/catering/pipeline-shared";
import type { PipelineLead, PipelineBoardLead, PipelineSearchResult, AssignableStaff } from "@/lib/catering/pipeline";
import { LEAD_SOURCES, leadSourceKey } from "@/lib/catering/intake-shared";
import type { CateringCapacityResult } from "@/lib/catering/capacity";
import { EzcaterReconciliationPanel } from "./EzcaterReconciliationPanel";
import { TransferLead } from "./TransferLead";
import { EzcaterDetail } from "./EzcaterDetail";
import type { EzcaterOrderDetail } from "@/lib/catering/ezcater-detail-shared";
import { humanEzcaterNotes } from "@/lib/catering/ezcater-detail-shared";
import { postJson, resolveErrorKey } from "./shared";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { NotInToast, NotInToastChip } from "./NotInToast";
import type { PipelineToastOrder } from "@/lib/catering/not-in-toast";

interface LocationOpt {
  id: string;
  name: string;
}
interface Props {
  notInToast: PipelineToastOrder[] | null;
  staff: AssignableStaff[];
  leads: PipelineBoardLead[];
  followUps: PipelineLead[];
  locations: LocationOpt[];
  createLocations: LocationOpt[];
  /** B8 #3 — the working shop (resolveShop over createLocations); null = none allowed. */
  defaultCreateLocationId?: string | null;
  actorLevel: number;
  canTransfer: boolean;
  writeMin: number;
  searchQuery: string;
  results: PipelineSearchResult[] | null;
}

const SIGNAL_TONE: Record<CateringCapacityResult["signal"], string> = {
  available: "bg-co-success-surface text-co-confirm-text",
  limited: "bg-co-warning-surface text-co-warning-text",
  unavailable: "bg-co-danger-surface text-co-cta-text",
  blackout: "bg-co-danger-surface text-co-cta-text",
  below_lead_time: "bg-co-warning-surface text-co-warning-text",
  unconfigured: "bg-co-surface text-co-text-muted",
};

/** The shop chip: the location NAME (table-read), never the code. Present on every lead card. */
function ShopChip({ lead }: { lead: { locationName?: string | null } }) {
  const { t } = useTranslation();
  const name = shopChipLabel(lead);
  return (
    <span
      data-testid="shop-chip"
      className="mt-1 inline-block rounded-md border border-co-border bg-co-surface px-2 py-0.5 text-xs font-medium text-co-text-muted"
      aria-label={name ? t("catering.pipeline.shop_chip_aria", { name }) : undefined}
    >
      {name ?? t("catering.pipeline.shop_none")}
    </span>
  );
}

/** D-46: a Confirmed card whose current quote is still a draft or only sent. */
function QuoteNotAcceptedChip() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="quote-not-accepted-chip"
      title={t("catering.pipeline.quote_not_accepted_hint")}
      className="ml-1 mt-1 inline-block rounded-md bg-co-warning-surface px-2 py-0.5 text-xs font-medium text-co-warning-text"
    >
      {t("catering.pipeline.quote_not_accepted")}
    </span>
  );
}

function stageKey(s: PipelineStage): TranslationKey {
  return `catering.pipeline.stage.${s}` as TranslationKey;
}

export function PipelineClient({ notInToast, staff, leads, followUps, locations, createLocations, defaultCreateLocationId = null, actorLevel, canTransfer, writeMin, searchQuery, results }: Props) {
  const { t, language } = useTranslation();
  const canWrite = actorLevel >= writeMin;
  const pendingIds = new Set((notInToast ?? []).flatMap((r) => r.lead_id ? [r.lead_id] : []));
  const router = useRouter();
  const [stageOverlay, setStageOverlay] = useState<CateringStageOverlay>({});
  const stageOverlayRef = useRef<CateringStageOverlay>({});
  const requestRef = useRef(0);
  const serverStages: Record<string, PipelineStage> = {};
  const serverVersions: Record<string, string | null> = {};
  for (const lead of leads) {
    serverStages[lead.id] = lead.stage;
    serverVersions[lead.id] = lead.updatedAt;
  }
  useEffect(() => {
    const next = cateringStageOverlay(stageOverlayRef.current, serverStages, { type: "props", versions: serverVersions });
    if (next !== stageOverlayRef.current) {
      stageOverlayRef.current = next;
      setStageOverlay(next);
    }
  }, [leads]); // Server props are authoritative once they include the accepted move.

  const moveStage = useCallback(async (id: string, from: PipelineStage, to: PipelineStage) => {
    const request = ++requestRef.current;
    const next = cateringStageOverlay(stageOverlayRef.current, serverStages, { type: "start", id, from, to, request, version: serverVersions[id] });
    if (next === stageOverlayRef.current) return;
    stageOverlayRef.current = next;
    setStageOverlay(next);
    const result = await postJson(`/api/catering/pipeline/${id}`, { stage: to }, "PATCH");
    const resolved = cateringStageOverlay(stageOverlayRef.current, serverStages, { type: "resolve", id, request, result });
    if (resolved !== stageOverlayRef.current) {
      stageOverlayRef.current = resolved;
      setStageOverlay(resolved);
    }
    if (result.ok || result.code === "stage_changed" || result.code === "network") router.refresh();
  }, [leads, router]);

  const money = (cents: number | null) => (cents == null ? null : formatCents(cents, language));

  // Attribution filters (spec #2b): by order lead + by intake source. Client-side.
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");
  const staffNames: Record<string, string> = {};
  for (const m of staff) staffNames[m.id] = m.name;
  const visibleLeads = leads.filter(
    (l) =>
      (filterAssignee === "" || l.assignedTo === filterAssignee) &&
      (filterSource === "" || l.leadSource === filterSource),
  );

  const byStage: Record<PipelineStage, PipelineBoardLead[]> = {
    inquiry: [],
    quote_sent: [],
    confirmed: [],
    out: [],
    completed: [],
    lost: [],
  };
  for (const l of visibleLeads) {
    const stage = projectedCateringStage(l.stage, stageOverlay[l.id]);
    byStage[stage].push({ ...l, stage });
  }

  return (
    <div className="mt-4 space-y-6">
      {/* Search box — always visible */}
      <SearchBox searchQuery={searchQuery} />
      <NotInToast rows={notInToast} locations={locations} />

      {results != null ? (
        /* SEARCH MODE */
        <SearchResults results={results} searchQuery={searchQuery} money={money} pendingIds={pendingIds} />
      ) : (
        /* BOARD MODE */
        <>
          {canWrite && <AddLeadRow locations={createLocations} staff={staff} defaultLocationId={defaultCreateLocationId} />}

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-co-text-muted" htmlFor="pl-f-assignee">{t("catering.intake.filter.assignee")}</label>
            <select id="pl-f-assignee" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="rounded-md border border-co-border bg-co-surface p-1.5 text-sm text-co-text">
              <option value="">{t("catering.intake.filter.all")}</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <label className="text-xs text-co-text-muted" htmlFor="pl-f-source">{t("catering.intake.filter.source")}</label>
            <select id="pl-f-source" value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="rounded-md border border-co-border bg-co-surface p-1.5 text-sm text-co-text">
              <option value="">{t("catering.intake.filter.all")}</option>
              {LEAD_SOURCES.map((sc) => (
                <option key={sc} value={sc}>{t(`catering.intake.source.${sc}` as TranslationKey)}</option>
              ))}
            </select>
          </div>

          {followUps.length > 0 && (
            <section className="co-card p-4">
              <h2 className="text-sm font-bold text-co-text">{t("catering.pipeline.follow_ups.heading")}</h2>
              <ul className="mt-2 space-y-1.5">
                {followUps.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-co-text">
                      {l.contactName}
                      {l.company ? ` · ${l.company}` : ""}
                    </span>
                    <span className="text-co-cta-text">
                      {t("catering.pipeline.follow_ups.due")}{" "}
                      {l.followUpDate ? formatDateLabel(l.followUpDate, language) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex gap-3 overflow-x-auto pb-2">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="min-w-[15rem] flex-1">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t(stageKey(stage))}</h2>
                  <span className="text-xs text-co-text-muted">{byStage[stage].length}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {byStage[stage].length === 0 ? (
                    <p className="px-1 text-xs text-co-text-muted">{t("catering.pipeline.empty_stage")}</p>
                  ) : (
                    byStage[stage].map((lead) => <LeadCard key={lead.id} lead={lead} stageMove={stageOverlay[lead.id]} onStageMove={moveStage} notInToast={pendingIds.has(lead.id)} money={money} canWrite={canWrite} canTransfer={canTransfer} locations={locations} staffNames={staffNames} />)
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Search box ────────────────────────────────────────────────────────────────
function SearchBox({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState(searchQuery);

  // During-render adjustment: if the server-prop changes (navigation), reset local state.
  const [prevQuery, setPrevQuery] = useState(searchQuery);
  if (searchQuery !== prevQuery) {
    setPrevQuery(searchQuery);
    setValue(searchQuery);
  }

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        router.push(`/catering/pipeline?q=${encodeURIComponent(trimmed)}`);
      }
    },
    [value, router],
  );

  const handleClear = useCallback(() => {
    setValue("");
    router.push("/catering/pipeline");
  }, [router]);

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2" role="search" aria-label={t("catering.pipeline.search.search_aria" as TranslationKey)}>
      <div className="relative flex-1">
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("catering.pipeline.search.placeholder" as TranslationKey)}
          className="w-full min-h-[44px] rounded-md border border-co-border bg-co-surface px-3 py-2 text-sm text-co-text placeholder:text-co-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60"
        />
      </div>
      <button
        type="submit"
        className="min-h-[44px] rounded-md bg-co-text px-4 py-2 text-sm font-semibold text-co-bg"
      >
        {t("catering.pipeline.search.submit" as TranslationKey)}
      </button>
      {searchQuery && (
        <button
          type="button"
          onClick={handleClear}
          className="min-h-[44px] rounded-md border border-co-border px-3 py-2 text-sm text-co-text-muted hover:text-co-text"
        >
          {t("catering.pipeline.search.clear" as TranslationKey)}
        </button>
      )}
    </form>
  );
}

// ── Search results ────────────────────────────────────────────────────────────
function SearchResults({
  pendingIds,
  results,
  searchQuery,
  money,
}: {
  pendingIds: ReadonlySet<string>;
  results: PipelineSearchResult[];
  searchQuery: string;
  money: (cents: number | null) => string | null;
}) {
  const { t } = useTranslation();

  const header = (t("catering.pipeline.search.results_header" as TranslationKey) as string)
    .replace("{n}", String(results.length))
    .replace("{q}", searchQuery);

  if (results.length === 0) {
    const empty = (t("catering.pipeline.search.empty" as TranslationKey) as string).replace("{q}", searchQuery);
    return (
      <div>
        <p className="mb-3 text-sm font-semibold text-co-text">{header}</p>
        <p className="text-sm text-co-text-muted">{empty}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-co-text">{header}</p>
      <div className="space-y-3">
        {results.map((r) => (
          <SearchResultCard key={r.id} result={r} money={money} notInToast={pendingIds.has(r.id)} />
        ))}
      </div>
    </div>
  );
}

function SearchResultCard({
  notInToast,
  result: r,
  money,
}: {
  notInToast: boolean;
  result: PipelineSearchResult;
  money: (cents: number | null) => string | null;
}) {
  const { t, language } = useTranslation();
  const quoteDisplay =
    r.quoteStatus != null && r.quoteTotalCents != null
      ? `${r.quoteStatus} · ${money(r.quoteTotalCents) ?? ""}`
      : null;

  return (
    <div className="co-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-semibold text-co-text">{r.contactName}</span>
          {r.company && <span className="ml-2 text-sm text-co-text-muted">{r.company}</span>}
          <div><ShopChip lead={r} />{notInToast && <NotInToastChip />}{showQuoteNotAccepted(r.stage, r.quoteStatus) && <QuoteNotAcceptedChip />}</div>
        </div>
        <span className="inline-block rounded-md bg-co-surface px-2 py-0.5 text-xs font-medium text-co-text-muted border border-co-border">
          {t(stageKey(r.stage))}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {r.eventDate && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.event_date")}</dt>
            <dd className="text-co-text">{formatDateLabel(r.eventDate, language)}</dd>
          </>
        )}
        {r.contactPhone && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.search.phone_label" as TranslationKey)}</dt>
            <dd className="text-co-text">{r.contactPhone}</dd>
          </>
        )}
        {r.email && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.search.email_label" as TranslationKey)}</dt>
            <dd className="text-co-text">{r.email}</dd>
          </>
        )}
        <dt className="text-co-text-muted">{t("catering.pipeline.search.quote_label" as TranslationKey)}</dt>
        <dd className="text-co-text">
          {quoteDisplay ?? t("catering.pipeline.search.no_quote" as TranslationKey)}
        </dd>
      </dl>
    </div>
  );
}

// ── Lead card + expandable detail ─────────────────────────────────────────────
function LeadCard({
  notInToast,
  lead,
  stageMove,
  onStageMove,
  money,
  canWrite,
  canTransfer,
  locations,
  staffNames,
}: {
  notInToast: boolean;
  lead: PipelineBoardLead;
  stageMove?: CateringStageMove;
  onStageMove: (id: string, from: PipelineStage, to: PipelineStage) => Promise<void>;
  money: (c: number | null) => string | null;
  canWrite: boolean;
  canTransfer: boolean;
  locations: LocationOpt[];
  staffNames: Record<string, string>;
}) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const rev = money(lead.estimatedRevenueCents);
  return (
    <div className="co-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
        aria-expanded={open}
      >
        <div className="font-semibold text-co-text">{lead.contactName}</div>
        {lead.company && <div className="text-xs text-co-text-muted">{lead.company}</div>}
        <ShopChip lead={lead} />
        {notInToast && <NotInToastChip />}
        {showQuoteNotAccepted(lead.stage, lead.quoteStatus) && <QuoteNotAcceptedChip />}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-co-text-muted">
          {lead.eventDate && <span>{formatDateLabel(lead.eventDate, language)}</span>}
          {lead.headcount != null && <span>{t("catering.pipeline.headcount_short").replace("{n}", String(lead.headcount))}</span>}
          {lead.leadSource && (
            <span>{leadSourceKey(lead.leadSource) ? t(leadSourceKey(lead.leadSource) as TranslationKey) : lead.leadSource}</span>
          )}
          {lead.assignedTo && <span>@{staffNames[lead.assignedTo] ?? "?"}</span>}
          {rev && <span>{rev}</span>}
        </div>
      </button>
      {stageMove && <SaveStatus phase={stageMove.phase} detail={stageMove.phase === "failed" ? t(resolveErrorKey(stageMove.errorCode ?? "generic")) : undefined}
        onRetry={stageMove.phase === "failed" ? () => void onStageMove(lead.id, lead.stage, stageMove.to) : undefined} />}
      {open && <LeadDetail lead={lead} money={money} canWrite={canWrite} canTransfer={canTransfer} locations={locations} onStageMove={onStageMove} moving={stageMove?.phase === "saving" || stageMove?.phase === "saved"} onClose={() => setOpen(false)} />}
    </div>
  );
}

function LeadDetail({
  lead,
  money,
  canWrite,
  canTransfer,
  locations,
  onStageMove,
  moving,
  onClose,
}: {
  lead: PipelineLead;
  money: (c: number | null) => string | null;
  canWrite: boolean;
  canTransfer: boolean;
  locations: LocationOpt[];
  onStageMove: (id: string, from: PipelineStage, to: PipelineStage) => Promise<void>;
  moving: boolean;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const [detail, setDetail] = useState<{ leadId: string; ezcater: EzcaterOrderDetail | null; capacity: CateringCapacityResult | null } | null>(null);
  // Key the response to its lead: a switch hides old details before the next effect runs.
  const ezcater = detail?.leadId === lead.id ? detail.ezcater : null;
  const capacity = detail?.leadId === lead.id ? detail.capacity : null;
  // D-49: the final stage awaiting a second tap (Completed / Lost), or null.
  const [confirming, setConfirming] = useState<PipelineStage | null>(null);
  const confirmTitleId = useId();

  useEffect(() => {
    let alive = true;
    void fetch(`/api/catering/pipeline/${lead.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { capacity?: CateringCapacityResult; ezcater?: EzcaterOrderDetail | null } | null) => {
        if (alive) setDetail({ leadId: lead.id, capacity: d?.capacity ?? null, ezcater: d?.ezcater ?? null });
      })
      .catch(() => { if (alive) setDetail(null); });
    return () => {
      alive = false;
    };
  }, [lead.id]);

  const moveTo = useCallback(
    async (toStage: PipelineStage) => {
      if (moving) return;
      setConfirming(null);
      await onStageMove(lead.id, lead.stage, toStage);
    },
    [lead.id, lead.stage, moving, onStageMove],
  );

  const rev = money(lead.estimatedRevenueCents);
  // Only the moves the server will accept (LEGAL_TRANSITIONS); a closed lead (Completed / Lost) has none.
  const otherStages: readonly PipelineStage[] = LEGAL_TRANSITIONS[lead.stage] ?? [];
  const visibleNotes = ezcater ? humanEzcaterNotes(lead.notes) : lead.notes;

  return (
    <div className="mt-3 border-t border-co-border pt-3 text-sm">
      {capacity && lead.eventDate && (
        <div className="mb-2">
          <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${SIGNAL_TONE[capacity.signal]}`}>
            {t(`catering.pipeline.capacity.${capacity.signal}` as TranslationKey)}
            {capacity.remainingCovers != null && capacity.signal !== "unconfigured"
              ? ` · ${t("catering.pipeline.capacity.remaining").replace("{n}", String(Math.max(0, capacity.remainingCovers)))}`
              : ""}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {lead.contactPhone && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.phone")}</dt>
            <dd className="text-co-text">{lead.contactPhone}</dd>
          </>
        )}
        {visibleNotes?.trim() && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.notes")}</dt>
            <dd className="text-co-text">{visibleNotes}</dd>
          </>
        )}
        {lead.followUpDate && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.follow_up_date")}</dt>
            <dd className="text-co-text">{formatDateLabel(lead.followUpDate, language)}</dd>
          </>
        )}
        {rev && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.estimated_revenue")}</dt>
            <dd className="text-co-text">{rev}</dd>
          </>
        )}
      </dl>

      {ezcater && <EzcaterDetail detail={ezcater} />}

      <EzcaterReconciliationPanel leadId={lead.id} />

      {canTransfer && <TransferLead leadId={lead.id} locationId={lead.locationId} locations={locations} onMoved={onClose} />}

      {canWrite && <EditLeadDetails lead={lead} />}

      {canWrite && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-co-text-muted">{t("catering.pipeline.move_to")}</div>
          {otherStages.length === 0 && (
            <p className="mt-1 text-xs text-co-text-muted">{t("catering.pipeline.no_moves")}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {otherStages.map((s) => (
              <button
                key={s}
                type="button"
                disabled={moving || confirming !== null}
                onClick={() => (stageMoveNeedsConfirm(s) ? setConfirming(s) : void moveTo(s))}
                className="rounded-md border border-co-border px-2 py-1 text-xs text-co-text disabled:opacity-50"
              >
                {t(stageKey(s))}
              </button>
            ))}
          </div>
          {confirming && (
            <div
              role="group"
              aria-labelledby={confirmTitleId}
              data-testid="final-stage-confirm"
              className="mt-2 rounded-md border border-co-border bg-co-warning-surface p-3"
            >
              <p id={confirmTitleId} className="text-sm font-semibold text-co-warning-text">
                {t("catering.pipeline.confirm_final.title", { stage: t(stageKey(confirming)) })}
              </p>
              <p className="mt-1 text-xs text-co-text">{t("catering.pipeline.confirm_final.body")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={moving}
                  onClick={() => void moveTo(confirming)}
                  className="inline-flex min-h-[44px] items-center rounded-md bg-co-text px-4 text-sm font-semibold text-co-bg disabled:opacity-50"
                >
                  {t("catering.pipeline.confirm_final.yes", { stage: t(stageKey(confirming)) })}
                </button>
                <button
                  type="button"
                  disabled={moving}
                  onClick={() => setConfirming(null)}
                  className="inline-flex min-h-[44px] items-center rounded-md px-4 text-sm text-co-text-muted"
                >
                  {t("catering.pipeline.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Edit a lead in place (B5 #36) ────────────────────────────────────────────
// PATCH /api/catering/pipeline/[id] already edits these fields ("D3 — edit in place");
// the board only lacked a form. Sends ONLY the changed fields (leadEditPatch). D-48 adds the
// phone; a lead has no email column (email lives on the catering customer), so no email box.
function EditLeadDetails({ lead }: { lead: PipelineLead }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const formId = `lead-edit-${lead.id}`;

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const raw = (k: string) => (fd.get(k) as string | null) ?? "";
      const result = leadEditPatch(lead, {
        contactName: raw("contactName"),
        company: raw("company"),
        contactPhone: raw("contactPhone"),
        eventDate: raw("eventDate"),
        headcount: raw("headcount"),
        followUpDate: raw("followUpDate"),
        notes: raw("notes"),
      });
      if (!result.ok) {
        setErrorMsg(t("catering.pipeline.error.invalid_payload"));
        return;
      }
      if (Object.keys(result.patch).length === 0) {
        setOpen(false);
        return;
      }
      setBusy(true);
      setErrorMsg(null);
      const res = await postJson(`/api/catering/pipeline/${lead.id}`, result.patch, "PATCH");
      setBusy(false);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErrorMsg(t(resolveErrorKey(res.code)));
      }
    },
    [lead, router, t],
  );

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={formId}
        className="inline-flex min-h-[44px] items-center rounded-md border border-co-border px-3 text-xs font-semibold text-co-text"
      >
        {t("catering.pipeline.edit_details")}
      </button>
      {open && (
        /* B8 #2 — this form lives inside a ~15rem pipeline column, so it STACKS at every
           width: a viewport-breakpoint two-column grid split it into ~6rem columns at tablet width
           (labels wrapped, names and dates clipped). */
        <form id={formId} onSubmit={submit} className="mt-2 space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <Field label={t("catering.pipeline.field.contact_name")} name="contactName" required defaultValue={lead.contactName} />
            <Field label={t("catering.pipeline.field.company")} name="company" defaultValue={lead.company ?? ""} />
            <Field label={t("catering.pipeline.field.phone")} name="contactPhone" type="tel" defaultValue={lead.contactPhone ?? ""} />
            <Field label={t("catering.pipeline.field.event_date")} name="eventDate" type="date" defaultValue={lead.eventDate ?? ""} />
            <Field label={t("catering.pipeline.field.headcount")} name="headcount" type="number" defaultValue={lead.headcount != null ? String(lead.headcount) : ""} />
            <Field label={t("catering.pipeline.field.follow_up_date")} name="followUpDate" type="date" defaultValue={lead.followUpDate ?? ""} />
            <label className="block min-w-0 text-sm">
              <span className="text-co-text-muted">{t("catering.pipeline.field.notes")}</span>
              <textarea name="notes" rows={3} aria-label={t("catering.pipeline.field.notes")} defaultValue={lead.notes ?? ""} className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text" />
            </label>
          </div>
          {errorMsg && <p className="text-xs text-co-cta-text">{errorMsg}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="inline-flex min-h-[44px] items-center rounded-md bg-co-text px-4 text-sm font-semibold text-co-bg disabled:opacity-50">
              {busy ? t("catering.pipeline.saving") : t("catering.pipeline.save")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-md px-4 text-sm text-co-text-muted">
              {t("catering.pipeline.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Add-lead form ─────────────────────────────────────────────────────────────
function AddLeadRow({ locations, staff, defaultLocationId }: { locations: LocationOpt[]; staff: AssignableStaff[]; defaultLocationId: string | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const str = (k: string) => {
        const v = (fd.get(k) as string | null)?.trim();
        return v && v.length > 0 ? v : null;
      };
      const contactName = str("contactName");
      if (!contactName) {
        setErrorMsg(t("catering.pipeline.error.invalid_payload"));
        return;
      }
      const headcountRaw = str("headcount");
      const locationId = str("locationId");
      setBusy(true);
      setErrorMsg(null);
      const res = await postJson("/api/catering/pipeline", {
        contactName,
        company: str("company"),
        contactPhone: str("contactPhone"),
        contactEmail: str("contactEmail"),
        eventDate: str("eventDate"),
        headcount: headcountRaw ? Number(headcountRaw) : null,
        leadSource: str("leadSource"),
        assignedTo: str("assignedTo"),
        locationId,
        notes: str("notes"),
        followUpDate: str("followUpDate"),
      });
      setBusy(false);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErrorMsg(t(resolveErrorKey(res.code)));
      }
    },
    [router, t],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="co-card co-card-interactive px-4 py-2 text-sm font-semibold text-co-text"
      >
        + {t("catering.pipeline.add_lead")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="co-card space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("catering.pipeline.field.contact_name")} name="contactName" required />
        <Field label={t("catering.pipeline.field.company")} name="company" />
        <Field label={t("catering.pipeline.field.phone")} name="contactPhone" type="tel" />
        <Field label={t("catering.pipeline.field.email")} name="contactEmail" type="email" hint={t("catering.pipeline.field.email_hint")} />
        <Field label={t("catering.pipeline.field.event_date")} name="eventDate" type="date" />
        <Field label={t("catering.pipeline.field.headcount")} name="headcount" type="number" />
        <label className="block text-sm">
          <span className="text-co-text-muted">{t("catering.pipeline.field.lead_source")}</span>
          <select name="leadSource" defaultValue="staff" className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text">
            {LEAD_SOURCES.map((sc) => (
              <option key={sc} value={sc}>{t(`catering.intake.source.${sc}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-co-text-muted">{t("catering.intake.field.assigned_to")}</span>
          <select name="assignedTo" defaultValue="" className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text">
            <option value="">{t("catering.intake.unassigned")}</option>
            {staff.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <Field label={t("catering.pipeline.field.follow_up_date")} name="followUpDate" type="date" />
        <label className="block text-sm">
          <span className="text-co-text-muted">{t("catering.pipeline.field.location")}</span>
          <select name="locationId" defaultValue={defaultLocationId ?? ""} className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text">
            <option value="">{t("catering.pipeline.global")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-co-text-muted">{t("catering.pipeline.field.notes")}</span>
          <textarea name="notes" rows={2} className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text" />
        </label>
      </div>
      {errorMsg && <p className="text-xs text-co-cta-text">{errorMsg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-co-text px-4 py-2 text-sm font-semibold text-co-bg disabled:opacity-50">
          {t("catering.pipeline.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-4 py-2 text-sm text-co-text-muted">
          {t("catering.pipeline.cancel")}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  const hintId = useId();
  return (
    <label className="block min-w-0 text-sm">
      <span className="text-co-text-muted">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        aria-describedby={hint ? hintId : undefined}
        {...(type === "tel" ? { inputMode: "tel" as const, autoComplete: "off", maxLength: LEAD_PHONE_MAX } : {})}
        {...(type === "email" ? { inputMode: "email" as const, autoComplete: "off", autoCapitalize: "none", maxLength: LEAD_EMAIL_MAX } : {})}
        className="mt-1 min-h-[44px] w-full min-w-0 rounded-md border border-co-border bg-co-surface p-2 text-co-text"
      />
      {hint && <span id={hintId} className="mt-1 block text-xs text-co-text-dim">{hint}</span>}
    </label>
  );
}
