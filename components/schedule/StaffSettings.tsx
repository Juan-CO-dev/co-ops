"use client";
/**
 * Staff schedule settings (spec §5.3, §5.5; plan Task 24; mockup v17 "Staff skills, work types…" and "Leader shifts"):
 * one summary row per person (a full-row toggle, single-expand — D7, D8); the drawer edits their work type and what
 * else they may work, the leader setting (Opens only / Closes only / Mix / the role's default), the ORDERED position list
 * with ↑ ↓ × (44 px) — Juan 2026-10-20: for everyone below shift lead it is "Positions (in order)": #1 Primary, #2
 * Secondary, the rest "Can flex to", checked against the work type before any post (`positionListProblems`, the save
 * path's own rule), with a "Use <position>" button when Toast suggests a primary (never saved on its own); for a manager
 * it stays their preferred cover positions. The drawer also edits the soft weekly range and full-time minimum.
 * Off-floor accounts can choose a separate floor role per shop. Save posts `{action: person}` (no step-up; audited).
 * A drawer with unsaved work stays open (D10).
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import { defaultWorkType, type PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import { pickerPositionAllowed, hasPositionRank, isHourlyLeadRole, positionListProblems, positionSlotOf } from "@/lib/scheduling/position-rank-shared";
import { editorBaseOnProps, personBody, type SettingsMember } from "@/lib/scheduling/settings-view-shared";
import type { RoleCode } from "@/lib/roles";
import { canWorkAs, effectiveScheduleRole, WORKS_AS_ROLES, type WorksAsRole } from "@/lib/scheduling/works-as-shared";
import { workTypeAllows } from "@/lib/scheduling/rules-shared";
import type { PositionRole } from "@/lib/scheduling/structure-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { BUTTON, Check, Fields, GHOST, NumField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";

const empty = (userId: string): PersonSettingsRow => ({ userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null });

type PositionLabels = Record<string, { name: string; nameEs: string | null; role?: PositionRole; allowedRoles?: RoleCode[] }>;

export function StaffSettings({ locationId, members, positions, livePositionIds, names, rolesKnown = false, initialPerson = null, onDirty }: {
  locationId: string;
  members: SettingsMember[];
  positions: PositionLabels;
  livePositionIds: string[];
  names: Record<string, string>;
  /** The positions' roles are known (the structure is saved): the primary / secondary work-type check runs. */
  rolesKnown?: boolean;
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
              <PersonEditor locationId={locationId} member={m} positions={positions} livePositionIds={livePositionIds} names={names} rolesKnown={rolesKnown}
                onDirty={(d) => { setDirtyOf(d ? m.userId : null); onDirty?.(d); }} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PersonEditor({ locationId, member, positions, livePositionIds, names, rolesKnown, onDirty }: {
  locationId: string;
  member: SettingsMember;
  positions: PositionLabels;
  livePositionIds: string[];
  names: Record<string, string>;
  rolesKnown: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const { t, position } = useBoardLine({ names, positions });
  const router = useRouter();
  const post = useStepUpPost();
  const id = useId();
  const [draft, setS] = useState<PersonSettingsRow>(() => structuredClone(member.settings ?? empty(member.userId)));
  const s = canWorkAs(member.role) ? draft : { ...draft, worksAs: null };
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  // Astra BC-007 (r3): the row id this DRAFT is based on (sent as expectedId), moved with the draft by the prev-compare
  // pattern — a clean editor adopts a refreshed row (values + id), a dirty one keeps both and is refused on save.
  const [base, setBase] = useState<{ baseId: string | null; seenId: string | null }>(() => ({ baseId: member.settingsId ?? null, seenId: member.settingsId ?? null }));
  const next = editorBaseOnProps({ dirty, ...base }, member.settingsId ?? null);
  if (next.baseId !== base.baseId || next.seenId !== base.seenId) {
    setBase({ baseId: next.baseId, seenId: next.seenId });
    if (next.reset) setS(structuredClone(member.settings ?? empty(member.userId)));
  }
  const edit = (f: (x: PersonSettingsRow) => void) => {
    setS((cur) => { const n = structuredClone(cur); f(n); return n; });
    if (!dirty) { setDirty(true); onDirty(true); }
  };
  async function save() {
    setBusy(true); setError(null);
    const r = await post("/api/schedule", personBody(locationId, s, base.baseId));
    setBusy(false);
    if (!r.ok) { setError(r.code); return; }
    setDirty(false); onDirty(false);
    router.refresh();
  }
  // Juan 2026-10-20: below shift lead the list is Primary / Secondary / Can flex to; a manager's is their cover order.
  const role = effectiveScheduleRole(member.role, s.worksAs);
  const ranked = hasPositionRank({ role });
  const person = { role, workType: s.workType ?? defaultWorkType(role), alsoAllowed: s.alsoAllowed };
  const allowed = (pid: string) => !ranked || pickerPositionAllowed(person, rolesKnown ? positions[pid] : positions[pid] ? {} : undefined);
  const roles: Record<string, PositionRole> = {};
  if (rolesKnown) for (const [pid, p] of Object.entries(positions)) if (p.role) roles[pid] = p.role;
  const problems = ranked ? positionListProblems(person, s.coverPositions, roles, Object.fromEntries(Object.entries(positions).filter(([, p]) => p.allowedRoles).map(([pid, p]) => [pid, p.allowedRoles!]))) : [];
  const slotLabel = (i: number) => t(`schedule.settings.staff.slot_${positionSlotOf(i)}` as TranslationKey);
  const suggestion = ranked && s.coverPositions.length === 0 && member.suggestedPrimary && livePositionIds.includes(member.suggestedPrimary.positionId) && allowed(member.suggestedPrimary.positionId) ? member.suggestedPrimary : null;
  const readOnly = member.editable === false;
  const move = (i: number, by: -1 | 1) => edit((x) => { const a = x.coverPositions; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; });
  const iconBtn = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface text-sm font-bold text-co-text disabled:opacity-60";
  return (
    <div data-person-editor={member.userId} className="grid gap-3 border-t border-co-border p-3">
      {readOnly ? <p className="text-sm font-bold text-co-text-muted" data-person-read-only>{t("schedule.settings.staff.read_only")}</p> : null}
      {/* Juan 2026-10-20: a person this actor may not change (themselves, a GM or above) — every control disabled; the save path refuses too. */}
      <fieldset disabled={readOnly} className="contents">
      {canWorkAs(member.role) ? <label className="grid gap-1">
        <span className="text-sm font-bold">{t("schedule.settings.staff.works_as")}</span>
        <select className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-2" value={s.worksAs ?? ""} onChange={(e) => edit((x) => { x.worksAs = (e.target.value || null) as WorksAsRole | null; })}>
          <option value="">{t("schedule.settings.staff.works_as_none")}</option>
          {WORKS_AS_ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}` as TranslationKey)}</option>)}
        </select>
      </label> : null}
      {(!["cgs", "social_media_mgr"].includes(member.role) || s.worksAs) ? <>
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
      <div className="grid gap-1" data-position-list={ranked ? "ranked" : "cover"}>
        <span id={`${id}-pos`} className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t(ranked ? "schedule.settings.staff.cover" : "schedule.settings.staff.cover_manager")}</span>
        {ranked ? <p className="text-xs text-co-text-muted">{t("schedule.settings.staff.cover_help")}</p> : null}
        {/* Juan 2026-10-20: a lead's manager duties are implicit — never a list entry; one line says so. */}
        {isHourlyLeadRole(role) ? <p data-lead-note className="text-xs text-co-text-muted">{t("schedule.settings.staff.lead_note")}</p> : null}
        {suggestion ? (
          <div className="flex flex-wrap items-center gap-2" data-toast-suggestion={suggestion.positionId}>
            <button type="button" className={GHOST} onClick={() => edit((x) => { x.coverPositions = [suggestion.positionId]; })}>
              {t("schedule.settings.staff.toast_suggest", { position: position(suggestion.positionId) })}
            </button>
            <span className="text-xs text-co-text-muted">{t("schedule.settings.staff.toast_suggest_help", { job: suggestion.jobName })}</span>
          </div>
        ) : null}
        <ol className="grid gap-1" aria-labelledby={`${id}-pos`}>
          {s.coverPositions.map((p, i) => (
            <li key={p} data-position-slot={ranked ? positionSlotOf(i) : "cover"} className="flex flex-wrap items-center gap-2 text-sm text-co-text">
              <span className="grid min-w-[8rem] flex-1">
                {ranked ? <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{slotLabel(i)}</span> : null}
                <span>{i + 1}. {position(p)}</span>
                {!allowed(p) ? <span data-ineligible-position={p} className="text-co-warning-text">{t(positions[p]?.role && !workTypeAllows(person, { role: positions[p]!.role! }) ? "schedule.settings.staff.warning_work_type" : "schedule.settings.staff.problem_ineligible", { slot: slotLabel(i), position: position(p) })}</span> : null}
              </span>
              <button type="button" data-cover-act="up" className={iconBtn} disabled={i === 0} aria-label={t("schedule.settings.staff.cover_up", { position: position(p) })} onClick={() => move(i, -1)}>↑</button>
              <button type="button" data-cover-act="down" className={iconBtn} disabled={i === s.coverPositions.length - 1} aria-label={t("schedule.settings.staff.cover_down", { position: position(p) })} onClick={() => move(i, 1)}>↓</button>
              <button type="button" data-cover-act="remove" className={iconBtn} aria-label={t("schedule.settings.staff.cover_remove", { position: position(p) })} onClick={() => edit((x) => { x.coverPositions = x.coverPositions.filter((y) => y !== p); })}>×</button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("schedule.settings.staff.cover_pick")} className="min-h-[44px] min-w-0 flex-1 rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t("schedule.settings.staff.cover_pick")}</option>
            {livePositionIds.filter((p) => !s.coverPositions.includes(p) && allowed(p)).map((p) => <option key={p} value={p}>{position(p)}</option>)}
          </select>
          <button type="button" className={GHOST} disabled={!adding || !allowed(adding)} onClick={() => { edit((x) => { x.coverPositions = [...x.coverPositions, adding]; }); setAdding(""); }}>{t("schedule.settings.staff.cover_add")}</button>
        </div>
        {problems.length > 0 ? (
          <ul role="alert" data-position-problems className="grid gap-1 text-sm font-bold text-co-cta-text">
            {problems.map((pr) => <li key={pr.slot}>{t(pr.code === "work_type" ? "schedule.settings.staff.problem_work_type" : "schedule.settings.staff.problem_ineligible", { slot: slotLabel(pr.slot === "primary" ? 0 : 1), position: position(pr.positionId) })}</li>)}
          </ul>
        ) : null}
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
      </> : null}
      {member.includeOffered && !s.worksAs && !["cgs", "social_media_mgr"].includes(member.role) ? (
        <Check label={t("schedule.settings.staff.include")} checked={s.rosterInclude === true} onChange={(on) => edit((x) => { x.rosterInclude = on ? true : null; })} />
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={busy || !dirty || problems.some((pr) => pr.code === "work_type")} onClick={save}>{t("schedule.settings.save")}</button>
        {dirty ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.settings.unsaved")}</span> : null}
      </div>
      </fieldset>
      <span data-person-editor-end hidden />
    </div>
  );
}
