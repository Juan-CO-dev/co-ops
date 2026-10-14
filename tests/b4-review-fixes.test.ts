/**
 * B4 review fixes - behaviour tests (not source pins):
 *  1. #16  mid-day reconcile carries the report's TRUE submission time, not "now".
 *  2. #20  START BREAK stays hidden after End my shift even while Toast still says clocked in.
 *  3. #19  a closed station is not shown once the holder ended their shift after the close.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadShiftBoard } from "@/lib/assignments";
import { closedStationFor, showBreakButton, type ShiftBoard } from "@/lib/assignments-shared";
import { coopsShiftEnded, personPresence } from "@/lib/presence-shared";
import { autoCompleteClosingMidDayRef, midDayTickIsStale, pickMidDayReport, reconcileClosingReportRefs } from "@/lib/prep";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignment-taken", () => ({ loadTakenTasks: vi.fn(async () => []) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

// -- 1. mid-day reconcile -----------------------------------------------------------------------
type MdRow = { id: string; triggered_at: string; confirmed_at: string | null };
type Completion = {
  id: string; instance_id: string; template_item_id: string; revoked_at: string | null; superseded_at: string | null;
  superseded_by: string | null; prep_data: Record<string, unknown> | null; auto_complete_meta: Record<string, unknown>;
};
type Head = { id: string; revoked_at: string | null; auto_complete_meta: Record<string, unknown> } | null;
const liveHead = (meta: Record<string, unknown>, id = "head-1"): Head => ({ id, revoked_at: null, auto_complete_meta: meta });

/**
 * Chainable Supabase fake. `checklist_completions` is STATEFUL and ENFORCES the 0196 index
 * (one live row per instance + item + phase kind): an INSERT while a live row shares the key is a 23505,
 * exactly what production does - so insert-before-supersede cannot pass this fake.
 */
