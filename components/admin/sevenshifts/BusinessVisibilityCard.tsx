"use client";
/**
 * The "Business report: what GMs can see" card on /admin/sevenshifts, beside the Payroll shop and Burden cards
 * (business report access, Juan 2026-11-19; owner / CGS / MoO only, decided on the server before anything is read;
 * shown only with BUSINESS_REPORT and the two fact switches).
 *
 * Nine switches (lib/business-access-shared.ts), in four groups. A switch that needs another one is disabled, with
 * the sentence "Turn on ... first", while that one is off; turning a parent off turns its children off in the DRAFT.
 * Nothing is sent until Save: ONE save, of the whole set, bound to the head this card showed (another save in
 * between is refused, never overwritten), behind a password every time (Tier B: it changes who sees the labor
 * money, in both directions). Cost per person and labor dollars per 15 minutes are not switches: two fixed lines
 * say they stay MoO and up.
 *
 * Disclosure doctrine: a default-collapsed CollapsibleSection with the "N of 9 on" count on its header; every
 * switch is a full-row 44px toggle. The section is CONTROLLED and stays open while the draft is unsaved, so a
 * draft survives a cancelled password and is never unmounted (D10). useState only.
 *
 * AN EDIT IS NEVER LOST SILENTLY (review BRACCESS-r1 P2). After a save succeeds the card WAITS for the page to
 * deliver the new saved row before a switch can be touched again (the head the save was made against is remembered;
 * the switches and Save stay disabled until the head the server sends is a different one). An edit made in that
 * gap would be thrown away when the new row arrives, so it cannot be made. The card is NOT remounted on a new
 * head (no React key on it): it re-seeds its draft during render, and if the head moved under an UNSAVED draft
 * because someone else saved, it says so ("Someone else just changed these settings") instead of dropping it mute.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabelWithYear } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { etDisplayDate } from "@/lib/operational-day";
import {
  BUSINESS_VISIBILITY_ERROR_CODES, GM_VISIBILITY_KEYS, GM_VISIBILITY_NEEDS, coherentGmVisibility, type GmVisibility, type GmVisibilityKey,
} from "@/lib/business-access-shared";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const ON_CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-confirm-text";
const OFF_CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-text-muted";

export interface BusinessVisibilityCardData { settings: GmVisibility; headId: string | null; savedBy: string | null; savedAt: string | null }

const GROUPS: ReadonlyArray<{ title: TranslationKey; keys: readonly GmVisibilityKey[] }> = [
  { title: "business.visibility.group.access", keys: ["report"] },
  { title: "business.visibility.group.money", keys: ["hourly_cost", "loaded"] },
  { title: "business.visibility.group.tabs", keys: ["quarters", "channels", "people", "servers", "compare"] },
  { title: "business.visibility.group.downloads", keys: ["export"] },
];
function errorKey(code: string | undefined): TranslationKey {
  return (BUSINESS_VISIBILITY_ERROR_CODES as readonly string[]).includes(code ?? "") ? (`business.visibility.error.${code}` as TranslationKey) : "business.visibility.error.generic";
}
/** Every switch that needs `key`, directly or through another. */
function dependents(key: GmVisibilityKey): GmVisibilityKey[] {
  const direct = GM_VISIBILITY_KEYS.filter((k) => GM_VISIBILITY_NEEDS[k].includes(key));
  return [...direct, ...direct.flatMap(dependents)];
}

export function BusinessVisibilityCard({ data }: { data: BusinessVisibilityCardData | null }) {
  const { t } = useTranslation();
  if (!data) return <section className="co-card p-4"><p className="text-co-text-muted">{t("business.visibility.unavailable")}</p></section>;
  return <BusinessVisibilityForm data={data} />;
}

