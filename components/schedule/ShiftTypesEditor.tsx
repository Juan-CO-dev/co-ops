"use client";

import { useMemo } from "react";
import type { TranslationKey } from "@/lib/i18n/types";
import { CREW_TYPES, positionIds, type ScheduleStructure, type ShiftType } from "@/lib/scheduling/structure-shared";
import { Check, Fields, GHOST, NumField, SelectField, TimeField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";
import { formatQ, qToWall, wallToQ } from "@/lib/scheduling/time-shared";

let shiftTypeIdCounter = 0;
/** Local draft identities work on HTTP and older browsers as well as secure origins. */
export function newShiftTypeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `shift-${Date.now().toString(36)}-${(shiftTypeIdCounter++).toString(36)}`;
}

/** Array order is scheduling priority; IDs survive renames, edits and reordering. */
export function ShiftTypesEditor({ value, structure, positions, onChange }: {
  value: ShiftType[];
  structure: ScheduleStructure;
  positions: Record<string, { name: string; nameEs: string | null }>;
  onChange: (value: ShiftType[]) => void;
}) {
  const { t, position, language } = useBoardLine({ names: {}, positions });
  const endTimes = useMemo(() => Array.from({ length: 97 }, (_, q) => ({ value: qToWall(q), label: q === 96 ? t("schedule.settings.shift_types.end_of_day") : formatQ(q, language) })), [language, t]);
  const patch = (index: number, change: Partial<ShiftType>) => onChange(value.map((row, i) => i === index ? { ...row, ...change } : row));
  const move = <T,>(items: T[], index: number, delta: number): T[] => {
    const next = [...items], target = index + delta;
    if (index < 0 || target < 0 || index >= next.length || target >= next.length) return next;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  };
  return <div className="grid min-w-0 gap-3">
    {value.length === 0 && <p className="text-sm text-co-text-muted">{t("schedule.settings.shift_types.empty")}</p>}
    {value.map((row, index) => <fieldset key={row.id} data-shift-type={row.id} className="grid min-w-0 gap-3 rounded-lg border border-co-border p-3">
      <legend className="max-w-full break-words px-1 text-sm font-bold">{row.name || t("schedule.settings.shift_types.unnamed")}</legend>
      <label className="grid min-w-0 gap-1 text-sm">
        {t("schedule.settings.shift_types.name")}
        <input aria-label={t("schedule.settings.shift_types.name")} name={`shiftTypes.${index}.name`} value={row.name} className="min-h-[44px] w-full min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-2" onChange={(event) => patch(index, { name: event.target.value })} />
      </label>
      <Fields>
        <TimeField name={`shiftTypes.${index}.fromQ`} label={t("schedule.settings.shift_types.from")} q={row.fromQ} onChange={(fromQ) => patch(index, { fromQ })} />
        <SelectField name={`shiftTypes.${index}.toQ`} label={t("schedule.settings.shift_types.to")} value={qToWall(row.toQ)} options={endTimes} onChange={(time) => patch(index, { toQ: wallToQ(time) })} />
        <NumField name={`shiftTypes.${index}.startFlexQ`} label={t("schedule.settings.shift_types.flex")} value={row.startFlexQ * 15} step={15} max={1440} onChange={(minutes) => patch(index, { startFlexQ: (minutes ?? 0) / 15 })} />
        <NumField name={`shiftTypes.${index}.minLengthQ`} label={t("schedule.settings.shift_types.minimum")} value={row.minLengthQ * 15} min={15} max={1440} step={15} onChange={(minutes) => patch(index, { minLengthQ: (minutes ?? 0) / 15 })} />
        {CREW_TYPES.map((day) => <NumField key={day} name={`shiftTypes.${index}.headcount.${day}`} label={t("schedule.settings.shift_types.headcount", { day: t(`schedule.board.day_type.${day}` as TranslationKey) })} value={row.headcount[day]} max={20} onChange={(heads) => patch(index, { headcount: { ...row.headcount, [day]: heads ?? 0 } })} />)}
      </Fields>
      <Check name={`shiftTypes.${index}.countsTowardMod`} label={t("schedule.settings.shift_types.mod")} checked={row.countsTowardMod} onChange={(countsTowardMod) => patch(index, { countsTowardMod })} />
      <p className="text-sm text-co-text-muted">{t("schedule.settings.shift_types.stations")}</p>
      <ol className="grid min-w-0 gap-2">
        {row.stations.map((id, stationIndex) => <li key={id} className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-sm">{stationIndex + 1}. {position(id)}</span>
          <button type="button" className={GHOST} disabled={stationIndex === 0} aria-label={t("schedule.settings.shift_types.up_named", { name: position(id) })} onClick={() => patch(index, { stations: move(row.stations, stationIndex, -1) })}>{t("schedule.settings.shift_types.up")}</button>
          <button type="button" className={GHOST} disabled={stationIndex === row.stations.length - 1} aria-label={t("schedule.settings.shift_types.down_named", { name: position(id) })} onClick={() => patch(index, { stations: move(row.stations, stationIndex, 1) })}>{t("schedule.settings.shift_types.down")}</button>
          <button type="button" className={GHOST} aria-label={t("schedule.settings.shift_types.remove_named", { name: position(id) })} onClick={() => patch(index, { stations: row.stations.filter((station) => station !== id) })}>{t("schedule.settings.shift_types.remove")}</button>
        </li>)}
      </ol>
      <SelectField name={`shiftTypes.${index}.stations`} label={t("schedule.settings.shift_types.add_station")} value="" options={[{ value: "", label: t("schedule.settings.shift_types.choose_station") }, ...positionIds(structure).filter((id) => !row.stations.includes(id)).map((id) => ({ value: id, label: position(id) }))]} onChange={(id) => { if (id) patch(index, { stations: [...row.stations, id] }); }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={GHOST} disabled={index === 0} aria-label={t("schedule.settings.shift_types.up_named", { name: row.name })} onClick={() => onChange(move(value, index, -1))}>{t("schedule.settings.shift_types.up")}</button>
        <button type="button" className={GHOST} disabled={index === value.length - 1} aria-label={t("schedule.settings.shift_types.down_named", { name: row.name })} onClick={() => onChange(move(value, index, 1))}>{t("schedule.settings.shift_types.down")}</button>
        <button type="button" className={GHOST} aria-label={t("schedule.settings.shift_types.remove_named", { name: row.name })} onClick={() => onChange(value.filter((_, i) => i !== index))}>{t("schedule.settings.shift_types.remove")}</button>
      </div>
    </fieldset>)}
    <button type="button" className={GHOST} onClick={() => onChange([...value, {
      id: newShiftTypeId(), name: t("schedule.settings.shift_types.unnamed"),
      fromQ: structure.shopDay.prepStartQ, toQ: structure.shopDay.outLatestQ,
      startFlexQ: 0, minLengthQ: Math.min(structure.limits.minimumShiftQ, structure.shopDay.outLatestQ - structure.shopDay.prepStartQ),
      headcount: { slow: 0, normal: 0, busy: 0, weekend: 0 }, stations: [], countsTowardMod: true,
    }])}>{t("schedule.settings.shift_types.add")}</button>
  </div>;
}
