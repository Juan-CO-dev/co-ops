/**
 * Unit spine — POST /api/prep/draft wears the same-origin belt FIRST (review fix, PR #383,
 * item 4). The REAL `assertSameOrigin` runs; the session gate is mocked. A cross-site or
 * Origin-less POST is refused 403 bad_origin before the session is even consulted; a
 * same-origin fetch AND a same-origin sendBeacon (text/plain body, Origin +
 * Sec-Fetch-Site: same-origin, no custom headers) reach the save.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/prep/draft/route";
import { saveAmPrepDraft } from "@/lib/am-prep-draft";
import { requireSession } from "@/lib/session";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/am-prep-draft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/am-prep-draft")>("@/lib/am-prep-draft");
  return { ...actual, saveAmPrepDraft: vi.fn() };
});

const HOST = "https://co-ops.example.com";
const INSTANCE = "33333333-3333-4333-8333-333333333333";
const body = JSON.stringify({ instanceId: INSTANCE, draft: { version: 1, items: { k: { onHand: "1" } } } });

const post = (headers: Record<string, string>) =>
  new NextRequest(`${HOST}/api/prep/draft`, { method: "POST", headers, body });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "u-kh" },
    role: "key_holder",
    level: 4,
    locations: ["shop"],
  } as never);
  vi.mocked(saveAmPrepDraft).mockResolvedValue({ savedAt: "2026-10-06T14:00:00.000Z" });
});

describe("POST /api/prep/draft — same-origin, first", () => {
  it("refuses a cross-site POST with 403 bad_origin before the session or any save", async () => {
    const res = await POST(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(requireSession).not.toHaveBeenCalled();
    expect(saveAmPrepDraft).not.toHaveBeenCalled();
  });

  it("refuses a foreign Origin even without Sec-Fetch-Site", async () => {
    const res = await POST(post({ origin: "https://evil.example", "content-type": "application/json" }));
    expect(res.status).toBe(403);
    expect(saveAmPrepDraft).not.toHaveBeenCalled();
  });

  it("refuses a POST with no Origin at all", async () => {
    const res = await POST(post({ "content-type": "application/json" }));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(saveAmPrepDraft).not.toHaveBeenCalled();
  });

  it("accepts a same-origin fetch", async () => {
    const res = await POST(post({ origin: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ savedAt: "2026-10-06T14:00:00.000Z" });
    expect(saveAmPrepDraft).toHaveBeenCalledOnce();
  });

  it("accepts a same-origin sendBeacon (text/plain body, Origin sent, no custom headers)", async () => {
    const res = await POST(post({ origin: HOST, "sec-fetch-site": "same-origin", "content-type": "text/plain;charset=UTF-8" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(saveAmPrepDraft).mock.calls[0]![1]).toMatchObject({ instanceId: INSTANCE, patch: { k: { onHand: "1" } } });
  });
});
