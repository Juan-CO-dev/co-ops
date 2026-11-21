import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDayInstance } from "@/lib/checklist-day-instance";

// A lost create race re-reads the day in the SAME render; Next memoizes identical GETs there, so the re-read must
// carry its own AbortController signal (`fresh`) or it replays the first, empty answer.
function client() {
  const signals: Array<{ table: string; signalled: boolean }> = [];
  const from = (table: string) => {
    let signalled = false;
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
      abortSignal: (s: unknown) => { signalled = s instanceof AbortSignal; return q; },
      returns: async () => {
        signals.push({ table, signalled });
        return table === "checklist_templates"
          ? { data: [{ id: "tpl-1" }], error: null }
          : { data: [{ id: "inst-1", template_id: "tpl-1", status: "open", created_at: "2026-11-20T01:00:00Z" }], error: null };
      },
    };
    return q;
  };
  return { sb: { from } as unknown as SupabaseClient, signals };
}

const args = { locationId: "shop-1", type: "closing" as const, date: "2026-11-20", columns: "id, template_id, status, created_at" };

describe("findDayInstance fresh re-read", () => {
  it("an ordinary lookup passes no signal (unchanged)", async () => {
    const db = client();
    await expect(findDayInstance(db.sb, args)).resolves.toMatchObject({ id: "inst-1" });
    expect(db.signals).toEqual([{ table: "checklist_templates", signalled: false }, { table: "checklist_instances", signalled: false }]);
  });

  it("fresh gives every read its own signal, opting out of render memoization", async () => {
    const db = client();
    await expect(findDayInstance(db.sb, { ...args, fresh: true })).resolves.toMatchObject({ id: "inst-1" });
    expect(db.signals).toEqual([{ table: "checklist_templates", signalled: true }, { table: "checklist_instances", signalled: true }]);
  });
});
