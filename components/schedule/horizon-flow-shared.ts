/**
 * THE HORIZON / APPROVE FLOW — pure (Scheduling Phase 2, Task 23). The request a choice makes, when Apply needs the
 * password (Tier B ONLY when an edited week is checked — never silently overwrite, J12), which edited weeks will be
 * skipped, the exact route bodies, and `runGuarded`: the password FIRST, then the post; a cancelled prompt posts
 * nothing and keeps the preview.
 */
import type { HorizonRequest } from "@/lib/scheduling/horizon-shared";

export type HorizonMode = "next_week" | "next_weeks" | "rest_of_month" | "month";
export const HORIZON_MODES: readonly HorizonMode[] = ["next_week", "next_weeks", "rest_of_month", "month"];
export interface HorizonChoice { mode: HorizonMode; n: number; month: string }

export function requestFor(c: HorizonChoice): HorizonRequest {
  switch (c.mode) {
    case "next_week": return { mode: "next_week" };
    case "next_weeks": return { mode: "next_weeks", n: c.n };
    case "rest_of_month": return { mode: "rest_of_month" };
    case "month": return { mode: "month", month: c.month };
  }
}

type PreviewWeeks = { weeks: ReadonlyArray<{ weekStart: string; edited: boolean }> };
/** Tier B only when a CONFIRMED week carries manager edits (the route asserts the same). */
export function applyNeedsStepUp(preview: PreviewWeeks, confirmed: readonly string[]): boolean {
  return preview.weeks.some((w) => w.edited && confirmed.includes(w.weekStart));
}
/** Edited weeks the person did not check: the server skips them and names them. */
export function skippedWeeks(preview: PreviewWeeks, confirmed: readonly string[]): string[] {
  return preview.weeks.filter((w) => w.edited && !confirmed.includes(w.weekStart)).map((w) => w.weekStart);
}

export const previewBody = (locationId: string, request: HorizonRequest) => ({ action: "preview" as const, locationId, request });
export const applyBody = (locationId: string, request: HorizonRequest, token: string, confirmedWeekStarts: readonly string[]) =>
  ({ action: "apply" as const, locationId, request, token, confirmedWeekStarts: [...confirmedWeekStarts] });
export const approveBody = (locationId: string, weekStart: string, expectedHead: string) => ({ action: "approve" as const, locationId, weekStart, expectedHead });

export type PostOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; code: string };
export type Guarded = { kind: "cancelled" } | { kind: "ok"; data: Record<string, unknown> } | { kind: "refused"; code: string };

/**
 * The password (when the tier asks for it) BEFORE the post; a cancelled prompt posts nothing. `requestStepUp` is the
 * caller's own literal-tier prompt (the client tier map pins each component's tier by its literal call).
 */
export async function runGuarded(args: { tier: "B" | "E" | null; requestStepUp: () => Promise<"ok" | "cancelled">; post: () => Promise<PostOutcome> }): Promise<Guarded> {
  if (args.tier) {
    const s = await args.requestStepUp();
    if (s !== "ok") return { kind: "cancelled" };
  }
  const r = await args.post();
  return r.ok ? { kind: "ok", data: r.data } : { kind: "refused", code: r.code };
}

/** The single-week rebuild's exact body (`SCHEDULE_ACTIONS.generate`). */
export const regenerateBody = (locationId: string, weekStart: string, expectedHead: string | null, confirmEdited: boolean) =>
  ({ action: "generate" as const, locationId, weekStart, expectedHead, confirmEdited });

/**
 * The board's main Generate / Regenerate (Astra chunk F P2-3): the SAME confirmation as the horizon flow. A week with
 * manager edits first shows "You edited this week — rebuilding replaces your edits" (`confirm`); then Tier B (the route
 * asserts it for `confirmEdited: true`); only then the post with `confirmEdited: true`. Cancelling either step posts
 * NOTHING. A week without edits posts at once with `confirmEdited: false` (no password: the route asks for none).
 */
export async function runRegenerate(args: {
  edited: boolean;
  confirm: () => Promise<boolean>;
  requestStepUp: () => Promise<"ok" | "cancelled">;
  post: (confirmEdited: boolean) => Promise<PostOutcome>;
}): Promise<Guarded> {
  if (!args.edited) return runGuarded({ tier: null, requestStepUp: args.requestStepUp, post: () => args.post(false) });
  if (!(await args.confirm())) return { kind: "cancelled" };
  return runGuarded({ tier: "B", requestStepUp: args.requestStepUp, post: () => args.post(true) });
}
