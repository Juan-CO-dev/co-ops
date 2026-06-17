"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type {
  Gradient,
  EmployeeEval,
  PmReportForEdit,
  ShiftWrapUpRow,
} from "@/lib/pm-report";
import type { OverdueState, ReportKey, ReportStatusRow } from "@/lib/midshift";
import { ActionButton } from "@/components/ActionButton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  locationId: string;
  report: PmReportForEdit | null;
  timeliness: ReportStatusRow[];
  locationUsers: { id: string; name: string }[];
  language: Language;
  submitted: boolean;
}

// Per-card save state.
type SaveState = "idle" | "saving" | "saved" | "error";

// ─── Gradient i18n map — Record<Gradient, TranslationKey> avoids string-concat casts ──

const GRADIENT_LABEL: Record<Gradient, TranslationKey> = {
  great: "pm.attitude.great",
  good: "pm.attitude.good",
  needs_work: "pm.attitude.needs_work",
};

const GRADIENT_VALUES: Gradient[] = ["great", "good", "needs_work"];

// ─── Timeliness badge ─────────────────────────────────────────────────────────

const OVERDUE_KEY: Record<OverdueState, TranslationKey> = {
  ok: "midshift.progress.done",
  overdue: "midshift.overdue.badge",
  not_due_yet: "midshift.overdue.not_due_yet",
};

const REPORT_LABEL_KEY: Record<ReportKey, TranslationKey> = {
  opening: "midshift.report.opening",
  am_prep: "midshift.report.am_prep",
  mid_day: "midshift.report.mid_day",
  cash: "midshift.report.cash",
  closing: "midshift.report.closing",
};

// ─── EmployeeEvalCard ─────────────────────────────────────────────────────────

function EmployeeEvalCard({
  employeeId,
  employeeName,
  existing,
  pmReportId,
  locationId,
  readOnly,
}: {
  employeeId: string;
  employeeName: string;
  existing: EmployeeEval | undefined;
  pmReportId: string;
  locationId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [arrivedReady, setArrivedReady] = useState<Gradient>(existing?.arrivedReady ?? "good");
  const [attitude, setAttitude] = useState<Gradient>(existing?.attitude ?? "good");
  const [production, setProduction] = useState<Gradient>(existing?.production ?? "good");
  const [teamPlayer, setTeamPlayer] = useState<Gradient>(existing?.teamPlayer ?? "good");
  const [area, setArea] = useState(existing?.areaToImprove ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveState("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/pm-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({
          action: "save_eval",
          locationId,
          employeeId,
          arrivedReady,
          attitude,
          production,
          teamPlayer,
          areaToImprove: area.trim() || null,
          note: note.trim() || null,
        }),
      });
      if (res.ok) {
        setSaveState("saved");
        // Reset "saved" indicator after 2s.
        setTimeout(() => setSaveState("idle"), 2000);
      } else {
        setSaveState("error");
        setErrorMsg(t("pm.error.generic"));
      }
    } catch {
      setSaveState("error");
      setErrorMsg(t("pm.error.generic"));
    }
  };

  const saveBtnLabel =
    saveState === "saving"
      ? t("pm.saving")
      : saveState === "saved"
        ? t("pm.saved")
        : t("pm.save");

  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <p className="mb-3 text-sm font-bold text-co-text">{employeeName}</p>

      {/* Arrived ready 3-way */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
          {t("pm.eval.arrived_ready")}
        </p>
        <div className="flex gap-2">
          {GRADIENT_VALUES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && setArrivedReady(g)}
              className={`
                flex-1 rounded-md border-2 px-2 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-60
                ${arrivedReady === g
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t(GRADIENT_LABEL[g])}
            </button>
          ))}
        </div>
      </div>

      {/* Attitude 3-way */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
          {t("pm.eval.attitude")}
        </p>
        <div className="flex gap-2">
          {GRADIENT_VALUES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && setAttitude(g)}
              className={`
                flex-1 rounded-md border-2 px-2 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-60
                ${attitude === g
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t(GRADIENT_LABEL[g])}
            </button>
          ))}
        </div>
      </div>

      {/* Production 3-way */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
          {t("pm.eval.production")}
        </p>
        <div className="flex gap-2">
          {GRADIENT_VALUES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && setProduction(g)}
              className={`
                flex-1 rounded-md border-2 px-2 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-60
                ${production === g
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t(GRADIENT_LABEL[g])}
            </button>
          ))}
        </div>
      </div>

      {/* Team player 3-way */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
          {t("pm.eval.team_player")}
        </p>
        <div className="flex gap-2">
          {GRADIENT_VALUES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && setTeamPlayer(g)}
              className={`
                flex-1 rounded-md border-2 px-2 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-60
                ${teamPlayer === g
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t(GRADIENT_LABEL[g])}
            </button>
          ))}
        </div>
      </div>

      {/* Area to improve */}
      <div className="mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
            {t("pm.eval.area_to_improve")}
          </span>
          <textarea
            value={area}
            readOnly={readOnly}
            onChange={(e) => setArea(e.target.value)}
            placeholder={readOnly ? "" : t("pm.eval.area_placeholder")}
            rows={2}
            className="
              w-full rounded-md border-2 border-co-border-2 bg-co-surface
              px-3 py-2 text-sm text-co-text focus:border-co-text focus:outline-none
              focus-visible:ring-4 focus-visible:ring-co-gold/60
              read-only:opacity-70
            "
          />
        </label>
      </div>

      {/* Note (managers only) */}
      <div className="mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-co-text-dim">
            {t("pm.eval.note")}
          </span>
          <textarea
            value={note}
            readOnly={readOnly}
            onChange={(e) => setNote(e.target.value)}
            placeholder={readOnly ? "" : t("pm.eval.note_placeholder")}
            rows={2}
            className="
              w-full rounded-md border-2 border-co-border-2 bg-co-surface
              px-3 py-2 text-sm text-co-text focus:border-co-text focus:outline-none
              focus-visible:ring-4 focus-visible:ring-co-gold/60
              read-only:opacity-70
            "
          />
        </label>
        <p className="mt-1 text-xs text-co-text-muted">
          {t("pm.eval.note_private_hint")}
        </p>
      </div>

      {errorMsg && (
        <p className="mb-2 text-sm text-co-cta">{errorMsg}</p>
      )}

      {!readOnly && (
        <ActionButton
          size="default"
          variant={saveState === "saved" ? "secondary" : "primary"}
          onClick={() => void handleSave()}
          disabled={saveState === "saving"}
        >
          {saveBtnLabel}
        </ActionButton>
      )}
    </div>
  );
}

