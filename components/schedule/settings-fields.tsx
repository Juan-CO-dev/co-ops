"use client";
/**
 * Small form fields for the schedule settings editors (admin-form grammar: rounded-lg, 44 px, border-co-border; a
 * checkbox keeps its 20 px box inside a 44 px label). Display strings arrive translated.
 */
import type { ReactNode } from "react";
import { qToTime, timeToQ } from "@/lib/scheduling/settings-view-shared";

const LABEL = "grid min-w-0 gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const INPUT = "min-h-[44px] w-full min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm font-normal tracking-normal text-co-text";

export function NumField({ label, name, value, onChange, step = 1, min = 0, max }: {
  label: string; name: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <label className={LABEL}>
      {label}
      <input type="number" inputMode="decimal" name={name} className={INPUT} step={step} min={min} max={max} value={value === null ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </label>
  );
}

export function TimeField({ label, name, q, onChange }: { label: string; name: string; q: number; onChange: (q: number) => void }) {
  return (
    <label className={LABEL}>
      {label}
      <input type="time" step={900} name={name} className={INPUT} value={qToTime(q)} onChange={(e) => { const v = timeToQ(e.target.value); if (v !== null) onChange(v); }} />
    </label>
  );
}

export function SelectField({ label, name, value, onChange, options }: {
  label: string; name: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className={LABEL}>
      {label}
      <select name={name} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange, name, data }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; name?: string; data?: Record<string, string> }) {
  return (
    <label {...data} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-co-text">
      <input type="checkbox" name={name} className="h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A grid of fields that wraps to one column at 375 px. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export const BUTTON = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold tracking-[0.1em] text-co-text disabled:opacity-60";
export const GHOST = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm font-bold tracking-[0.1em] text-co-text disabled:opacity-60";
