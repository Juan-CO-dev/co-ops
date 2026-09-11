/** Pure heartbeat decisions. Nights pause a pinger's clock; days/dedupe use Eastern time. */
import type { RegisteredJob } from "./jobs-registry";

const MINUTE = 60_000;
const DAY = 86_400_000;
const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function parts(at: Date) {
  return Object.fromEntries(eastern.formatToParts(at).map(({ type, value }) => [type, value]));
}

export function easternDay(at: Date): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Registry boundaries (00:00, 06:00, 22:00) are unambiguous even on DST transition days. */
export function easternBoundary(day: string, hour: number): Date {
  const target = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += target - wall;
  }
  return new Date(instant);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** Add active minutes rather than wall-clock minutes, carrying unused grace across nights. */
function deadline(job: RegisteredJob, last: Date): Date {
  let remaining = 2 * job.cadenceMinutes * MINUTE;
  if (!job.window) return new Date(last.getTime() + remaining);
  let day = easternDay(last);
  let cursor = last.getTime();
  while (true) {
    const start = easternBoundary(day, job.window.startHourET).getTime();
    const end = easternBoundary(day, job.window.endHourET).getTime();
    cursor = Math.max(cursor, start);
    const available = Math.max(0, end - cursor);
    if (remaining < available) return new Date(cursor + remaining);
    if (remaining === available) return easternBoundary(nextDay(day), job.window.startHourET);
    remaining -= available;
    day = nextDay(day);
    cursor = easternBoundary(day, job.window.startHourET).getTime();
  }
}

export function decideJobWatch(
  job: RegisteredJob,
  now: Date,
  lastSuccessAt: string | null,
  lastAlertAt: string | null,
): { silent: boolean; shouldAlert: boolean; expectedBy: string } {
  const day = easternDay(now);
  // No history: allow the opening grace for pingers; daily jobs have already missed a heartbeat.
  const expected = lastSuccessAt
    ? deadline(job, new Date(lastSuccessAt))
    : job.window
      ? deadline(job, easternBoundary(day, job.window.startHourET))
      : easternBoundary(day, 0);
  const inWindow = !job.window || (
    now >= easternBoundary(day, job.window.startHourET) &&
    now < easternBoundary(day, job.window.endHourET)
  );
  const silent = inWindow && now.getTime() > expected.getTime();
  const alreadyAlerted = lastAlertAt !== null && easternDay(new Date(lastAlertAt)) === day;
  return { silent, shouldAlert: silent && !alreadyAlerted, expectedBy: expected.toISOString() };
}
