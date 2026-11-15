import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

/**
 * Audit W04/B047: two managers resolving one credit at once. Both read status 'open'; the
 * UPDATE must compare-and-set on what was read, so the loser gets 409 instead of
 * overwriting the winner's outcome and notes.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ row: null as Row | null, staleRead: null as Row | null, updates: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    from() {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Row) => { patch = p; return q; },
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
        maybeSingle: async () => {
          // The next read may be served a stale snapshot ONCE (the race window).
          const snapshot = state.staleRead ?? state.row;
          state.staleRead = null;
          return { data: snapshot && filters.every((f) => f(snapshot)) ? { ...snapshot } : null, error: null };
        },
        then: (resolve: (x: unknown) => unknown) => {
          let count = 0;
          if (patch && state.row && filters.every((f) => f(state.row!))) { Object.assign(state.row, patch); count = 1; state.updates++; }
          return Promise.resolve({ error: null, count }).then(resolve);
        },
      };
      return q;
    },
  }),
}));

import { resolveCredit } from "@/lib/credits";

const actor = (id: string) => ({ user: { id, role: "gm" }, locations: ["L"] }) as unknown as AuthContext;

beforeEach(() => {
  state.row = { id: "X", location_id: "L", status: "open", notes: null };
  state.staleRead = null;
  state.updates = 0;
});

describe("W04/B047 concurrent credit resolution", () => {
  it("the second resolver, holding a stale 'open' read, gets 409 and the first outcome stands", async () => {
    await resolveCredit(actor("A"), "X", "resolved_refund", "vendor refunding $42");
    state.staleRead = { id: "X", location_id: "L", status: "open", notes: null };
    await expect(resolveCredit(actor("B"), "X", "written_off", "eat it")).rejects.toMatchObject({ status: 409, code: "already_resolved" });
    expect(state.row).toMatchObject({ status: "resolved_refund", notes: "vendor refunding $42" });
    expect(state.updates).toBe(1);
  });

  it("a notes change between read and write is refused too (no clobbered notes)", async () => {
    state.staleRead = { id: "X", location_id: "L", status: "open", notes: null };
    state.row!.notes = "called the rep";
    await expect(resolveCredit(actor("B"), "X", "written_off", "eat it")).rejects.toMatchObject({ status: 409 });
    expect(state.row).toMatchObject({ status: "open", notes: "called the rep" });
  });

  it("a credit that vanished is 404", async () => {
    state.staleRead = { id: "X", location_id: "L", status: "open", notes: null };
    state.row = null;
    await expect(resolveCredit(actor("B"), "X", "written_off", null)).rejects.toMatchObject({ status: 404 });
  });

  it("an uncontested resolve still works and appends notes", async () => {
    state.row!.notes = "first";
    await resolveCredit(actor("A"), "X", "resolved_credit", "second");
    expect(state.row).toMatchObject({ status: "resolved_credit", notes: "first\nsecond" });
  });
});
