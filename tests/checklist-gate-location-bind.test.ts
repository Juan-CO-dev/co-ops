import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateInstance } from "@/lib/checklists";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("Unexpected service I/O"); }) }));

it("LRA-227: foreign locations are denied before any read, including the service gate evaluator", async () => {
  const from = vi.fn(() => { throw new Error("Unexpected user I/O"); });
  await expect(getOrCreateInstance({ from } as unknown as SupabaseClient, {
    templateId: "template", locationId: "foreign", date: "2026-09-10",
    actor: { userId: "actor", role: "gm", level: 7, locations: ["own"] },
  })).rejects.toMatchObject({ name: "ChecklistRoleViolationError", code: "role_level_insufficient" });
  expect(from).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("LRA-227: own-shop GMs and all-location owners reach the existing read", async () => {
  for (const [role, level, locations] of [["gm", 7, ["own"]], ["owner", 10, []]] as const) {
    const from = vi.fn(() => { throw new Error("Reached authorized read"); });
    await expect(getOrCreateInstance({ from } as unknown as SupabaseClient, {
      templateId: "template", locationId: "own", date: "2026-09-10",
      actor: { userId: "actor", role, level, locations: [...locations] },
    })).rejects.toThrow("Reached authorized read");
    expect(from).toHaveBeenCalledOnce();
  }
});

it("trainees can read an existing closing but cannot create one", async () => {
  const actor = { userId: "actor", role: "trainee" as const, level: 2, locations: ["own"] };
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const service = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const args = { templateId: "template", locationId: "own", date: "2026-10-07", actor };
  await expect(getOrCreateInstance(service, args)).rejects.toMatchObject({ code: "role_level_insufficient" });
  query.maybeSingle.mockResolvedValue({ data: { id: "existing" } as never, error: null });
  await expect(getOrCreateInstance(service, args)).resolves.toMatchObject({ created: false, instance: { id: "existing" } });
});
