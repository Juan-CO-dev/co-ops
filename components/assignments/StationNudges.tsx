"use client";
import { useEffect, useState } from "react";
import type { ShiftBoard } from "@/lib/assignments-shared";
import { stationNudges, trimReleasePayload } from "@/lib/station-schedule-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatClockTime } from "@/lib/i18n/format";
import { ActionButton, ActionLink } from "@/components/ActionButton";
import { closingStationAnchor } from "@/lib/assignment-sections";

export function StationNudges({ board, disabled, release }: {
  board: ShiftBoard; disabled: boolean; release: (payload: NonNullable<ReturnType<typeof trimReleasePayload>>) => void;
}) {
  const { t, language } = useTranslation();
  const [now, setNow] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const storageKey = `station-nudges:${board.viewerId}:${board.locationId}:${board.stationDate ?? board.date}`;
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const read = () => {
      try {
        const data: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        setDismissed(Array.isArray(data) ? data.filter((key): key is string => typeof key === "string") : []);
      } catch { setDismissed([]); }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [storageKey]);
  function dismiss(key: string) {
    const next = [...dismissed, key];
    setDismissed(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Session dismissal still works. */ }
  }
  if (!now || board.viewerLevel < 4) return null;
  return <div className="space-y-3">{board.stations.flatMap(station => stationNudges(board, station, now, dismissed).map(nudge => {
    const name = language === "es" ? station.nameEs || station.name : station.name;
    return <div key={nudge.key} className="space-y-2 rounded-xl border-2 border-co-border p-3">
      <p className="font-bold">{nudge.kind === "close"
        ? t("assignments.schedule.closeNudge", { name, time: formatClockTime(nudge.at, language) })
        : t("assignments.schedule.trimNudge", { name, from: nudge.count, to: nudge.toCount })}</p>
      <div className="flex flex-wrap gap-2">
        {nudge.kind === "close" && <ActionLink
          href={`/operations/closing?location=${encodeURIComponent(board.locationId)}#${closingStationAnchor(station.name)}`}
          prefetch={false}
          aria-disabled={disabled || undefined}
          onClick={event => { if (disabled) event.preventDefault(); }}
        >{t("assignments.schedule.closeNow", { name })}</ActionLink>}
        {nudge.kind === "trim" && <ActionButton disabled={disabled} aria-expanded={picking === nudge.key} aria-controls={`trim-${station.id}`} onClick={() => setPicking(picking === nudge.key ? null : nudge.key)}>{t("assignments.schedule.choose")}</ActionButton>}
        <ActionButton variant="secondary" disabled={disabled} onClick={() => dismiss(nudge.key)}>{t("assignments.schedule.dismiss")}</ActionButton>
      </div>
      {nudge.kind === "trim" && picking === nudge.key && <div id={`trim-${station.id}`} className="flex flex-wrap gap-2">{board.people.map(person => {
        const payload = trimReleasePayload(board, station.id, person.id);
        return payload && <ActionButton key={person.id} variant="secondary" disabled={disabled} onClick={() => release(payload)}>{t("assignments.schedule.release", { name: person.name })}</ActionButton>;
      })}</div>}
    </div>;
  }))}</div>;
}