function BusinessVisibilityForm({ data }: { data: BusinessVisibilityCardData }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [draft, setDraft] = useState<GmVisibility>(data.settings);
  /** The saved settings the draft started from, and the row they are (the head a save is bound to). */
  const [base, setBase] = useState<{ headId: string | null; settings: GmVisibility }>({ headId: data.headId, settings: data.settings });
  /** After a successful save: the head that save was made AGAINST. Until the server delivers a different head the
   * card waits (`undefined` = not waiting; `null` is a real head: "never saved"). */
  const [savedAgainst, setSavedAgainst] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  // A new saved row arrived from the server: the draft restarts from it. During render, not in an effect
  // (router.refresh() does not reset client state). Our own save was waiting for exactly this; anything else is
  // someone else's save, and an unsaved draft it replaces is announced, never dropped mute.
  if (base.headId !== data.headId) {
    const wasDirty = GM_VISIBILITY_KEYS.some((k) => draft[k] !== base.settings[k]);
    if (savedAgainst === undefined && wasDirty) { setError("business.visibility.error.moved"); setSaved(false); }
    setBase({ headId: data.headId, settings: data.settings });
    setDraft(data.settings);
    setSavedAgainst(undefined);
  }
  /** Saved, and the new row has not arrived yet: nothing may be edited (it would be discarded when it does). */
  const waiting = savedAgainst !== undefined && savedAgainst === data.headId;

  const dirty = GM_VISIBILITY_KEYS.some((k) => draft[k] !== base.settings[k]);
  const on = GM_VISIBILITY_KEYS.filter((k) => draft[k]).length;
  const label = (k: GmVisibilityKey) => t(`business.visibility.switch.${k}` as TranslationKey);
  const blockedBy = (k: GmVisibilityKey) => GM_VISIBILITY_NEEDS[k].find((p) => !draft[p]);

  function flip(k: GmVisibilityKey) {
    if (busy || waiting) return;
    setSaved(false); setError(null);
    setDraft((d) => {
      const next = { ...d, [k]: !d[k] };
      // Turning a switch off turns off everything that needs it.
      if (!next[k]) for (const child of dependents(k)) next[child] = false;
      return next;
    });
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const against = data.headId;
      const payload = { settings: draft, expectedId: against };
      const post = () => fetch("/api/admin/reports/business-visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
      setSaved(true);
      // Wait for the row this save made: no switch is editable until the page delivers it.
      setSavedAgainst(against);
      router.refresh();
    } catch { setError("business.visibility.error.generic"); } finally { setBusy(false); }
  }

  return <CollapsibleSection idBase="business-visibility" title={t("business.visibility.title")}
    count={t("business.visibility.count", { on, total: GM_VISIBILITY_KEYS.length })}
    // Controlled: the section cannot close over an unsaved draft (D10). A tap on the header while there is one does
    // NOTHING (it must not arm a collapse that fires the moment the draft is put back or saved).
    open={open || dirty} onToggle={() => { if (!dirty) setOpen((o) => !o); else setOpen(true); }}>
    <div className="space-y-4">
      <p className="text-co-text-muted">{t("business.visibility.intro")}</p>
      <p className="text-sm text-co-text-dim">{t("business.visibility.promise")}</p>
      {GROUPS.map((group) => <div key={group.title} className="space-y-2">
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t(group.title)}</h4>
        <ul className="space-y-2">{group.keys.map((k) => {
          const parent = blockedBy(k);
          const state = t(draft[k] ? "business.visibility.state.on" : "business.visibility.state.off");
          return <li key={k}>
            <button type="button" role="switch" aria-checked={draft[k]} disabled={parent !== undefined || busy || waiting}
              aria-label={t("business.visibility.aria.switch", { name: label(k), state })} onClick={() => flip(k)}
              className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border px-3 py-2 text-left disabled:opacity-60">
              <span className="min-w-0 flex-1 basis-[14rem]">
                <span className="block font-bold text-co-text">{label(k)}</span>
                <span className="block text-sm text-co-text-dim">{t(`business.visibility.hint.${k}` as TranslationKey)}</span>
                {k === "hourly_cost" && <span className="block text-sm font-bold text-co-warning-text">{t("business.visibility.pay_note")}</span>}
                {parent !== undefined && <span className="block text-sm text-co-text-muted">{t("business.visibility.needs", { parent: label(parent) })}</span>}
              </span>
              <span className={draft[k] ? ON_CHIP : OFF_CHIP}>{state}</span>
            </button>
          </li>;
        })}</ul>
      </div>)}
      <div className="space-y-1 rounded-lg bg-co-surface-inset p-3">
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("business.visibility.fixed.title")}</h4>
        <p className="text-sm text-co-text">{t("business.visibility.fixed.person_cost")}</p>
        <p className="text-sm text-co-text">{t("business.visibility.fixed.quarter_cost")}</p>
      </div>
      <p className="text-sm text-co-text-dim">{data.headId === null || data.savedAt === null ? t("business.visibility.never_saved")
        : t("business.visibility.last_saved", { who: data.savedBy ?? "-", date: formatDateLabelWithYear(etDisplayDate(data.savedAt), language) })}</p>
      {!dirty && !saved && !error && <p className="text-sm text-co-text-muted">{t("business.visibility.no_changes")}</p>}
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      {saved && <p aria-live="polite" className="text-sm font-bold text-co-confirm-text">{t("business.visibility.success")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={!dirty || !coherentGmVisibility(draft) || busy || waiting} onClick={save}>
          {busy ? t("business.visibility.saving") : t("business.visibility.save")}</button>
        <Link href="/reports/business" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-co-text underline">{t("business.visibility.open_report")}</Link>
      </div>
    </div>
  </CollapsibleSection>;
}
