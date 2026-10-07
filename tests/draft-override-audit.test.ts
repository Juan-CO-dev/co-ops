import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditTaskOverride, hasTaskAccess } from "@/lib/assignments";
import { saveOpeningPhase1Draft } from "@/lib/opening";
import { emptyOpeningPhase1Draft } from "@/lib/opening-draft-shared";
import { saveAmPrepDraft } from "@/lib/am-prep-draft";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(), auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const stamp = "2026-10-07T16:00:00Z";
function client() {
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ error: null, data: table === "checklist_templates"
      ? { type: "prep", prep_subtype: "am_prep" }
      : { id: "instance", template_id: "template", location_id: "shop", date: "2026-10-07", status: "open" } }),
    single: vi.fn().mockResolvedValue({ error: null, data: { saved_at: stamp } }),
  }));
  const rpc = vi.fn().mockResolvedValue({ error: null, data: stamp });
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasTaskAccess).mockResolvedValue(true); });
describe("draft saves never emit override audit noise", () => {
  it("a KH can autosave an opening without recording task.override", async () => {
    const { service, from } = client();
    await expect(saveOpeningPhase1Draft(service, { instanceId: "instance", locationId: "shop",
      actor: { userId: "kh", role: "key_holder", level: 4 }, savedBy: "kh", draft: emptyOpeningPhase1Draft() }))
      .resolves.toEqual({ savedAt: stamp });
    expect(from).toHaveBeenCalledWith("opening_phase1_drafts");
    expect(auditTaskOverride).not.toHaveBeenCalled();
  });
  it("a KH can autosave AM prep without recording task.override", async () => {
    const { service, rpc } = client();
    await expect(saveAmPrepDraft(service, { instanceId: "instance", patch: {},
      actor: { user: { id: "kh" }, role: "key_holder", level: 4, locations: ["shop"] } }))
      .resolves.toEqual({ savedAt: stamp });
    expect(rpc).toHaveBeenCalledWith("save_am_prep_draft", expect.anything());
    expect(auditTaskOverride).not.toHaveBeenCalled();
  });
});
