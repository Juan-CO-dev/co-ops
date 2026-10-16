/**
 * Scheduling Phase 1, Task 12 — the public profile on the same layer.
 *
 * `loadProfileFacts` reads the card's company-wide facts (the target's live completions, MVP count
 * and PM v1 gradients across every shop — the card's existing scope), and the pure `publicProfile`
 * computes the numbers. `loadPublicProfile` keeps the visibility gate, the leadership contact rule
 * and the blurb rule in the wrapper. Needs-work grades are never returned.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { loadProfileFacts } from "@/lib/people/facts";
import { publicProfileNumbers } from "@/lib/people/performance-shared";

const EMP = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

describe("publicProfileNumbers (pure)", () => {
  it("tasks, streaks, a 30-day velocity, positive gradients only, MVP wins, tenure", () => {
    const n = publicProfileNumbers({
      completions: [
        { completed_at: "2026-10-12T15:00:00.000Z" }, { completed_at: "2026-10-13T15:00:00.000Z" },
        { completed_at: "2026-10-14T15:00:00.000Z" }, { completed_at: "2026-10-14T16:00:00.000Z" },
      ],
      mvpCount: 2,
      grades: [{ arrived_ready: "great", attitude: "good", production: "needs_work", team_player: "great" }],
    }, { createdAt: "2026-10-04T00:00:00Z", today: "2026-10-14" });
    expect(n.tasksAllTime).toBe(4);
    expect(n.streaks).toEqual({ current: 3, longest: 3, personalBest: 2 });
    expect(n.velocity).toHaveLength(30);
    expect(n.velocity.slice(-3)).toEqual([1, 1, 2]);
    expect(n.gradient).toEqual({ great: 2, good: 1 });
    expect(n.mvpWins).toBe(2);
    expect(n.tenureDays).toBe(10);
    expect(JSON.stringify(n)).not.toMatch(/needs/i);
  });
});

describe("loadProfileFacts — the card's company-wide facts, read-only", () => {
  it("reads the target's live completions, MVP count and live grades across every shop", async () => {
    const db = createFakeDb({
      checklist_completions: [
        { id: "c1", completed_by: EMP, completed_at: "2026-10-14T15:00:00.000Z", superseded_at: null, revoked_at: null },
        { id: "c2", completed_by: EMP, completed_at: "2026-10-13T15:00:00.000Z", superseded_at: "2026-10-13T16:00:00.000Z", revoked_at: null },
        { id: "c3", completed_by: OTHER, completed_at: "2026-10-14T15:00:00.000Z", superseded_at: null, revoked_at: null },
      ],
      pm_reports: [
        { id: "r1", mvp_user_id: EMP, superseded_at: null }, { id: "r2", mvp_user_id: EMP, superseded_at: "2026-10-01T00:00:00Z" },
      ],
      pm_employee_evals: [
        { id: "e1", pm_report_id: "r1", employee_id: EMP, arrived_ready: "great", attitude: "good", production: "good", team_player: "great", superseded_at: null },
        { id: "e2", pm_report_id: "r1", employee_id: EMP, arrived_ready: "good", attitude: "good", production: "good", team_player: "good", superseded_at: "2026-10-02T00:00:00Z" },
      ],
    });
    const f = await loadProfileFacts(db.client as unknown as SupabaseClient, EMP);
    expect(f.completions).toEqual([{ completed_at: "2026-10-14T15:00:00.000Z" }]);
    expect(f.mvpCount).toBe(1);
    expect(f.grades).toHaveLength(1);
    expect(db.writes).toEqual([]);
  });
});
