/**
 * W15/B086 + B084 — "which checklist did this shop run on this day", INSTANCE FIRST.
 *
 * Pages used to resolve the template EFFECTIVE on the date (active versions only) and then
 * look the instance up by that template id. Once the version that served a day is retired
 * (a later publish, or an apply-now publish retiring yesterday's version at once), the day's
 * instance was unreachable: the closing page showed "no template" for a closing that exists,
 * and the opening's "yesterday's closing" check said there was none. And an apply-now publish
 * landing between a closer's first open and their refresh made the page create a SECOND
 * closing on the new version, stranding the first one's ticks.
 *
 * The rule now: when an instance exists for (shop, type, date) on ANY version — active or
 * retired — the page uses it and its own template_id. Effective resolution is only for
 * creating today's instance. Server-only by use (takes the caller's client); the pick is pure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DayInstanceCandidate {
  id: string;
  template_id: string;
  status: string;
  created_at: string | null;
}

/** PostgREST's response cap: the template read pages at it. */
const TEMPLATE_PAGE = 1000;

/** Statuses that are still being worked; anything else is a finished (confirmed / finalized) day. */
const IN_PROGRESS = new Set(["open", "phase1_complete"]);

/**
 * One instance per (shop, type, day) is the rule (0320's guard enforces it for new rows);
 * legacy duplicate pairs (a B084 strand) are decided deterministically: a finished one
 * first, then the oldest created, then the lowest id. Pure.
 */
export function pickDayInstance<T extends DayInstanceCandidate>(rows: readonly T[]): T | null {
  const sorted = [...rows].sort((a, b) =>
    Number(IN_PROGRESS.has(a.status)) - Number(IN_PROGRESS.has(b.status))
    || (a.created_at ?? "").localeCompare(b.created_at ?? "")
    || a.id.localeCompare(b.id));
  return sorted[0] ?? null;
}

/**
 * The day's one-per-day instance of `type` at the shop, on any version of the shop's lists of
 * that type (active or retired). Two reads (the template read paged at 1000, the instance read chunked by 100 ids), no embed. `columns` must include
 * id, template_id, status, created_at.
 *
 * `fresh`: the re-read after a lost create race (`checklist_instance_lineage_taken`). Inside a server render Next
 * memoizes identical GET fetches, so the same lookup repeated in one render replays the FIRST answer (empty) and never
 * sees the winner; `fresh` gives every read its own AbortController signal, the documented opt-out.
 */
export async function findDayInstance<T extends DayInstanceCandidate>(
  sb: SupabaseClient,
  args: { locationId: string; type: "opening" | "closing"; date: string; columns: string; fresh?: boolean },
): Promise<T | null> {
  // Only the race re-read opts out; every ordinary lookup stays exactly as it was.
  const fresh = <Q extends { abortSignal(signal: AbortSignal): Q }>(q: Q): Q => (args.fresh ? q.abortSignal(new AbortController().signal) : q);
  // W15 round 1: every version, paged in a stable order — a shop past 1000 versions of a list would
  // otherwise lose the newest (or any) version's instance behind the response cap.
  const ids: string[] = [];
  for (let from = 0; ; from += TEMPLATE_PAGE) {
    const { data: tpls, error: tErr } = await fresh(sb
      .from("checklist_templates")
      .select("id")
      .eq("location_id", args.locationId)
      .eq("type", args.type)
      .order("id", { ascending: true })
      .range(from, from + TEMPLATE_PAGE - 1))
      .returns<Array<{ id: string }>>();
    if (tErr) throw new Error(`findDayInstance templates: ${tErr.message}`);
    const page = tpls ?? [];
    ids.push(...page.map((t) => t.id));
    if (page.length < TEMPLATE_PAGE) break;
  }
  if (ids.length === 0) return null;
  // Versions accumulate over the years: chunk the id list so the request line stays bounded.
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: iErr } = await fresh(sb
      .from("checklist_instances")
      .select(args.columns)
      .in("template_id", ids.slice(i, i + 100))
      .eq("location_id", args.locationId)
      .eq("date", args.date)
      .eq("allows_multiple_per_day", false))
      .returns<T[]>();
    if (iErr) throw new Error(`findDayInstance instances: ${iErr.message}`);
    rows.push(...(data ?? []));
  }
  return pickDayInstance(rows);
}
