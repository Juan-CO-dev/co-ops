"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ActionLink } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";
import { currentStation, TASK_TYPES, TASK_MIN_LEVEL, taskHref, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";

const control = "flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal tracking-normal text-co-text";

export function ShiftBoardClient({ board, compact = false }: { board: ShiftBoard; compact?: boolean }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const disabled = busy || refreshing;
  const unassigned = TASK_TYPES.filter((task) => !board.tasks.some((assignment) => assignment.task === task));
  const people = compact ? board.people.filter((p) => p.id === board.viewerId) : board.people;
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: board.locationId, ...payload }) });
      if (!response.ok || response.redirected) throw new Error("assignment_write_failed");
      startTransition(() => router.refresh());
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <section className="co-card space-y-4 p-4" aria-busy={disabled}>
    <h2 className="text-xl font-bold text-co-text">{t(compact || board.viewerLevel < 4 ? "assignments.myShift" : "assignments.team")}</h2>
    {!compact && board.viewerLevel >= 4 && <p className="text-sm text-co-text-muted">{t("assignments.rosterHint")}</p>}
    {error && <p role="alert" className="text-co-cta-text">{t("assignments.error")}</p>}
    {compact && board.viewerLevel >= 4 && <ul className="space-y-2">{unassigned.map((task) => <li key={task}>
      <ActionLink variant="secondary" href={`/assignments?location=${board.locationId}`}>{t("assignments.unassignedAction", { task: t(`assignments.task.${task}`) })}</ActionLink>
    </li>)}</ul>}
    {!compact && <div className="space-y-3">
      <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("assignments.allTasks")}</h3>
      <p className="text-sm text-co-text-muted">{t("assignments.takeHint")}</p>
      <ul className="space-y-3">
        <li className="rounded-xl border border-co-border p-3"><ActionLink variant="secondary" href={`/operations/closing?location=${board.locationId}`}>{t("assignments.closing")}</ActionLink><p className="mt-2 text-sm text-co-text-muted">{t("assignments.everyone")}</p></li>
        {TASK_TYPES.map((task) => {
          const assignments = board.tasks.filter((assignment) => assignment.task === task);
          const canOpen = assignments.length === 0 || assignments.some((assignment) => assignment.assigneeId === board.viewerId);
          return <li key={task} className="rounded-xl border border-co-border p-3">
            <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink>
            <p className="mt-2 text-sm text-co-text-muted">{assignments.length === 0 ? t("assignments.unassigned") : assignments.map((assignment) => board.people.find((person) => person.id === assignment.assigneeId)?.name ?? t("assignments.assignedStaff")).join(", ")}</p>
            {!canOpen && <p className="text-sm text-co-text-muted">{t("assignments.assignedOther")}</p>}
          </li>;
        })}
      </ul>
    </div>}
    {people.length === 0 && <p>{t("assignments.empty")}</p>}
    {people.map((person) => {
      const current = currentStation(board.events, person.id);
      const station = board.stations.find((s) => s.id === current?.stationId);
      const tasks = board.tasks.filter((task) => task.assigneeId === person.id && person.level >= TASK_MIN_LEVEL[task.task]);
      const assignableTasks = TASK_TYPES.filter((task) => person.level >= TASK_MIN_LEVEL[task]);
      const managerCanEdit = !compact && board.viewerLevel >= 4 && person.level <= board.viewerLevel;
      const canClaim = compact && person.id === board.viewerId && (!current?.stationId || current.source === "claimed");
      return <article key={person.id} className="space-y-3 rounded-xl border border-co-border p-3">
        {!compact && <h3 className="font-bold text-co-text">{person.name}</h3>}
        <p className="font-bold text-co-text">{station ? (language === "es" ? station.nameEs || station.name : station.name) : t("assignments.noStation")}</p>
        {current?.stationId && current.source === "assigned" && <p className="text-sm text-co-text-muted"><span aria-hidden="true">🔒 </span>{t("assignments.assignedBy", { name: current.actorName ?? t("assignments.teamLead") })}</p>}
        {(managerCanEdit || canClaim) && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate({ action: "station", userId: person.id, stationId: data.get("stationId") || null, manage: managerCanEdit });
        }}>
          <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.station")}
            <select key={current?.id ?? "none"} name="stationId" defaultValue={current?.stationId ?? ""} disabled={disabled} className={control}>
              <option value="">{t("assignments.noStation")}</option>
              {board.stations.filter((s) => s.active || s.id === current?.stationId).map((s) => <option key={s.id} value={s.id} disabled={!s.active}>{language === "es" ? s.nameEs || s.name : s.name}</option>)}
            </select>
          </label>
          <ActionButton type="submit" disabled={disabled}>{t(managerCanEdit ? "assignments.setStation" : "assignments.claimChange")}</ActionButton>
        </form>}
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("assignments.tasks")}</h4>
        {tasks.length === 0 && <p className="text-sm text-co-text-muted">{t("assignments.noTasks")}</p>}
        <ul className="space-y-2">{tasks.map((assignment) => <li key={assignment.id} className="flex flex-wrap items-center gap-2">
          <ActionLink variant="secondary" href={taskHref(assignment.task, board.locationId)}>{t(`assignments.task.${assignment.task}`)}</ActionLink>
          {assignment.note && <p className="text-sm text-co-text-muted">{assignment.note}</p>}
          {managerCanEdit && person.id !== board.viewerId && <ActionButton variant="danger" disabled={disabled} onClick={() => void mutate({ action: "task_retract", assignmentId: assignment.id })}>{t("assignments.retract")}</ActionButton>}
        </li>)}</ul>
        {managerCanEdit && person.id !== board.viewerId && assignableTasks.length > 0 && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void mutate({ action: "task_assign", userId: person.id, task: data.get("task") as TaskType, note: data.get("note") });
        }}>
          <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.task")}
            <select name="task" className={control} disabled={disabled}>{assignableTasks.map((task) => <option key={task} value={task}>{t(`assignments.task.${task}`)}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.note")}<input aria-label={t("assignments.note")} name="note" maxLength={500} className={control} disabled={disabled} /></label>
          <ActionButton type="submit" disabled={disabled}>{t("assignments.assignTask")}</ActionButton>
        </form>}
      </article>;
    })}
    {compact && board.viewerLevel >= 4 && <ActionLink variant="secondary" href={`/assignments?location=${board.locationId}`}>{t(board.viewerLevel >= 4 ? "assignments.title" : "assignments.viewDay")}</ActionLink>}
  </section>;
}
