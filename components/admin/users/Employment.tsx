"use client";

/**
 * Employment status on the Users screen (staff separations, Juan 2026-10-20; migration 0279).
 *
 *  - `EmploymentChip`: what EVERYONE who can see the person sees — "On leave until …" / "Separated · rehire OK" /
 *    "Separated · not eligible for rehire" / "Separated · owner OK needed". Never a reason.
 *  - `EmploymentRecord`: the reasons and notes, default-collapsed (disclosure doctrine D3), rendered ONLY when the server
 *    sent them (`view.detail` is null for anyone but the owner / MoO / CGS and the GM of the person's shop — the
 *    redaction is server-side, this component cannot widen it).
 *  - `EmploymentDialog`: End employment (on leave · separated), Back from leave, Rehire, Correct record. Every one is a
 *    Tier B write (`requestStepUp("B")`, like Deactivate) to POST /api/admin/users/[id]/employment with the head the
 *    screen loaded (`expectedId`); a moved record answers `employment_moved`.
 *  - `RehireMatches`: the Add user warning (same phone or same Toast employee — never a name).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  EMPLOYMENT_NOTE_MAX, EMPLOYMENT_REASON_MAX, employmentChipKey, LEAVE_REASONS, REHIRE_SETTINGS, SEPARATION_TYPES,
  type EmploymentChip as Chip, type EmploymentDetail, type EmploymentView, type LeaveReason, type RehireSetting, type SeparationType,
} from "@/lib/admin/employment-shared";
import type { RehireMatch } from "@/lib/admin/employment";
import { postJson, resolveErrorKey } from "./shared";

const FIELD = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
const AREA = "mt-1 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

const chipKey = (chip: Chip): TranslationKey => employmentChipKey(chip);

export function EmploymentChip({ view }: { view: EmploymentView | undefined }) {
  const { t, language } = useTranslation();
  if (!view?.chip) return null;
  const chip = view.chip;
  const tone = chip.status === "on_leave" ? "border-co-warning bg-co-warning-surface text-co-warning-text" : "border-co-border-2 bg-co-surface-inset text-co-text";
  return (
    <span data-employment-chip={chip.status} className={`inline-flex min-h-[28px] items-center rounded-full border px-2.5 text-xs font-bold ${tone}`}>
      {t(chipKey(chip), chip.status === "on_leave" && chip.until ? { date: formatDateLabel(chip.until, language) } : undefined)}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{label}</dt>
      <dd className="text-sm text-co-text">{value}</dd>
    </div>
  );
}

/** The reasons, for the viewers the server sent them to. Default-collapsed. */
export function EmploymentRecord({ detail }: { detail: EmploymentDetail | null }) {
  const { t, language } = useTranslation();
  if (!detail) return null;
  const date = (d: string) => formatDateLabel(d, language);
  return (
    <details className="mt-2 rounded-lg border border-co-border bg-co-surface-inset" data-employment-record>
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-bold text-co-text">
        {t("admin.users.employment.detail.title")}
        {detail.corrected ? <span className="ml-2 text-xs font-normal text-co-text-muted">· {t("admin.users.employment.detail.corrected")}</span> : null}
      </summary>
      <dl className="flex flex-col gap-2 px-3 pb-3">
        <Row label={t("admin.users.employment.detail.since")} value={date(etCalendarDate(detail.since))} />
        {detail.kind === "on_leave" ? (
          <>
            <Row label={t("admin.users.employment.field.leave_reason")} value={t(`admin.users.employment.leave_reason.${detail.leaveReason}` as TranslationKey)} />
            <Row label={t("admin.users.employment.detail.expected_back")} value={detail.expectedBack ? date(detail.expectedBack) : "—"} />
            {detail.note ? <Row label={t("admin.users.employment.field.note")} value={detail.note} /> : null}
          </>
        ) : (
          <>
            <Row label={t("admin.users.employment.field.separation_type")} value={t(`admin.users.employment.separation_type.${detail.separationType}` as TranslationKey)} />
            <Row label={t("admin.users.employment.field.last_day")} value={date(detail.lastDayWorked)} />
            <Row label={t("admin.users.employment.field.reason")} value={detail.reason} />
            <Row label={t("admin.users.employment.field.rehire")} value={t(`admin.users.employment.rehire.${detail.rehire}` as TranslationKey)} />
            {detail.rehireNote ? <Row label={t("admin.users.employment.field.rehire_note")} value={detail.rehireNote} /> : null}
          </>
        )}
      </dl>
    </details>
  );
}

export type EmploymentMode = "end" | "back" | "rehire" | "correct";

interface LeaveDraft { leaveReason: LeaveReason; expectedBack: string; note: string }
interface SepDraft { separationType: SeparationType; lastDayWorked: string; reason: string; rehire: RehireSetting; rehireNote: string }

