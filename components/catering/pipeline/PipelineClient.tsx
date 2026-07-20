"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { PIPELINE_STAGES, type PipelineStage, type PipelineLead, type PipelineSearchResult } from "@/lib/catering/pipeline";
import type { CateringCapacityResult } from "@/lib/catering/capacity";
import { postJson, resolveErrorKey } from "./shared";

interface LocationOpt {
  id: string;
  name: string;
}
interface Props {
  leads: PipelineLead[];
  followUps: PipelineLead[];
  locations: LocationOpt[];
  actorLevel: number;
  writeMin: number;
  searchQuery: string;
  results: PipelineSearchResult[] | null;
}

const SIGNAL_TONE: Record<CateringCapacityResult["signal"], string> = {
  available: "bg-co-success/15 text-co-success",
  limited: "bg-co-gold/25 text-co-text",
  unavailable: "bg-co-cta/15 text-co-cta",
  blackout: "bg-co-cta/15 text-co-cta",
  below_lead_time: "bg-co-gold/25 text-co-text",
  unconfigured: "bg-co-surface text-co-text-muted",
};

function stageKey(s: PipelineStage): TranslationKey {
  return `catering.pipeline.stage.${s}` as TranslationKey;
}

export function PipelineClient({ leads, followUps, locations, actorLevel, searchQuery, results }: Props) {
  const { t, language } = useTranslation();
  const canWrite = actorLevel >= 6;

  const money = (cents: number | null) => (cents == null ? null : formatCents(cents, language));

  const byStage: Record<PipelineStage, PipelineLead[]> = {
    inquiry: [],
    quote_sent: [],
    confirmed: [],
    out: [],
    completed: [],
    lost: [],
  };
  for (const l of leads) byStage[l.stage].push(l);

  return (
    <div className="mt-4 space-y-6">
      {/* Search box — always visible */}
      <SearchBox searchQuery={searchQuery} />

      {results != null ? (
        /* SEARCH MODE */
        <SearchResults results={results} searchQuery={searchQuery} money={money} />
      ) : (
        /* BOARD MODE */
        <>
          {canWrite && <AddLeadRow locations={locations} />}

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
                    <span className="text-co-cta">
                      {t("catering.pipeline.follow_ups.due")} {l.followUpDate}
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
                    byStage[stage].map((lead) => <LeadCard key={lead.id} lead={lead} money={money} canWrite={canWrite} />)
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
          className="w-full min-h-[44px] rounded-md border border-co-card-border bg-co-surface px-3 py-2 text-sm text-co-text placeholder:text-co-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60"
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
          className="min-h-[44px] rounded-md border border-co-card-border px-3 py-2 text-sm text-co-text-muted hover:text-co-text"
        >
          {t("catering.pipeline.search.clear" as TranslationKey)}
        </button>
      )}
    </form>
  );
}

// ── Search results ────────────────────────────────────────────────────────────
function SearchResults({
  results,
  searchQuery,
  money,
}: {
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
          <SearchResultCard key={r.id} result={r} money={money} />
        ))}
      </div>
    </div>
  );
}

function SearchResultCard({
  result: r,
  money,
}: {
  result: PipelineSearchResult;
  money: (cents: number | null) => string | null;
}) {
  const { t } = useTranslation();
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
        </div>
        <span className="inline-block rounded-md bg-co-surface px-2 py-0.5 text-xs font-medium text-co-text-muted border border-co-card-border">
          {t(stageKey(r.stage))}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {r.eventDate && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.event_date")}</dt>
            <dd className="text-co-text">{r.eventDate}</dd>
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
  lead,
  money,
  canWrite,
}: {
  lead: PipelineLead;
  money: (c: number | null) => string | null;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
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
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-co-text-muted">
          {lead.eventDate && <span>{lead.eventDate}</span>}
          {lead.headcount != null && <span>{t("catering.pipeline.headcount_short").replace("{n}", String(lead.headcount))}</span>}
          {lead.leadSource && <span>{lead.leadSource}</span>}
          {rev && <span>{rev}</span>}
        </div>
      </button>
      {open && <LeadDetail lead={lead} money={money} canWrite={canWrite} onClose={() => setOpen(false)} />}
    </div>
  );
}

function LeadDetail({
  lead,
  money,
  canWrite,
  onClose,
}: {
  lead: PipelineLead;
  money: (c: number | null) => string | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [capacity, setCapacity] = useState<CateringCapacityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/catering/pipeline/${lead.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { capacity?: CateringCapacityResult } | null) => {
        if (alive && d?.capacity) setCapacity(d.capacity);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lead.id]);

  const moveTo = useCallback(
    async (toStage: PipelineStage) => {
      setBusy(true);
      setErrorMsg(null);
      const res = await postJson(`/api/catering/pipeline/${lead.id}`, { stage: toStage }, "PATCH");
      setBusy(false);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setErrorMsg(t(resolveErrorKey(res.code)));
      }
    },
    [lead.id, router, t, onClose],
  );

  const rev = money(lead.estimatedRevenueCents);
  const otherStages = PIPELINE_STAGES.filter((s) => s !== lead.stage);

  return (
    <div className="mt-3 border-t border-co-card-border pt-3 text-sm">
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
        {lead.notes && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.notes")}</dt>
            <dd className="text-co-text">{lead.notes}</dd>
          </>
        )}
        {lead.followUpDate && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.follow_up_date")}</dt>
            <dd className="text-co-text">{lead.followUpDate}</dd>
          </>
        )}
        {rev && (
          <>
            <dt className="text-co-text-muted">{t("catering.pipeline.field.estimated_revenue")}</dt>
            <dd className="text-co-text">{rev}</dd>
          </>
        )}
      </dl>

      {canWrite && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-co-text-muted">{t("catering.pipeline.move_to")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {otherStages.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void moveTo(s)}
                className="rounded-md border border-co-card-border px-2 py-1 text-xs text-co-text disabled:opacity-50"
              >
                {t(stageKey(s))}
              </button>
            ))}
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-2 text-xs text-co-cta">{errorMsg}</p>}
    </div>
  );
}

// ── Add-lead form ─────────────────────────────────────────────────────────────
function AddLeadRow({ locations }: { locations: LocationOpt[] }) {
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
        eventDate: str("eventDate"),
        headcount: headcountRaw ? Number(headcountRaw) : null,
        leadSource: str("leadSource"),
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
        <Field label={t("catering.pipeline.field.event_date")} name="eventDate" type="date" />
        <Field label={t("catering.pipeline.field.headcount")} name="headcount" type="number" />
        <Field label={t("catering.pipeline.field.lead_source")} name="leadSource" />
        <Field label={t("catering.pipeline.field.follow_up_date")} name="followUpDate" type="date" />
        <label className="block text-sm">
          <span className="text-co-text-muted">{t("catering.pipeline.field.location")}</span>
          <select name="locationId" className="mt-1 w-full rounded-md border border-co-card-border bg-co-surface p-2 text-co-text">
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
          <textarea name="notes" rows={2} className="mt-1 w-full rounded-md border border-co-card-border bg-co-surface p-2 text-co-text" />
        </label>
      </div>
      {errorMsg && <p className="text-xs text-co-cta">{errorMsg}</p>}
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-co-text-muted">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1 w-full rounded-md border border-co-card-border bg-co-surface p-2 text-co-text"
      />
    </label>
  );
}
