"use client";
/**
 * Staff schedule settings (spec §5.3, §5.5; plan Task 24; mockup v17 "Staff skills, work types…" and "Leader shifts"):
 * one summary row per person (a full-row toggle, single-expand — D7, D8); the drawer edits their work type and what
 * else they may work, the leader setting (Opens only / Closes only / Mix / the role's default), preferred cover
 * positions ORDERED with ↑ ↓ × (44 px), the soft weekly range, full-timer and its minimum, and — only for a role that is
 * off the floor schedule by default (the prep or catering manager; never the CGS or social media manager, who are not
 * listed) — "Include on the schedule". Save posts `{action: person}` (no step-up; audited). A drawer with unsaved work
 * stays open (D10).
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import { personBody, type SettingsMember } from "@/lib/scheduling/settings-view-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { BUTTON, Check, Fields, GHOST, NumField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";

const empty = (userId: string): PersonSettingsRow => ({ userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null });

export function StaffSettings({ locationId, members, positions, names, initialPerson = null, onDirty }: {
  locationId: string;
  members: SettingsMember[];
  positions: Record<string, { name: string; nameEs: string | null }>;
  names: Record<string, string>;
  /** SSR tests only: the drawer open on this person. */
  initialPerson?: string | null;
  onDirty?: (dirty: boolean) => void;
}) {
  const { t } = useBoardLine({ names, positions });
  const [open, setOpen] = useState<string | null>(initialPerson);
  const [dirtyOf, setDirtyOf] = useState<string | null>(null);
  return (
    <ul className="grid gap-2" data-section="staff-settings">
      {members.map((m) => {
        const isOpen = open === m.userId || dirtyOf === m.userId;
        const s = m.settings;
        const summary = [s?.workType ? t(`schedule.settings.staff.work_type_${s.workType}` as TranslationKey) : null,
          s?.leaderSetting ? t(`schedule.settings.staff.leader_${s.leaderSetting}` as TranslationKey) : null].filter(Boolean).join(" · ");
        return (
          <li key={m.userId} className="rounded-lg border border-co-border bg-co-surface">
            <button type="button" aria-expanded={isOpen} onClick={() => { if (dirtyOf !== m.userId) setOpen(isOpen ? null : m.userId); }}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-sm">
              <span className="min-w-0"><strong className="text-co-text">{m.name}</strong> <span className="text-co-text-muted">· {t(`role.${m.role}` as TranslationKey)}{summary ? ` · ${summary}` : ""}</span></span>
              <span aria-hidden="true" className="text-co-text-dim">{isOpen ? "⌃" : "⌄"}</span>
            </button>
            {isOpen ? (
              <PersonEditor locationId={locationId} member={m} positions={positions} names={names}
                onDirty={(d) => { setDirtyOf(d ? m.userId : null); onDirty?.(d); }} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PersonEditor({ locationId, member, positions, names, onDirty }: {
  locationId: string;
  member: SettingsMember;
  positions: Record<string, { name: string; nameEs: string | null }>;
  names: Record<string, string>;
  onDirty: (dirty: boolean) => void;
}) {
  const { t, position } = useBoardLine({ names, positions });
  const router = useRouter();
  const post = useStepUpPost();
  const id = useId();
  const [s, setS] = useState<PersonSettingsRow>(() => structuredClone(member.settings ?? empty(member.userId)));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const edit = (f: (x: PersonSettingsRow) => void) => {
    setS((cur) => { const n = structuredClone(cur); f(n); return n; });
    if (!dirty) { setDirty(true); onDirty(true); }
  };
  async function save() {
    setBusy(true); setError(null);
    const r = await post("/api/schedule", personBody(locationId, s));
    setBusy(false);
    if (!r.ok) { setError(r.code); return; }
    setDirty(false); onDirty(false);
    router.refresh();
  }
  const move = (i: number, by: -1 | 1) => edit((x) => { const a = x.coverPositions; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; });
  const iconBtn = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface text-sm font-bold text-co-text disabled:opacity-60";
  return (
    <div data-person-editor={member.userId} className="grid gap-3 border-t border-co-border p-3">
      <div className="grid gap-1" role="radiogroup" aria-labelledby={`${id}-wt`}>
        <span id={`${id}-wt`} className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.staff.work_type")}</span>
        <div className="flex flex-wrap gap-x-3">
          {(["default", "foh", "boh", "management"] as const).map((w) => (
            <label key={w} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-co-text">
              <input type="radio" className="h-5 w-5" name={`${id}-worktype`} checked={(s.workType ?? "default") === w} onChange={() => edit((x) => { x.workType = w === "default" ? null : w; })} />
              {t(`schedule.settings.staff.work_type_${w}` as TranslationKey)}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.staff.also_allowed")}</span>
        <div className="flex flex-wrap gap-x-3">
          {(["foh", "boh"] as const).map((w) => (
            <Check key={w} label={t(`schedule.settings.staff.work_type_${w}` as TranslationKey)} checked={s.alsoAllowed.includes(w)}
              onChange={(on) => edit((x) => { x.alsoAllowed = on ? [...new Set([...x.alsoAllowed, w])].sort() : x.alsoAllowed.filter((y) => y !== w); })} />
          ))}
        </div>
      </div>
      <div className="grid gap-1" role="radiogroup" aria-labelledby={`${id}-ld`}>
        <span id={`${id}-ld`} className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.staff.leader")}</span>
        <div className="flex flex-wrap gap-x-3">
          {(["default", "opens", "closes", "mix"] as const).map((l) => (
            <label key={l} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-co-text">
              <input type="radio" className="h-5 w-5" name={`${id}-leader`} checked={(s.leaderSetting ?? "default") === l} onChange={() => edit((x) => { x.leaderSetting = l === "default" ? null : l; })} />
              {t(`schedule.settings.staff.leader_${l}` as TranslationKey)}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.staff.cover")}</span>
        <ol className="grid gap-1">
          {s.coverPositions.map((p, i) => (
            <li key={p} className="flex flex-wrap items-center gap-2 text-sm text-co-text">
              <span className="min-w-[8rem] flex-1">{i + 1}. {position(p)}</span>
              <button type="button" data-cover-act="up" className={iconBtn} disabled={i === 0} aria-label={t("schedule.settings.staff.cover_up", { position: position(p) })} onClick={() => move(i, -1)}>↑</button>
              <button type="button" data-cover-act="down" className={iconBtn} disabled={i === s.coverPositions.length - 1} aria-label={t("schedule.settings.staff.cover_down", { position: position(p) })} onClick={() => move(i, 1)}>↓</button>
              <button type="button" data-cover-act="remove" className={iconBtn} aria-label={t("schedule.settings.staff.cover_remove", { position: position(p) })} onClick={() => edit((x) => { x.coverPositions = x.coverPositions.filter((y) => y !== p); })}>×</button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("schedule.settings.staff.cover_pick")} className="min-h-[44px] min-w-0 flex-1 rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t("schedule.settings.staff.cover_pick")}</option>
            {Object.keys(positions).filter((p) => !s.coverPositions.includes(p)).map((p) => <option key={p} value={p}>{position(p)}</option>)}
          </select>
          <button type="button" className={GHOST} disabled={!adding} onClick={() => { edit((x) => { x.coverPositions = [...x.coverPositions, adding]; }); setAdding(""); }}>{t("schedule.settings.staff.cover_add")}</button>
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.staff.soft_range")}</span>
        <Fields>
          <NumField name="softMinH" label={t("schedule.settings.staff.soft_min")} value={s.softMinH} step={0.25} onChange={(v) => edit((x) => { x.softMinH = v; })} />
          <NumField name="softMaxH" label={t("schedule.settings.staff.soft_max")} value={s.softMaxH} step={0.25} onChange={(v) => edit((x) => { x.softMaxH = v; })} />
        </Fields>
      </div>
      <div className="grid gap-1">
        <Check label={t("schedule.settings.staff.full_time")} checked={s.fullTime} onChange={(on) => edit((x) => { x.fullTime = on; if (!on) x.fullTimeMinH = null; })} />
        {s.fullTime ? <NumField name="fullTimeMinH" label={t("schedule.settings.staff.full_time_min")} value={s.fullTimeMinH} step={0.25} onChange={(v) => edit((x) => { x.fullTimeMinH = v; })} /> : null}
      </div>
      {member.includeOffered ? (
        <Check label={t("schedule.settings.staff.include")} checked={s.rosterInclude === true} onChange={(on) => edit((x) => { x.rosterInclude = on ? true : null; })} />
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={busy || !dirty} onClick={save}>{t("schedule.settings.save")}</button>
        {dirty ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.settings.unsaved")}</span> : null}
      </div>
      <span data-person-editor-end hidden />
    </div>
  );
}
