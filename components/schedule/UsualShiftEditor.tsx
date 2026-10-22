"use client";
import type { ShiftType } from "@/lib/scheduling/structure-shared";
import { validUsualShift, type UsualShift, type UsualShiftGuess } from "@/lib/scheduling/usual-shift-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { Check, Fields, GHOST, SelectField, TimeField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";

export function UsualShiftEditor({ value, guess, types, onChange }: {
  value: UsualShift | null; guess: UsualShiftGuess | null; types: readonly ShiftType[]; onChange: (value: UsualShift | null) => void;
}) {
  const { t, language } = useBoardLine({ names: {}, positions: {} });
  if (!types.length) return null;
  const type = types.find((s) => s.id === value?.typeId);
  const suggested = types.find((s) => s.id === guess?.value.typeId);
  const outside = type && value?.fromQ !== undefined && Math.abs(value.fromQ - type.fromQ) > type.startFlexQ;
  return <fieldset className="grid min-w-0 gap-2" data-usual-shift-editor>
    <legend className="text-sm font-bold">{t("schedule.settings.staff.usual_shift")}</legend>
    {suggested && guess ? <p className="text-xs text-co-text-muted">{t("schedule.settings.staff.usual_shift_guess", { name: suggested.name, from: formatQ(guess.value.fromQ ?? suggested.fromQ, language), to: formatQ(guess.value.toQ ?? suggested.toQ, language) })}</p> : null}
    {value && !type ? <p role="status">{t("schedule.settings.staff.usual_shift_deleted", { typeId: value.typeId })}</p> : null}
    {value ? <>
      <SelectField name="usualShift.typeId" label={t("schedule.settings.staff.usual_shift_type")} value={value.typeId}
        options={[...(!type ? [{ value: value.typeId, label: value.typeId }] : []), ...types.map((s) => ({ value: s.id, label: s.name }))]}
        onChange={(typeId) => onChange({ typeId })} />
      <Check label={t("schedule.settings.staff.usual_shift_times")} checked={value.fromQ !== undefined}
        onChange={(on) => onChange(on ? { typeId: value.typeId, fromQ: type?.fromQ ?? 28, toQ: type?.toQ ?? 80 } : { typeId: value.typeId })} />
      {value.fromQ !== undefined ? <>
        <Fields>
          <TimeField name="usualShift.fromQ" label={t("schedule.settings.staff.availability_from")} q={value.fromQ} onChange={(fromQ) => onChange({ typeId: value.typeId, fromQ, toQ: value.toQ! })} />
          {value.toQ !== 96 ? <TimeField name="usualShift.toQ" label={t("schedule.settings.staff.availability_to")} q={value.toQ} onChange={(toQ) => onChange({ typeId: value.typeId, fromQ: value.fromQ!, toQ })} /> : null}
        </Fields>
        <Check label={t("schedule.settings.staff.availability_midnight")} checked={value.toQ === 96} onChange={(on) => onChange({ typeId: value.typeId, fromQ: value.fromQ!, toQ: on ? 96 : 95 })} />
      </> : null}
      {!validUsualShift(value) ? <p role="alert">{t("schedule.settings.staff.availability_time_error")}</p> : null}
      {outside ? <p role="status" className="text-sm text-co-warning-text">{t("schedule.settings.staff.usual_shift_flex")}</p> : null}
      <button type="button" className={GHOST} onClick={() => onChange(null)}>{t("schedule.settings.staff.usual_shift_clear")}</button>
    </> : <button type="button" className={GHOST} onClick={() => onChange(guess?.value ?? { typeId: types[0]!.id })}>{t("schedule.settings.staff.usual_shift_set")}</button>}
  </fieldset>;
}
