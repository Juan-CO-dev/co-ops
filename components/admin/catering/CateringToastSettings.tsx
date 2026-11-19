"use client";

/**
 * Item 21 PR 5 — the catering ↔ Toast settings card (/admin/catering/toast; Owner / CGS / MoO only). One card per shop.
 *
 *  - Identity and state are always visible: the shop, On / Off, and what is switched on. The form is a drawer; while it
 *    holds unsaved changes it cannot be closed by the header (D10), only by Save or Cancel.
 *  - Save asks for the password every time (Tier B), then posts the shop's WHOLE row with the `updated_at` the person
 *    saw. Someone else's change in between is refused "Someone else just changed this" and the page reloads the row.
 *  - What cannot be saved is said before the press: `settingsRefusal` is the writer's own dependency rule (0350).
 *  - "Orders not matched yet" (a shop that is on): the person asks for the matches, sees how many checks the system is
 *    sure about and why the rest were left, and confirms them in one step (Tier A). Each is an ordinary human link.
 *    The server recomputes the list for every batch; this component never sends pairs.
 * en + es (tú); 44 px controls with items-center; flex-wrap rows for a 375 px phone; useState only.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  MAX_TOLERANCE_CENTS, SETTINGS_SWITCHES, sameSettings, settingsErrorKey, settingsRefusal,
  type CateringToastSettingsValues, type CateringToastShopCard, type SettingsReadiness, type SettingsSwitch,
} from "@/lib/catering/catering-toast-settings-shared";
import { OLD_ORDER_SKIPS, type OldOrdersLinkResult, type OldOrdersView } from "@/lib/catering/catering-toast-old-orders-shared";

const BUTTON = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-60";
const PRIMARY = `${BUTTON} border-co-gold-deep bg-co-gold text-co-text`;
const QUIET = `${BUTTON} border-co-border bg-co-surface text-co-text`;
const FIELD = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const SWITCH_KEY: Record<SettingsSwitch, string> = {
  enabled: "enabled", ringCodeEnabled: "ring_code", autoLinkEnabled: "auto_link", originAutoLinkEnabled: "origin_auto_link", includeToastOriginLeads: "list_origin",
};
const k = (key: string) => `admin.catering.toast.${key}` as TranslationKey;

export function CateringToastSettings({ shops, readiness, initialOpen = null, initialOldOrders = null }: {
  shops: readonly CateringToastShopCard[]; readiness: SettingsReadiness;
  /** SSR tests only: a shop whose form starts open, and a loaded old-orders answer. */
  initialOpen?: string | null; initialOldOrders?: { locationId: string; view: OldOrdersView } | null;
}) {
  const { t } = useTranslation();
  return <div className="grid gap-4">
    {!readiness.linkStep && <p role="status" className="co-card p-4 text-sm font-bold text-co-warning-text">{t(k("not_ready.link_step"))}</p>}
    {readiness.linkStep && !readiness.automatic && <p role="status" className="co-card p-4 text-sm text-co-text-muted">{t(k("not_ready.automatic"))}</p>}
    <ul className="grid gap-4">
      {shops.map((shop) => <ShopCard key={shop.locationId} shop={shop} readiness={readiness} startOpen={initialOpen === shop.locationId}
        initialOldOrders={initialOldOrders?.locationId === shop.locationId ? initialOldOrders.view : null} />)}
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

function ShopCard({ shop, readiness, startOpen, initialOldOrders }: { shop: CateringToastShopCard; readiness: SettingsReadiness; startOpen: boolean; initialOldOrders: OldOrdersView | null }) {
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

    {shop.values.enabled && readiness.linkStep && <OldOrders shop={shop} initial={initialOldOrders} />}
  </li>;
}

function OldOrders({ shop, initial }: { shop: CateringToastShopCard; initial: OldOrdersView | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const sectionId = useId();
  const [view, setView] = useState<OldOrdersView | null>(initial);
  const [open, setOpen] = useState(initial !== null);
  const [busy, setBusy] = useState<"find" | "link" | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [progress, setProgress] = useState<{ linked: number; refused: Record<string, number> } | null>(null);
  const money = (cents: number | null) => (cents === null ? t(k("old.amount_unknown")) : formatCents(cents, language));

  async function find() {
    setBusy("find"); setError(null);
    try {
      const res = await fetch(`/api/admin/catering/toast-settings/old-orders?location=${shop.locationId}`, { redirect: "error" });
      const body = (await res.json().catch(() => ({}))) as { oldOrders?: OldOrdersView; code?: string };
      if (!res.ok || !body.oldOrders) { setError(settingsErrorKey(body.code) as TranslationKey); return; }
      setView(body.oldOrders);
    } catch { setError(settingsErrorKey("generic") as TranslationKey); }
    finally { setBusy(null); }
  }
  async function link() {
    setBusy("link"); setError(null);
    const total = { linked: 0, refused: {} as Record<string, number> };
    try {
      if (await requestStepUp("A") !== "ok") return;
      // One batch per request; go on while a batch still links something and something is left.
      for (let skip = 0, batch = 0; batch < 100; batch += 1) {
        const r = await post("/api/admin/catering/toast-settings/old-orders", { locationId: shop.locationId, skip });
        if (!r.ok) { setError(settingsErrorKey(r.code) as TranslationKey); break; }
        const result = r.data.result as OldOrdersLinkResult;
        total.linked += result.linked;
        for (const [code, n] of Object.entries(result.refused)) { total.refused[code] = (total.refused[code] ?? 0) + n; skip += n; }
        setProgress({ linked: total.linked, refused: { ...total.refused } });
        if (result.remaining <= 0 || (result.linked === 0 && Object.keys(result.refused).length === 0)) break;
      }
    } finally {
      setBusy(null);
      await find();
      router.refresh();
    }
  }

  const refusedTotal = progress ? Object.values(progress.refused).reduce((a, b) => a + b, 0) : 0;
  const skipped = view ? OLD_ORDER_SKIPS.filter((reason) => view.skipped[reason] > 0) : [];
  // Collapsed by default (secondary content); it cannot be closed while a batch is running.
  return <CollapsibleSection idBase={sectionId} title={t(k("old.title"))} count={view?.state === "ready" ? t(k("old.count"), { n: view.orders }) : undefined}
    open={open} onToggle={() => { if (busy === null) setOpen(!open); }}>
    <div className="grid gap-3 text-sm text-co-text">
      <p className="text-co-text-muted">{t(k("old.intro"))}</p>
      {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
      {busy === "find" && <p role="status">{t(k("old.finding"))}</p>}
      {busy === "link" && <p role="status">{t(k("old.linking"), { n: progress?.linked ?? 0 })}</p>}
      {progress && busy === null && <p role="status" className="font-bold text-co-confirm-text">{t(k("old.linked"), { n: progress.linked })}</p>}
      {progress && busy === null && refusedTotal > 0 && <p role="status" className="text-co-warning-text">{t(k("old.refused"), { n: refusedTotal })}</p>}
      {view?.state === "ready" && <>
        <p>{t(k("old.found"), { orders: view.orders, matched: view.ordersMatched, checks: view.checks })}</p>
        {view.sample.length > 0 && <ul className="grid gap-1">
          {view.sample.map((m) => <li key={`${m.leadId}|${m.checkGuid}`} className="flex flex-wrap gap-x-2">
            <span className="font-bold">{formatDateLabel(m.eventDate, language)}</span>
            <span>{t(k("old.row"), { value: money(m.valueCents), check: money(m.checkTotalCents), date: formatDateLabel(m.businessDate, language) })}</span>
            <span className="text-co-text-muted">{t(k(`old.evidence.${m.evidence}`))}</span>
            {m.amountMismatch && <span className="text-co-warning-text">{t(k("old.amount_differs"))}</span>}
          </li>)}
          {view.checks > view.sample.length && <li className="text-co-text-muted">{t(k("old.more"), { n: view.checks - view.sample.length })}</li>}
        </ul>}
        {skipped.length > 0 && <ul className="grid gap-1 text-co-text-muted">
          {skipped.map((reason) => <li key={reason}>{t(k(`old.skipped.${reason}`), { n: view.skipped[reason] })}</li>)}
        </ul>}
      </>}
      {view?.state === "off" && <p className="text-co-warning-text">{t(settingsErrorKey("switch_needs_enabled") as TranslationKey)}</p>}
      {view?.state === "not_installed" && <p className="text-co-warning-text">{t(settingsErrorKey("link_step_not_installed") as TranslationKey)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={QUIET} disabled={busy !== null} onClick={() => void find()}>{t(k(view ? "old.find_again" : "old.find"))}</button>
        {view?.state === "ready" && view.checks > 0 && <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void link()}>
          {t(k("old.link"), { n: view.checks })}</button>}
      </div>
    </div>
  </CollapsibleSection>;
}
