"use client";

/** People (KH+): who's here (Toast clock or CO-OPS activity), on break, stations covered/open, freed stations, unlinked clock-ins; the detail page adds the timeline. */
import Link from "next/link";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PeopleData, PersonRow } from "@/lib/pulse/types";
import { subHeading, tapLink } from "@/components/pulse/shared";

function presenceText(p: PersonRow, t: ReturnType<typeof useTranslation>["t"], language: "en" | "es"): string {
  if (p.onShift) return p.source === "toast_clock" && p.since ? t("whosHere.clockedIn", { time: formatTime(p.since, language) }) : t("whosHere.activeInCoops");
  if (p.off) {
    const key: TranslationKey = p.off.reason === "clocked_out" ? "whosHere.clockedOut" : p.off.reason === "ended_shift" ? "whosHere.endedShift" : "whosHere.shopClosed";
    return t(key, { time: formatTime(p.off.at, language) });
  }
  return "";
}

export function PeopleSection({ data, mode, locationId }: { data: PeopleData; mode: "card" | "detail"; locationId: string }) {
  const { t, language } = useTranslation();
  const list = mode === "card" ? data.here.slice(0, 8) : data.here;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-co-text-muted">
        <span className="font-bold text-co-text">{t("pulse.people.here", { count: data.here.length })}</span>
        {data.onBreak > 0 && <span>{t("pulse.people.on_break", { count: data.onBreak })}</span>}
        <span>{t("pulse.people.stations", { covered: data.stationsCovered, open: data.stationsOpen })}</span>
      </div>
      {!data.whosHere && <p className="text-xs text-co-text-dim">{t("pulse.people.presence_off")}</p>}
      {list.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.people.nobody")}</p> : (
        <ul className="flex flex-col divide-y divide-co-border/50">
          {list.map((p) => (
            <li key={p.id} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1">
              <span className="min-w-0 text-sm"><span className="font-bold text-co-text">{p.name}</span>{p.onBreak && <span className="ml-2 rounded-full bg-co-warning-surface px-2 py-0.5 text-[10px] font-bold uppercase text-co-warning-text">{t("assignments.lifecycle.onBreak")}</span>}</span>
              <span className="text-xs text-co-text-muted">{p.stationName ? `${p.stationName}${p.positionName ? ` · ${p.positionName}` : ""}` : t("pulse.people.no_station")} · {presenceText(p, t, language)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.unlinked.count > 0 && (
        <p className="text-xs font-semibold text-co-warning-text">
          {data.unlinked.count === 1 ? t("pulse.people.unlinked_one", { names: data.unlinked.names.join(", ") }) : t("pulse.people.unlinked_other", { count: data.unlinked.count, names: data.unlinked.names.join(", ") })}
        </p>
      )}
      {data.freed.length > 0 && (
        <div>
          <h3 className={subHeading}>{t("pulse.people.freed")}</h3>
          <ul className="text-sm text-co-text-muted">
            {data.freed.slice(0, mode === "card" ? 3 : 50).map((f, i) => (
              <li key={`${f.name}-${f.at}-${i}`}>{t(f.reason === "ended_shift" ? "assignments.lifecycle.leftOpenEnded" : "assignments.lifecycle.leftOpen", { name: f.name, time: formatTime(f.at, language) })}{f.stationName ? ` · ${f.stationName}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {mode === "detail" && (
        <>
          {data.seenToday.length > 0 && (
            <div>
              <h3 className={subHeading}>{t("pulse.people.seen_today")}</h3>
              <ul className="text-sm text-co-text-muted">{data.seenToday.map((p) => <li key={p.id} className="min-h-[28px]"><span className="font-semibold text-co-text">{p.name}</span> · {presenceText(p, t, language)}</li>)}</ul>
            </div>
          )}
          <div>
            <h3 className={subHeading}>{t("pulse.people.timeline")}</h3>
            {data.timeline.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.card.empty")}</p> : (
              <ol className="text-sm text-co-text-muted">
                {data.timeline.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex min-h-[28px] gap-2"><span className="w-20 shrink-0 tabular-nums">{formatTime(e.at, language)}</span><span><span className="font-semibold text-co-text">{e.name}</span> {t(`pulse.people.event.${e.kind}` as TranslationKey, { detail: e.detail ?? "" })}</span></li>
                ))}
              </ol>
            )}
          </div>
          <Link href={`/assignments?loc=${encodeURIComponent(locationId)}`} className={tapLink}>{t("assignments.stations")}</Link>
        </>
      )}
    </div>
  );
}