// ─── PmReportClient ───────────────────────────────────────────────────────────

export function PmReportClient({
  locationId,
  report,
  timeliness,
  locationUsers,
  language,
  submitted,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  // MVP state
  const [mvpUserId, setMvpUserId] = useState<string | null>(report?.mvpUserId ?? null);
  const [mvpNote, setMvpNote] = useState(report?.mvpNote ?? "");
  const [mvpSaveState, setMvpSaveState] = useState<SaveState>("idle");

  // Employees being evaluated: auto-populate from wrapUp activity + any existing evals
  const wrapUp: ShiftWrapUpRow[] = report?.wrapUp ?? [];
  const existingEvals = report?.evals ?? [];

  // Build the initial set from wrapUp (active today) ∪ existing evals
  const autoEmployeeIds = new Set<string>(wrapUp.map((r) => r.userId));
  for (const e of existingEvals) autoEmployeeIds.add(e.employeeId);

  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([]);
  const [selectValue, setSelectValue] = useState("");

  // Submit state
  const [submitState, setSubmitState] = useState<SaveState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // All employee IDs in the eval set (auto + manually added)
  const evalEmployeeIds = [...autoEmployeeIds, ...addedEmployeeIds.filter((id) => !autoEmployeeIds.has(id))];

  // Name lookup helper
  const nameById = new Map<string, string>();
  for (const u of locationUsers) nameById.set(u.id, u.name);
  for (const r of wrapUp) if (r.name) nameById.set(r.userId, r.name);
  for (const e of existingEvals) if (e.employeeName) nameById.set(e.employeeId, e.employeeName);

  // Existing eval lookup
  const evalByEmployeeId = new Map<string, EmployeeEval>();
  for (const e of existingEvals) evalByEmployeeId.set(e.employeeId, e);

  const pmReportId = report?.id ?? "";

  // ── MVP save ──
  const handleMvpSave = async () => {
    setMvpSaveState("saving");
    try {
      const res = await fetch("/api/pm-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({
          action: "set_mvp",
          locationId,
          mvpUserId: mvpUserId || null,
          mvpNote: mvpNote.trim() || null,
        }),
      });
      if (res.ok) {
        setMvpSaveState("saved");
        setTimeout(() => setMvpSaveState("idle"), 2000);
      } else {
        setMvpSaveState("error");
      }
    } catch {
      setMvpSaveState("error");
    }
  };

  // ── Submit ──
  const handleSubmit = async () => {
    setSubmitState("saving");
    setSubmitError(null);
    try {
      const res = await fetch("/api/pm-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({ action: "submit", locationId }),
      });
      if (res.ok) {
        router.refresh(); // Server re-renders; submitted=true locks the form
      } else {
        setSubmitState("error");
        setSubmitError(t("pm.error.generic"));
      }
    } catch {
      setSubmitState("error");
      setSubmitError(t("pm.error.generic"));
    }
  };

  // ── Add employee from select ──
  const handleAddEmployee = (userId: string) => {
    if (!userId || autoEmployeeIds.has(userId) || addedEmployeeIds.includes(userId)) {
      setSelectValue("");
      return;
    }
    setAddedEmployeeIds((prev) => [...prev, userId]);
    setSelectValue("");
  };

  // Users available to add (not yet in the eval set)
  const pickableUsers = locationUsers.filter(
    (u) => !evalEmployeeIds.includes(u.id),
  );

  // ── Submitted banner ──
  if (submitted && report) {
    const bannerText = t("pm.submitted_banner", {
      time: report.submittedAt ? formatTime(report.submittedAt, language) : "—",
      name: report.submittedByName ?? "—",
    });

    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg border-2 border-co-success bg-[#E6F4E6] px-3 py-2 text-sm font-semibold text-co-text">
          {bannerText}
        </p>
        {/* Read-only wrap-up and evals below */}
        <WrapUpSection wrapUp={wrapUp} timeliness={timeliness} language={language} />
        {evalEmployeeIds.map((id) => (
          <EmployeeEvalCard
            key={id}
            employeeId={id}
            employeeName={nameById.get(id) ?? id}
            existing={evalByEmployeeId.get(id)}
            pmReportId={pmReportId}
            locationId={locationId}
            readOnly={true}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── WRAP-UP SECTION ── */}
      <WrapUpSection wrapUp={wrapUp} timeliness={timeliness} language={language} />

      {/* ── MVP SECTION ── */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {t("pm.mvp.heading")}
        </h2>
        <div className="flex flex-col gap-3">
          <select
            value={mvpUserId ?? ""}
            onChange={(e) => setMvpUserId(e.target.value || null)}
            className="
              h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface
              px-3 text-sm text-co-text focus:border-co-text focus:outline-none
              focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            <option value="">{t("pm.mvp.none")}</option>
            {evalEmployeeIds.map((id) => (
              <option key={id} value={id}>
                {nameById.get(id) ?? id}
              </option>
            ))}
          </select>
          {mvpUserId && (
            <textarea
              value={mvpNote}
              onChange={(e) => setMvpNote(e.target.value)}
              placeholder={t("pm.mvp.note_placeholder")}
              rows={2}
              className="
                w-full rounded-md border-2 border-co-border-2 bg-co-surface
                px-3 py-2 text-sm text-co-text focus:border-co-text focus:outline-none
                focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          )}
          <ActionButton
            size="default"
            variant={mvpSaveState === "saved" ? "secondary" : "primary"}
            onClick={() => void handleMvpSave()}
            disabled={mvpSaveState === "saving"}
          >
            {mvpSaveState === "saving"
              ? t("pm.saving")
              : mvpSaveState === "saved"
                ? t("pm.saved")
                : t("pm.save")}
          </ActionButton>
        </div>
      </section>

      {/* ── EVAL CARDS ── */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {t("pm.eval.attitude")}
        </h2>
        <div className="flex flex-col gap-4">
          {evalEmployeeIds.map((id) => (
            <EmployeeEvalCard
              key={id}
              employeeId={id}
              employeeName={nameById.get(id) ?? id}
              existing={evalByEmployeeId.get(id)}
              pmReportId={pmReportId}
              locationId={locationId}
              readOnly={false}
            />
          ))}

          {/* Add-employee picker */}
          {pickableUsers.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectValue}
                onChange={(e) => {
                  setSelectValue(e.target.value);
                  handleAddEmployee(e.target.value);
                }}
                className="
                  h-10 flex-1 rounded-md border-2 border-co-border-2 bg-co-surface
                  px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                  focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              >
                <option value="">{t("pm.add_employee_placeholder")}</option>
                {pickableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* ── SUBMIT ── */}
      <section className="flex flex-col gap-2">
        {submitError && (
          <p className="text-sm text-co-cta">{submitError}</p>
        )}
        <ActionButton
          size="lg"
          className="w-full"
          onClick={() => void handleSubmit()}
          disabled={submitState === "saving"}
        >
          {submitState === "saving" ? t("pm.submitting") : t("pm.submit")}
        </ActionButton>
      </section>
    </div>
  );
}

// ─── WrapUpSection ─────────────────────────────────────────────────────────────

function WrapUpSection({
  wrapUp,
  timeliness,
  language,
}: {
  wrapUp: ShiftWrapUpRow[];
  timeliness: ReportStatusRow[];
  language: Language;
}) {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {t("pm.wrapup.heading")}
      </h2>

      {/* Per-employee activity */}
      {wrapUp.length === 0 ? (
        <p className="text-sm text-co-text-muted">{t("pm.wrapup.empty")}</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-1.5">
          {wrapUp.map((r) => (
            <li
              key={r.userId}
              className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
            >
              <span className="font-semibold text-co-text">{r.name ?? r.userId}</span>
              <span className="shrink-0 text-co-text-muted">
                {t("pm.wrapup.items", { count: r.itemsCompleted })}
                {" · "}
                {t("pm.wrapup.reports", { count: r.reportsSubmitted })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Report timeliness — reusing midshift.report.* + midshift.overdue.badge labels */}
      {timeliness.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {timeliness.map((row) => {
            const overdueKey = OVERDUE_KEY[row.overdue];
            const badgeClasses =
              row.overdue === "overdue"
                ? "text-co-cta font-bold"
                : row.overdue === "ok" || row.progress === "done"
                  ? "text-co-success font-semibold"
                  : "text-co-text-muted";

            return (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
              >
                <span className="font-semibold text-co-text">
                  {t(REPORT_LABEL_KEY[row.key])}
                </span>
                <span className={`shrink-0 text-xs ${badgeClasses}`}>
                  {row.progress === "done" && row.doneAt
                    ? formatTime(row.doneAt, language)
                    : t(overdueKey)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
