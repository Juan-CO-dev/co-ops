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

// Audit W05B (Juan 2026-11-15): level 8+ start a shop's checklist without a membership, like they read it.
// Below 8 a member of another shop still reads (RLS scope) nothing here and cannot create.
it.each([7, 6, 4])("a non-member level %s cannot create (below 8 the shop membership is required)", async level => {
  const actor = checklistActor({ level, locations: ["other"] });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const reader = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const args = { templateId: "template", locationId: "own", date: "2026-10-19", actor };
  await expect(getOrCreateInstance(reader, args)).rejects.toMatchObject({ code: "role_level_insufficient" });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it.each([8, 9, 10])("a non-member level %s reads an existing instance and passes the shop gate to create", async level => {
  // The verified actor's level is derived from its role (resolveChecklistWriteActor), and the shop rule reads the role.
  const role = ({ 8: "moo", 9: "owner", 10: "cgs" } as const)[level as 8 | 9 | 10];
  const actor = checklistActor({ role, level, locations: [] });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "existing" }, error: null }) };
  const reader = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const args = { templateId: "template", locationId: "own", date: "2026-10-19", actor };
  await expect(getOrCreateInstance(reader, args)).resolves.toMatchObject({ created: false, instance: { id: "existing" } });
  query.maybeSingle.mockResolvedValue({ data: null as never, error: null });
  // Past the shop gate the create path reads the template with the service client (not mocked here).
  await expect(getOrCreateInstance(reader, args)).rejects.not.toMatchObject({ code: "role_level_insufficient" });
  expect(getServiceRoleClient).toHaveBeenCalled();
});

it("an inactive level-8+ actor cannot create", async () => {
  vi.mocked(getServiceRoleClient).mockClear();
  const actor = checklistActor({ level: 10, locations: ["own"], active: false });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const reader = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  await expect(getOrCreateInstance(reader, { templateId: "template", locationId: "own", date: "2026-10-19", actor }))
    .rejects.toMatchObject({ code: "role_level_insufficient" });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
