import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ actor: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ user: { id: "user" } }), SESSION_COOKIE_NAME: "session" }));
vi.mock("@/lib/checklist-write-actor", async (original) => ({
  ...await original<typeof import("@/lib/checklist-write-actor")>(), resolveChecklistWriteActor: h.actor,
}));
vi.mock("@/lib/supabase-server", () => ({
  createAuthedClient: () => ({}),
  getServiceRoleClient: () => ({ from: () => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { type: "closing", location_id: "shop", active: true }, error: null }) };
    return q;
  } }),
}));
vi.mock("@/lib/checklists", () => ({ getOrCreateInstance: h.write, completeItem: h.write, submitBatch: h.write, confirmInstance: h.write }));
vi.mock("@/app/api/checklist/_helpers", () => ({ mapChecklistError: vi.fn() }));
vi.mock("@/lib/written-reports", () => ({ createWrittenReport: h.write, updateWrittenReport: h.write, validateWrittenReportDraft: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesSystemTrigger: vi.fn() }));
vi.mock("@/lib/report-digests", () => ({ runClosingDigests: vi.fn() }));
vi.mock("@/lib/whos-here-tick", () => ({ releaseAfterSettledClose: vi.fn() }));

import { ChecklistActorTransientError } from "@/lib/checklist-write-actor";
import { POST as instances } from "@/app/api/checklist/instances/route";
import { POST as completions } from "@/app/api/checklist/completions/route";
import { POST as submissions } from "@/app/api/checklist/submissions/route";
import { POST as confirm } from "@/app/api/checklist/confirm/route";
import { POST as reports } from "@/app/api/written-reports/route";
import { PATCH } from "@/app/api/written-reports/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockRejectedValue(new ChecklistActorTransientError());
});

it.each([
  ["instances", instances, { templateId: "template", locationId: "shop", date: "2026-10-19" }],
  ["completions", completions, { instanceId: "instance", templateItemId: "item" }],
  ["submissions", submissions, { instanceId: "instance", completionIds: [] }],
  ["confirm", confirm, { instanceId: "instance", pin: "1234", incompleteReasons: [] }],
  ["report create", reports, { body: "report" }],
  ["report update", (req: NextRequest) => PATCH(req, { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) }), { body: "report" }],
] as const)("%s returns the existing JSON envelope with 503 and never writes", async (_name, handler, body) => {
  const req = new NextRequest("http://localhost/api/test", {
    method: "POST", headers: { "content-type": "application/json", cookie: "session=test" }, body: JSON.stringify(body),
  });
  const response = await handler(req);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "checklist_actor_unavailable", code: "checklist_actor_unavailable" });
  expect(h.actor).toHaveBeenCalledOnce();
  expect(h.write).not.toHaveBeenCalled();
});
