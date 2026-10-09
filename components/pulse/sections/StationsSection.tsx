"use client";

/** Stations & tasks: counts up front, per-station rows (names at KH+), tasks done vs left; crew see "My shift". */
import Link from "next/link";
import { formatClockTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { StationTaskRow, StationsData } from "@/lib/pulse/types";
import { STATUS_CHIP, STATUS_KEY, subHeading, tapLink } from "@/components/pulse/shared";

function TaskList({ tasks, withNames }: { tasks: StationTaskRow[]; withNames: boolean }) {
  const { t } = useTranslation();
  if (tasks.length === 0) return <p className="text-sm text-co-text-muted">{t("pulse.stations.mine_tasks_none")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-co-border/50">
      {tasks.map((task, i) => (
        <li key={`${task.task}-${task.assigneeName ?? ""}-${i}`} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1">
          <Link href={task.href} className="min-w-0 text-sm font-semibold text-co-text underline underline-offset-2">
            {t(`assignments.task.${task.task}` as TranslationKey)}{withNames && task.assigneeName ? <span className="font-normal text-co-text-muted"> · {task.assigneeName}</span> : null}
          </Link>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${task.done === true ? "bg-co-success-surface text-co-confirm-text" : task.done === false ? "bg-co-warning-surface text-co-warning-text" : "bg-co-surface-2 text-co-text-dim"}`}>
            {task.done === true ? t("pulse.stations.task_done") : task.done === false ? t("pulse.stations.task_open") : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StationsSection({ data, mode, locationId }: { data: StationsData; mode: "card" | "detail"; locationId: string }) {
  const { t, language } = useTranslation();
  const rows = mode === "card" ? data.stations.slice(0, 6) : data.stations;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-co-text-muted">{t("pulse.stations.counts", { ...data.counts })}</p>
      <p className="text-sm font-bold text-co-text">{t("pulse.stations.tasks", { done: data.tasksDone, left: data.tasksLeft })}</p>
      {data.mine && (
        <div className="rounded-lg border border-co-border bg-co-surface-inset p-3">
          <h3 className={subHeading}>{t("pulse.stations.mine")}</h3>
          <p className="text-sm font-semibold text-co-text">{data.mine.stationName ? `${data.mine.stationName}${data.mine.positionName ? ` · ${data.mine.positionName}` : ""}` : t("pulse.stations.mine_none")}</p>
          <TaskList tasks={data.mine.tasks} withNames={false} />
        </div>
      )}
      {rows.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.stations.empty")}</p> : (
        <ul className="flex flex-col divide-y divide-co-border/50">
          {rows.map((s) => (
            <li key={s.id} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1">
              <span className="min-w-0 text-sm">
                <span className="font-bold text-co-text">{language === "es" ? s.nameEs || s.name : s.name}</span>
                {s.people.length > 0 && <span className="text-co-text-muted"> · {s.people.join(", ")}</span>}
                {s.closedAt == null && s.closesAt && <span className="text-xs text-co-text-dim"> · {t("pulse.stations.closes", { time: formatClockTime(s.closesAt, language) })}</span>}
                {s.closedAt == null && s.trimAt && <span className="text-xs text-co-text-dim"> · {t("pulse.stations.trims", { time: formatClockTime(s.trimAt, language) })}</span>}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_CHIP[s.status]}`}>{t(STATUS_KEY[s.status])}</span>
            </li>
          ))}
        </ul>
      )}
      {mode === "detail" && (
        <>
          {!data.mine && (
            <div>
              <h3 className={subHeading}>{t("assignments.tasks")}</h3>
              <TaskList tasks={data.tasks} withNames />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/assignments?loc=${encodeURIComponent(locationId)}`} className={tapLink}>{t("assignments.stations")}</Link>
            <Link href={`/operations/closing?location=${encodeURIComponent(locationId)}`} className={tapLink}>{t("pulse.drawer.go_close")}</Link>
          </div>
        </>
      )}
    </div>
  );
}
