/**
 * Audit W22/B205 — an LTO event and its items are created together (0329 create_lto_event). A bad item ref is
 * a 400 invalid_item_ref, not a 500 with a live, item-less offer left behind. Before 0329 is applied, the
 * previous two inserts run and the half-made event is CANCELLED when its items fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLtoEvent, LtoError, type CreateLtoEventInput } from "@/lib/catering/lto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeCall, type FakeRpc } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/catering/lto-pos-push", () => ({ pushLtoToPos: vi.fn(async () => ({ status: "not_pushed" })) }));

const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["X"] } as unknown as AuthContext;
const input: CreateLtoEventInput = {
  locationId: "X", kind: "discount", name: "Test", discountBps: 1000, promoPriceCents: null,
  startsOn: "2026-11-14", endsOn: "2026-11-16", note: null,
  items: [{ itemId: "00000000-0000-0000-0000-000000000000", menuItemId: null, nameSnapshot: "Ghost", qty: 1, sourcePipelineId: null }],
};

let calls: FakeCall[];
let rpcs: FakeRpc[];
let rpcAnswer: { data?: unknown; error?: unknown };
let itemsError: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  rpcAnswer = { data: "EV1" };
  itemsError = null;
  const fake = fakeSupabase((call) => {
    if (call.table === "locations") return { data: { id: "X" } };
    if (call.table === "lto_events" && call.kind === "insert") return { data: { id: "EV-legacy" } };
    if (call.table === "lto_event_items") return { error: itemsError };
    return { data: null };
  }, () => rpcAnswer);
  calls = fake.calls;
  rpcs = fake.rpcs;
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe("B205: createLtoEvent is all or nothing", () => {
  it("calls create_lto_event with the event and items, never a bare event insert", async () => {
    expect(await createLtoEvent(actor, input)).toEqual({ id: "EV1" });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]!.name).toBe("create_lto_event");
    expect(rpcs[0]!.args).toMatchObject({
      p_actor_id: "mgr",
      p_event: { location_id: "X", kind: "discount", name: "Test", discount_bps: 1000, starts_on: "2026-11-14", ends_on: "2026-11-16" },
      p_items: [{ item_id: "00000000-0000-0000-0000-000000000000", menu_item_id: null, name_snapshot: "Ghost", qty: 1, source_pipeline_id: null }],
    });
    expect(calls.some((c) => c.table === "lto_events" && c.kind === "insert")).toBe(false);
  });

  it.each(["23503", "22P02"])("maps %s to 400 invalid_item_ref", async (code) => {
    rpcAnswer = { error: { code, message: "violates foreign key constraint" } };
    const err = await createLtoEvent(actor, input).catch((e) => e);
    expect(err).toBeInstanceOf(LtoError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_item_ref");
  });

  it("maps the SQL actor re-check to 403", async () => {
    rpcAnswer = { error: { code: "P0001", message: "lto_forbidden" } };
    const err = await createLtoEvent(actor, input).catch((e) => e);
    expect(err.status).toBe(403);
  });

  it("before 0329: an item failure cancels the just-made event (no live offer with zero items)", async () => {
    rpcAnswer = { error: { code: "PGRST202", message: "Could not find the function" } };
    itemsError = { code: "23503", message: "violates foreign key constraint" };
    const err = await createLtoEvent(actor, input).catch((e) => e);
    expect(err.code).toBe("invalid_item_ref");
    const cancel = calls.find((c) => c.table === "lto_events" && c.kind === "update")!;
    expect((cancel.arg("update") as Record<string, unknown>).status).toBe("cancelled");
    expect(cancel.has("eq", "id", "EV-legacy")).toBe(true);
  });
});
