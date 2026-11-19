"use client";
/**
 * The "Burden (taxes and benefits)" card on /admin/sevenshifts, beside the Payroll shop card (board two labor views
 * PR 2; owner / CGS / MoO only, decided on the server before anything is read; shown only with SCHEDULE_LABOR_VIEWS).
 * Disclosure doctrine: a default-collapsed CollapsibleSection with the scope count on its header and the ESTIMATED
 * count in the never-collapse badge slot; one summary row per scope (the company default first, then every shop),
 * each a full-row 44px toggle that opens its drawer (history + the form). useState only.
 *
 * Juan 2026-11-18: the burden is an ESTIMATE until payroll gives the real figure, and the card says so on every
 * estimated scope. A shop either follows the company or has its own rate; "Follow the company" (0346) ends a
 * shop's own rate from a Sunday on. Every save re-prices labor from its start date (read time, never rebuilt), so
 * the warning names that date before the password is asked for (Tier B, always prompted), then
 * POST /api/admin/labor/burden with the head this card showed (another save in between is refused, never overwritten).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabelWithYear } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  LABOR_BURDEN_ERROR_CODES, LABOR_BURDEN_MAX_PCT, LABOR_BURDEN_NOTE_MAX, validBurdenStart, type BurdenCardView, type BurdenScopeView, type BurdenSource,
} from "@/lib/facts/labor-burden-shared";
import { LABOR_FLOOR_WEEK } from "@/lib/facts/labor-config-shared";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const control = "min-h-[44px] items-center min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const EST_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";
const OK_CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-text-muted";

export type LaborBurdenCardData = BurdenCardView & { userNames: Record<string, string> };

function errorKey(code: string | undefined): TranslationKey {
  return (LABOR_BURDEN_ERROR_CODES as readonly string[]).includes(code ?? "") ? (`labor.burden.error.${code}` as TranslationKey) : "labor.burden.error.generic";
}
/** 11.5 → "11.5", 12 → "12" (a setting, shown as typed; never a locale format). */
const pctText = (n: number) => String(Math.round(n * 100) / 100);

export function LaborBurdenCard({ data }: { data: LaborBurdenCardData | null }) {
  const { t, language } = useTranslation();
  if (!data) return <section className="co-card p-4"><p className="text-co-text-muted">{t("labor.burden.unavailable")}</p></section>;
  return <CollapsibleSection idBase="labor-burden" title={t("labor.burden.title")} count={t("labor.burden.count", { n: data.scopes.length - 1 })}
    badge={data.estimatedCount > 0 ? <span className={EST_CHIP}>{t("labor.burden.estimated_badge", { n: data.estimatedCount })}</span> : null}>
    <div className="space-y-3">
      <p className="text-co-text-muted">{t("labor.burden.intro")}</p>
      <p className="text-sm text-co-text-dim">{t("labor.burden.week", { date: formatDateLabelWithYear(data.weekStart, language) })}</p>
      {data.estimatedCount > 0 && <p className="rounded-lg bg-co-warning-surface p-3 text-sm font-bold text-co-warning-text">{t("labor.burden.estimate_note")}</p>}
      <ul className="space-y-2">{data.scopes.map((scope) => <li key={scope.locationId ?? "company"}><BurdenRowView scope={scope} data={data} /></li>)}</ul>
    </div>
  </CollapsibleSection>;
}

