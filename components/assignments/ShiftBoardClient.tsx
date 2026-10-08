"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ActionLink } from "@/components/ActionButton";
import type { TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";
import { RetrainTaskList } from "@/components/production/RetrainTaskList";
import { CollapsibleChecklistSection } from "@/components/ui/CollapsibleChecklistSection";
import { useCollapsibleSections } from "@/lib/use-collapsible-sections";
import { assignmentSectionDefaults } from "@/lib/assignment-sections";
import type { RetrainTaskView } from "@/lib/yield-stats";
import { canSelfClaim, currentStation, TASK_TYPES, TASK_MIN_LEVEL, taskHref, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";

const control = "flex min-h-[44px] w-full max-w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal tracking-normal text-co-text";

/** retrainTasks: the viewer's OWN open yield retrains at this shop (batch vs bottle Phase B) —
 *  they persist until marked done, so they ride beside the daily tasks, not inside them. */
export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }: { board: ShiftBoard; compact?: boolean; retrainTasks?: RetrainTaskView[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const disabled = busy || refreshing;
  const unassigned = TASK_TYPES.filter((task) => !board.tasks.some((assignment) => assignment.task === task && assignment.available !== false));
  const people = compact ? board.people.filter((p) => p.id === board.viewerId) : board.people;
  const ownTasks = board.tasks.filter((task) => task.assigneeId === board.viewerId && task.available !== false);
  const positions = board.stations.filter((station) => station.active && station.staffed).flatMap((station) => station.positions.filter((position) => position.active));
  const filledStations = positions.filter((position) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === position.id)).length;
  const sections = useCollapsibleSections(`assignments:${board.viewerId}:${board.locationId}:${compact ? "dashboard" : "page"}`, [
    { id: "tasks", done: compact ? ownTasks.length : TASK_TYPES.length - unassigned.length, total: TASK_TYPES.length },
    { id: "stations", done: compact ? Number(!!currentStation(board.events, board.viewerId)?.stationId) : filledStations, total: compact ? 1 : positions.length },
    { id: "people", done: board.people.filter((person) => person.hasWork).length, total: board.people.length },
    { id: "unassigned", done: 0, total: unassigned.length },
  ], assignmentSectionDefaults(board, compact));
  const section = (id: "tasks" | "stations" | "people" | "unassigned", title: TranslationKey, done: number, total: number, children: ReactNode) =>
    <CollapsibleChecklistSection formKey="assignment-board" sectionId={id} title={t(title)} done={done} total={total}
      progressText={id === "unassigned" ? t("assignments.unassignedCount", { count: total }) : t("assignments.assignedCount", { done, total })}
      open={sections.isOpen(id)} onToggle={() => sections.toggle(id)} headingLevel={3}
      className="min-w-0 rounded-xl border border-co-border p-3" panelClassName="min-w-0 space-y-3 pt-3"
      titleClassName="min-w-0 truncate text-sm font-bold text-co-text">{children}</CollapsibleChecklistSection>;
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: board.locationId, ...payload }) });
      if (!response.ok || response.redirected) {
        const body: unknown = await response.json().catch(() => null);
        if (response.status === 409 && body && typeof body === "object" && "error" in body && body.error === "assignment_already_active") {
          setError("assignments.errorAlreadyActive");
          return;
        }
        if (response.status === 409 && body && typeof body === "object" && "error" in body && body.error === "position_taken") {
          setError("assignments.positionTaken"); return;
        }
        throw new Error("assignment_write_failed");
      }
      startTransition(() => router.refresh());
    } catch { setError("assignments.error"); } finally { setBusy(false); }
  }
  return <section className="co-card min-w-0 max-w-full space-y-4 break-words p-4 [&_a]:max-w-full [&_a]:whitespace-normal [&_button]:max-w-full [&_button]:whitespace-normal" aria-busy={disabled}>
    <h2 className="text-xl font-bold text-co-text">{t(compact || board.viewerLevel < 4 ? "assignments.myShift" : "assignments.team")}</h2>
    {!compact && <ActionLink variant="secondary" href={`/stations?loc=${board.locationId}`}>{t("assignments.stations")}</ActionLink>}
    {!compact && board.viewerLevel >= 4 && <p className="text-sm text-co-text-muted">{t("assignments.rosterHint")}</p>}
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {!compact && board.viewerLevel >= 4 && section("stations", "assignments.takeAssignStations", filledStations, positions.length, <div className="space-y-3">{board.stations.filter((s) => s.active && s.staffed).map((station) => {
      const positions = station.positions.filter((p) => p.active);
      const filled = positions.filter((p) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === p.id)).length;
      return <div key={station.id} className="rounded-xl border border-co-border p-3">
        <h4 className="min-w-0 truncate font-bold" title={language === "es" ? station.nameEs || station.name : station.name}>{language === "es" ? station.nameEs || station.name : station.name} · {filled} {t("assignments.of")} {positions.length}</h4>
        <ul className="mt-2 space-y-2">{positions.map((position) => {
          const occupant = board.people.find((person) => currentStation(board.events, person.id)?.positionId === position.id);
          return <li key={position.id} className="rounded-lg border border-co-border p-2">
            <p className="truncate font-bold" title={language === "es" ? position.nameEs || position.name : position.name}>{language === "es" ? position.nameEs || position.name : position.name} · {occupant?.name ?? t("assignments.unassigned")}</p>
            {(language === "es" ? position.dutyEs || position.duty : position.duty) && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
            <form className="mt-2 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault();
              const userId = String(new FormData(event.currentTarget).get("userId") || "");
              if (userId) void mutate({ action: "station", userId, stationId: station.id, positionId: position.id, manage: true });
            }}>
              <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold text-co-text-dim">{t("assignments.person")}
                <select name="userId" className={control} disabled={disabled} defaultValue="">
                  <option value="" disabled>{t("assignments.person")}</option>
                  {board.people.filter((person) => person.available !== false && person.level <= board.viewerLevel && (person.id !== board.viewerId || canSelfClaim(currentStation(board.events, person.id))))
                    .map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <ActionButton type="submit" disabled={disabled}>{t("assignments.setStation")}</ActionButton>
            </form>
          </li>;
        })}</ul>
      </div>;
    })}</div>)}
    {compact && retrainTasks.length > 0 && <RetrainTaskList tasks={retrainTasks} />}
    {compact && section("tasks", "assignments.takeAssignTasks", ownTasks.length, TASK_TYPES.length, <div className="space-y-3"><ul className="space-y-2">{board.viewerLevel >= 4 && unassigned.filter((task) => board.viewerLevel >= TASK_MIN_LEVEL[task] && board.people.find((person) => person.id === board.viewerId)?.available !== false).map((task) => <li key={task}>
      <ActionLink variant="secondary" className="max-w-full whitespace-normal text-left" href={board.viewerLevel >= 4 ? `/assignments?location=${board.locationId}` : taskHref(task, board.locationId)}>{t("assignments.unassignedAction", { task: t(`assignments.task.${task}`) })}</ActionLink>
    </li>)}</ul>{ownTasks.filter((task) => board.viewerLevel >= TASK_MIN_LEVEL[task.task]).map((task) => <ActionLink key={task.id} variant="secondary" href={taskHref(task.task, board.locationId)}>{t(`assignments.task.${task.task}`)}</ActionLink>)}</div>)}
    {!compact && section("tasks", "assignments.takeAssignTasks", TASK_TYPES.length - unassigned.length, TASK_TYPES.length, <div className="space-y-3">
      <p className="text-sm text-co-text-muted">{t("assignments.takeHint")}</p>
      <ul className="space-y-3">
        <li className="rounded-xl border border-co-border p-3"><ActionLink variant="secondary" href={`/operations/closing?location=${board.locationId}`}>{t("assignments.closing")}</ActionLink><p className="mt-2 text-sm text-co-text-muted">{t("assignments.everyone")}</p></li>
        {TASK_TYPES.map((task) => {
          const assignments = board.tasks.filter((assignment) => assignment.task === task && assignment.available !== false);
          const canOpen = board.viewerLevel >= TASK_MIN_LEVEL[task] && (board.viewerLevel >= 4 || assignments.some((assignment) => assignment.assigneeId === board.viewerId));
          return <li key={task} className="rounded-xl border border-co-border p-3">
            {canOpen ? <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink> : <span>{t(`assignments.task.${task}`)}</span>}
            <p className="mt-2 text-sm text-co-text-muted">{assignments.length === 0 ? t("assignments.unassigned") : assignments.map((assignment) => board.people.find((person) => person.id === assignment.assigneeId)?.name ?? t("assignments.assignedStaff")).join(", ")}</p>
            {!canOpen && assignments.length > 0 && <p className="text-sm text-co-text-muted">{t("assignments.assignedOther")}</p>}
          </li>;
        })}
      </ul>
    </div>)}
    {!compact && board.viewerLevel >= 4 && section("unassigned", "assignments.unassigned", 0, unassigned.length, <ul className="space-y-2">{unassigned.map((task) => <li key={task}>{board.viewerLevel >= TASK_MIN_LEVEL[task] ? <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink> : <span>{t(`assignments.task.${task}`)}</span>}</li>)}</ul>)}
    {section(compact ? "stations" : "people", compact ? "assignments.takeAssignStations" : "assignments.people", compact ? Number(!!currentStation(board.events, board.viewerId)?.stationId) : board.people.filter((person) => person.hasWork).length, compact ? 1 : board.people.length, <div className="space-y-3">
    {people.length === 0 && <p>{t("assignments.empty")}</p>}
    {people.map((person) => {
      const current = currentStation(board.events, person.id);
      const station = board.stations.find((s) => s.id === current?.stationId);
      const position = station?.positions.find((p) => p.id === current?.positionId);
      const tasks = board.tasks.filter((task) => task.assigneeId === person.id && (board.viewerLevel >= 4 || (task.available !== false && person.available !== false && person.level >= TASK_MIN_LEVEL[task.task])));
      const assignableTasks = TASK_TYPES.filter((task) => person.level >= TASK_MIN_LEVEL[task]);
      const managerCanEdit = !compact && board.viewerLevel >= 4 && person.available !== false && person.level <= board.viewerLevel
        && (person.id !== board.viewerId || canSelfClaim(current));
      const canRetract = board.viewerLevel >= 4;
      const canClaim = person.available !== false && compact && person.id === board.viewerId && canSelfClaim(current);
      return <article key={person.id} className="min-w-0 space-y-3 rounded-xl border border-co-border p-3">
        {!compact && <h4 className="truncate font-bold text-co-text" title={person.name}>{person.name}</h4>}
        {person.available === false && <p className="text-sm text-co-text-muted">{t("assignments.unavailablePerson")}</p>}
        <p className="truncate font-bold text-co-text" title={station?.name}>{station ? `${language === "es" ? station.nameEs || station.name : station.name} · ${position ? (language === "es" ? position.nameEs || position.name : position.name) : ""}` : t("assignments.noStation")}</p>
        {position && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
        {current?.stationId && current.source === "assigned" && <p className="text-sm text-co-text-muted"><span aria-hidden="true">🔒 </span>{t("assignments.assignedBy", { name: current.actorName ?? t("assignments.teamLead") })}</p>}
        {(managerCanEdit || canClaim) && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const positionId = String(data.get("positionId") || "");
          const target = board.stations.find((s) => s.positions.some((p) => p.id === positionId));
          void mutate({ action: "station", userId: person.id, stationId: target?.id ?? null, positionId: positionId || null, manage: managerCanEdit });
        }}>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.station")}
            <select key={current?.id ?? "none"} name="positionId" defaultValue={current?.positionId ?? ""} disabled={disabled} className={control}>
              <option value="">{t("assignments.noStation")}</option>
              {board.stations.filter((s) => (s.active && s.staffed) || s.id === current?.stationId).flatMap((s) =>
                s.positions.filter((p) => p.active || p.id === current?.positionId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((p) => {
                  const holder = board.occupiedPositions?.find((entry) => entry.positionId === p.id);
                  const taken = !!holder && p.id !== current?.positionId;
                  return <option key={p.id} value={p.id} disabled={!s.active || !s.staffed || !p.active || (board.viewerLevel < 4 && taken)}>
                    {language === "es" ? s.nameEs || s.name : s.name} · {language === "es" ? p.nameEs || p.name : p.name}
                    {p.sort === 1 ? ` · ${t("assignments.fillFirst")}` : ""}
                    {holder ? ` · ${t("assignments.takenBy", { name: holder.firstName })}` : ""}
                  </option>;
                }))}
            </select>
          </label>
          <ActionButton type="submit" disabled={disabled}>{t(managerCanEdit ? "assignments.setStation" : "assignments.claimChange")}</ActionButton>
        </form>}
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("assignments.tasks")}</h4>
        {tasks.length === 0 && <p className="text-sm text-co-text-muted">{t("assignments.noTasks")}</p>}
        <ul className="space-y-2">{tasks.map((assignment) => <li key={assignment.id} className="flex flex-wrap items-center gap-2">
          <ActionLink variant="secondary" href={taskHref(assignment.task, board.locationId)}>{t(`assignments.task.${assignment.task}`)}</ActionLink>
          {assignment.available === false && <p className="text-sm text-co-text-muted">{t("assignments.unavailableTask")}</p>}
          {assignment.note && <p className="text-sm text-co-text-muted">{assignment.note}</p>}
          {canRetract && <ActionButton variant="danger" disabled={disabled} onClick={() => void mutate({ action: "task_retract", assignmentId: assignment.id })}>{t("assignments.retract")}</ActionButton>}
        </li>)}</ul>
        {managerCanEdit && person.id !== board.viewerId && assignableTasks.length > 0 && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void mutate({ action: "task_assign", userId: person.id, task: data.get("task") as TaskType, note: data.get("note") });
        }}>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.task")}
            <select name="task" className={control} disabled={disabled}>{assignableTasks.map((task) => <option key={task} value={task}>{t(`assignments.task.${task}`)}</option>)}</select>
          </label>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.note")}<input aria-label={t("assignments.note")} name="note" maxLength={500} className={control} disabled={disabled} /></label>
          <ActionButton type="submit" disabled={disabled}>{t("assignments.assignTask")}</ActionButton>
        </form>}
      </article>;
    })}</div>)}
    {compact && board.viewerLevel >= 4 && <ActionLink variant="secondary" href={`/assignments?location=${board.locationId}`}>{t(board.viewerLevel >= 4 ? "assignments.title" : "assignments.viewDay")}</ActionLink>}
  </section>;
}
