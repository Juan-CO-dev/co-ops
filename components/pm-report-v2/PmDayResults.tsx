"use client";
/**
 * PM v2 — a SUBMITTED day's results (Scheduling Phase 1, Task 21), for those `canReadPmDayResults` allows
 * (the day's authors, GM / Op-6 of the shop, MoO+; the lib refuses everyone else before this renders).
 *
 * Disclosure doctrine: per person and position a summary row ("Expeditor · Great 2.6 · 2 managers"); the
 * drawer holds each criterion's average with every manager's grade and minutes ("Dani · Great · 3h 10m"), the
 * write-ins attributed, and "Coming up again" (recurring themes over 30 days) with their quoted sources. A
 * "Copies" tab shows each copy whole: side by side at `lg` (two columns), stacked on a phone. useState only;
 * 44 px controls with items-center.
 */
import { useState } from "react";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PmDayResultsView, PmResultsPosition } from "@/lib/pm-report-v2";
import { gradeBand, type PmGrade } from "@/lib/pm-report-v2-shared";

const tab = (on: boolean) => `inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-4 font-bold ${on ? "border-co-text bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text"}`;

function useLabels() {
  const { t } = useTranslation();
  const grade = (g: PmGrade | null) => t(g === null ? "pmv2.grade.didntSee" : (`pmv2.grade.${g}` as TranslationKey));
  const minutes = (m: number) => {
    const h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? t("pmv2.duration.hm", { h, m: r }) : t("pmv2.duration.m", { m: r });
  };
  return { t, grade, minutes };
}

/** `initialTab` exists for the SSR tests only; the page opens on "By person". */
export function PmDayResults({ results, initiallyOpen = false, initialTab = "people" }: { results: PmDayResultsView; initiallyOpen?: boolean; initialTab?: "people" | "copies" }) {
  const { t, language } = useTranslation();
  const [view, setView] = useState<"people" | "copies">(initialTab);
  return (
    <section className="grid gap-3" aria-label={t("pmv2.results.title")}>
      <div className="co-card grid gap-2 p-4">
        <h2 className="text-base font-bold text-co-text">{t("pmv2.results.title")}</h2>
        {results.submittedByName && results.submittedAt && (
          <p className="text-sm text-co-text-muted">{t("pmv2.results.submittedBy", { name: results.submittedByName, time: formatTime(results.submittedAt, language) })}</p>
        )}
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={view === "people"} className={tab(view === "people")} onClick={() => setView("people")}>{t("pmv2.results.byPerson")}</button>
          <button type="button" role="tab" aria-selected={view === "copies"} className={tab(view === "copies")} onClick={() => setView("copies")}>{t("pmv2.results.copies", { n: results.copies.length })}</button>
        </div>
      </div>
      {view === "people" ? results.people.map((p) => (
        <div key={p.subjectId} className="co-card grid gap-2 p-4">
          <h3 className="font-bold text-co-text">{p.name}</h3>
          {p.positions.map((pos) => <PositionResult key={pos.positionId ?? "none"} position={pos} initiallyOpen={initiallyOpen} />)}
        </div>
      )) : <Copies results={results} />}
    </section>
  );
}

function PositionResult({ position, initiallyOpen }: { position: PmResultsPosition; initiallyOpen: boolean }) {
  const { t, grade, minutes } = useLabels();
  const { language } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const name = position.positionId === null ? t("pmv2.position.none") : (language === "es" && position.nameEs ? position.nameEs : position.name ?? "");
  const avg = position.summary.average;
  const id = `pmv2-res-${position.positionId ?? "none"}`;
  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface">
      <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 basis-[10rem] font-bold text-co-text">{name}</span>
        <span className="text-sm text-co-text">
          {avg === null ? t("pmv2.results.notObserved") : t("pmv2.results.summary", { band: t(`pmv2.band.${gradeBand(avg)}` as TranslationKey), avg: avg.toFixed(1), n: position.summary.managers })}
        </span>
      </button>
      {open && (
        <div id={id} className="grid gap-3 border-t-2 border-co-border px-3 py-3">
          <ul className="grid gap-2">
            {position.cells.map((c) => (
              <li key={c.criterionId} className="grid gap-1">
                <span className="text-sm font-bold text-co-text">
                  {(language === "es" && c.labelEs ? c.labelEs : c.label)} · {c.average === null ? t("pmv2.results.notObserved") : c.average.toFixed(1)}
                  {c.weights === "equal_fallback" ? ` · ${t("pmv2.results.equalWeights")}` : ""}
                </span>
                <span className="text-sm text-co-text-muted">{c.contributionsNamed.map((x) => t("pmv2.results.contribution", { name: x.authorName, grade: grade(x.grade), time: minutes(x.minutes) })).join(" · ")}</span>
              </li>
            ))}
          </ul>
          {position.writeIns.length > 0 && (
            <div>
              <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("pmv2.results.writeIns")}</h4>
              <ul className="mt-1 grid gap-1 text-sm text-co-text">{position.writeIns.map((w, i) => <li key={i}>{t("pmv2.results.writeIn", { name: w.authorName, text: w.text })}</li>)}</ul>
            </div>
          )}
          {position.themes.length > 0 && (
            <div>
              <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("pmv2.results.themes")}</h4>
              <ul className="mt-1 grid gap-2 text-sm text-co-text">
                {position.themes.map((th) => (
                  <li key={th.stem}>
                    <span className="font-bold">{th.term}</span> · {t("pmv2.results.themeCount", { authors: th.authors, days: th.days })}
                    <ul className="mt-1 grid gap-1 text-co-text-muted">{th.sources.map((s) => <li key={s.noteId}>{t("pmv2.results.quote", { name: s.authorName ?? "", text: s.text })}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Copies({ results }: { results: PmDayResultsView }) {
  const { t, grade } = useLabels();
  const { language } = useTranslation();
  // Criterion and position labels in the reader's language (Astra chunk F P3); English when no Spanish exists.
  const pick = <T extends string | null>(en: T, es: string | null): T | string => (language === "es" && es ? es : en);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {results.copies.map((c) => (
        <div key={c.copyId} className="co-card grid gap-2 p-4">
          <h3 className="font-bold text-co-text">{c.authorName}</h3>
          <p className="text-sm text-co-text-muted">
            {c.observedFrom ? t("pmv2.results.window", { from: formatTime(c.observedFrom, language), to: c.observedTo ? formatTime(c.observedTo, language) : "—" }) : t("pmv2.results.noWindow")}
          </p>
          <ul className="grid gap-1 text-sm text-co-text">
            {c.entries.map((e, i) => {
              const position = pick(e.positionName, e.positionNameEs);
              return <li key={i}>{e.subjectName}{position ? ` · ${position}` : ""} · {pick(e.criterion, e.criterionEs)} · {grade(e.grade)}</li>;
            })}
          </ul>
          {c.notes.length > 0 && <ul className="grid gap-1 text-sm text-co-text-muted">{c.notes.map((n, i) => {
            const position = pick(n.positionName, n.positionNameEs);
            return <li key={i}>{n.subjectName}{position ? ` · ${position}` : ""}: {n.text}</li>;
          })}</ul>}
        </div>
      ))}
    </div>
  );
}
