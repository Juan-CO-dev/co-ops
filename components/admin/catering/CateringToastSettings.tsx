"use client";

/**
 * Item 21 PR 5 — the catering ↔ Toast settings card (/admin/catering/toast; Owner / CGS / MoO only). One card per shop.
 *
 *  - Identity and state are always visible: the shop, On / Off, and what is switched on. The form is a drawer; while it
 *    holds unsaved changes it cannot be closed by the header (D10), only by Save or Cancel.
 *  - Save asks for the password every time (Tier B), then posts the shop's WHOLE row with the `updated_at` the person
 *    saw. Someone else's change in between is refused "Someone else just changed this" and the page reloads the row.
 *  - What cannot be saved is said before the press: `settingsRefusal` is the writer's own dependency rule (0350).
 *  - "Match older orders" (a shop with an automatic switch on): the cron only looks at the last nine days, so this runs
 *    the same reconciler over older stretches, from the shop's start date to today (Tier A, one step per request, the
 *    cursor is a date the server hands back). This component decides nothing and never sends an order or a check.
 * en + es (tú); 44 px controls with items-center; flex-wrap rows for a 375 px phone; useState only.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  MAX_TOLERANCE_CENTS, SETTINGS_SWITCHES, sameSettings, settingsErrorKey, settingsRefusal,
  type CateringToastSettingsValues, type CateringToastShopCard, type SettingsReadiness, type SettingsSwitch,
} from "@/lib/catering/catering-toast-settings-shared";
import { BACKFILL_SKIPS, type BackfillSkip, type BackfillStatus, type BackfillStep } from "@/lib/catering/catering-toast-backfill-shared";

const BUTTON = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-60";
const PRIMARY = `${BUTTON} border-co-gold-deep bg-co-gold text-co-text`;
const QUIET = `${BUTTON} border-co-border bg-co-surface text-co-text`;
const FIELD = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const SWITCH_KEY: Record<SettingsSwitch, string> = {
  enabled: "enabled", ringCodeEnabled: "ring_code", autoLinkEnabled: "auto_link", originAutoLinkEnabled: "origin_auto_link", includeToastOriginLeads: "list_origin",
};
const k = (key: string) => `admin.catering.toast.${key}` as TranslationKey;
/** A backfill is a few stretches, each a handful of steps: this only stops a loop that could never end. */
const BACKFILL_MAX_STEPS = 400;

export function CateringToastSettings({ shops, readiness, initialOpen = null, initialBackfill = null }: {
  shops: readonly CateringToastShopCard[]; readiness: SettingsReadiness;
  /** SSR tests only: a shop whose form starts open, and a loaded backfill status. */
  initialOpen?: string | null; initialBackfill?: { locationId: string; status: BackfillStatus } | null;
}) {
  const { t } = useTranslation();
  return <div className="grid gap-4">
    {!readiness.linkStep && <p role="status" className="co-card p-4 text-sm font-bold text-co-warning-text">{t(k("not_ready.link_step"))}</p>}
    {readiness.linkStep && !readiness.automatic && <p role="status" className="co-card p-4 text-sm text-co-text-muted">{t(k("not_ready.automatic"))}</p>}
    <ul className="grid gap-4">
      {shops.map((shop) => <ShopCard key={shop.locationId} shop={shop} readiness={readiness} startOpen={initialOpen === shop.locationId}
        initialBackfill={initialBackfill?.locationId === shop.locationId ? initialBackfill.status : null} />)}
    </ul>
  </div>;
}

function summary(v: CateringToastSettingsValues, t: (key: TranslationKey, vars?: Record<string, string | number>) => string, language: string): string {
  if (!v.enabled) return t(k("summary.off"));
  const parts = [t(k("summary.list"))];
  if (v.ringCodeEnabled) parts.push(t(k("summary.ring_code")));
  if (v.autoLinkEnabled || v.originAutoLinkEnabled) {
    parts.push(t(k(v.autoLinkEnabled && v.originAutoLinkEnabled ? "summary.auto_both" : v.autoLinkEnabled ? "summary.auto_code" : "summary.auto_origin"),
      { date: v.autoLinkFromDate ? formatDateLabel(v.autoLinkFromDate, language as "en" | "es") : "—" }));
  }
  return parts.join(" · ");
}

