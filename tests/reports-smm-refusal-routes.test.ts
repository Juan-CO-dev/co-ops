/**
 * Nav spec r3 PR S1 — the report ROUTES refuse the social media manager (section 8.2).
 *
 *   - the export (/api/reports/export), every family, CSV and PDF: 403 `forbidden` before any read,
 *     no file, no audit row; the loader's own floor refuses the role for any other caller;
 *   - the written-report routes (POST create, PATCH edit): 403 before the actor is resolved;
 *   - the control: an AGM (also level 6) still gets its export exactly as before.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/reports-search", () => ({ buildSearchCorpus: vi.fn(async () => new Map()), searchReport: vi.fn(() => ({ matched: true, snippet: null })) }));
vi.mock("@/lib/reports-hub", async (orig) => ({ ...(await orig<typeof import("@/lib/reports-hub")>()), listReports: vi.fn(), loadReportDetail: vi.fn() }));
vi.mock("@/lib/checklist-write-actor", async (orig) => ({
  ...(await orig<typeof import("@/lib/checklist-write-actor")>()),
  resolveChecklistWriteActor: vi.fn(async () => { throw new Error("actor_resolved"); }),
}));

import { GET } from "@/app/api/reports/export/route";
import { POST as createWritten } from "@/app/api/written-reports/route";
import { PATCH as editWritten } from "@/app/api/written-reports/[id]/route";
import { audit } from "@/lib/audit";
import { resolveChecklistWriteActor } from "@/lib/checklist-write-actor";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listReports } from "@/lib/reports-hub";
import { assertFamilyFloor, ExportError } from "@/lib/report-export";
import { EXPORT_FAMILIES, EXPORT_FORMATS } from "@/lib/report-export-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const SHOP = "aaaaaaaa-0000-4000-8000-00000000000a";
const ID = "bbbbbbbb-0000-4000-8000-00000000000b";

function session(role: RoleCode) {
  const ctx = { user: { id: "viewer-1", role, name: "Viewer One", language: "en" }, role, level: ROLES[role].level, locations: [SHOP], session: { id: "s1" } };
  vi.mocked(requireSession).mockResolvedValue(ctx as never);
  return ctx;
}

function fakeClient() {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: SHOP, code: "MEP", name: "Capitol Hill" }, error: null }) };
  return { from: (table: string) => { if (table !== "locations") throw new Error(`unexpected read: ${table}`); return q; } };
}

const exportGet = (query: string) => GET(new NextRequest(`https://example.test/api/reports/export?${query}`));
const writeReq = (url: string, method: string) => new NextRequest(url, {
  method, headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ body: "Walk-in at 45F" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServiceRoleClient).mockReturnValue(fakeClient() as never);
  vi.mocked(listReports).mockResolvedValue([
    { type: "closing", id: "k1", date: "2026-10-05", locationId: SHOP, submitterName: "Ana", status: "confirmed",
      signalSummary: { underPar: 2, overPar: 0, skipped: 1, tempFlags: 0, cashOverShortCents: -1234 } },
  ] as never);
});

describe("the export refuses the social media manager: every family, both formats, before any read", () => {
  const cases = EXPORT_FAMILIES.flatMap((family) => EXPORT_FORMATS.map((format) => [family, format] as const));
  it.each(cases)("%s as %s → 403, nothing read, nothing audited", async (family, format) => {
    session("social_media_mgr");
    const res = await exportGet(`family=${family}&format=${format}&location=${SHOP}&range=last30`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(getServiceRoleClient).not.toHaveBeenCalled();
    expect(listReports).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("the loader's own floor refuses the role, whatever the family", () => {
    const smm = { user: { id: "u", role: "social_media_mgr" }, role: "social_media_mgr", level: 6, locations: [SHOP] };
    for (const family of EXPORT_FAMILIES) {
      let caught: unknown = null;
      try { assertFamilyFloor(smm as never, family, { BUSINESS_REPORT: "1" }); } catch (error) { caught = error; }
      expect(caught, family).toBeInstanceOf(ExportError);
      expect((caught as ExportError).status).toBe(403);
      expect((caught as ExportError).code).toBe("forbidden");
    }
  });
});

describe("the control: an AGM (also level 6) exports exactly as before", () => {
  it.each(EXPORT_FORMATS)("operations as %s → 200 with the file", async (format) => {
    session("agm");
    const res = await exportGet(`family=operations&format=${format}&location=${SHOP}&range=custom&from=2026-10-01&to=2026-10-06`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(listReports).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("the loader floor lets the AGM through for operations", () => {
    const agm = { user: { id: "u", role: "agm" }, role: "agm", level: 6, locations: [SHOP] };
    expect(() => assertFamilyFloor(agm as never, "operations")).not.toThrow();
  });
});

describe("the written-report routes refuse the social media manager before the actor is resolved", () => {
  it("POST /api/written-reports → 403", async () => {
    session("social_media_mgr");
    const res = await createWritten(writeReq("https://example.test/api/written-reports", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(resolveChecklistWriteActor).not.toHaveBeenCalled();
  });

  it("PATCH /api/written-reports/[id] → 403", async () => {
    session("social_media_mgr");
    const res = await editWritten(writeReq(`https://example.test/api/written-reports/${ID}`, "PATCH"), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(resolveChecklistWriteActor).not.toHaveBeenCalled();
  });

  it("an AGM passes the role gate (the actor is resolved as before)", async () => {
    session("agm");
    await expect(createWritten(writeReq("https://example.test/api/written-reports", "POST"))).rejects.toThrow("actor_resolved");
    await expect(editWritten(writeReq(`https://example.test/api/written-reports/${ID}`, "PATCH"), { params: Promise.resolve({ id: ID }) })).rejects.toThrow("actor_resolved");
  });
});
