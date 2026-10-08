import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/report-recipients/route";
import { POST as POST_SETTINGS } from "@/app/api/admin/report-recipients/settings/route";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { saveReportRecipient } from "@/lib/report-recipients";
import { validateRecipientInput, validateSettingsPatch } from "@/lib/report-recipients-shared";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in the unit spine"); }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const SHOP = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000002";
const fresh = () => new Date().toISOString();

function session(role: string, level: number, stepUp: "fresh" | "none" = "fresh") {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "actor", role }, role, level, locations: [SHOP],
    session: { stepUpUnlocked: stepUp === "fresh", stepUpUnlockedAt: stepUp === "fresh" ? fresh() : null },
  } as never);
}
const req = (url: string, body: unknown) => new NextRequest(`https://example.test${url}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const accountant = { kind: "external", displayName: "Accountant", email: "", active: true, cateringDigest: false, shopDigest: false, locationIds: null, packages: ["cash"], cadence: "daily_close", formats: ["csv", "pdf"] };

beforeEach(() => vi.clearAllMocks());

describe("who may write", () => {
  it("a GM (7) can view the page but every write is 403 before any database work", async () => {
    session("gm", 7);
    expect((await POST(req("/api/admin/report-recipients", accountant))).status).toBe(403);
    expect((await POST_SETTINGS(req("/api/admin/report-recipients/settings", { mode: "live" }))).status).toBe(403);
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("an owner needs a fresh step-up", async () => {
    session("owner", 9, "none");
    const res = await POST(req("/api/admin/report-recipients", accountant));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_required" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("the accountant row stays disabled until it has an email", () => {
  it("API: an external row switched on with no email is a 400 email_required_to_enable", async () => {
    session("owner", 9);
    const res = await POST(req("/api/admin/report-recipients", accountant));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "email_required_to_enable" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  it("validation: disabled without email is fine; with an email it may be enabled (lowercased)", () => {
    expect(validateRecipientInput({ ...accountant, active: false })).toMatchObject({ ok: true, value: { active: false, email: null } });
    expect(validateRecipientInput({ ...accountant, email: " Books@Example.COM " })).toMatchObject({ ok: true, value: { active: true, email: "books@example.com" } });
    expect(validateRecipientInput({ ...accountant, email: "not-an-email" })).toEqual({ ok: false, code: "email_invalid" });
  });

  it("external rows never take a digest flag; internal rows need a user", () => {
    expect(validateRecipientInput({ ...accountant, email: "a@b.co", cateringDigest: true })).toEqual({ ok: false, code: "external_no_digest" });
    expect(validateRecipientInput({ ...accountant, kind: "internal", userId: "nope" })).toEqual({ ok: false, code: "user_required" });
    expect(validateRecipientInput({ ...accountant, kind: "internal", userId: USER, cateringDigest: true, locationIds: [SHOP] }))
      .toMatchObject({ ok: true, value: { kind: "internal", userId: USER, email: null, locationIds: [SHOP] } });
  });

  it("a package needs a cadence and known sections", () => {
    expect(validateRecipientInput({ ...accountant, active: false, cadence: null })).toEqual({ ok: false, code: "cadence_required" });
    expect(validateRecipientInput({ ...accountant, active: false, packages: ["payroll"] })).toEqual({ ok: false, code: "invalid_package" });
  });
});

describe("location bind inside the lib writer", () => {
  it("a shop the actor may not act in is refused before any I/O", async () => {
    const parsed = validateRecipientInput({ ...accountant, kind: "internal", userId: USER, locationIds: ["cccccccc-0000-4000-8000-000000000003"] });
    if (!parsed.ok) throw new Error("fixture");
    const sb = { from: vi.fn() } as never;
    // A role without the all-locations grant (level from the role, not the claimed number).
    await expect(saveReportRecipient(sb, { actor: { userId: "a", role: "gm", level: 9, locations: [SHOP] }, input: parsed.value }))
      .rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    await expect(saveReportRecipient(sb, { actor: { userId: "a", role: "gm", level: 7, locations: [SHOP] }, input: parsed.value }))
      .rejects.toMatchObject({ status: 403, code: "role_insufficient" });
    expect((sb as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("the switch takes off | preview | live only; times must sit inside the 03:00-22:00 pinger window", () => {
    expect(validateSettingsPatch({ mode: "preview" })).toEqual({ ok: true, value: { mode: "preview" } });
    expect(validateSettingsPatch({ mode: "on" })).toEqual({ ok: false, code: "invalid_mode" });
    expect(validateSettingsPatch({ cateringTimeEt: "06:30", unifiedFallbackTimeEt: "03:00", graceMinutes: 45 }).ok).toBe(true);
    expect(validateSettingsPatch({ unifiedFallbackTimeEt: "02:00" })).toEqual({ ok: false, code: "invalid_time" });
    expect(validateSettingsPatch({ cateringTimeEt: "23:00" })).toEqual({ ok: false, code: "invalid_time" });
    expect(validateSettingsPatch({})).toEqual({ ok: false, code: "invalid_payload" });
  });
});
