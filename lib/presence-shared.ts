/**
 * Who's actually here — PURE (client-safe, zero I/O). Juan 2026-10-08: "managers don't usually clock
 * in". Toast has no schedules (CC probe: /labor/v1/shifts = 0 rows), so a person is ON SHIFT today
 * at a shop when EITHER
 *   1. they have an OPEN Toast time entry (linked through toast_employee_links), or
 *   2. they have NO Toast entry today and are active in CO-OPS at that shop: signed in, holding a
 *      station, or holding a task — and that activity is newer than their last "End my shift" and
 *      the shop's close.
 * A CLOSED Toast entry (clocked out, none open) means off shift: Toast is the clock when it has one.
 *
 * SEAM for a future 7shifts "scheduled" source: each source contributes one PresenceEvidence; the
 * resolver picks by PRESENCE_PRECEDENCE. Adding 7shifts = one more PresenceSource member, one more
 * precedence slot, one evidence builder in the loader. Nothing else here changes.
 */

export type PresenceSource = "toast_clock" | "coops_activity";
/** Highest first: a clock beats an inference. */
export const PRESENCE_PRECEDENCE: readonly PresenceSource[] = ["toast_clock", "coops_activity"];

export type ActivityKind = "station" | "task" | "signed_in";
export type OffShiftReason = "clocked_out" | "ended_shift" | "shop_closed";

export interface PresenceEvidence {
  source: PresenceSource;
  onShift: boolean;
  /** When the evidence starts (clock-in instant, or the newest CO-OPS activity). */
  since: string | null;
  activity?: ActivityKind;
}

export interface PresenceView {
  onShift: boolean;
  source: PresenceSource | null;
  since: string | null;
  activity?: ActivityKind;
  /** Why someone seen today is no longer on shift (and when). */
  off?: { reason: OffShiftReason; at: string };
}

export interface ToastDayFacts {
  /** Non-deleted entries today, already filtered to this person + shop. */
  entries: ReadonlyArray<{ inAt: string; outAt: string | null }>;
}

export interface CoopsDayFacts {
  /** Instants of today's activity at this shop; null when there is none of that kind. */
  stationAt: string | null;
  taskAt: string | null;
  /** The sign-in (session created_at) whose activity reached today; single-shop members only. */
  signedInAt: string | null;
  /** The person's last "End my shift" today (any actor). */
  endedAt: string | null;
  /** The shop's close marker for the day, when the closing was finalized. */
  shopClosedAt: string | null;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
const later = (a: string | null, b: string | null) => (ms(a) >= ms(b) ? a : b);

/** Toast evidence: null when the person has no Toast entry today (the CO-OPS rule then applies). */
export function toastEvidence(facts: ToastDayFacts): PresenceEvidence | null {
  if (facts.entries.length === 0) return null;
  const open = facts.entries.filter((e) => e.outAt === null).sort((a, b) => ms(b.inAt) - ms(a.inAt))[0];
  if (open) return { source: "toast_clock", onShift: true, since: open.inAt };
  return { source: "toast_clock", onShift: false, since: null };
}

/** CO-OPS evidence: the newest activity counts only when it is newer than an end and the close. */
export function coopsEvidence(facts: CoopsDayFacts): PresenceEvidence | null {
  const kinds: Array<[ActivityKind, string | null]> = [["station", facts.stationAt], ["task", facts.taskAt], ["signed_in", facts.signedInAt]];
  const seen = kinds.filter(([, at]) => at !== null).sort((a, b) => ms(b[1]) - ms(a[1]));
  if (seen.length === 0) return null;
  // Ending a shift and closing the shop release every hold, so only NEWER activity is evidence.
  const cutoff = later(facts.endedAt, facts.shopClosedAt);
  const top = seen.find(([, at]) => ms(at) > ms(cutoff));
  if (!top) return { source: "coops_activity", onShift: false, since: null };
  return { source: "coops_activity", onShift: true, since: top[1], activity: top[0] };
}

/** Pick the first evidence by precedence; the Toast clock, when present, decides alone. */
export function resolvePresence(evidence: ReadonlyArray<PresenceEvidence | null>, ctx: {
  lastOutAt?: string | null; endedAt?: string | null; shopClosedAt?: string | null;
}): PresenceView {
  const present = evidence.filter((e): e is PresenceEvidence => e !== null);
  for (const source of PRESENCE_PRECEDENCE) {
    const e = present.find((x) => x.source === source);
    if (!e) continue;
    if (e.onShift) return { onShift: true, source: e.source, since: e.since, ...(e.activity ? { activity: e.activity } : {}) };
    return { onShift: false, source: e.source, since: null, off: offReason(e.source, ctx) };
  }
  return { onShift: false, source: null, since: null };
}

function offReason(source: PresenceSource, ctx: { lastOutAt?: string | null; endedAt?: string | null; shopClosedAt?: string | null }): PresenceView["off"] {
  if (source === "toast_clock" && ctx.lastOutAt) return { reason: "clocked_out", at: ctx.lastOutAt };
  const ended = ctx.endedAt ?? null; const closed = ctx.shopClosedAt ?? null;
  if (ended && ms(ended) >= ms(closed)) return { reason: "ended_shift", at: ended };
  if (closed) return { reason: "shop_closed", at: closed };
  return undefined;
}

/** One person's presence from both sources (the loader's single entry point). */
export function personPresence(toast: ToastDayFacts, coops: CoopsDayFacts): PresenceView {
  const lastOutAt = toast.entries.filter((e) => e.outAt).map((e) => e.outAt!).sort((a, b) => ms(b) - ms(a))[0] ?? null;
  return resolvePresence([toastEvidence(toast), coopsEvidence(coops)], { lastOutAt, endedAt: coops.endedAt, shopClosedAt: coops.shopClosedAt });
}
