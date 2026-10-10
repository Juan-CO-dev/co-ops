"use client";

/** Tap a station: who's on it, positions filled, close/trim time, open tasks, and the one-tap actions through the existing surfaces. */
import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { formatClockTime, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { FloorStation } from "@/lib/pulse/types";
import { STATUS_CHIP, STATUS_KEY, tapLink } from "@/components/pulse/shared";

export function StationDrawer({ station, locationId, canAct, onClose }: { station: FloorStation; locationId: string; canAct: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const name = language === "es" ? station.nameEs || station.name : station.name;
  const loc = encodeURIComponent(locationId);
  return (
    <div role="region" aria-label={name} className="mt-3 rounded-lg border border-co-border bg-co-surface-inset p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-co-text">{name} <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_CHIP[station.status]}`}>{t(STATUS_KEY[station.status])}</span></h3>
        <ActionButton variant="secondary" onClick={onClose}>{t("pulse.drawer.dismiss")}</ActionButton>
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("pulse.drawer.who")}</dt><dd className="text-co-text">{station.people.length > 0 ? station.people.join(", ") : station.filled > 0 ? "•".repeat(station.filled) : t("pulse.drawer.nobody")}</dd></div>
        {station.positions > 0 && <div><dd className="text-co-text">{t("pulse.drawer.positions", { filled: station.filled, positions: station.positions })}</dd></div>}
        {station.closedAt ? <div><dd className="text-co-text">{t("pulse.drawer.closed_at", { time: formatTime(station.closedAt, language) })}</dd></div>
          : <>
            {station.closesAt && <div><dd className="text-co-text">{t("pulse.drawer.closes_at", { time: formatClockTime(station.closesAt, language) })}</dd></div>}
            {station.trimAt && station.trimTo !== null && <div><dd className="text-co-text">{t("pulse.drawer.trim_at", { to: station.trimTo, time: formatClockTime(station.trimAt, language) })}</dd></div>}
          </>}
        {station.tasksLeft > 0 && <div><dd className="text-co-text">{t("pulse.drawer.tasks_left", { count: station.tasksLeft })}</dd></div>}
      </dl>
      {canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/assignments?loc=${loc}`} className={tapLink}>{t("pulse.drawer.go_assign")}</Link>
          {!station.closedAt && <Link href={`/operations/closing?location=${loc}`} className={tapLink}>{t("pulse.drawer.go_close")}</Link>}
        </div>
      )}
    </div>
  );
}
