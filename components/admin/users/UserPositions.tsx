"use client";

/**
 * The user screen's PRIMARY / SECONDARY position pickers (Juan 2026-10-20) — per shop the person belongs to: work type,
 * primary, secondary, and the Toast suggestion as a button ("Use Prep/…", never saved on its own). Used by the "Positions"
 * action on a user row AND by the Add user form (~19 new staff), so a new hire gets their positions in the same visit.
 *
 * Writes the SAME schedule person settings as Schedule settings › Staff settings (`personBody` → POST /api/schedule
 * {action: "person"}; no step-up, audited server-side), changing only the work type and the first two positions of the
 * person's latest row (`nextSettingsRow`). Everyone below shift lead; a manager's ordered list is their cover order and
 * stays on the schedule settings card. The work-type check runs before any post (`pickProblems`, the save path's rule).
 * Admin-form grammar: rounded-lg, 44 px, border-co-border; en + es.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";
import type { WorkType } from "@/lib/scheduling/context-shared";
import { isHourlyLeadRole } from "@/lib/scheduling/position-rank-shared";
import { personPositionsBody } from "@/lib/scheduling/settings-view-shared";
import {
  flexDropped, pickChanged, pickOf, pickProblems, positionChangesOf, type PickerPosition, type PositionPick, type ShopPositionPicker,
} from "@/lib/scheduling/user-positions-shared";
import { scheduleErrorKey } from "@/components/schedule/schedule-errors";
import { postJson, type LocationOption } from "./shared";

const LABEL = "text-sm font-bold text-co-text";
const SELECT = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const GHOST_BTN = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

export type PositionShops = Record<string, ShopPositionPicker | null>;

/** One shop's pickers (controlled). `shop` null = scheduling not installed there. */
export function ShopPositionFields({ userId, role, location, shop, pick, onChange }: {
  userId: string | null;
  role: RoleCode;
  location: LocationOption;
  shop: ShopPositionPicker | null | undefined;
  pick: PositionPick;
  onChange: (next: PositionPick) => void;
}) {
  const { t, language } = useTranslation();
  const legend = `${location.code} · ${location.name}`;
  if (!shop) {
    return (
      <fieldset className="grid gap-1 rounded-lg border-2 border-co-border p-3" data-position-shop={location.id}>
        <legend className="px-1 text-sm font-bold text-co-text">{legend}</legend>
        <p className="text-sm text-co-text-muted">{t("admin.users.positions.unavailable")}</p>
      </fieldset>
    );
  }
  const current = userId ? shop.settings[userId] : null;
  const label = (p: PickerPosition) => (language === "es" && p.nameEs ? p.nameEs : p.name);
  const byId = new Map(shop.positions.map((p) => [p.id, p]));
  const name = (id: string) => { const p = byId.get(id); return p ? label(p) : ""; };
  const suggestion = userId && pick.primary === null ? shop.suggestions[userId] ?? null : null;
  const problems = pickProblems(role, current, pick, shop);
  const dropped = flexDropped(current, pick);
  const tailCount = flexDropped(current, { ...pick, secondary: null });
  const slot = (s: "primary" | "secondary") => t(s === "primary" ? "schedule.settings.staff.slot_primary" : "schedule.settings.staff.slot_secondary");
  const ids = { wt: `wt-${location.id}`, p: `pr-${location.id}`, s: `se-${location.id}` };
  return (
    <fieldset className="grid gap-3 rounded-lg border-2 border-co-border p-3" data-position-shop={location.id}>
      <legend className="px-1 text-sm font-bold text-co-text">{legend}</legend>
      <label className="block" htmlFor={ids.wt}>
        <span className={LABEL}>{t("admin.users.positions.work_type")}</span>
        <select id={ids.wt} className={SELECT} value={pick.workType ?? "default"}
          onChange={(e) => onChange({ ...pick, workType: e.target.value === "default" ? null : (e.target.value as WorkType) })}>
          {(["default", "foh", "boh", "management"] as const).map((w) => (
            <option key={w} value={w}>{t(`schedule.settings.staff.work_type_${w}` as TranslationKey)}</option>
          ))}
        </select>
      </label>
      <label className="block" htmlFor={ids.p}>
        <span className={LABEL}>{t("admin.users.positions.primary")}</span>
        <select id={ids.p} className={SELECT} value={pick.primary ?? ""} data-pick="primary"
          onChange={(e) => { const v = e.target.value || null; onChange({ ...pick, primary: v, secondary: v === null || v === pick.secondary ? null : pick.secondary }); }}>
          <option value="">{t("admin.users.positions.none")}</option>
          {shop.positions.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </label>
      {suggestion && byId.has(suggestion.positionId) ? (
        <div className="flex flex-wrap items-center gap-2" data-toast-suggestion={suggestion.positionId}>
          <button type="button" className={GHOST_BTN} onClick={() => onChange({ ...pick, primary: suggestion.positionId })}>
            {t("schedule.settings.staff.toast_suggest", { position: name(suggestion.positionId) })}
          </button>
          <span className="text-xs text-co-text-muted">{t("schedule.settings.staff.toast_suggest_help", { job: suggestion.jobName })}</span>
        </div>
      ) : null}
      <label className="block" htmlFor={ids.s}>
        <span className={LABEL}>{t("admin.users.positions.secondary")}</span>
        <select id={ids.s} className={SELECT} value={pick.secondary ?? ""} disabled={pick.primary === null} data-pick="secondary"
          onChange={(e) => onChange({ ...pick, secondary: e.target.value || null })}>
          {/* Astra BC-013: with "can flex to" entries behind it, None says it clears them — no silent promotion. */}
          <option value="">{tailCount === 1 ? t("admin.users.positions.none_clear_one") : tailCount > 1 ? t("admin.users.positions.none_clear_other", { count: tailCount }) : t("admin.users.positions.none")}</option>
          {shop.positions.filter((p) => p.id !== pick.primary).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      </label>
      {isHourlyLeadRole(role) ? <p data-lead-note className="text-xs text-co-text-muted">{t("schedule.settings.staff.lead_note")}</p> : null}
      {dropped > 0 ? <p className="text-xs font-bold text-co-warning-text">{dropped === 1 ? t("admin.users.positions.clears_flex_one") : t("admin.users.positions.clears_flex_other", { count: dropped })}</p> : null}
      {problems.length > 0 ? (
        <ul role="alert" data-position-problems className="grid gap-1 text-sm font-bold text-co-cta-text">
          {problems.map((pr) => <li key={pr.slot}>{t("schedule.settings.staff.problem_work_type", { slot: slot(pr.slot), position: name(pr.positionId) })}</li>)}
        </ul>
      ) : null}
    </fieldset>
  );
}

/** The picks for a person across shops, starting from their stored rows. */
export function initialPicks(userId: string | null, locationIds: readonly string[], shops: PositionShops): Record<string, PositionPick> {
  return Object.fromEntries(locationIds.map((id) => [id, pickOf(userId ? shops[id]?.settings[userId] : null)]));
}

/** Any blocking problem across the shops? */
export function anyPickProblem(userId: string | null, role: RoleCode, picks: Record<string, PositionPick>, shops: PositionShops): boolean {
  return Object.entries(picks).some(([id, pick]) => { const shop = shops[id]; return !!shop && pickProblems(role, userId ? shop.settings[userId] : null, pick, shop).length > 0; });
}

/**
 * Write every changed shop's picks (one POST per shop); the first refusal's code, or null when all saved. Astra BC-007: only
 * WHAT CHANGED is sent (`person_positions`); the server merges it onto the person's latest row, so nothing changed by
 * someone else since the page loaded (full-time, soft range, also-allowed, leader setting, roster_include, the flex
 * tail) is overwritten.
 */
export async function savePicks(userId: string, picks: Record<string, PositionPick>, shops: PositionShops): Promise<string | null> {
  for (const [locationId, pick] of Object.entries(picks).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const shop = shops[locationId];
    if (!shop) continue;
    const current = shop.settings[userId] ?? null;
    if (!pickChanged(current, pick)) continue;
    const r = await postJson("/api/schedule", personPositionsBody(locationId, userId, { ...positionChangesOf(current, pick) }, shop.settingsIds?.[userId] ?? null));
    if (!r.ok) return r.code;
  }
  return null;
}

/** The "Positions" dialog body for an existing user: one block per shop they belong to (that the actor may assign). */
export function UserPositionsDialog({ userId, role, locations, shops, onClose, initialPicksOverride }: {
  userId: string;
  role: RoleCode;
  locations: LocationOption[];
  shops: PositionShops;
  onClose: () => void;
  /** SSR tests / screenshots only. */
  initialPicksOverride?: Record<string, PositionPick>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, PositionPick>>(() => initialPicksOverride ?? initialPicks(userId, locations.map((l) => l.id), shops));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = anyPickProblem(userId, role, picks, shops);
  const save = async () => {
    setBusy(true); setError(null);
    const code = await savePicks(userId, picks, shops);
    setBusy(false);
    if (code) { setError(code); return; }
    onClose();
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-3" data-user-positions={userId}>
      <p className="text-sm text-co-text-muted">{t("admin.users.positions.help")}</p>
      {locations.length === 0 ? <p className="text-sm text-co-text-muted">{t("admin.users.positions.not_member")}</p> : null}
      {locations.map((loc) => (
        <ShopPositionFields key={loc.id} userId={userId} role={role} location={loc} shop={shops[loc.id]} pick={picks[loc.id] ?? pickOf(null)}
          onChange={(next) => setPicks((cur) => ({ ...cur, [loc.id]: next }))} />
      ))}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50">
          {t("admin.users.cancel")}
        </button>
        <button type="button" onClick={() => void save()} disabled={busy || blocked || locations.length === 0}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50">
          {t("admin.users.positions.save")}
        </button>
      </div>
    </div>
  );
}