/** The first draft of a form: a correction starts from the record in force; a new separation from today. */
function drafts(detail: EmploymentDetail | null, today: string): { leave: LeaveDraft; sep: SepDraft } {
  return {
    leave: detail?.kind === "on_leave" ? { leaveReason: detail.leaveReason, expectedBack: detail.expectedBack ?? "", note: detail.note ?? "" }
      : { leaveReason: "school", expectedBack: "", note: "" },
    sep: detail?.kind === "separated" ? { separationType: detail.separationType, lastDayWorked: detail.lastDayWorked, reason: detail.reason,
      rehire: detail.rehire, rehireNote: detail.rehireNote ?? "" }
      : { separationType: "quit", lastDayWorked: today, reason: "", rehire: "yes", rehireNote: "" },
  };
}

export function EmploymentDialog({ userId, name, view, mode, onClose, today, initialKind }: {
  userId: string; name: string; view: EmploymentView; mode: EmploymentMode; onClose: () => void;
  /** The ET business date (the default last day worked). */
  today: string;
  /** SSR tests / screenshots only: which branch of "End employment" starts selected. */
  initialKind?: "leave" | "separated";
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const start = drafts(view.detail, today);
  // From on leave, End employment is a separation only (Astra BC-036): another leave is never offered.
  const leaveOffered = view.status === "active";
  const [kind, setKind] = useState<"leave" | "separated">(
    !leaveOffered && mode === "end" ? "separated" : initialKind ?? (mode === "correct" && view.status === "separated" ? "separated" : "leave"));
  const [leave, setLeave] = useState<LeaveDraft>(start.leave);
  const [sep, setSep] = useState<SepDraft>(start.sep);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rehireSetting = view.chip?.status === "separated" ? view.chip.rehire : null;
  const needsReason = mode === "rehire" && rehireSetting !== null && rehireSetting !== "yes";
  const isLeave = mode === "correct" ? view.status === "on_leave" : kind === "leave";
  const sepInvalid = !isLeave && (mode === "end" || mode === "correct")
    && (sep.reason.trim() === "" || !sep.lastDayWorked || (sep.rehire !== "yes" && sep.rehireNote.trim() === ""));
  const blocked = submitting || sepInvalid || (needsReason && note.trim() === "");

  const fieldsOf = (): { act: string; fields: Record<string, unknown> } => {
    const leaveFields = { leaveReason: leave.leaveReason, expectedBack: leave.expectedBack || null, note: leave.note.trim() || null };
    const sepFields = { separationType: sep.separationType, lastDayWorked: sep.lastDayWorked, reason: sep.reason.trim(), rehire: sep.rehire,
      ...(sep.rehire === "yes" ? {} : { rehireNote: sep.rehireNote.trim() }) };
    if (mode === "back") return { act: "leave_end", fields: note.trim() ? { note: note.trim() } : {} };
    if (mode === "rehire") return { act: "rehired", fields: note.trim() ? { note: note.trim() } : {} };
    if (mode === "correct") return { act: "correction", fields: { correctsId: view.detail?.eventId, ...(isLeave ? leaveFields : sepFields) } };
    return isLeave ? { act: "leave_start", fields: leaveFields } : { act: "separated", fields: sepFields };
  };

  const submit = async () => {
    if (blocked) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const { act, fields } = fieldsOf();
    const r = await postJson(`/api/admin/users/${userId}/employment`, { act, fields, expectedId: view.headId });
    setSubmitting(false);
    if (r.ok) { onClose(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(r.code)));
  };

  const titleKey: TranslationKey = mode === "end" ? "admin.users.employment.end.title" : mode === "back" ? "admin.users.employment.action.back"
    : mode === "rehire" ? "admin.users.employment.action.rehire" : "admin.users.employment.action.correct";

  return (
    <div role="dialog" aria-modal="true" aria-label={`${name} · ${t(titleKey)}`} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4">
      <div className="mt-8 w-full max-w-md rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
        <h2 className="text-base font-extrabold text-co-text">{name} · {t(titleKey)}</h2>
        <div className="mt-4 flex flex-col gap-3">
          {mode === "end" ? (
            <fieldset>
              <legend className="text-sm font-bold text-co-text">{t("admin.users.employment.end.choose")}</legend>
              <div className="mt-2 flex flex-col gap-2">
                {(leaveOffered ? (["leave", "separated"] as const) : (["separated"] as const)).map((k) => (
                  <label key={k} className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3">
                    <input type="radio" name={`end-${userId}`} checked={kind === k} onChange={() => setKind(k)} className="h-5 w-5 accent-co-gold" />
                    <span className="text-sm text-co-text">{t(k === "leave" ? "admin.users.employment.end.leave" : "admin.users.employment.end.separated")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {(mode === "end" || mode === "correct") && isLeave ? (
            <>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.leave_reason")}</span>
                <select value={leave.leaveReason} onChange={(e) => setLeave({ ...leave, leaveReason: e.target.value as LeaveReason })} className={FIELD}>
                  {LEAVE_REASONS.map((r) => <option key={r} value={r}>{t(`admin.users.employment.leave_reason.${r}` as TranslationKey)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.expected_back")}</span>
                <input type="date" value={leave.expectedBack} onChange={(e) => setLeave({ ...leave, expectedBack: e.target.value })} className={FIELD} />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.note_optional")}</span>
                <textarea rows={2} maxLength={EMPLOYMENT_NOTE_MAX} value={leave.note} onChange={(e) => setLeave({ ...leave, note: e.target.value })} className={AREA} />
              </label>
              {mode === "end" ? <p className="text-xs text-co-text-muted">{t("admin.users.employment.leave_effect")}</p> : null}
            </>
          ) : null}

          {(mode === "end" || mode === "correct") && !isLeave ? (
            <>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.separation_type")}</span>
                <select value={sep.separationType} onChange={(e) => setSep({ ...sep, separationType: e.target.value as SeparationType })} className={FIELD}>
                  {SEPARATION_TYPES.map((r) => <option key={r} value={r}>{t(`admin.users.employment.separation_type.${r}` as TranslationKey)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.last_day")}</span>
                <input type="date" required value={sep.lastDayWorked} onChange={(e) => setSep({ ...sep, lastDayWorked: e.target.value })} className={FIELD} />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.reason")}</span>
                <textarea rows={3} required maxLength={EMPLOYMENT_REASON_MAX} value={sep.reason} onChange={(e) => setSep({ ...sep, reason: e.target.value })} className={AREA} />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.rehire")}</span>
                <select value={sep.rehire} onChange={(e) => setSep({ ...sep, rehire: e.target.value as RehireSetting })} className={FIELD}>
                  {REHIRE_SETTINGS.map((r) => <option key={r} value={r}>{t(`admin.users.employment.rehire.${r}` as TranslationKey)}</option>)}
                </select>
              </label>
              {sep.rehire !== "yes" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.users.employment.field.rehire_note")}</span>
                  <textarea rows={2} required maxLength={EMPLOYMENT_NOTE_MAX} value={sep.rehireNote} onChange={(e) => setSep({ ...sep, rehireNote: e.target.value })} className={AREA} />
                  <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.employment.rehire_note_hint")}</span>
                </label>
              ) : null}
              {mode === "end" ? <p className="text-xs text-co-text-muted">{t("admin.users.employment.separated_effect")}</p> : null}
              <p className="text-xs text-co-text-muted">{t("admin.users.employment.privacy")}</p>
            </>
          ) : null}

          {mode === "back" ? <p className="text-sm text-co-text">{t("admin.users.employment.back.confirm")}</p> : null}
          {mode === "rehire" ? <p className="text-sm text-co-text">{t("admin.users.employment.rehire.confirm")}</p> : null}
          {mode === "rehire" && rehireSetting ? (
            <p className="text-sm font-bold text-co-text">{t(`admin.users.employment.chip.separated_${rehireSetting}` as TranslationKey)}</p>
          ) : null}
          {mode === "back" || mode === "rehire" ? (
            <label className="block">
              <span className="text-sm font-bold text-co-text">
                {t(needsReason ? "admin.users.employment.field.rehire_reason" : "admin.users.employment.field.note_optional")}
              </span>
              <textarea rows={2} required={needsReason} maxLength={EMPLOYMENT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} className={AREA} />
            </label>
          ) : null}

          {errorMsg ? <p role="alert" className="text-sm text-co-cta-text">{errorMsg}</p> : null}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50">
            {t("admin.users.cancel")}
          </button>
          <button type="button" onClick={() => void submit()} disabled={blocked}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50">
            {t("admin.users.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Add user warning: people this may be (same phone / same Toast employee), their chip, the reasons when sent. */
export function RehireMatches({ matches }: { matches: RehireMatch[] }) {
  const { t } = useTranslation();
  if (matches.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border-2 border-co-warning bg-co-warning-surface p-3" data-rehire-matches>
      <p className="text-sm font-bold text-co-warning-text">{t("admin.users.rehire.title")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {matches.map((m) => (
          <li key={m.userId} className="rounded-lg bg-co-surface p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-co-text">{m.name}</span>
              <EmploymentChip view={m.view} />
            </div>
            <p className="mt-1 text-xs text-co-text-muted">{m.by.map((b) => t(b === "phone" ? "admin.users.rehire.by_phone" : "admin.users.rehire.by_toast")).join(" · ")}</p>
            <EmploymentRecord detail={m.view.detail} />
            {!m.mayProceed ? (
              <p className="mt-1 text-xs font-bold text-co-cta-text">{t(m.rehire === "no" ? "admin.users.rehire.cannot_owner" : "admin.users.rehire.cannot_owner_ok")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
