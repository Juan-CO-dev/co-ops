"use client";
/**
 * THE one-line forecast, for every surface that shows one (the signals page's day rows, the order walk's
 * "Coming up"). It renders the line AND its qualifications together, so no surface can show the figure and
 * drop what limits it (review DEMAND4-r1 P2): rain given for only some hours says for how many, a day held in
 * part says so, and a forecast whose feed has not run cleanly says it may be old.
 * The decisions are lib/demand-signals/weather-line-shared.ts; this file only spells them in en + es.
 */
import { rainLineOf, weatherIsOld } from "@/lib/demand-signals/weather-line-shared";
import type { WeatherDay } from "@/lib/demand-signals/signals-view-shared";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

const WARN_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** The line's text: the temperatures, then the chance of rain WITH how much of the day it stands for. */
export function weatherSummaryText(t: T, w: Pick<WeatherDay, "highF" | "lowF" | "precipMaxPct" | "precipHours" | "hours">): string {
  const temps = t("signals.weather.temps", { high: Math.round(w.highF), low: Math.round(w.lowF) });
  const rain = rainLineOf(w);
  if (rain.kind === "not_given") return t("signals.weather.line_no_rain", { temps });
  if (rain.kind === "partial") return t("signals.weather.line_rain_partial", { temps, rain: rain.pct, known: rain.known, hours: rain.hours });
  return t("signals.weather.line", { temps, rain: rain.pct });
}

export function WeatherSummary({ weather, feeds, className }: { weather: WeatherDay; feeds: Readonly<Record<string, string>>; className?: string }) {
  const { t } = useTranslation();
  return <>
    <span className={className}>{weatherSummaryText(t, weather)}</span>
    {weather.partial && <span className={WARN_CHIP}>{t("signals.weather.partial_badge")}</span>}
    {weatherIsOld(weather.sourceIds, feeds) && <span className={WARN_CHIP}>{t("signals.weather.old_badge")}</span>}
  </>;
}
