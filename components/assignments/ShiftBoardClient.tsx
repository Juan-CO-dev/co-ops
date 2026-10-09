"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ActionLink } from "@/components/ActionButton";
import { formatTime, formatClockTime } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";
import { RetrainTaskList } from "@/components/production/RetrainTaskList";
import { CollapsibleChecklistSection } from "@/components/ui/CollapsibleChecklistSection";
import { useCollapsibleSections } from "@/lib/use-collapsible-sections";
import { assignmentSectionDefaults } from "@/lib/assignment-sections";
import type { RetrainTaskView } from "@/lib/yield-stats";
import type { PresenceView } from "@/lib/presence-shared";
import { canSelfClaim, currentStation, formatAssignmentAttribution, requiresOverrideReason, OVERRIDE_REASON_CODES, type OverrideReasonCode, type TaskAssignment, type AssignmentChange, type StationEvent, TASK_TYPES, TASK_MIN_LEVEL, taskHref, type ShiftBoard, type TaskType } from "@/lib/assignments-shared";

const control = "flex min-h-[44px] w-full max-w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal tracking-normal text-co-text";

/** retrainTasks: the viewer's OWN open yield retrains at this shop (batch vs bottle Phase B) —
 *  they persist until marked done, so they ride beside the daily tasks, not inside them. */