function reconcileService(midDayRows: MdRow[], head: Head = null, opts: {
  failInsert?: boolean; failRestore?: boolean;
  /** Runs once, just before this writer's first supersede UPDATE (a concurrent writer moves first). */
  beforeSupersede?: (rows: Completion[]) => void;
  /** Runs once, just before this writer's first INSERT. */
  beforeInsert?: (rows: Completion[]) => void;
} = {}) {
  const completions: Completion[] = head ? [{
    id: head.id, instance_id: "closing-1", template_item_id: "mid-ref-item", revoked_at: head.revoked_at,
    superseded_at: null, superseded_by: null, prep_data: null, auto_complete_meta: head.auto_complete_meta,
  }] : [];
  const calls: string[] = [];
  let seq = 0;
  let hookedSupersede = false;
  let hookedInsert = false;
  const isLive = (c: Completion) => c.superseded_at === null && c.revoked_at === null;
  const phaseKey = (c: Completion) => `${c.instance_id}|${c.template_item_id}|${!!(c.prep_data && "phase2" in c.prep_data)}`;
  const from = (table: string) => {
    const eq = new Map<string, unknown>();
    const filters: Array<(c: Completion) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> = {};
    const matches = () => completions.filter((c) => filters.every((f) => f(c)));
    const run = (): { data?: unknown; error: { message: string; code?: string } | null; count?: number } => {
      if (table !== "checklist_completions") {
        return { data: table === "checklist_instances" ? midDayRows : [], error: null, count: 0 };
      }
      if (op === "insert") {
        calls.push("insert");
        if (opts.beforeInsert && !hookedInsert) { hookedInsert = true; opts.beforeInsert(completions); }
        if (opts.failInsert) return { error: { message: "injected insert failure" } };
        const row: Completion = {
          id: `new-${++seq}`, instance_id: String(payload.instance_id), template_item_id: String(payload.template_item_id),
          revoked_at: null, superseded_at: null, superseded_by: null, prep_data: null,
          auto_complete_meta: payload.auto_complete_meta as Record<string, unknown>,
        };
        if (completions.some((c) => isLive(c) && phaseKey(c) === phaseKey(row))) {
          return { error: { message: 'duplicate key value violates unique constraint "checklist_completions_one_live_head_per_phase"', code: "23505" } };
        }
        completions.push(row);
        return { data: { id: row.id }, error: null };
      }
      if (op === "update") {
        const un = payload.superseded_at === null;
        if (opts.beforeSupersede && !hookedSupersede && !un && !("superseded_by" in payload)) { hookedSupersede = true; opts.beforeSupersede(completions); }
        calls.push(un ? "restore" : "superseded_by" in payload ? "link" : "supersede");
        if (un && opts.failRestore) return { error: { message: "injected restore failure" } };
        const rows = matches();
        // Un-superseding can itself hit the index (a live row now shares the key) - enforce it too.
        if (un && rows.some((r) => completions.some((c) => c !== r && isLive(c) && phaseKey(c) === phaseKey(r)))) {
          return { error: { message: 'duplicate key value violates unique constraint "checklist_completions_one_live_head_per_phase"', code: "23505" } };
        }
        rows.forEach((r) => Object.assign(r, payload));
        return { error: null, count: rows.length };
      }
      return { data: matches()[0] ?? null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, returns: () => q, order: () => q, limit: () => q, in: () => q, lte: () => q, gte: () => q, or: () => q, not: () => q,
      eq: (k: string, v: unknown) => {
        eq.set(k, v);
        filters.push((c) => (c as unknown as Record<string, unknown>)[k] === undefined || (c as unknown as Record<string, unknown>)[k] === v);
        return q;
      },
      is: (k: string, v: unknown) => { filters.push((c) => (c as unknown as Record<string, unknown>)[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push((c) => (c as unknown as Record<string, unknown>)[k] !== v); return q; },
      insert: (row: Record<string, unknown>) => { op = "insert"; payload = row; return q; },
      update: (row: Record<string, unknown>) => { op = "update"; payload = row; return q; },
      maybeSingle: async () => {
        if (table === "checklist_completions" && op === "select") return run();
        if (table === "checklist_completions") return run();
        if (table === "checklist_templates") {
          if (eq.get("type") === "closing") return { data: { id: "closing-tmpl" }, error: null };
          if (eq.get("prep_subtype") === "mid_day_prep") return { data: { id: "mid-tmpl", name: "Mid-day" }, error: null };
          return { data: null, error: null };
        }
        if (table === "checklist_template_items") {
          return { data: eq.get("report_reference_type") === "mid_day_prep" ? { id: "mid-ref-item" } : null, error: null };
        }
        if (table === "checklist_instances") return { data: { id: "closing-1" }, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return q;
  };
  const inserts = { get length() { return calls.filter((c) => c === "insert").length; } };
  return {
    service: { from } as unknown as SupabaseClient,
    completions, calls, inserts,
    live: () => completions.filter(isLive),
  };
}

const reconcile = (service: SupabaseClient) => reconcileClosingReportRefs(service, {
  locationId: "loc", date: "2026-10-11", closingInstanceId: "closing-1", actor: { userId: "u1" } as never,
});
type Meta = { reportType: string; reportSubmittedAt?: string; count: number; reportInstanceId: string };
const newest = (f: ReturnType<typeof reconcileService>) => f.completions.filter((c) => c.id.startsWith("new-")).at(-1);
const metaOf = (c: { auto_complete_meta: Record<string, unknown> } | undefined) => c?.auto_complete_meta as Meta;
const eveningOpen = () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T00:00:00Z")); }; // 8 PM ET
const oldTick = (over: Record<string, unknown> = {}) => liveHead({
  reportType: "mid_day_prep", reportInstanceId: "md-1", reportSubmittedAt: "2026-10-11T23:59:00.000Z", count: 1, ...over,
});

describe("the fake enforces the 0196 live-head index (so insert-before-supersede cannot pass)", () => {
  it("rejects a second live tick for the same instance + item", async () => {
    const f = reconcileService([], oldTick());
    const res = await (f.service.from("checklist_completions") as unknown as {
      insert: (r: unknown) => { select: (c: string) => { maybeSingle: () => Promise<{ error: { code?: string } | null }> } };
    }).insert({ instance_id: "closing-1", template_item_id: "mid-ref-item", auto_complete_meta: {} }).select("id").maybeSingle();
    expect(res.error?.code).toBe("23505");
  });
});

describe("#16 reconcile carries the real mid-day submission time", () => {
  it("uses the confirmed_at of the report, not the moment the closing page was opened", async () => {
    eveningOpen();
    const f = reconcileService([
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:10:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ]);
    expect((await reconcile(f.service)).ticked).toBe(1);
    expect(newest(f)).toMatchObject({ instance_id: "closing-1", template_item_id: "mid-ref-item" });
    expect(metaOf(newest(f))).toMatchObject({ reportType: "mid_day_prep", count: 2, reportInstanceId: "md-2", reportSubmittedAt: "2026-10-11T19:00:00Z" });
  });

  it("out of order: A started first but confirmed last (4 PM) beats B started second, confirmed 3 PM - id and time from the SAME row", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "A", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T20:00:00Z" }, // 4 PM ET
      { id: "B", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }, // 3 PM ET
    ];
    const f = reconcileService(rows);
    await reconcile(f.service);
    expect(metaOf(newest(f)).reportInstanceId).toBe("A");
    expect(metaOf(newest(f)).reportSubmittedAt).toBe("2026-10-11T20:00:00Z");
    expect(pickMidDayReport(rows)).toEqual({ reportInstanceId: "A", reportSubmittedAt: "2026-10-11T20:00:00Z" });
  });

  it("never invents 'now' when no row has confirmed_at: uses the row's own start time, or omits the time", async () => {
    eveningOpen();
    const started = reconcileService([{ id: "md-1", triggered_at: "2026-10-11T19:00:00Z", confirmed_at: null }]);
    await reconcile(started.service);
    expect(metaOf(newest(started)).reportSubmittedAt).toBe("2026-10-11T19:00:00Z");

    const unknown = reconcileService([{ id: "md-1", triggered_at: null as unknown as string, confirmed_at: null }]);
    await reconcile(unknown.service);
    const meta = metaOf(newest(unknown));
    expect(meta.reportInstanceId).toBe("md-1");
    expect("reportSubmittedAt" in meta).toBe(false); // display falls back to the tick's own time
    expect(JSON.stringify(meta)).not.toContain("2026-10-12T00:00:00");
  });

  it("repairs an existing tick written by old code (same count, closing-open time) UNDER the live-head index, then stays idempotent", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const stale = reconcileService(rows, oldTick());
    expect((await reconcile(stale.service)).ticked).toBe(1);
    expect(stale.calls).toEqual(["supersede", "insert", "link"]); // supersede BEFORE insert
    expect(stale.live()).toHaveLength(1);
    const live = stale.live()[0]!;
    expect(live.id).not.toBe("head-1");
    expect(metaOf(live).reportSubmittedAt).toBe("2026-10-11T19:00:00Z");
    const old = stale.completions.find((c) => c.id === "head-1")!;
    expect(old.superseded_at).not.toBeNull();
    expect(old.superseded_by).toBe(live.id);

    // Stored time equal as an INSTANT (different spelling) -> no churn.
    const fresh = reconcileService(rows, oldTick({ reportSubmittedAt: "2026-10-11T19:00:00.000+00:00" }));
    expect((await reconcile(fresh.service)).ticked).toBe(0);
    expect(fresh.calls).toEqual([]);
  });

  it("the count-change path (a second mid-day finalizes) also works under the index", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:00:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ];
    const f = reconcileService(rows, oldTick({ reportSubmittedAt: "2026-10-11T18:00:00Z", count: 1 }));
    expect((await reconcile(f.service)).ticked).toBe(1);
    expect(f.live()).toHaveLength(1);
    expect(metaOf(f.live()[0])).toMatchObject({ count: 2, reportInstanceId: "md-2" });
  });

  it("a revoked (C.55 reopened) head is never re-ticked", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const reopened: Head = { ...oldTick()!, revoked_at: "2026-10-11T23:00:00Z" };
    const f = reconcileService(rows, reopened);
    expect((await reconcile(f.service)).ticked).toBe(0);
    expect(f.calls).toEqual([]);
  });

  it("a failed insert after the supersede is LOUD and restores the prior tick (the line is never left unticked)", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const f = reconcileService(rows, oldTick(), { failInsert: true });
    await expect(reconcile(f.service)).rejects.toThrow(/insert: injected insert failure.*prior tick was restored/);
    expect(f.calls).toEqual(["supersede", "insert", "restore"]);
    expect(f.live().map((c) => c.id)).toEqual(["head-1"]);
    expect(f.live()[0]!.superseded_by).toBeNull();
  });

  it("if the compensating restore ALSO fails, the error says the line is unticked", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const f = reconcileService(rows, oldTick(), { failInsert: true, failRestore: true });
    await expect(reconcile(f.service)).rejects.toThrow(/restoring the superseded prior tick failed.*UNTICKED/);
  });

  it("the finalize-time push (autoCompleteClosingMidDayRef) also supersedes before it inserts", async () => {
    eveningOpen();
    const f = reconcileService([
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:00:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ], oldTick()); // head covers 1 report; two are finalized now
    await autoCompleteClosingMidDayRef(f.service, { locationId: "loc", date: "2026-10-11", midDayInstanceId: "md-2", actor: { userId: "u1" } as never });
    expect(f.calls).toEqual(["supersede", "insert", "link"]);
    expect(f.live()).toHaveLength(1);
    expect(metaOf(f.live()[0]).reportInstanceId).toBe("md-2");
  });


  it("CAS: writer A reads head H, writer B replaces H with count 3, A's swap on H updates 0 rows -> A re-reads, sees count 3 is newer, and writes NOTHING", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:00:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ]; // A's truth: count 2
    const f = reconcileService(rows, oldTick({ reportSubmittedAt: "2026-10-11T18:00:00Z", count: 1 }), {
      beforeSupersede: (all) => {
        all[0]!.superseded_at = "2026-10-11T23:50:00.000Z"; // B superseded H ...
        all.push({ ...all[0]!, id: "B-row", superseded_at: null, superseded_by: null,
          auto_complete_meta: { reportType: "mid_day_prep", reportInstanceId: "md-3", reportSubmittedAt: "2026-10-11T22:00:00Z", count: 3 } }); // ... with count 3
      },
    });
    expect((await reconcile(f.service)).ticked).toBe(0);
    expect(f.calls).toEqual(["supersede"]); // A's CAS attempt only: no insert, no restore, no link
    expect(f.live().map((c) => c.id)).toEqual(["B-row"]);
    expect(metaOf(f.live()[0]).count).toBe(3);
  });

  it("CAS: B replaced H with an OLDER count, so A re-reads and swaps B's row (never H, never both)", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "md-1", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:00:00Z" },
      { id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ];
    const f = reconcileService(rows, oldTick({ count: 1 }), {
      beforeSupersede: (all) => {
        all[0]!.superseded_at = "2026-10-11T23:50:00.000Z";
        all.push({ ...all[0]!, id: "B-row", superseded_at: null, superseded_by: null,
          auto_complete_meta: { reportType: "mid_day_prep", reportInstanceId: "md-1", reportSubmittedAt: "2026-10-11T18:00:00Z", count: 1 } });
      },
    });
    expect((await reconcile(f.service)).ticked).toBe(1);
    expect(f.live()).toHaveLength(1);
    expect(metaOf(f.live()[0])).toMatchObject({ count: 2, reportInstanceId: "md-2" });
    expect(f.completions.find((c) => c.id === "B-row")!.superseded_by).toBe(f.live()[0]!.id);
  });

  it("CAS: two first-ticks racing - the loser's insert is a 23505, it re-reads, and finds the line already true", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const f = reconcileService(rows, null, {
      beforeInsert: (all) => {
        all.push({ id: "B-row", instance_id: "closing-1", template_item_id: "mid-ref-item", revoked_at: null, superseded_at: null,
          superseded_by: null, prep_data: null,
          auto_complete_meta: { reportType: "mid_day_prep", reportInstanceId: "md-1", reportSubmittedAt: "2026-10-11T19:00:00Z", count: 1 } });
      },
    });
    expect((await reconcile(f.service)).ticked).toBe(0);
    expect(f.live().map((c) => c.id)).toEqual(["B-row"]);
  });

  it("the finalize-time push does NOT re-tick over a manager's revoke (same rule as the page-load reconcile)", async () => {
    eveningOpen();
    const f = reconcileService([{ id: "md-2", triggered_at: "2026-10-11T18:30:00Z", confirmed_at: "2026-10-11T19:00:00Z" }],
      { ...oldTick()!, revoked_at: "2026-10-11T23:00:00Z" });
    await autoCompleteClosingMidDayRef(f.service, { locationId: "loc", date: "2026-10-11", midDayInstanceId: "md-2", actor: { userId: "u1" } as never });
    expect(f.calls).toEqual([]);
    expect(f.completions).toHaveLength(1);
    expect(f.live()).toHaveLength(0);
  });

  it("crash between supersede and insert (superseded head, nothing live, not revoked): the next closing load re-inserts the tick", async () => {
    eveningOpen();
    const rows: MdRow[] = [{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];
    const f = reconcileService(rows, oldTick());
    f.completions[0]!.superseded_at = "2026-10-11T23:59:30.000Z"; // the state a crash would leave
    expect(f.live()).toHaveLength(0);
    expect((await reconcile(f.service)).ticked).toBe(1);
    expect(f.calls).toEqual(["insert"]);
    expect(f.live()).toHaveLength(1);
    expect(metaOf(f.live()[0]).reportSubmittedAt).toBe("2026-10-11T19:00:00Z");
  });

  it("A and B both finalize: B's push writes B, then A's DELAYED push computes the same truth (B) and writes nothing", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "A", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:30:00Z" },
      { id: "B", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" },
    ];
    const f = reconcileService(rows, oldTick({ reportInstanceId: "A", reportSubmittedAt: "2026-10-11T18:30:00Z", count: 1 }));
    const push = (id: string) => autoCompleteClosingMidDayRef(f.service, { locationId: "loc", date: "2026-10-11", midDayInstanceId: id, actor: { userId: "u1" } as never });

    await push("B");
    expect(f.live()).toHaveLength(1);
    expect(metaOf(f.live()[0])).toMatchObject({ reportInstanceId: "B", reportSubmittedAt: "2026-10-11T19:00:00Z", count: 2 });
    const before = [...f.calls];
    const headId = f.live()[0]!.id;

    await push("A"); // delayed fire-and-forget for the OTHER report, reading the same two finalized rows
    expect(f.calls).toEqual(before); // no supersede, no insert
    expect(f.live().map((c) => c.id)).toEqual([headId]);
    expect(metaOf(f.live()[0]).reportInstanceId).toBe("B");

    // ...and the page-load reconcile agrees with the push (one definition of the truth).
    expect((await reconcile(f.service)).ticked).toBe(0);
    expect(f.calls).toEqual(before);
  });

  it("MONOTONIC on the FIRST read: A read {A} and paused, B then wrote count 2 / B - A resumes, sees B's live tick, and does NOT regress it", async () => {
    eveningOpen();
    const staleRows: MdRow[] = [{ id: "A", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T18:30:00Z" }]; // what A read
    const bTick = liveHead({ reportType: "mid_day_prep", reportInstanceId: "B", reportSubmittedAt: "2026-10-11T19:00:00Z", count: 2 }, "B-head");
    const push = reconcileService(staleRows, bTick);
    await autoCompleteClosingMidDayRef(push.service, { locationId: "loc", date: "2026-10-11", midDayInstanceId: "A", actor: { userId: "u1" } as never });
    expect(push.calls).toEqual([]); // no supersede, no insert
    expect(push.live().map((c) => c.id)).toEqual(["B-head"]);
    expect(metaOf(push.live()[0])).toMatchObject({ reportInstanceId: "B", count: 2 });

    const reconciled = reconcileService(staleRows, bTick); // the same stale view through the reconcile writer
    expect((await reconcile(reconciled.service)).ticked).toBe(0);
    expect(reconciled.calls).toEqual([]);
  });

  it("equal count, different report: replaced only when OUR report was confirmed strictly later", async () => {
    eveningOpen();
    const head = (id: string, at: string) => liveHead({ reportType: "mid_day_prep", reportInstanceId: id, reportSubmittedAt: at, count: 1 }, "head-x");
    const ours: MdRow[] = [{ id: "A", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }];

    const later = reconcileService(ours, head("B", "2026-10-11T18:00:00Z")); // head's report confirmed earlier -> ours is newer
    expect((await reconcile(later.service)).ticked).toBe(1);
    expect(metaOf(later.live()[0]).reportInstanceId).toBe("A");

    const earlier = reconcileService(ours, head("B", "2026-10-11T20:00:00Z")); // head's report confirmed later -> no write
    expect((await reconcile(earlier.service)).ticked).toBe(0);
    expect(earlier.calls).toEqual([]);

    const same = reconcileService(ours, head("B", "2026-10-11T19:00:00Z")); // not STRICTLY later -> no write
    expect((await reconcile(same.service)).ticked).toBe(0);
    expect(same.calls).toEqual([]);
  });

  it("an old-code tick (different instance, stored time = closing-open) is still repaired: the head's instance is judged by ITS confirmed_at, not the bogus stored time", async () => {
    eveningOpen();
    const rows: MdRow[] = [
      { id: "X", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T18:30:00Z" },
      { id: "Y", triggered_at: "2026-10-11T17:00:00Z", confirmed_at: "2026-10-11T20:00:00Z" }, // started first, confirmed last
    ];
    const f = reconcileService(rows, liveHead({ reportType: "mid_day_prep", reportInstanceId: "X", reportSubmittedAt: "2026-10-11T23:59:00.000Z", count: 2 }));
    expect((await reconcile(f.service)).ticked).toBe(1);
    expect(metaOf(f.live()[0])).toMatchObject({ reportInstanceId: "Y", reportSubmittedAt: "2026-10-11T20:00:00Z", count: 2 });
  });

  it("a first tick (no head) is a plain insert with no supersede", async () => {
    eveningOpen();
    const f = reconcileService([{ id: "md-1", triggered_at: "2026-10-11T18:00:00Z", confirmed_at: "2026-10-11T19:00:00Z" }]);
    await reconcile(f.service);
    expect(f.calls).toEqual(["insert"]);
  });

  it("a head with no stored time is repaired; a wrong stored instance is repaired; an unknown true time never churns", () => {
    expect(midDayTickIsStale({ reportInstanceId: "A" }, { reportInstanceId: "A", reportSubmittedAt: "2026-10-11T19:00:00Z" })).toBe(true);
    expect(midDayTickIsStale({ reportInstanceId: "B", reportSubmittedAt: "2026-10-11T19:00:00Z" }, { reportInstanceId: "A", reportSubmittedAt: "2026-10-11T19:00:00Z" })).toBe(true);
    expect(midDayTickIsStale({ reportInstanceId: "A", reportSubmittedAt: "2026-10-11T23:00:00Z" }, { reportInstanceId: "A", reportSubmittedAt: null })).toBe(false);
    expect(midDayTickIsStale({ reportInstanceId: "A" }, undefined)).toBe(false);
  });
});

// -- 2. START BREAK vs Toast --------------------------------------------------------------------
describe("#20 START BREAK after End my shift while Toast says clocked in", () => {
  const toastOpen = { entries: [{ inAt: "2026-10-12T13:58:00Z", outAt: null }] };
  const coops = (over: Partial<Parameters<typeof personPresence>[1]> = {}) => ({
    stationAt: null, taskAt: null, signedInAt: "2026-10-12T14:00:00Z", endedAt: "2026-10-12T20:00:00Z", shopClosedAt: null, ...over,
  });
  it("Toast outranks CO-OPS in presence, so presence alone says still on shift", () => {
    expect(personPresence(toastOpen, coops()).onShift).toBe(true);
  });
  it("coopsShiftEnded is true after the end, false again once newer activity exists", () => {
    expect(coopsShiftEnded(coops())).toBe(true);
    expect(coopsShiftEnded(coops({ endedAt: null }))).toBe(false);
    expect(coopsShiftEnded(coops({ stationAt: "2026-10-12T20:05:00Z" }))).toBe(false);
    expect(coopsShiftEnded(coops({ taskAt: "2026-10-12T20:05:00Z" }))).toBe(false);
    expect(coopsShiftEnded(coops({ stationAt: "2026-10-12T19:00:00Z" }))).toBe(true);
  });
  it("the combined state (Toast clocked in + ended shift) hides the button", () => {
    const facts = coops();
    const person = { presence: personPresence(toastOpen, facts), shiftEnded: coopsShiftEnded(facts) };
    expect(person.presence.onShift).toBe(true);
    expect(showBreakButton(person, { whosHere: true })).toBe(false);
  });
  it("still offers the break while on shift, and CLAIM-after-end brings it back", () => {
    const facts = coops({ endedAt: null });
    expect(showBreakButton({ presence: personPresence(toastOpen, facts), shiftEnded: coopsShiftEnded(facts) }, { whosHere: true })).toBe(true);
    const reclaimed = coops({ stationAt: "2026-10-12T20:30:00Z" });
    expect(showBreakButton({ presence: personPresence(toastOpen, reclaimed), shiftEnded: coopsShiftEnded(reclaimed) }, { whosHere: true })).toBe(true);
  });
});

// -- 2 + 3 through the real loader --------------------------------------------------------------
const shop = "11111111-1111-4111-8111-111111111111";
const gm = "22222222-2222-4222-8222-222222222222";
const cook = "33333333-3333-4333-8333-333333333333"; // Toast-clocked, holds Slicer
const slicerRelease = {
  id: "e2", sequence: "2", location_id: shop, business_date: "2026-10-12", user_id: cook, station_id: null, position_id: null,
  prior_position_id: "position", kind: "release", actor_id: null, at: "2026-10-12T16:05:00Z", effective_at: "2026-10-12T16:00:00Z",
  source: null, reason_code: "station_closed",
};
function loaderClient(shiftEnds: unknown[]) {
  const rows: Record<string, unknown[]> = {
    users: [{ id: gm, name: "Gina", role: "gm", active: true }, { id: cook, name: "Carl", role: "employee", active: true }],
    user_locations: [{ user_id: gm }, { user_id: cook }],
    stations: [{ id: "slicer", name: "Slicer", name_es: null, sort: 1, active: true, staffed: true, usually_closes_at: null }],
    station_positions: [{ id: "position", station_id: "slicer", name: "Lead", name_es: null, duty: null, duty_es: null, sort: 1, active: true, usually_trims_at: null }],
    station_events: [
      { id: "e1", sequence: "1", location_id: shop, business_date: "2026-10-12", user_id: cook, station_id: "slicer", position_id: "position",
        kind: "assign", actor_id: gm, at: "2026-10-12T14:00:00Z", source: "assigned" },
      slicerRelease,
    ],
    toast_time_entries: [{ user_id: cook, in_at: "2026-10-12T13:58:00Z", out_at: null }],
    shift_ends: shiftEnds,
    sessions: [],
  };
  const rpc = vi.fn(async (name: string) => ({
    data: name === "station_business_date" ? "2026-10-12" : name === "station_closures" ? [{ station_id: "slicer", closed_at: "2026-10-12T16:00:00Z" }] : [],
    error: null,
  }));
  const from = (table: string) => {
    const result = () => ({ data: rows[table] ?? [], error: null });
    const q = {
      select: () => q, order: () => q, not: () => q, gte: () => q, in: () => q, eq: () => q,
      range: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return { from, rpc } as unknown as SupabaseClient;
}
async function board(shiftEnds: unknown[]): Promise<ShiftBoard> {
  vi.stubEnv("WHOS_HERE", "1");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T18:00:00Z"));
  return loadShiftBoard(loaderClient(shiftEnds), { actor: { userId: gm, role: "gm", level: 7, locations: [shop] }, locationId: shop, date: "2026-10-12" });
}
const endedAfterClose = [{ user_id: cook, kind: "ended_shift", at: "2026-10-12T17:00:00Z" }];
const endedBeforeClose = [{ user_id: cook, kind: "ended_shift", at: "2026-10-12T15:00:00Z" }];

describe("the loader feeds both fixes", () => {
  it("#20: Toast-clocked cook who ended shift is onShift in presence but shiftEnded, so no break button", async () => {
    const b = await board(endedAfterClose);
    const cookRow = b.people.find((p) => p.id === cook)!;
    expect(cookRow.presence?.onShift).toBe(true);
    expect(cookRow.shiftEnded).toBe(true);
    expect(cookRow.shiftEndedAt).toBe("2026-10-12T17:00:00Z");
    expect(showBreakButton(cookRow, b)).toBe(false);
  });
  it("#19: the closed station shows after the close, and stops showing once the holder ended their shift", async () => {
    const stillHere = await board([]);
    expect(closedStationFor(stillHere, cook)?.station.id).toBe("slicer");
    expect(showBreakButton(stillHere.people.find((p) => p.id === cook)!, stillHere)).toBe(true);

    const ended = await board(endedAfterClose);
    expect(closedStationFor(ended, cook)).toBeNull();
  });
  it("#19: an end BEFORE the close (older shift) does not hide the closed station", async () => {
    const b = await board(endedBeforeClose);
    expect(closedStationFor(b, cook)?.station.id).toBe("slicer");
  });
});
