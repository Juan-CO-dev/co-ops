"use client";
/**
 * THE SCHEDULE STRUCTURE EDITOR (spec §5.7 — every rule is tunable; Juan's mockup v17 "Schedule structure" sections):
 * the shop day, day types (thresholds + weekend days), the crews per day type (stacked cards at 375 px), positions
 * (role, open / trim / close, heads before / after the trim, allowed roles; the priority pairs with a swap), leadership,
 * managers (daily minimums, the weekly floor limit, staying longer), limits (the minimum shift, the daily maximum,
 * overtime, segments; flex rules arrive in Phase 3; the closing checklist "measured ~N min from M finalized closes ·
 * override (wins when set)"), the catering prep rule, the labor target (% + basis, Total labor by default) and the
 * roster's excluded roles.
 *
 * Save: the TS validator names the failing key BEFORE any post; then the Tier E edit window (a cancelled prompt keeps the
 * draft); then POST /api/schedule/settings {action: structure, expectedId} — someone else's save in between is
 * `structure_moved`, named. After a save: "Settings changed — regenerate?" with the way back to the board. The draft is
 * reported dirty so its section stays open (D10).
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";
import { structureBody, structureSaveRefusal } from "@/lib/scheduling/settings-view-shared";
import {
  CREW_TYPES, LEADER_SETTINGS, POSITION_ROLES, isLineRole, positionIds, type PositionRole, type ScheduleStructure,
} from "@/lib/scheduling/structure-shared";
import { runGuarded } from "./horizon-flow-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { BUTTON, Check, Fields, GHOST, NumField, SelectField, TimeField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";

const FLOOR_ROLES: RoleCode[] = ["trainee", "employee", "trainer", "key_holder", "shift_lead", "agm", "gm", "moo", "owner"];
const ALL_ROLES: RoleCode[] = ["cgs", "owner", "moo", "gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee", "trainee"];
const LEADER_ROLES: RoleCode[] = ["key_holder", "shift_lead", "agm", "gm", "moo", "owner"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <fieldset data-structure-section={id} className="grid gap-3 rounded-lg border border-co-border p-3">
      <legend className="px-1 text-xs font-bold tracking-[0.14em] text-co-text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

export function StructureEditor({ locationId, structure, closing, positions, names, onDirty, initialError = null, initialSaved = false }: {
  locationId: string;
  structure: { id: string | null; source: "saved" | "defaults"; value: ScheduleStructure };
  closing: { measuredMinutes: number | null; samples: number };
  positions: Record<string, { name: string; nameEs: string | null }>;
  names: Record<string, string>;
  onDirty?: (dirty: boolean) => void;
  /** SSR tests only. */
  initialError?: string | null;
  initialSaved?: boolean;
}) {
  const { t, position } = useBoardLine({ names, positions });
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [draft, setDraft] = useState<ScheduleStructure>(() => structuredClone(structure.value));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(initialError);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(initialSaved);
  const edit = (mutate: (s: ScheduleStructure) => void) => {
    setDraft((d) => { const n = structuredClone(d); mutate(n); return n; });
    if (!dirty) { setDirty(true); onDirty?.(true); }
    setSaved(false);
  };
  const num = (v: number | null, fallback = 0) => (v === null || !Number.isFinite(v) ? fallback : v);

  async function save() {
    setKeyError(null); setRefusal(null);
    const key = structureSaveRefusal(draft);
    if (key) { setKeyError(key); return; }
    setBusy(true);
    const out = await runGuarded({
      tier: "E", requestStepUp: () => requestStepUp("E"),
      post: async () => { const r = await post("/api/schedule/settings", structureBody(locationId, structure.id, draft)); return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code }; },
    });
    setBusy(false);
    if (out.kind === "cancelled") return; // the draft stays exactly as it was
    if (out.kind === "refused") { setRefusal(out.code); return; }
    setDirty(false); onDirty?.(false); setSaved(true);
    router.refresh();
  }

  const d = draft;
  const roleLabel = (r: RoleCode) => t(`role.${r}` as TranslationKey);
  const lineIds = positionIds(d).filter((id) => isLineRole(d.positions[id]!.role));
  return (
    <div className="grid gap-3" data-section="structure-editor">
      <Section id="shop_day" title={t("schedule.settings.section.shop_day")}>
        <Fields>
          <TimeField name="shopDay.prepStartQ" label={t("schedule.settings.shop_day.prep_start")} q={d.shopDay.prepStartQ} onChange={(q) => edit((s) => { s.shopDay.prepStartQ = q; })} />
          <TimeField name="shopDay.prepDishArrivalQ" label={t("schedule.settings.shop_day.prep_dish")} q={d.shopDay.prepDishArrivalQ} onChange={(q) => edit((s) => { s.shopDay.prepDishArrivalQ = q; })} />
          <TimeField name="shopDay.serviceStartQ" label={t("schedule.settings.shop_day.service_start")} q={d.shopDay.serviceStartQ} onChange={(q) => edit((s) => { s.shopDay.serviceStartQ = q; })} />
          <TimeField name="shopDay.serviceCloseQ" label={t("schedule.settings.shop_day.service_close")} q={d.shopDay.serviceCloseQ} onChange={(q) => edit((s) => { s.shopDay.serviceCloseQ = q; })} />
          <TimeField name="shopDay.outEarliestQ" label={t("schedule.settings.shop_day.out_earliest")} q={d.shopDay.outEarliestQ} onChange={(q) => edit((s) => { s.shopDay.outEarliestQ = q; })} />
          <TimeField name="shopDay.outLatestQ" label={t("schedule.settings.shop_day.out_latest")} q={d.shopDay.outLatestQ} onChange={(q) => edit((s) => { s.shopDay.outLatestQ = q; })} />
        </Fields>
      </Section>

      <Section id="day_types" title={t("schedule.settings.section.day_types")}>
        <Fields>
          <NumField name="dayTypes.slowBelow" label={t("schedule.settings.day_types.slow_below")} value={r2(d.dayTypes.slowBelowCents / 100)} step={100}
            onChange={(v) => edit((s) => { s.dayTypes.slowBelowCents = Math.round(num(v) * 100); })} />
          <NumField name="dayTypes.busyAbove" label={t("schedule.settings.day_types.busy_above")} value={r2(d.dayTypes.busyAboveCents / 100)} step={100}
            onChange={(v) => edit((s) => { s.dayTypes.busyAboveCents = Math.round(num(v) * 100); })} />
        </Fields>
        <div className="flex flex-wrap gap-x-3">
          <span className="w-full text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.day_types.weekend")}</span>
          {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
            <Check key={dow} label={t(`schedule.settings.dow.${dow}` as TranslationKey)} checked={d.dayTypes.weekendIsoDows.includes(dow)}
              onChange={(on) => edit((s) => { s.dayTypes.weekendIsoDows = on ? [...new Set([...s.dayTypes.weekendIsoDows, dow])].sort() : s.dayTypes.weekendIsoDows.filter((x) => x !== dow); })} />
          ))}
        </div>
      </Section>

      <Section id="crews" title={t("schedule.settings.section.crews")}>
        <div className="grid gap-3 lg:grid-cols-2">
          {CREW_TYPES.map((ct) => {
            const c = d.crews[ct];
            return (
              <div key={ct} data-crew-card={ct} className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3">
                <h4 className="text-sm font-bold text-co-text">{t(`schedule.board.day_type.${ct}` as TranslationKey)}</h4>
                <Fields>
                  <NumField name={`crews.${ct}.prepHeads`} label={t("schedule.settings.crews.prep_heads")} value={c.prepHeads} onChange={(v) => edit((s) => { s.crews[ct].prepHeads = num(v); })} />
                  <TimeField name={`crews.${ct}.prepUntilQ`} label={t("schedule.settings.crews.prep_until")} q={c.prepUntilQ} onChange={(q) => edit((s) => { s.crews[ct].prepUntilQ = q; })} />
                  <NumField name={`crews.${ct}.prepDishHeads`} label={t("schedule.settings.crews.prep_dish_heads")} value={c.prepDishHeads} onChange={(v) => edit((s) => { s.crews[ct].prepDishHeads = num(v); })} />
                  <NumField name={`crews.${ct}.setup`} label={t("schedule.settings.crews.setup_heads")} value={c.waves.setup.heads} onChange={(v) => edit((s) => { s.crews[ct].waves.setup.heads = num(v); })} />
                  <TimeField name={`crews.${ct}.setupAt`} label={t("schedule.settings.crews.setup_at")} q={c.waves.setup.atQ} onChange={(q) => edit((s) => { s.crews[ct].waves.setup.atQ = q; })} />
                  <NumField name={`crews.${ct}.service`} label={t("schedule.settings.crews.service_heads")} value={c.waves.service.heads} onChange={(v) => edit((s) => { s.crews[ct].waves.service.heads = num(v); })} />
                  <NumField name={`crews.${ct}.rush`} label={t("schedule.settings.crews.rush_heads")} value={c.waves.rush.heads} onChange={(v) => edit((s) => { s.crews[ct].waves.rush.heads = num(v); })} />
                  <TimeField name={`crews.${ct}.rushAt`} label={t("schedule.settings.crews.rush_at")} q={c.waves.rush.atQ} onChange={(q) => edit((s) => { s.crews[ct].waves.rush.atQ = q; })} />
                  <NumField name={`crews.${ct}.closeRegister`} label={t("schedule.settings.crews.close_register")} value={c.close.registerHeads} onChange={(v) => edit((s) => { s.crews[ct].close.registerHeads = num(v); })} />
                  <NumField name={`crews.${ct}.closeWalk`} label={t("schedule.settings.crews.close_walk")} value={c.close.walkHeads} onChange={(v) => edit((s) => { s.crews[ct].close.walkHeads = num(v); })} />
                  <NumField name={`crews.${ct}.closePrepDish`} label={t("schedule.settings.crews.close_prep_dish")} value={c.close.prepDishHeads} onChange={(v) => edit((s) => { s.crews[ct].close.prepDishHeads = num(v); })} />
                  {lineIds.map((id) => (
                    <NumField key={id} name={`crews.${ct}.lineMinHeads.${id}`} label={t("schedule.settings.crews.line_min", { position: position(id) })} value={c.lineMinHeads[id] ?? 0}
                      onChange={(v) => edit((s) => { s.crews[ct].lineMinHeads[id] = num(v); })} />
                  ))}
                </Fields>
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="positions" title={t("schedule.settings.section.positions")}>
        <div className="grid gap-3 lg:grid-cols-2">
          {positionIds(d).map((id) => {
            const p = d.positions[id]!;
            return (
              <div key={id} data-position-card={id} className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3">
                <h4 className="text-sm font-bold text-co-text">{position(id)}</h4>
                <Fields>
                  <SelectField name={`positions.${id}.role`} label={t("schedule.settings.positions.role")} value={p.role}
                    options={POSITION_ROLES.map((r) => ({ value: r, label: t(`schedule.settings.role.${r}` as TranslationKey) }))}
                    onChange={(v) => edit((s) => { s.positions[id]!.role = v as PositionRole; })} />
                  <TimeField name={`positions.${id}.openQ`} label={t("schedule.settings.positions.open")} q={p.openQ} onChange={(q) => edit((s) => { s.positions[id]!.openQ = q; })} />
                  <TimeField name={`positions.${id}.trimQ`} label={t("schedule.settings.positions.trim")} q={p.trimQ} onChange={(q) => edit((s) => { s.positions[id]!.trimQ = q; })} />
                  <TimeField name={`positions.${id}.closeQ`} label={t("schedule.settings.positions.close")} q={p.closeQ} onChange={(q) => edit((s) => { s.positions[id]!.closeQ = q; })} />
                  <NumField name={`positions.${id}.headsBefore`} label={t("schedule.settings.positions.heads_before")} value={p.headsBefore} onChange={(v) => edit((s) => { s.positions[id]!.headsBefore = num(v); })} />
                  <NumField name={`positions.${id}.headsAfter`} label={t("schedule.settings.positions.heads_after")} value={p.headsAfter} onChange={(v) => edit((s) => { s.positions[id]!.headsAfter = num(v); })} />
                </Fields>
                <div className="flex flex-wrap gap-x-3">
                  <span className="w-full text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.positions.allowed")}</span>
                  {FLOOR_ROLES.map((r) => (
                    <Check key={r} label={roleLabel(r)} checked={p.allowedRoles.includes(r)}
                      onChange={(on) => edit((s) => { const a = s.positions[id]!.allowedRoles; s.positions[id]!.allowedRoles = on ? [...new Set([...a, r])] : a.filter((x) => x !== r); })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {d.priority.length > 0 ? (
          <ul className="grid gap-2">
            {d.priority.map((pr, i) => {
              const secondary = pr.pair[0] === pr.primary ? pr.pair[1] : pr.pair[0];
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-co-text">
                  <span>{t("schedule.settings.positions.priority", { primary: position(pr.primary), secondary: position(secondary) })}</span>
                  <button type="button" className={GHOST} onClick={() => edit((s) => { s.priority[i]!.primary = secondary; })}>{t("schedule.settings.positions.swap")}</button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>

      <Section id="leadership" title={t("schedule.settings.section.leadership")}>
        <Check label={t("schedule.settings.leadership.mod_required")} checked={d.leadership.modRequired} onChange={(on) => edit((s) => { s.leadership.modRequired = on; })} />
        <div className="flex flex-wrap gap-x-3">
          <span className="w-full text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.leadership.closing_roles")}</span>
          {LEADER_ROLES.map((r) => (
            <Check key={r} label={roleLabel(r)} checked={d.leadership.closingRoles.includes(r)}
              onChange={(on) => edit((s) => { const a = s.leadership.closingRoles; s.leadership.closingRoles = on ? [...new Set([...a, r])] : a.filter((x) => x !== r); })} />
          ))}
        </div>
        <Fields>
          {LEADER_ROLES.map((r) => (
            <SelectField key={r} name={`leadership.leaderDefaults.${r}`} label={t("schedule.settings.leadership.default_for", { role: roleLabel(r) })} value={d.leadership.leaderDefaults[r] ?? "mix"}
              options={LEADER_SETTINGS.map((l) => ({ value: l, label: t(`schedule.settings.staff.leader_${l}` as TranslationKey) }))}
              onChange={(v) => edit((s) => { s.leadership.leaderDefaults[r] = v as "opens" | "closes" | "mix"; })} />
          ))}
        </Fields>
        <Check label={t("schedule.settings.leadership.kh_mod")} checked={d.leadership.keyHolderModAfterQ !== null}
          onChange={(on) => edit((s) => { s.leadership.keyHolderModAfterQ = on ? s.shopDay.serviceCloseQ - 8 : null; })} />
        {d.leadership.keyHolderModAfterQ !== null ? (
          <TimeField name="leadership.keyHolderModAfterQ" label={t("schedule.settings.leadership.kh_mod_after")} q={d.leadership.keyHolderModAfterQ} onChange={(q) => edit((s) => { s.leadership.keyHolderModAfterQ = q; })} />
        ) : null}
      </Section>

      <Section id="managers" title={t("schedule.settings.section.managers")}>
        <Fields>
          <NumField name="limits.gmMinimumH" label={t("schedule.settings.managers.gm_min")} value={d.limits.gmMinimumH} step={0.25} onChange={(v) => edit((s) => { s.limits.gmMinimumH = num(v); })} />
          <NumField name="limits.agmMinimumH" label={t("schedule.settings.managers.agm_min")} value={d.limits.agmMinimumH} step={0.25} onChange={(v) => edit((s) => { s.limits.agmMinimumH = num(v); })} />
          <NumField name="limits.managerFloorH" label={t("schedule.settings.managers.floor")} value={d.limits.managerFloorH} step={0.25} onChange={(v) => edit((s) => { s.limits.managerFloorH = num(v); })} />
          {/* Astra chunk H P2-4: the salaried week target (0–80 h) and the flex on top (0–10 h), quarter-hour steppers. */}
          <NumField name="limits.salariedTargetWeekH" label={t("schedule.settings.managers.week_target")} value={d.limits.salariedTargetWeekH} step={0.25} max={80} onChange={(v) => edit((s) => { s.limits.salariedTargetWeekH = num(v); })} />
          <NumField name="limits.salariedFlexH" label={t("schedule.settings.managers.flex")} value={d.limits.salariedFlexH} step={0.25} max={10} onChange={(v) => edit((s) => { s.limits.salariedFlexH = num(v); })} />
        </Fields>
        <Check label={t("schedule.settings.managers.stay_longer")} checked={d.limits.salariedStayLonger} onChange={(on) => edit((s) => { s.limits.salariedStayLonger = on; })} />
      </Section>

      <Section id="limits" title={t("schedule.settings.section.limits")}>
        <Fields>
          <NumField name="limits.minimumShiftH" label={t("schedule.settings.limits.min_shift")} value={d.limits.minimumShiftQ / 4} step={0.25} onChange={(v) => edit((s) => { s.limits.minimumShiftQ = Math.round(num(v) * 4); })} />
          <NumField name="limits.maxShiftH" label={t("schedule.settings.limits.max_shift")} value={d.limits.maxShiftH} step={0.25} onChange={(v) => edit((s) => { s.limits.maxShiftH = num(v); })} />
          <NumField name="limits.overtimeH" label={t("schedule.settings.limits.overtime")} value={d.limits.overtimeH} step={0.25} onChange={(v) => edit((s) => { s.limits.overtimeH = num(v); })} />
          <NumField name="limits.segmentMinMinutes" label={t("schedule.settings.limits.segment_min")} value={d.limits.segmentMinQ * 15} step={15} onChange={(v) => edit((s) => { s.limits.segmentMinQ = Math.round(num(v) / 15); })} />
          <NumField name="limits.closingMinutesOverride" label={t("schedule.settings.limits.closing_override")} value={d.limits.closingMinutesOverride} step={5}
            onChange={(v) => edit((s) => { s.limits.closingMinutesOverride = v === null ? null : Math.round(v); })} />
        </Fields>
        <p className="text-sm text-co-text-muted">{closing.measuredMinutes !== null
          ? t("schedule.settings.limits.closing_measured", { minutes: closing.measuredMinutes, samples: closing.samples })
          : t("schedule.settings.limits.closing_unmeasured")}</p>
        <p className="text-xs text-co-text-muted">{t("schedule.settings.limits.flex_phase3")}</p>
      </Section>

      <Section id="catering" title={t("schedule.settings.section.catering")}>
        <Fields>
          <NumField name="catering.minHeadcount" label={t("schedule.settings.catering.min_headcount")} value={d.catering.minHeadcount} onChange={(v) => edit((s) => { s.catering.minHeadcount = num(v); })} />
          <NumField name="catering.extraPrepDishHeads" label={t("schedule.settings.catering.extra_heads")} value={d.catering.extraPrepDishHeads} onChange={(v) => edit((s) => { s.catering.extraPrepDishHeads = num(v); })} />
          <TimeField name="catering.defaultStartQ" label={t("schedule.settings.catering.start")} q={d.catering.defaultStartQ} onChange={(q) => edit((s) => { s.catering.defaultStartQ = q; })} />
          <TimeField name="catering.defaultEndQ" label={t("schedule.settings.catering.end")} q={d.catering.defaultEndQ} onChange={(q) => edit((s) => { s.catering.defaultEndQ = q; })} />
          <NumField name="catering.leadMinutes" label={t("schedule.settings.catering.lead")} value={d.catering.leadMinutes} step={15} onChange={(v) => edit((s) => { s.catering.leadMinutes = num(v); })} />
        </Fields>
      </Section>

      <Section id="labor" title={t("schedule.settings.section.labor")}>
        <Fields>
          <NumField name="labor.targetPct" label={t("schedule.settings.labor.target")} value={d.labor.targetPct} step={0.5} onChange={(v) => edit((s) => { s.labor.targetPct = num(v); })} />
          <SelectField name="labor.basis" label={t("schedule.settings.labor.basis")} value={d.labor.basis}
            options={[{ value: "total", label: t("schedule.settings.labor.basis_total") }, { value: "hourly", label: t("schedule.settings.labor.basis_hourly") }]}
            onChange={(v) => edit((s) => { s.labor.basis = v === "hourly" ? "hourly" : "total"; })} />
          <NumField name="labor.strong" label={t("schedule.settings.labor.strong")} value={d.labor.strong} step={0.05} max={1} onChange={(v) => edit((s) => { s.labor.strong = num(v); })} />
          <NumField name="labor.watch" label={t("schedule.settings.labor.watch")} value={d.labor.watch} step={0.05} max={1} onChange={(v) => edit((s) => { s.labor.watch = num(v); })} />
          <NumField name="labor.budgetDeadbandH" label={t("schedule.settings.labor.deadband")} value={d.labor.budgetDeadbandH} step={0.25} onChange={(v) => edit((s) => { s.labor.budgetDeadbandH = num(v); })} />
        </Fields>
      </Section>

      <Section id="roster" title={t("schedule.settings.section.roster")}>
        <div className="flex flex-wrap gap-x-3">
          {ALL_ROLES.map((r) => (
            <Check key={r} label={roleLabel(r)} checked={d.roster.excludedRoles.includes(r)}
              onChange={(on) => edit((s) => { const a = s.roster.excludedRoles; s.roster.excludedRoles = on ? [...new Set([...a, r])] : a.filter((x) => x !== r); })} />
          ))}
        </div>
      </Section>

      {keyError ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t("schedule.error.structure_invalid", { key: keyError })}</p> : null}
      {refusal ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(refusal), { key: "—" })}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-act="save-structure" disabled={busy} onClick={save} className={BUTTON}>{t("schedule.settings.save")}</button>
        {dirty ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.settings.unsaved")}</span> : null}
      </div>
      {saved ? (
        <p role="status" className="rounded-lg border-2 border-co-warning bg-co-warning-surface p-3 text-sm font-bold text-co-warning-text">
          {t("schedule.board.banner.settings_changed")}{" "}
          <Link href={`/schedule?loc=${locationId}`} className="inline-flex min-h-[44px] items-center underline">{t("schedule.settings.back_to_board")}</Link>
        </p>
      ) : null}
    </div>
  );
}
