import { etCalendarDate, etClockTime } from "@/lib/operational-day";
import type { PunchEntry } from "./people-input-shared";
import type { ShiftType } from "./structure-shared";
import { addDays, isoWeekStart } from "./time-shared";

/** Shape only: resolving a saved type against the shop belongs to the input layer. */
export type UsualShift =
  | { typeId: string; fromQ?: never; toQ?: never }
  | { typeId: string; fromQ: number; toQ: number };

/** Null means no manager override. SQL rejects JSON null but accepts SQL NULL. */
export function validUsualShift(value: unknown): value is UsualShift | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shift = value as Record<string, unknown>;
  if (!Object.hasOwn(shift, "typeId") || typeof shift.typeId !== "string"
    || Object.keys(shift).some((key) => !["typeId", "fromQ", "toQ"].includes(key))) return false;
  const from = Object.hasOwn(shift, "fromQ"), to = Object.hasOwn(shift, "toQ");
  if (from !== to) return false;
  return !from || (typeof shift.fromQ === "number" && typeof shift.toQ === "number"
    && Number.isInteger(shift.fromQ) && Number.isInteger(shift.toQ)
    && shift.fromQ >= 0 && shift.toQ <= 96 && shift.fromQ < shift.toQ);
}

export interface UsualShiftGuess { value: UsualShift; sampleDays: number; observedWeeks: number }
export interface ResolvedUsualShift { value: UsualShift | null; source: "manager" | "toast" | "none"; deletedTypeId: string | null }

/** Completed paired days only; medians use ET wall minutes before rounding to the quarter grid. */
export function guessUsualShift(entries: readonly PunchEntry[], args: {
  userId: string; asOf: string; shiftTypes: readonly ShiftType[]; weeks?: number;
}): UsualShiftGuess | null {
  if (!args.shiftTypes.length) return null;
  const end = isoWeekStart(args.asOf), start = addDays(end, -7 * (args.weeks ?? 8));
  const days = new Map<string, { from: number; to: number }>();
  const wall = (iso: string, date: string) => {
    const [h, m] = etClockTime(iso).split(":").map(Number);
    const offset = Math.round((Date.parse(etCalendarDate(iso)) - Date.parse(date)) / 86400000);
    return Math.max(0, Math.min(1440, offset * 1440 + h! * 60 + m!));
  };
  for (const e of entries) {
    if (e.deleted || e.userId !== args.userId || !e.outAt || e.businessDate < start || e.businessDate >= end
      || !Number.isFinite(Date.parse(e.inAt)) || !Number.isFinite(Date.parse(e.outAt)) || Date.parse(e.outAt) <= Date.parse(e.inAt)) continue;
    const from = wall(e.inAt, e.businessDate), to = wall(e.outAt, e.businessDate);
    if (to <= from) continue;
    const prior = days.get(e.businessDate);
    days.set(e.businessDate, { from: Math.min(prior?.from ?? from, from), to: Math.max(prior?.to ?? to, to) });
  }
  const observedWeeks = new Set([...days.keys()].map(isoWeekStart)).size;
  if (observedWeeks < 3) return null;
  const medianQ = (values: number[]) => {
    values.sort((a, b) => a - b);
    const i = Math.floor(values.length / 2);
    return Math.round((values.length % 2 ? values[i]! : (values[i - 1]! + values[i]!) / 2) / 15);
  };
  const fromQ = medianQ([...days.values()].map((v) => v.from)), toQ = medianQ([...days.values()].map((v) => v.to));
  if (fromQ >= toQ) return null;
  const overlap = (t: ShiftType) => Math.max(0, Math.min(toQ, t.toQ) - Math.max(fromQ, t.fromQ));
  const distance = (t: ShiftType) => Math.abs(fromQ - t.fromQ) + Math.abs(toQ - t.toQ);
  const match = [...args.shiftTypes].sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  return match && overlap(match) > 0 ? { value: { typeId: match.id, fromQ, toQ }, sampleDays: days.size, observedWeeks } : null;
}

export function resolveUsualShift(saved: UsualShift | null, guess: UsualShiftGuess | null, types: readonly ShiftType[]): ResolvedUsualShift {
  const exists = (id: string) => types.some((t) => t.id === id);
  if (saved && exists(saved.typeId)) return { value: saved, source: "manager", deletedTypeId: null };
  const value = guess && exists(guess.value.typeId) ? guess.value : null;
  return { value, source: value ? "toast" : "none", deletedTypeId: saved?.typeId ?? null };
}