function ShopCard({ shop, readiness, startOpen, initialBackfill }: { shop: CateringToastShopCard; readiness: SettingsReadiness; startOpen: boolean; initialBackfill: BackfillStatus | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const formId = useId();
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<CateringToastSettingsValues>(shop.values);
  const [dollars, setDollars] = useState(String(shop.values.toleranceCents / 100));
  const [percent, setPercent] = useState(String(Math.round(shop.values.tolerancePct * 1000) / 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  // The server's row moved (a save, or someone else's): start again from it. During-render prev-compare, not an effect.
  const [seen, setSeen] = useState(shop.updatedAt);
  if (seen !== shop.updatedAt) {
    setSeen(shop.updatedAt); setDraft(shop.values);
    setDollars(String(shop.values.toleranceCents / 100)); setPercent(String(Math.round(shop.values.tolerancePct * 1000) / 10));
  }

  // Dollars to the cent, percent to one decimal: judged on what was TYPED (never on a float product).
  const cents = Math.round(Number(dollars) * 100), pct = Math.round(Number(percent) * 10) / 1000;
  const numbersValid = /^\d{1,4}(\.\d{1,2})?$/.test(dollars.trim()) && /^\d{1,3}(\.\d)?$/.test(percent.trim())
    && cents <= MAX_TOLERANCE_CENTS && pct <= 1;
  const values: CateringToastSettingsValues = { ...draft, toleranceCents: numbersValid ? cents : draft.toleranceCents, tolerancePct: numbersValid ? pct : draft.tolerancePct };
  const dirty = !numbersValid || !sameSettings(values, shop.values);
  const refusal = numbersValid ? settingsRefusal(values, readiness) : null;

  function reset() {
    setDraft(shop.values); setDollars(String(shop.values.toleranceCents / 100)); setPercent(String(Math.round(shop.values.tolerancePct * 1000) / 10));
    setError(null); setOpen(false);
  }
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const r = await post("/api/admin/catering/toast-settings", { locationId: shop.locationId, values, expectedUpdatedAt: shop.updatedAt });
      if (!r.ok) {
        setError(settingsErrorKey(r.code) as TranslationKey);
        // Someone else changed the row: show theirs (the draft is kept until the person cancels or the row arrives).
        if (r.code === "settings_moved") router.refresh();
        return;
      }
      setSaved(true); setOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  return <li className="co-card grid gap-3 p-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="min-w-0 flex-1 basis-[8rem] text-base font-bold text-co-text">{shop.name}</h2>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${shop.values.enabled ? "bg-co-gold/20 text-co-text" : "bg-co-surface-inset text-co-text-muted"}`}>
        {t(k(shop.values.enabled ? "state.on" : "state.off"))}
      </span>
      {dirty && open && <span className="rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text">{t(k("unsaved"))}</span>}
      <button type="button" className={QUIET} aria-expanded={open} aria-controls={formId} disabled={busy || (open && dirty)}
        onClick={() => { setOpen(!open); setSaved(false); }}>{t(k(open ? "close" : "edit"))}</button>
    </div>
    <p className="text-sm text-co-text-muted">{summary(shop.values, t, language)}</p>
    {saved && !open && <p role="status" className="text-sm font-bold text-co-confirm-text">{t(k("saved"))}</p>}
    {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}

    <form id={formId} hidden={!open} className="grid gap-4 border-t border-co-border pt-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <ul className="grid gap-3">
        {SETTINGS_SWITCHES.map((name) => {
          const on = draft[name];
          return <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-[12rem]">
              <p className="text-sm font-bold text-co-text">{t(k(`switch.${SWITCH_KEY[name]}.label`))}</p>
              <p className="text-sm text-co-text-muted">{t(k(`switch.${SWITCH_KEY[name]}.help`))}</p>
            </div>
            <button type="button" role="switch" aria-checked={on} disabled={busy}
              aria-label={t(k("switch.aria"), { setting: t(k(`switch.${SWITCH_KEY[name]}.label`)), shop: shop.name })}
              className={`${BUTTON} min-w-[72px] ${on ? "border-co-gold-deep bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text-muted"}`}
              onClick={() => setDraft({ ...draft, [name]: !on })}>{t(k(on ? "state.on" : "state.off"))}</button>
          </li>;
        })}
      </ul>
      <label className="grid gap-1 text-sm font-bold text-co-text">{t(k("from_date.label"))}
        <input type="date" className={FIELD} disabled={busy} aria-label={t(k("from_date.label"))} value={draft.autoLinkFromDate ?? ""}
          onChange={(event) => setDraft({ ...draft, autoLinkFromDate: event.target.value === "" ? null : event.target.value })} />
        <span className="font-normal text-co-text-muted">{t(k("from_date.help"))}</span>
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-co-text">{t(k("tolerance.legend"))}</legend>
        <div className="flex flex-wrap gap-3">
          <label className="grid min-w-0 flex-1 basis-[8rem] gap-1 text-sm text-co-text">{t(k("tolerance.dollars"))}
            <input type="number" inputMode="decimal" min={0} max={MAX_TOLERANCE_CENTS / 100} step="0.01" className={FIELD} disabled={busy} aria-label={t(k("tolerance.dollars"))} value={dollars} onChange={(event) => setDollars(event.target.value)} />
          </label>
          <label className="grid min-w-0 flex-1 basis-[8rem] gap-1 text-sm text-co-text">{t(k("tolerance.percent"))}
            <input type="number" inputMode="decimal" min={0} max={100} step="0.1" className={FIELD} disabled={busy} aria-label={t(k("tolerance.percent"))} value={percent} onChange={(event) => setPercent(event.target.value)} />
          </label>
        </div>
        <p className="text-sm text-co-text-muted">{t(k("tolerance.help"))}</p>
        {!numbersValid && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(k("tolerance.invalid"))}</p>}
      </fieldset>
      {refusal && <p role="alert" className="text-sm font-bold text-co-warning-text">{t(settingsErrorKey(refusal) as TranslationKey)}</p>}
      <p className="text-sm text-co-text-muted">{t(k("password_note"))}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !dirty || !numbersValid || refusal !== null}>{t(k(busy ? "saving" : "save"))}</button>
        <button type="button" className={QUIET} disabled={busy} onClick={reset}>{t(k("cancel"))}</button>
      </div>
    </form>

    {/* Offered only where it can run: the shop is on, an automatic switch and its start date are SAVED, and 0348 is installed. */}
    {shop.values.enabled && (shop.values.autoLinkEnabled || shop.values.originAutoLinkEnabled) && shop.values.autoLinkFromDate !== null
      && readiness.linkStep && readiness.automatic && <Backfill shop={shop} initial={initialBackfill} />}
  </li>;
}

function Backfill({ shop, initial }: { shop: CateringToastShopCard; initial: BackfillStatus | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const sectionId = useId();
  const [status, setStatus] = useState<BackfillStatus | null>(initial);
  const [open, setOpen] = useState(initial !== null);
  const [busy, setBusy] = useState<"status" | "run" | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [progress, setProgress] = useState<{ phase: BackfillStep["phase"]; added: number; pending: number; skipped: Partial<Record<BackfillSkip, number>> } | null>(null);
  const start = shop.values.autoLinkFromDate ? formatDateLabel(shop.values.autoLinkFromDate, language) : "—";

  async function check() {
    setBusy("status"); setError(null);
    try {
      const res = await fetch(`/api/admin/catering/toast-settings/backfill?location=${shop.locationId}`, { redirect: "error" });
      const body = (await res.json().catch(() => ({}))) as { status?: BackfillStatus; code?: string };
      if (!res.ok || !body.status) { setError(settingsErrorKey(body.code) as TranslationKey); return; }
      setStatus(body.status);
    } catch { setError(settingsErrorKey("generic") as TranslationKey); }
    finally { setBusy(null); }
  }
  async function run() {
    setBusy("run"); setError(null);
    const total = { phase: "checking" as BackfillStep["phase"], added: 0, pending: 0, skipped: {} as Partial<Record<BackfillSkip, number>> };
    try {
      if (await requestStepUp("A") !== "ok") return;
      // One step per request. The cursor is a date the server hands back; a "checking" step repeats its own stretch.
      for (let cursor: string | null = null, steps = 0; steps < BACKFILL_MAX_STEPS; steps += 1) {
        const r = await post("/api/admin/catering/toast-settings/backfill", { locationId: shop.locationId, cursor });
        if (!r.ok) { setError(settingsErrorKey(r.code) as TranslationKey); break; }
        const step = r.data.step as BackfillStep;
        total.phase = step.phase; total.added += step.added; total.pending = step.pendingOrders;
        for (const reason of BACKFILL_SKIPS) if (step.skipped[reason]) total.skipped[reason] = (total.skipped[reason] ?? 0) + step.skipped[reason]!;
        setProgress({ ...total, skipped: { ...total.skipped } });
        if (step.next === null) break;
        cursor = step.next;
      }
    } finally {
      setBusy(null);
      await check();
      router.refresh();
    }
  }

  const skipped = progress ? BACKFILL_SKIPS.filter((reason) => (progress.skipped[reason] ?? 0) > 0) : [];
  // Collapsed by default (secondary content); it cannot be closed while a run is going.
  return <CollapsibleSection idBase={sectionId} title={t(k("backfill.title"))} count={status && status.state !== "not_installed" ? t(k("backfill.count"), { n: status.unmatched }) : undefined}
    open={open} onToggle={() => { if (busy === null) setOpen(!open); }}>
    <div className="grid gap-3 text-sm text-co-text">
      <p className="text-co-text-muted">{t(k("backfill.intro"), { date: start })}</p>
      {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
      {busy === "status" && <p role="status">{t(k("backfill.checking_status"))}</p>}
      {busy === "run" && <p role="status">{progress?.phase === "checking" ? t(k("backfill.checking_notes"), { n: progress.pending }) : t(k("backfill.linking"), { n: progress?.added ?? 0 })}</p>}
      {progress && busy === null && <p role="status" className="font-bold text-co-confirm-text">{t(k("backfill.linked"), { n: progress.added })}</p>}
      {progress && busy === null && skipped.length > 0 && <div className="grid gap-1 text-co-text-muted">
        <p>{t(k("backfill.left"))}</p>
        <ul className="grid gap-1">{skipped.map((reason) => <li key={reason}>{t(k(`backfill.skipped.${reason}`), { n: progress.skipped[reason] ?? 0 })}</li>)}</ul>
      </div>}
      {status?.state === "ready" && <p>{t(k("backfill.status"), { unmatched: status.unmatched, from: status.fromStart, before: status.beforeStart, date: start })}</p>}
      {status?.state === "no_switch" && <p className="text-co-warning-text">{t(settingsErrorKey("backfill_needs_switch") as TranslationKey)}</p>}
      {status?.state === "off" && <p className="text-co-warning-text">{t(settingsErrorKey("switch_needs_enabled") as TranslationKey)}</p>}
      {status?.state === "not_installed" && <p className="text-co-warning-text">{t(settingsErrorKey("automatic_not_installed") as TranslationKey)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={QUIET} disabled={busy !== null} onClick={() => void check()}>{t(k(status ? "backfill.check_again" : "backfill.check"))}</button>
        {status?.state === "ready" && status.fromStart > 0 && <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void run()}>
          {t(k("backfill.run"), { date: start })}</button>}
      </div>
    </div>
  </CollapsibleSection>;
}
