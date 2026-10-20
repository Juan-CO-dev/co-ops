import { checklistActor } from "./helpers/checklist-actor";
import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateInstance } from "@/lib/checklists";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("Unexpected service I/O"); }) }));

it("LRA-227: foreign locations are denied before any read, including the service gate evaluator", async () => {
  const from = vi.fn(() => { throw new Error("Unexpected user I/O"); });
  await expect(getOrCreateInstance({ from } as unknown as SupabaseClient, {
    templateId: "template", locationId: "foreign", date: "2026-09-10",
    actor: checklistActor({ role: "gm", level: 7, locations: ["own"] }),
  })).rejects.toMatchObject({ name: "ChecklistRoleViolationError", code: "role_level_insufficient" });
  expect(from).not.toHaveBeenCalled();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("LRA-227: own-shop GMs and non-member global readers reach the existing read", async () => {
  for (const [role, level, locations] of [["gm", 7, ["own"]], ["owner", 9, []], ["cgs", 10, []], ["moo", 8, []]] as const) {
    const from = vi.fn(() => { throw new Error("Reached authorized read"); });
    await expect(getOrCreateInstance({ from } as unknown as SupabaseClient, {
      templateId: "template", locationId: "own", date: "2026-09-10",
      actor: checklistActor({ role, level, locations: [...locations] }),
    })).rejects.toThrow("Reached authorized read");
    expect(from).toHaveBeenCalledOnce();
  }
});

it("trainees can read an existing closing but cannot create one", async () => {
  const actor = checklistActor({ role: "trainee", level: 2, locations: ["own"] });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const service = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const args = { templateId: "template", locationId: "own", date: "2026-10-07", actor };
  await expect(getOrCreateInstance(service, args)).rejects.toMatchObject({ code: "role_level_insufficient" });
  query.maybeSingle.mockResolvedValue({ data: { id: "existing" } as never, error: null });
  await expect(getOrCreateInstance(service, args)).resolves.toMatchObject({ created: false, instance: { id: "existing" } });
});

// READ >=8 is deliberately broader than R2 membership required to INSERT.
it.each([9, 10])("non-member level %s reads an existing instance but cannot create", async level => {
  const actor = checklistActor({ level, locations: [] });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "existing" }, error: null }) };
  const reader = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const args = { templateId: "template", locationId: "own", date: "2026-10-19", actor };
  await expect(getOrCreateInstance(reader, args)).resolves.toMatchObject({ created: false, instance: { id: "existing" } });
  query.maybeSingle.mockResolvedValue({ data: null as never, error: null });
  await expect(getOrCreateInstance(reader, args)).rejects.toMatchObject({ code: "role_level_insufficient" });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
