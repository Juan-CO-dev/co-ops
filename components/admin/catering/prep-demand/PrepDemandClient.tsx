"use client";

/**
 * PrepDemandClient — W4a Catering Prep Demand manager view.
 *
 * READ-ONLY: no mutations, no step-up. Shows upcoming catering prep demand
 * per date for a selected location, with:
 *   - Location selector (router.push on change — server reloads with fresh data)
 *   - Date window caption (from–to)
 *   - Per-day sections: per line, renders differently by refKind:
 *       choice   → slot name + "needs pick" badge; no par math
 *       menu_item→ qty × [portion] name + info note ("sub — par comparison in W4b")
 *       item     → qty × name; if overPar → amber alert chip + par-bump affordance
 *   - Empty state when days is empty
 */

import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { Language } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";
import type { PrepDemandDay, PrepDemandLine } from "@/lib/catering/prep-demand";
import type { PackageLocationOption } from "@/lib/admin/catering/packages";

// Portion label map: quarter → ¼, half → ½, whole → (no prefix).
const PORTION_LABELS: Record<string, string> = {
  quarter: "¼",
  half: "½",
  whole: "",
};

function portionPrefix(portion: string | null): string {
  if (!portion) return "";
  const label = PORTION_LABELS[portion];
  if (label === undefined) return "";
  return label ? `${label} ` : "";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  days: PrepDemandDay[];
  locations: PackageLocationOption[];
  locationId: string | null;
  from: string;
  to: string;
  lang: Language;
}

// ─── PrepDemandClient ─────────────────────────────────────────────────────────

export function PrepDemandClient({ days, locations, locationId, from, to, lang }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  const fromLabel = formatDateLabel(from, lang);
  const toLabel = formatDateLabel(to, lang);

  return (
    <div className="mt-5">
      {/* ─── Location selector ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.prep_demand.location" as TranslationKey)}
          </span>
          <select
            className={fieldCls}
            value={locationId ?? ""}
            aria-label={t("admin.catering.prep_demand.location" as TranslationKey)}
            onChange={(e) => {
              const id = e.target.value;
              if (id) router.push(`/admin/catering/prep-demand?location=${id}`);
            }}
          >
            {locations.length === 0 ? (
              <option value="">{t("admin.catering.prep_demand.empty" as TranslationKey)}</option>
            ) : (
              locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))
            )}
          </select>
        </label>
        {/* Date window caption */}
        <p className="text-xs text-co-text-muted">
          {t("admin.catering.prep_demand.date_window" as TranslationKey, {
            from: fromLabel,
            to: toLabel,
          })}
        </p>
      </div>

      {/* ─── Day list ──────────────────────────────────────────────────── */}
      <div className="mt-5">
        {days.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
            {t("admin.catering.prep_demand.empty" as TranslationKey)}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {days.map((day) => (
              <DaySection key={day.needDate} day={day} t={t} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DaySection ───────────────────────────────────────────────────────────────

function DaySection({
  day,
  t,
  lang,
}: {
  day: PrepDemandDay;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: Language;
}) {
  const dateLabel = formatDateLabel(day.needDate, lang);

  return (
    <section>
      {/* Date header */}
      <h2 className="mb-2 text-sm font-extrabold uppercase tracking-[0.08em] text-co-text">
        {dateLabel}
      </h2>
      <ul className="flex flex-col gap-2">
        {day.lines.map((line) => (
          <li key={line.key}>
            <DemandLine line={line} t={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── DemandLine ───────────────────────────────────────────────────────────────

function DemandLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  if (line.refKind === "choice") {
    return <ChoiceLine line={line} t={t} />;
  }
  if (line.refKind === "menu_item") {
    return <MenuItemLine line={line} t={t} />;
  }
  return <ItemLine line={line} t={t} />;
}

// ─── ChoiceLine ───────────────────────────────────────────────────────────────

function ChoiceLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium">{line.name}</span>
      <span className="inline-flex items-center rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text">
        {t("admin.catering.prep_demand.needs_pick" as TranslationKey)}
      </span>
    </div>
  );
}

// ─── MenuItemLine ─────────────────────────────────────────────────────────────

function MenuItemLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const prefix = portionPrefix(line.portion);
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      <span className="font-medium">
        {line.qty}
        {" × "}
        {prefix}
        {line.name}
      </span>
      <span className="text-xs text-co-text-muted">
        {t("admin.catering.prep_demand.sub_note" as TranslationKey)}
      </span>
    </div>
  );
}

// ─── ItemLine ─────────────────────────────────────────────────────────────────

function ItemLine({
  line,
  t,
}: {
  line: PrepDemandLine;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const suggestedPar =
    line.overPar
      ? (line.parValue ?? 0) + Math.ceil(line.wholeEquivDemand)
      : null;

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {line.qty}
          {" × "}
          {line.name}
        </span>
        {line.overPar ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">
            {t("admin.catering.prep_demand.over_par" as TranslationKey, {
              par: line.parValue != null ? String(line.parValue) : t("admin.catering.prep_demand.no_par" as TranslationKey),
              needed: String(Math.ceil(line.wholeEquivDemand)),
            })}
          </span>
        ) : null}
      </div>

      {/* Par-bump affordance — only when overPar */}
      {line.overPar && suggestedPar !== null ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-co-text-muted">
          <span>
            {t("admin.catering.prep_demand.suggested_par" as TranslationKey, {
              value: String(suggestedPar),
            })}
          </span>
          <a
            href={`/admin/pars`}
            className="inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.catering.prep_demand.raise_par" as TranslationKey)}
          </a>
        </div>
      ) : null}
    </div>
  );
}