function BurdenRowView({ scope, data }: { scope: BurdenScopeView; data: LaborBurdenCardData }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"rate" | "follow">("rate");
  const [pct, setPct] = useState("");
  const [source, setSource] = useState<BurdenSource>("estimated");
  const [starts, setStarts] = useState(data.weekStart);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  const date = (ymd: string) => formatDateLabelWithYear(ymd, language);
  const name = scope.name ?? t("labor.burden.scope.company");
  const key = scope.locationId ?? "company";
  const panelId = `labor-burden-row-${key}`;
  const follow = mode === "follow" && scope.canFollowCompany;
  const pctValue = pct.trim() === "" ? Number.NaN : Number(pct);
  const pctOk = Number.isFinite(pctValue) && pctValue >= 0 && pctValue <= LABOR_BURDEN_MAX_PCT;
  const startOk = validBurdenStart(starts);
  const ready = startOk && (follow || pctOk);
  const touched = () => { setSaved(false); setError(null); };

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const payload = { locationId: scope.locationId, followCompany: follow, burdenPct: follow ? null : pctValue, validFrom: starts,
        source: follow ? null : source, note, expectedId: scope.headId };
      const post = () => fetch("/api/admin/labor/burden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await post();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await post();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) { setError(errorKey(body.code)); return; }
      setSaved(true); setPct(""); setNote(""); setMode("rate");
      startTransition(() => router.refresh());
    } catch { setError("labor.burden.error.generic"); } finally { setBusy(false); }
  }

  return <div className="rounded-lg border-2 border-co-border">
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={t("labor.burden.aria.row", { name })} onClick={() => setOpen((o) => !o)}
      className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
      <span className="font-bold text-co-text">{name}</span>
      <span className="text-co-text">{t("labor.burden.row", { pct: pctText(scope.pct) })}</span>
      <span className={scope.basis === "estimated" ? EST_CHIP : OK_CHIP}>{t(`labor.burden.chip.${scope.basis}` as TranslationKey)}</span>
      {scope.locationId !== null && <span className="text-sm text-co-text-dim">{t(`labor.burden.reads.${scope.scope}` as TranslationKey)}</span>}
    </button>
    {open && <div id={panelId} className="space-y-3 border-t-2 border-co-border p-3">
      <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("labor.burden.history")}</h4>
        {scope.history.length === 0 ? <p className="text-sm text-co-text-dim">{t("labor.burden.history_empty")}</p>
          : <ul className="text-sm text-co-text">{scope.history.map((h) => <li key={h.id}>
            {h.followsCompany || h.pct === null || h.source === null
              ? t("labor.burden.history_follow", { date: date(h.validFrom), who: (h.createdBy && data.userNames[h.createdBy]) || "-" })
              : t("labor.burden.history_rate", { date: date(h.validFrom), pct: pctText(h.pct), source: t(`labor.burden.source.${h.source}` as TranslationKey),
                who: (h.createdBy && data.userNames[h.createdBy]) || "-" })}
            {h.scheduled ? ` (${t("labor.burden.history_scheduled")})` : ""}{h.hasNote ? ` (${t("labor.burden.history_note")})` : ""}</li>)}</ul>}
      </div>
      <div className="flex flex-wrap gap-3">
        {scope.canFollowCompany && <label className={fieldLabel}>{t("labor.burden.field.mode")}
          <select className={control} value={mode} aria-label={t("labor.burden.aria.mode", { name })} onChange={(e) => { setMode(e.target.value === "follow" ? "follow" : "rate"); touched(); }}>
            <option value="rate">{t("labor.burden.mode.rate")}</option>
            <option value="follow">{t("labor.burden.mode.follow")}</option>
          </select>
        </label>}
        {!follow && <label className={fieldLabel}>{t("labor.burden.field.pct")}
          <input type="number" inputMode="decimal" className={control} value={pct} min={0} max={LABOR_BURDEN_MAX_PCT} step={0.25}
            aria-label={t("labor.burden.aria.pct", { name })} onChange={(e) => { setPct(e.target.value); touched(); }} />
        </label>}
        {!follow && <label className={fieldLabel}>{t("labor.burden.field.source")}
          <select className={control} value={source} aria-label={t("labor.burden.aria.source", { name })} onChange={(e) => { setSource(e.target.value === "payroll" ? "payroll" : "estimated"); touched(); }}>
            <option value="estimated">{t("labor.burden.source.estimated")}</option>
            <option value="payroll">{t("labor.burden.source.payroll")}</option>
          </select>
        </label>}
        <label className={fieldLabel}>{t("labor.burden.field.starts")}
          <input type="date" className={control} value={starts} min={LABOR_FLOOR_WEEK} step={7} aria-label={t("labor.burden.aria.starts", { name })}
            onChange={(e) => { setStarts(e.target.value); touched(); }} />
        </label>
      </div>
      {follow && <p className="text-sm text-co-text-dim">{t("labor.burden.follow_help")}</p>}
      {pct.trim() !== "" && !follow && !pctOk && <p className="text-sm font-bold text-co-cta-text">{t("labor.burden.error.invalid")}</p>}
      {starts !== "" && !startOk && <p className="text-sm font-bold text-co-cta-text">{t("labor.burden.error.invalid_date")}</p>}
      <label className={fieldLabel}>{t("labor.burden.field.note")}
        <textarea className={`${control} py-2`} value={note} maxLength={LABOR_BURDEN_NOTE_MAX} aria-label={t("labor.burden.aria.note", { name })}
          onChange={(e) => { setNote(e.target.value); touched(); }} />
      </label>
      {ready && <p aria-live="polite" className="rounded-lg bg-co-warning-surface p-2 text-sm font-bold text-co-warning-text">
        {t("labor.burden.reprice_warning", { date: date(starts) })}</p>}
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      {saved && <p aria-live="polite" className="text-sm font-bold text-co-confirm-text">{t("labor.burden.success")}</p>}
      <button type="button" className={button} disabled={!ready || busy || refreshing} onClick={save}>
        {busy ? t("labor.burden.saving") : t("labor.burden.save")}</button>
    </div>}
  </div>;
}