export function ShiftBoardClient({ board, compact = false, retrainTasks = [] }: { board: ShiftBoard; compact?: boolean; retrainTasks?: RetrainTaskView[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [pending, setPending] = useState<{ payload: Record<string, unknown>; required: boolean } | null>(null);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const reasonDialog = useRef<HTMLDialogElement>(null);
  const disabled = busy || refreshing;
  useEffect(() => {
    if (pending) reasonDialog.current?.showModal();
    else reasonDialog.current?.close();
  }, [pending]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [router]);
  const changeLine = (change?: AssignmentChange) => change && <p className="text-sm text-co-text-muted">{t(change.reasonCode || change.reasonNote ? "assignments.attribution.changed" : "assignments.attribution.changedWithoutReason", {
    name: change.actorName ?? t("assignments.teamLead"),
    reason: change.reasonCode ? t(`assignments.reason.${change.reasonCode}`) : change.reasonNote ?? "",
    time: formatTime(change.at, language),
  })}{change.reasonCode && change.reasonNote ? ` · ${change.reasonNote}` : ""}</p>;
  const taskVacancyLine = (task: TaskType) => board.taskVacancies?.filter((entry) => entry.task === task).map((entry) =>
    <p key={`${entry.userId}:${entry.at}`} className="text-sm text-co-text-muted">{t(entry.reason === "ended_shift" ? "assignments.lifecycle.leftOpenEnded" : "assignments.lifecycle.leftOpen", { name: entry.name, time: formatTime(entry.at, language) })}</p>);
  const positionVacancyLine = (positionId: string) => {
    const vacancy = board.positionVacancies?.find((entry) => entry.positionId === positionId);
    return vacancy ? <p className="text-sm text-co-text-muted">{t(vacancy.reason === "on_break" ? "assignments.lifecycle.openCover" : vacancy.reason === "ended_shift" ? "assignments.lifecycle.leftOpenEnded" : "assignments.lifecycle.leftOpen", { name: vacancy.name, time: formatTime(vacancy.at, language) })}</p> : null;
  };
  // 0233 who's here: on shift and HOW we know (the Toast clock, or activity in CO-OPS).
  const presenceText = (presence: PresenceView | undefined): string | null => {
    if (!presence) return null;
    if (presence.onShift) return `${t("whosHere.onShift")} · ${presence.source === "toast_clock" && presence.since
      ? t("whosHere.clockedIn", { time: formatTime(presence.since, language) }) : t("whosHere.activeInCoops")}`;
    if (!presence.off) return null;
    const key = presence.off.reason === "clocked_out" ? "whosHere.clockedOut" : presence.off.reason === "ended_shift" ? "whosHere.endedShift" : "whosHere.shopClosed";
    return t(key, { time: formatTime(presence.off.at, language) });
  };
  const presenceLine = (presence: PresenceView | undefined) => {
    const text = presenceText(presence);
    return text ? <p className={presence?.onShift ? "text-sm font-bold text-co-confirm-text" : "text-sm text-co-text-muted"}>{text}</p> : null;
  };
  const hereNow = board.whosHere ? board.people.filter((person) => person.presence?.onShift) : [];
  const hereNowList = board.whosHere ? <div className="space-y-1">
    <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("whosHere.hereNow", { count: hereNow.length })}</h4>
    {hereNow.length === 0 ? <p className="text-sm text-co-text-muted">{t("whosHere.nobody")}</p>
      : <ul className="space-y-1">{hereNow.map((person) => <li key={person.id} className="min-w-0 text-sm"><span className="font-bold">{person.name}</span> · <span className="text-co-text-muted">{presenceText(person.presence)}</span></li>)}</ul>}
  </div> : null;
  const endShiftButton = (person: ShiftBoard["people"][number]) => {
    if (!board.whosHere || person.available === false) return null;
    const self = person.id === board.viewerId;
    if (!self && (compact || board.viewerLevel < 4 || person.level > board.viewerLevel)) return null;
    // Nothing to end: not on shift and holding nothing (an ended shift does not offer itself again).
    if (!person.presence?.onShift && !person.hasWork && !person.onBreak) return null;
    return <ActionButton variant={self ? "secondary" : "danger"} disabled={disabled}
      onClick={() => requestMutation({ action: "end_shift", userId: person.id }, self ? undefined : person.heldFromLevel)}>
      {t(self ? "whosHere.endMyShift" : "whosHere.endShift")}</ActionButton>;
  };
  const stationStatus = (station: ShiftBoard["stations"][number]) => <>
    {station.closedAt && <p className="font-bold text-co-text-muted">{t("assignments.lifecycle.closed", { time: formatTime(station.closedAt, language) })}</p>}
    {station.usuallyClosesAt && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.usuallyCloses", { time: formatClockTime(station.usuallyClosesAt, language) })}</p>}
  </>;
  const trimHint = (position: ShiftBoard["stations"][number]["positions"][number]) => position.sort > 1 && position.usuallyTrimsAt
    ? <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.usuallyTrims", { time: formatClockTime(position.usuallyTrimsAt, language) })}</p> : null;
  const taskLine = (assignment: TaskAssignment) => <div key={assignment.id} className="text-sm text-co-text-muted">
    <p>{formatAssignmentAttribution({ source: assignment.source ?? "assigned", holderName: assignment.assigneeName ?? board.people.find((person) => person.id === assignment.assigneeId)?.name ?? t("assignments.assignedStaff"), actorName: assignment.assignerName, at: assignment.at ?? "" }, language, t)}</p>
    {changeLine(assignment.change)}
  </div>;
  const stationLine = (event: StationEvent | null, name: string) => <div className="text-sm text-co-text-muted">
    <p>{formatAssignmentAttribution(event?.stationId && event.source ? { source: event.source, holderName: name, actorName: event.actorName, at: event.at } : null, language, t)}</p>
    {changeLine(event?.change)}
  </div>;
  // Under a person's name: say WHAT they hold, then who gave it / when (never repeat their name).
  const byText = (source: "assigned" | "claimed" | "taken", actorName: string | null, at: string) =>
    t(`assignments.by.${source}`, { by: actorName ?? t("assignments.teamLead"), time: formatTime(at, language) });
  const stationLabel = (event: StationEvent | null) => {
    const s = event?.stationId ? board.stations.find((x) => x.id === event.stationId) : undefined;
    const p = s?.positions.find((x) => x.id === event?.positionId);
    if (!s) return null;
    const sn = language === "es" ? s.nameEs || s.name : s.name;
    return p ? `${sn} · ${language === "es" ? p.nameEs || p.name : p.name}` : sn;
  };
  const personStationLine = (event: StationEvent | null) => {
    const label = stationLabel(event);
    return <div className="text-sm text-co-text-muted">
      <p>{label && event?.source ? `${label}: ${byText(event.source, event.actorName, event.at)}` : t("assignments.noStation")}</p>
      {changeLine(event?.change)}
    </div>;
  };
  const personTaskLine = (assignment: TaskAssignment) => <div key={assignment.id} className="text-sm text-co-text-muted">
    <p>{`${t(`assignments.task.${assignment.task}`)}: ${byText(assignment.source ?? "assigned", assignment.assignerName, assignment.at ?? "")}`}</p>
    {changeLine(assignment.change)}
  </div>;
  const byLine = (source: "assigned" | "claimed" | "taken" | null | undefined, actorName: string | null, at: string | null | undefined) =>
    source ? <p className="text-sm text-co-text-muted">{byText(source, actorName, at ?? "")}</p> : null;
  const stationOverrideLevel = (userId: string) => {
    const current = currentStation(board.events, userId);
    return current?.source === "assigned" ? current.actorLevel ?? 0 : 0;
  };
  function requestMutation(payload: Record<string, unknown>, assignerLevel?: number) {
    setReasonCode(""); setReasonNote(""); setError(null);
    setPending({ payload, required: requiresOverrideReason(board.viewerLevel, assignerLevel) });
  }
  const unassigned = TASK_TYPES.filter((task) => !board.tasks.some((assignment) => assignment.task === task && assignment.available !== false));
  const people = compact ? board.people.filter((p) => p.id === board.viewerId) : board.people;
  const ownTasks = board.tasks.filter((task) => task.assigneeId === board.viewerId && task.available !== false);
  const positions = board.stations.filter((station) => station.active && station.staffed && !station.closedAt).flatMap((station) => station.positions.filter((position) => position.active));
  const filledStations = positions.filter((position) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === position.id)).length;
  const sections = useCollapsibleSections(`assignments:${board.viewerId}:${board.locationId}:${compact ? "dashboard" : "page"}`, [
    { id: "tasks", done: compact ? ownTasks.length : TASK_TYPES.length - unassigned.length, total: TASK_TYPES.length },
    { id: "stations", done: compact ? Number(!!currentStation(board.events, board.viewerId)?.stationId) : filledStations, total: compact ? 1 : positions.length },
    { id: "people", done: board.people.filter((person) => person.hasWork).length, total: board.people.length },
    { id: "unassigned", done: 0, total: unassigned.length },
    { id: "team", done: board.people.filter((person) => person.hasWork).length, total: board.people.length },
  ], assignmentSectionDefaults(board, compact));
  const section = (id: "tasks" | "stations" | "people" | "unassigned" | "team", title: TranslationKey, done: number, total: number, children: ReactNode) =>
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
        if (body && typeof body === "object" && "error" in body && body.error === "override_reason_required") {
          setPending({ payload, required: true }); setError("assignments.reasonRequired"); return;
        }
        if (response.status === 409 && body && typeof body === "object" && "error" in body && body.error === "assignment_already_active") {
          setError("assignments.errorAlreadyActive");
          return;
        }
        if (response.status === 409 && body && typeof body === "object" && "error" in body && body.error === "position_taken") {
          setError("assignments.positionTaken"); return;
        }
        throw new Error("assignment_write_failed");
      }
      setPending(null);
      startTransition(() => router.refresh());
    } catch { setError("assignments.error"); } finally { setBusy(false); }
  }
  return <section className="co-card min-w-0 max-w-full space-y-4 break-words p-4 [&_a]:max-w-full [&_a]:whitespace-normal [&_button]:max-w-full [&_button]:whitespace-normal" aria-busy={disabled}>
    <h2 className="text-xl font-bold text-co-text">{t(compact ? "assignments.myShift" : "assignments.team")}</h2>
    {!compact && <ActionLink variant="secondary" href={`/stations?loc=${board.locationId}`}>{t("assignments.stations")}</ActionLink>}
    {!compact && board.viewerLevel >= 4 && <p className="text-sm text-co-text-muted">{t("assignments.rosterHint")}</p>}
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {!compact && section("stations", "assignments.takeAssignStations", filledStations, positions.length, <div className="space-y-3">{board.stations.filter((s) => s.active && s.staffed).map((station) => {
      const positions = station.positions.filter((p) => p.active);
      const filled = positions.filter((p) => board.people.some((person) => currentStation(board.events, person.id)?.positionId === p.id)).length;
      return <div key={station.id} className="rounded-xl border border-co-border p-3">
        <h4 className="min-w-0 truncate font-bold" title={language === "es" ? station.nameEs || station.name : station.name}>{language === "es" ? station.nameEs || station.name : station.name}{!station.closedAt && <> · {filled} {t("assignments.of")} {positions.length}</>}</h4>
        {stationStatus(station)}
        <ul className="mt-2 space-y-2">{positions.map((position) => {
          const occupant = board.people.find((person) => currentStation(board.events, person.id)?.positionId === position.id);
          return <li key={position.id} className="rounded-lg border border-co-border p-2">
            <p className="truncate font-bold" title={language === "es" ? position.nameEs || position.name : position.name}>{language === "es" ? position.nameEs || position.name : position.name} · {station.closedAt ? t("assignments.lifecycle.positionClosed") : occupant?.name ?? t("assignments.unassigned")}</p>
            {(language === "es" ? position.dutyEs || position.duty : position.duty) && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
            {trimHint(position)}
            {!occupant && !station.closedAt && positionVacancyLine(position.id)}
            {!station.closedAt && stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}
            {board.viewerLevel >= 4 && !station.closedAt && <form className="mt-2 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault();
              const userId = String(new FormData(event.currentTarget).get("userId") || "");
              if (userId) requestMutation({ action: "station", userId, stationId: station.id, positionId: position.id, manage: true }, stationOverrideLevel(userId));
            }}>
              <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold text-co-text-dim">{t("assignments.person")}
                <select name="userId" className={control} disabled={disabled} defaultValue="">
                  <option value="" disabled>{t("assignments.person")}</option>
                  {board.people.filter((person) => person.available !== false && !person.onBreak && person.level <= board.viewerLevel && (person.id !== board.viewerId || canSelfClaim(currentStation(board.events, person.id))))
                    .map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <ActionButton type="submit" disabled={disabled}>{t("assignments.setStation")}</ActionButton>
            </form>}
          </li>;
        })}</ul>
      </div>;
    })}</div>)}
    {compact && retrainTasks.length > 0 && <RetrainTaskList tasks={retrainTasks} />}
    {compact && section("tasks", "assignments.takeAssignTasks", ownTasks.length, TASK_TYPES.length, <div className="space-y-3"><ul className="space-y-2">{board.viewerLevel >= 4 && unassigned.filter((task) => board.viewerLevel >= TASK_MIN_LEVEL[task] && board.people.find((person) => person.id === board.viewerId)?.available !== false).map((task) => <li key={task}>
      <ActionLink variant="secondary" className="max-w-full whitespace-normal text-left" href={board.viewerLevel >= 4 ? `/assignments?location=${board.locationId}` : taskHref(task, board.locationId)}>{t("assignments.unassignedAction", { task: t(`assignments.task.${task}`) })}</ActionLink>
    </li>)}</ul>{ownTasks.filter((task) => board.viewerLevel >= TASK_MIN_LEVEL[task.task]).map((task) => <div key={task.id}>{board.viewerLevel >= 4 || task.source !== "taken" ? <ActionLink variant="secondary" href={taskHref(task.task, board.locationId)}>{t(`assignments.task.${task.task}`)}</ActionLink> : <span>{t(`assignments.task.${task.task}`)}</span>}{taskLine(task)}</div>)}</div>)}
    {!compact && section("tasks", "assignments.takeAssignTasks", TASK_TYPES.length - unassigned.length, TASK_TYPES.length, <div className="space-y-3">
      {board.viewerLevel >= 4 && <p className="text-sm text-co-text-muted">{t("assignments.takeHint")}</p>}
      <ul className="space-y-3">
        <li className="rounded-xl border border-co-border p-3"><ActionLink variant="secondary" href={`/operations/closing?location=${board.locationId}`}>{t("assignments.closing")}</ActionLink><p className="mt-2 text-sm text-co-text-muted">{t("assignments.everyone")}</p></li>
        {TASK_TYPES.map((task) => {
          const assignments = board.tasks.filter((assignment) => assignment.task === task && assignment.available !== false);
          const canOpen = board.viewerLevel >= TASK_MIN_LEVEL[task] && (board.viewerLevel >= 4 || assignments.some((assignment) => assignment.assigneeId === board.viewerId && assignment.source !== "taken"));
          return <li key={task} className="rounded-xl border border-co-border p-3">
            {canOpen ? <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink> : <span>{t(`assignments.task.${task}`)}</span>}
            <div className="mt-2">{assignments.length === 0 ? <><p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p>{taskVacancyLine(task)}</> : assignments.map(taskLine)}
              {board.taskChanges?.filter((entry) => entry.task === task).map((entry) => <div key={entry.change.at}>{changeLine(entry.change)}</div>)}
            </div>
            {!canOpen && assignments.length > 0 && <p className="text-sm text-co-text-muted">{t("assignments.assignedOther")}</p>}
          </li>;
        })}
      </ul>
    </div>)}
    {!compact && board.viewerLevel >= 4 && section("unassigned", "assignments.unassigned", 0, unassigned.length, <ul className="space-y-2">{unassigned.map((task) => <li key={task}>{board.viewerLevel >= TASK_MIN_LEVEL[task] ? <ActionLink variant="secondary" href={taskHref(task, board.locationId)}>{t(`assignments.task.${task}`)}</ActionLink> : <span>{t(`assignments.task.${task}`)}</span>}</li>)}</ul>)}
    {section(compact ? "stations" : "people", compact ? "assignments.takeAssignStations" : "assignments.people", compact ? Number(!!currentStation(board.events, board.viewerId)?.stationId) : board.people.filter((person) => person.hasWork).length, compact ? 1 : board.people.length, <div className="space-y-3">
    {!compact && hereNowList}
    {people.length === 0 && <p>{t("assignments.empty")}</p>}
    {people.map((person) => {
      const current = currentStation(board.events, person.id);
      const station = board.stations.find((s) => s.id === current?.stationId);
      const position = station?.positions.find((p) => p.id === current?.positionId);
      const tasks = board.tasks.filter((task) => task.assigneeId === person.id);
      const assignableTasks = TASK_TYPES.filter((task) => person.level >= TASK_MIN_LEVEL[task]);
      const managerCanEdit = !compact && board.viewerLevel >= 4 && person.available !== false && person.level <= board.viewerLevel
        && (person.id !== board.viewerId || canSelfClaim(current));
      const canRetract = board.viewerLevel >= 4;
      const canClaim = person.available !== false && !person.onBreak && compact && person.id === board.viewerId && canSelfClaim(current);
      return <article key={person.id} className="min-w-0 space-y-3 rounded-xl border border-co-border p-3">
        {!compact && <h4 className="truncate font-bold text-co-text" title={person.name}>{person.name}</h4>}
        {presenceLine(person.presence)}
        {person.onBreak && <><p className="font-bold text-co-text-muted">{t("assignments.lifecycle.onBreak")}</p><p className="text-sm text-co-text-muted">{t("assignments.lifecycle.breakHelp")}</p></>}
        {person.available !== false && (person.id === board.viewerId || (!compact && board.viewerLevel >= 4 && person.level <= board.viewerLevel)) && <ActionButton variant="secondary" disabled={disabled} onClick={() => void mutate({ action: "break", userId: person.id, onBreak: !person.onBreak })}>{t(person.onBreak ? "assignments.lifecycle.backFromBreak" : "assignments.lifecycle.startBreak")}</ActionButton>}
        {endShiftButton(person)}
        {person.available === false && <p className="text-sm text-co-text-muted">{t("assignments.unavailablePerson")}</p>}
        <p className="truncate font-bold text-co-text" title={station?.name}>{station ? `${language === "es" ? station.nameEs || station.name : station.name} · ${position ? (language === "es" ? position.nameEs || position.name : position.name) : ""}` : t("assignments.noStation")}</p>
        {position && <p className="text-sm text-co-text-muted">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
        {current?.stationId ? byLine(current.source, current.actorName, current.at) : null}
        {changeLine(current?.change)}
        {!person.onBreak && (managerCanEdit || canClaim) && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const positionId = String(data.get("positionId") || "");
          const target = board.stations.find((s) => s.positions.some((p) => p.id === positionId));
          requestMutation({ action: "station", userId: person.id, stationId: target?.id ?? null, positionId: positionId || null, manage: managerCanEdit }, stationOverrideLevel(person.id));
        }}>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.station")}
            <select key={current?.id ?? "none"} name="positionId" defaultValue={current?.positionId ?? ""} disabled={disabled} className={control}>
              <option value="">{t("assignments.noStation")}</option>
              {board.stations.filter((s) => (s.active && s.staffed && !s.closedAt) || s.id === current?.stationId).flatMap((s) =>
                s.positions.filter((p) => p.active || p.id === current?.positionId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((p) => {
                  const holder = board.occupiedPositions?.find((entry) => entry.positionId === p.id);
                  const taken = !!holder && p.id !== current?.positionId;
                  return <option key={p.id} value={p.id} disabled={!s.active || !s.staffed || !!s.closedAt || !p.active || (board.viewerLevel < 4 && taken)}>
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
          {board.viewerLevel >= TASK_MIN_LEVEL[assignment.task] && (board.viewerLevel >= 4 || (person.id === board.viewerId && assignment.source !== "taken" && assignment.available !== false && person.available !== false)) ? <ActionLink variant="secondary" href={taskHref(assignment.task, board.locationId)}>{t(`assignments.task.${assignment.task}`)}</ActionLink> : <span>{t(`assignments.task.${assignment.task}`)}</span>}
          <div className="w-full">{byLine(assignment.source ?? "assigned", assignment.assignerName, assignment.at)}{changeLine(assignment.change)}</div>
          {assignment.available === false && <p className="text-sm text-co-text-muted">{t("assignments.unavailableTask")}</p>}
          {assignment.note && <p className="text-sm text-co-text-muted">{assignment.note}</p>}
          {canRetract && assignment.source !== "taken" && <ActionButton variant="danger" disabled={disabled} onClick={() => requestMutation({ action: "task_retract", assignmentId: assignment.id }, assignment.assignerLevel)}>{t("assignments.retract")}</ActionButton>}
        </li>)}</ul>
        {managerCanEdit && person.id !== board.viewerId && assignableTasks.length > 0 && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          requestMutation({ action: "task_assign", userId: person.id, task: data.get("task") as TaskType, note: data.get("note") });
        }}>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.task")}
            <select name="task" className={control} disabled={disabled}>{assignableTasks.map((task) => <option key={task} value={task}>{t(`assignments.task.${task}`)}</option>)}</select>
          </label>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.note")}<input aria-label={t("assignments.note")} name="note" maxLength={500} className={control} disabled={disabled} /></label>
          <ActionButton type="submit" disabled={disabled}>{t("assignments.assignTask")}</ActionButton>
        </form>}
      </article>;
    })}</div>)}
    {compact && section("team", "assignments.teamToday", board.people.filter((person) => person.hasWork).length, board.people.length, <div className="space-y-4">
      {hereNowList}
      <ul className="space-y-3">{TASK_TYPES.map((task) => {
        const assignments = board.tasks.filter((assignment) => assignment.task === task && assignment.available !== false);
        return <li key={task}><h4 className="font-bold">{t(`assignments.task.${task}`)}</h4>{assignments.length ? assignments.map(taskLine) : <><p className="text-sm text-co-text-muted">{t("assignments.attribution.unassigned")}</p>{taskVacancyLine(task)}</>}
          {board.taskChanges?.filter((entry) => entry.task === task).map((entry) => <div key={entry.change.at}>{changeLine(entry.change)}</div>)}</li>;
      })}</ul>
      {board.stations.filter((station) => station.active && station.staffed).map((station) => <div key={station.id}>
        <h4 className="font-bold">{language === "es" ? station.nameEs || station.name : station.name}</h4>
        {stationStatus(station)}
        <ul className="space-y-2">{station.positions.filter((position) => position.active).map((position) => {
          const occupant = board.people.find((person) => currentStation(board.events, person.id)?.positionId === position.id);
          return <li key={position.id}><p>{language === "es" ? position.nameEs || position.name : position.name}</p>{trimHint(position)}{!occupant && !station.closedAt && positionVacancyLine(position.id)}{!station.closedAt && stationLine(occupant ? currentStation(board.events, occupant.id) : null, occupant?.name ?? t("assignments.assignedStaff"))}</li>;
        })}</ul>
      </div>)}
      {board.people.map((person) => { const held = board.tasks.filter((task) => task.assigneeId === person.id && task.available !== false); return <div key={person.id}><h4 className="font-bold">{person.name}</h4>{presenceLine(person.presence)}{person.onBreak && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.onBreak")}</p>}{personStationLine(currentStation(board.events, person.id))}{held.length ? held.map(personTaskLine) : <p className="text-sm text-co-text-muted">{t("assignments.noTasks")}</p>}</div>; })}
    </div>)}
    <dialog ref={reasonDialog} aria-label={t("assignments.confirmChange")} className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border-2 border-co-border bg-co-surface p-4 text-co-text backdrop:bg-black/50" onCancel={(event) => { event.preventDefault(); if (!busy) setPending(null); }}>
    {pending && <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      void mutate({ ...pending.payload, reasonCode: reasonCode || null, reasonNote: reasonNote.trim() || null });
    }}>
      <h3 className="font-bold">{t("assignments.confirmChange")}</h3>
      {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
      {pending.payload.action === "end_shift" && <p>{t(pending.payload.userId === board.viewerId ? "whosHere.endMyShiftConfirm" : "whosHere.endShiftConfirm")}</p>}
      {pending.required && <p>{t("assignments.reasonRequired")}</p>}
      <label className="grid min-w-0 gap-1 text-sm">{t("assignments.reasonLabel")}
        <select className={control} name="reasonCode" value={reasonCode} required={pending.required} disabled={disabled} onChange={(event) => setReasonCode(event.target.value as OverrideReasonCode | "")}>
          <option value="">{t("assignments.reasonNone")}</option>{OVERRIDE_REASON_CODES.map((code) => <option key={code} value={code}>{t(`assignments.reason.${code}`)}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm">{t(reasonCode === "other" ? "assignments.reasonNoteRequired" : "assignments.note")}
        <textarea className={control} name="reasonNote" maxLength={500} required={reasonCode === "other"} value={reasonNote} disabled={disabled} onChange={(event) => setReasonNote(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2"><ActionButton type="submit" disabled={disabled || (pending.required && !reasonCode) || (reasonCode === "other" && !reasonNote.trim())}>{t("assignments.confirmChange")}</ActionButton><ActionButton type="button" variant="secondary" disabled={disabled} onClick={() => setPending(null)}>{t("assignments.cancelChange")}</ActionButton></div>
    </form>}
    </dialog>
    {compact && <ActionLink variant="secondary" href={`/assignments?location=${board.locationId}`}>{t(board.viewerLevel >= 4 ? "assignments.title" : "assignments.viewDay")}</ActionLink>}
  </section>;
}
