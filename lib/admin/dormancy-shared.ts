/** Display-only inactivity; a clock-in never changes login authorization. */
export const DORMANT_WINDOW_DAYS = 182;
export const DORMANT_WINDOW_MS = DORMANT_WINDOW_DAYS * 86_400_000;
export type UserDormancy = { dormant: false } | {
  dormant: true; reason: "deactivated" | "manual" | "no_clock_in"; since: string | null;
};

const instant = (value: string | null): number => value ? Date.parse(value) : NaN;

export function userDormancy(input: {
  level: number; active: boolean; createdAt: string | null; dormantAt: string | null;
  lastClockInAt: string | null; now: number;
}): UserDormancy {
  if (!input.active) return { dormant: true, reason: "deactivated", since: null };
  const last = instant(input.lastClockInAt), marked = instant(input.dormantAt), created = instant(input.createdAt);
  if (Number.isFinite(marked) && !(last > marked)) {
    return { dormant: true, reason: "manual", since: input.dormantAt };
  }
  // Missing creation history is not evidence that a new/unlinked hire is long gone.
  const latest = Math.max(Number.isFinite(last) ? last : -Infinity, Number.isFinite(created) ? created : -Infinity);
  if (input.level <= 5 && Number.isFinite(latest) && latest < input.now - DORMANT_WINDOW_MS) {
    return { dormant: true, reason: "no_clock_in", since: new Date(latest).toISOString() };
  }
  return { dormant: false };
}

export function employeeNotSeen(input: { deleted: boolean; lastClockInAt: string | null; now: number }): boolean {
  return input.deleted || !(instant(input.lastClockInAt) >= input.now - DORMANT_WINDOW_MS);
}
