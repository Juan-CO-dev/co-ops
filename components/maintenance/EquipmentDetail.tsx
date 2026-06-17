import type { EquipmentDetail } from "@/lib/maintenance";
import { FRIDGE_DEFAULT_SAFE_MAX_F, computeFridgeStatus } from "@/lib/maintenance";
import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { formatTime, formatDateLabel } from "@/lib/i18n/format";
import { TempTrendChart } from "./TempTrendChart";

export function EquipmentDetail({
  detail,
  language,
}: {
  detail: EquipmentDetail;
  language: Language;
}) {
  const isFridge = detail.equip.kind === "fridge";
  const safeMax = detail.equip.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;

  // Derive today's status for the header chip
  const today = new Date().toISOString().slice(0, 10);
  const todaysReadings = detail.readings.filter((r) => r.date === today);
  const status = isFridge
    ? computeFridgeStatus(todaysReadings, safeMax)
    : null;

  // Group readings by date (desc) for the timeline
  const readingsByDate = new Map<string, typeof detail.readings>();
  for (const r of detail.readings) {
    const existing = readingsByDate.get(r.date);
    if (existing) {
      existing.push(r);
    } else {
      readingsByDate.set(r.date, [r]);
    }
  }
  // Sort dates descending
  const sortedDates = [...readingsByDate.keys()].sort((a, b) =>
    a < b ? 1 : -1,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-co-text">{detail.equip.name}</h1>
          {status !== null && (
            <span
              className={`text-xs font-semibold ${
                status === "ok"
                  ? "text-co-success"
                  : status === "out_of_range"
                    ? "text-co-cta"
                    : "text-co-text-muted"
              }`}
            >
              {status === "ok"
                ? serverT(language, "maintenance.status.ok")
                : status === "out_of_range"
                  ? serverT(language, "maintenance.status.out_of_range")
                  : serverT(language, "maintenance.status.no_reading")}
            </span>
          )}
        </div>
        {isFridge && (
          <p className="mt-1 text-xs text-co-text-muted">
            {serverT(language, "maintenance.detail.safe_range", {
              max: safeMax,
            })}
          </p>
        )}
      </div>

      {/* Fridge trend + stats */}
      {isFridge && detail.readings.length > 0 && (
        <>
          <TempTrendChart
            values={detail.readings.map((r) => r.valueF)}
            safeMaxF={safeMax}
            _language={language}
          />

          {detail.stats !== null && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {detail.stats.latest !== null && (
                <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                    {serverT(language, "maintenance.stat.latest")}
                  </p>
                  <p className="text-sm font-semibold text-co-text">
                    {serverT(language, "maintenance.degrees", {
                      value: detail.stats.latest,
                    })}
                  </p>
                </div>
              )}
              {detail.stats.amPmSwingToday !== null && (
                <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                    {serverT(language, "maintenance.stat.swing")}
                  </p>
                  <p className="text-sm font-semibold text-co-text">
                    {serverT(language, "maintenance.degrees", {
                      value: detail.stats.amPmSwingToday,
                    })}
                  </p>
                </div>
              )}
              {detail.stats.min !== null && (
                <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                    {serverT(language, "maintenance.stat.min")}
                  </p>
                  <p className="text-sm font-semibold text-co-text">
                    {serverT(language, "maintenance.degrees", {
                      value: detail.stats.min,
                    })}
                  </p>
                </div>
              )}
              {detail.stats.max !== null && (
                <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                    {serverT(language, "maintenance.stat.max")}
                  </p>
                  <p className="text-sm font-semibold text-co-text">
                    {serverT(language, "maintenance.degrees", {
                      value: detail.stats.max,
                    })}
                  </p>
                </div>
              )}
              {detail.stats.avg !== null && (
                <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                    {serverT(language, "maintenance.stat.avg")}
                  </p>
                  <p className="text-sm font-semibold text-co-text">
                    {serverT(language, "maintenance.degrees", {
                      value: detail.stats.avg,
                    })}
                  </p>
                </div>
              )}
              <div className="rounded-md border border-co-border bg-co-surface px-2 py-1.5 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                  {serverT(language, "maintenance.stat.out_of_range")}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    detail.stats.outOfRangeCount > 0
                      ? "text-co-cta"
                      : "text-co-text"
                  }`}
                >
                  {detail.stats.outOfRangeCount}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Readings timeline */}
      {isFridge && detail.readings.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {serverT(language, "maintenance.detail.readings_heading")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {sortedDates.map((date) => {
              const rows = readingsByDate.get(date) ?? [];
              return rows.map((r) => (
                <li
                  key={`${date}-${r.phase}-${r.at}`}
                  className="flex items-start gap-3 rounded-md border border-co-border bg-co-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-co-text-muted">
                        {formatDateLabel(date, language)}
                      </span>
                      <span className="rounded bg-co-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                        {r.phase === "AM"
                          ? serverT(language, "maintenance.phase.am")
                          : serverT(language, "maintenance.phase.pm")}
                      </span>
                      <span
                        className={`text-sm font-semibold ${
                          r.valueF > safeMax ? "text-co-cta" : "text-co-text"
                        }`}
                      >
                        {serverT(language, "maintenance.degrees", {
                          value: r.valueF,
                        })}
                      </span>
                    </div>
                    {r.note && (
                      <p className="mt-0.5 text-xs text-co-text-muted">
                        {r.note}
                      </p>
                    )}
                  </div>
                </li>
              ));
            })}
          </ul>
        </section>
      )}

      {/* Maintenance history */}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {serverT(language, "maintenance.detail.history_heading")}
        </h2>
        {detail.notes.length === 0 ? (
          <p className="text-sm text-co-text-muted">
            {serverT(language, "maintenance.empty.no_notes")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-co-border bg-co-surface px-3 py-2"
              >
                <p className="text-sm text-co-text">{n.note}</p>
                <p className="mt-1 text-xs text-co-text-muted">
                  {serverT(language, "maintenance.note.attribution", {
                    name: n.byName ?? "—",
                    time: formatTime(n.at, language),
                  })}
                  {n.byName === null
                    ? ` · ${serverT(language, "maintenance.note.checklist_source")}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
