"use client";
/**
 * The person page's Skills section (Scheduling Phase 1, Task 17) — the MANAGER view.
 *
 * Disclosure doctrine: one summary row ("Skills · 5 positions · 1 adjusted", default-collapsed), then one
 * full-row toggle per position worked, observed, adjusted or rated (name, a bar, the value to two decimals,
 * the band, "based on N days", an "Adjusted +0.10" chip); its drawer holds the evidence lines, the
 * adjustment / rating history and — for a GM of the shop or MoO+ who outranks the person — the Adjust
 * control (− / + in 0.05 steps clamped to ±0.30, a reason, Save) and, while the skill is a starting point,
 * "Set a starting rating" (the same 0–1 scale in 0.05 steps, never stars; J5). Positions with no evidence sit
 * under a collapsed "Other positions". useState only; 44 px controls with items-center; 375 px safe.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabel } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ManagerSkillRow, ManagerSkillView } from "@/lib/people/skill-matrix-shared";
import {
  formatDelta, SKILL_ADJUSTMENT_LIMIT, SKILL_ADJUSTMENT_STEP, SKILL_REASON_CODES, type SkillEvidenceLine,
} from "@/lib/people/skills-shared";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const stepButton = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-lg font-bold text-co-text disabled:opacity-60";
const control = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";

const ERROR_CODES = [
  "forbidden", "not_found", "invalid_payload", "invalid_adjustment", "invalid_rating", "invalid_reason", "invalid_tunables",
  "role_insufficient", "location_access_denied", "assignee_unavailable", "position_not_at_shop", "position_retired",
  "skills_unavailable", "pm_v2_unavailable", "write_failed",
];
function errorKey(code: unknown): TranslationKey {
  return typeof code === "string" && ERROR_CODES.includes(code) ? (`people.skills.error.${code}` as TranslationKey) : "people.skills.error.generic";
}
const cents = (v: number) => Math.round(v * 100) / 100;

function useLine() {
  const { t, language } = useTranslation();
  return (line: SkillEvidenceLine) => {
    const params: Record<string, string | number> = { ...(line.params ?? {}) };
    if (typeof params.reason === "string") params.reason = t(`people.skills.reason.${params.reason}` as TranslationKey);
    if (typeof params.date === "string") params.date = formatDateLabel(params.date, language);
    return t(line.key as TranslationKey, params);
  };
}

/** `initiallyOpen` exists for the SSR tests only; the page renders it collapsed (the disclosure doctrine). */
export function SkillsSection({ view, initiallyOpen = false }: { view: ManagerSkillView; initiallyOpen?: boolean }) {
  const { t } = useTranslation();
  const shown = view.rows.filter((r) => r.hasEvidence);
  const others = view.rows.filter((r) => !r.hasEvidence);
  return (
    <section className="mt-6" aria-label={t("people.skills.title")}>
      <CollapsibleSection
        idBase="people-skills"
        title={t("people.skills.title")}
        count={t("people.skills.summary", { positions: shown.length, adjusted: view.adjustedCount })}
        defaultOpen={initiallyOpen}
      >
        <div className="grid gap-2">
          {shown.map((row) => <SkillRow key={row.position.positionId} row={row} view={view} initiallyOpen={initiallyOpen} />)}
          {view.unrecordedMinutes > 0 && (
            <p className="text-sm text-co-text-muted">{t("people.skills.unrecorded", { hours: Math.round(view.unrecordedMinutes / 60) })}</p>
          )}
          {others.length > 0 && (
            <CollapsibleSection idBase="people-skills-other" title={t("people.skills.otherPositions")} count={t("people.skills.positionsCount", { n: others.length })} defaultOpen={initiallyOpen}>
              <div className="grid gap-2">
                {others.map((row) => <SkillRow key={row.position.positionId} row={row} view={view} initiallyOpen={initiallyOpen} />)}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </CollapsibleSection>
    </section>
  );
}

function SkillRow({ row, view, initiallyOpen }: { row: ManagerSkillRow; view: ManagerSkillView; initiallyOpen: boolean }) {
  const { t, language } = useTranslation();
  const line = useLine();
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  const s = row.skill;
  const name = language === "es" && row.position.nameEs ? row.position.nameEs : row.position.name;
  const value = s.value.toFixed(2);
  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface">
      <button
        type="button"
        className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("people.skills.toggle", { name })}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1 basis-[10rem] font-bold text-co-text">{name}</span>
        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-co-surface-inset" role="img" aria-label={t("people.skills.barLabel", { value })}>
          <span className="block h-full bg-co-gold-deep" style={{ width: `${Math.round(s.value * 100)}%` }} />
        </span>
        <span className="font-bold tabular-nums text-co-text">{value}</span>
        <span className="text-sm text-co-text-muted">{t(`people.skills.band.${s.band}` as TranslationKey)}</span>
        <span className="text-sm text-co-text-muted">
          {s.startingPoint && s.qualityDays === 0 ? t("people.skills.startingPoint") : t("people.skills.basedOn", { n: s.qualityDays })}
        </span>
        {s.adjustment !== 0 && (
          <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("people.skills.adjustedChip", { delta: formatDelta(s.adjustment) })}</span>
        )}
      </button>
      {open && (
        <div id={id} className="grid gap-3 border-t-2 border-co-border px-3 py-3">
          <div>
            <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("people.skills.evidenceTitle")}</h4>
            {s.evidence.length ? (
              <ul className="mt-1 grid gap-1 text-sm text-co-text">{s.evidence.map((e, i) => <li key={i}>{line(e)}</li>)}</ul>
            ) : <p className="mt-1 text-sm text-co-text-muted">{t("people.skills.noEvidence")}</p>}
          </div>
          <div>
            <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("people.skills.historyTitle")}</h4>
            {row.history.length ? (
              <ul className="mt-1 grid gap-1 text-sm text-co-text">
                {row.history.map((h) => (
                  <li key={h.id}>
                    {h.kind === "adjustment"
                      ? t("people.skills.history.adjustment", { delta: formatDelta(h.value), actor: h.actorName, date: formatDateLabel(h.at.slice(0, 10), language), reason: t(`people.skills.reason.${h.reasonCode}` as TranslationKey) })
                      : t("people.skills.history.rating", { rating: h.value.toFixed(2), actor: h.actorName, date: formatDateLabel(h.at.slice(0, 10), language), reason: t(`people.skills.reason.${h.reasonCode}` as TranslationKey) })}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-co-text-muted">{t("people.skills.noHistory")}</p>}
          </div>
          {view.canAdjust && (
            <SkillControl kind="adjust" row={row} view={view} initial={s.adjustment} min={-SKILL_ADJUSTMENT_LIMIT} max={SKILL_ADJUSTMENT_LIMIT} />
          )}
          {view.canAdjust && s.startingPoint && (
            <SkillControl kind="rate" row={row} view={view} initial={Math.round(s.prior * 20) / 20} min={0} max={1} />
          )}
        </div>
      )}
    </div>
  );
}

function SkillControl({ kind, row, view, initial, min, max }: {
  kind: "adjust" | "rate"; row: ManagerSkillRow; view: ManagerSkillView; initial: number; min: number; max: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [draft, setDraft] = useState(cents(initial));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const step = (dir: 1 | -1) => setDraft((d) => cents(Math.min(max, Math.max(min, d + dir * SKILL_ADJUSTMENT_STEP))));
  const needsNote = reason === "other" && !/\S/.test(note);
  const shownValue = kind === "adjust" ? t("people.skills.adjust.value", { delta: formatDelta(draft) }) : t("people.skills.rate.value", { rating: draft.toFixed(2) });

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/people/skills", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: kind, locationId: view.locationId, userId: view.subjectId, positionId: row.position.positionId,
          [kind === "adjust" ? "delta" : "rating"]: draft, reasonCode: reason, ...(note.trim() ? { reasonNote: note.trim() } : {}),
        }),
      });
      if (!res.ok) { setError(errorKey((await res.json().catch(() => ({}))).code)); return; }
      setSaved(true);
      router.refresh();
    } catch {
      setError("people.skills.error.generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-3">
      <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t(kind === "adjust" ? "people.skills.adjust.title" : "people.skills.rate.title")}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={stepButton} aria-label={t("people.skills.adjust.decrease")} disabled={busy || draft <= min} onClick={() => step(-1)}>−</button>
        <span className="min-w-[8rem] text-center font-bold tabular-nums text-co-text" aria-live="polite">{shownValue}</span>
        <button type="button" className={stepButton} aria-label={t("people.skills.adjust.increase")} disabled={busy || draft >= max} onClick={() => step(1)}>+</button>
      </div>
      <label className={fieldLabel} htmlFor={`${id}-reason`}>
        {t("people.skills.adjust.reason")}
        <select id={`${id}-reason`} className={control} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
          <option value="">{t("people.skills.adjust.pickReason")}</option>
          {SKILL_REASON_CODES.map((c) => <option key={c} value={c}>{t(`people.skills.reason.${c}` as TranslationKey)}</option>)}
        </select>
      </label>
      <label className={fieldLabel} htmlFor={`${id}-note`}>
        {t("people.skills.adjust.note")}
        <input id={`${id}-note`} className={control} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </label>
      {needsNote && <p className="text-sm text-co-text-muted">{t("people.skills.adjust.noteRequired")}</p>}
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      {saved && <p className="text-sm font-bold text-co-confirm-text">{t("people.skills.adjust.saved")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !reason || needsNote} onClick={save}>
          {busy ? t("people.skills.adjust.saving") : t(kind === "adjust" ? "people.skills.adjust.save" : "people.skills.rate.save")}
        </button>
      </div>
    </div>
  );
}
