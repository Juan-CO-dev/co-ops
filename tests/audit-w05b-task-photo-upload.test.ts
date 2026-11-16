/**
 * Audit W05B fix round 1 (review P2) — a photo for a shop TASK uploads through the shop-task rule.
 *
 * W05B let level 8+ (MoO, owner, CGS) work checklist tasks at any active shop (Juan 2026-11-15), but the
 * photo a photo-required closing item needs still went through POST /api/photos → uploadPhoto's
 * lockLocationContext (a membership, or level 9+). A MoO who belongs only to shop A opened shop B's
 * closing, took the photo, got "upload failed" (404), and could not mark the item done (missing_photo).
 *
 * The fix: an upload that names the checklist instance it is for (`instanceId`) is a TASK photo. It is
 * allowed by canWorkShopTasks against THAT instance's shop, only while the instance is open and the shop
 * is active, and the photo is stored for that shop (so completeItem's W08/B163 check — photo exists and
 * belongs to the instance's shop — still passes for it and still refuses any other). An upload that names
 * no instance (receiving, case photos, receipts) keeps lockLocationContext exactly as before.
 *
 * No real database: the in-memory fake stands in for the service client.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { RoleCode } from "@/lib/roles";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";

const h = vi.hoisted(() => ({ db: vi.fn(), uploads: [] as string[], tables: {} as Record<string, Array<Record<string, unknown>>> }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { PhotoError, uploadPhoto } from "@/lib/photos";

const A = "6f1d2c3e-0000-4000-8000-00000000000a"; // the actor's own shop
const B = "6f1d2c3e-0000-4000-8000-00000000000b"; // the shop whose closing they are working
const CLOSED = "6f1d2c3e-0000-4000-8000-00000000000c"; // an inactive shop
const INSTANCE_B = "8b3f4e5a-0000-4000-8000-0000000000b1";
const CONFIRMED_B = "8b3f4e5a-0000-4000-8000-0000000000b2";
const INSTANCE_CLOSED_SHOP = "8b3f4e5a-0000-4000-8000-0000000000c1";
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const actor = (role: RoleCode, locations: string[]) =>
  ({ user: { id: `u-${role}`, role }, role, level: getRoleLevel(role), locations }) as unknown as AuthContext;

async function refusal(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof PhotoError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  h.uploads.length = 0;
  h.tables = {
    photos: [],
    locations: [{ id: A, active: true }, { id: B, active: true }, { id: CLOSED, active: false }],
    checklist_instances: [
      { id: INSTANCE_B, location_id: B, status: "open" },
      { id: CONFIRMED_B, location_id: B, status: "confirmed" },
      { id: INSTANCE_CLOSED_SHOP, location_id: CLOSED, status: "open" },
    ],
  };
  const fake = createFakeDb(h.tables);
  h.db.mockImplementation(() => ({
    from: fake.client.from,
    storage: {
      from: () => ({
        upload: async (path: string) => { h.uploads.push(path); return { data: { path }, error: null }; },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }));
});
afterEach(() => { vi.clearAllMocks(); });

describe("a task photo uploads through the shop-task rule (level 8+ at any active shop)", () => {
  it.each<RoleCode>(["moo", "owner", "cgs"])("a %s with no membership at shop B uploads a photo for B's open closing, stored for B", async (role) => {
    const { photoId } = await uploadPhoto(actor(role, [A]), { locationId: B, bytes, contentType: "image/jpeg", instanceId: INSTANCE_B });
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toContain(`photos/${B}/`);
    // The registry row belongs to B — exactly what completeItem's B163 check (photo.location_id === instance.location_id) requires.
    expect(h.tables.photos).toEqual([expect.objectContaining({ id: photoId, location_id: B })]);
  });

  it.each<RoleCode>(["gm", "agm", "social_media_mgr", "key_holder", "employee"])(
    "a %s of another shop is still 404 for B's closing photo, and nothing is stored", async (role) => {
      expect(await refusal(uploadPhoto(actor(role, [A]), { locationId: B, bytes, contentType: "image/jpeg", instanceId: INSTANCE_B })))
        .toEqual({ status: 404, code: "not_found" });
      expect(h.uploads).toEqual([]);
      expect(h.tables.photos).toEqual([]);
    });

  it("a member of B below level 8 uploads for B's closing as before", async () => {
    await expect(uploadPhoto(actor("key_holder", [B]), { locationId: B, bytes, contentType: "image/jpeg", instanceId: INSTANCE_B }))
      .resolves.toHaveProperty("photoId");
  });

  it("the photo is bound to the instance's shop: naming B's instance with another shop id is 404 for the MoO", async () => {
    expect(await refusal(uploadPhoto(actor("moo", []), { locationId: A, bytes, contentType: "image/jpeg", instanceId: INSTANCE_B })))
      .toEqual({ status: 404, code: "not_found" });
    expect(h.uploads).toEqual([]);
  });

  it("a confirmed instance, an inactive shop, an unknown or malformed instance id give the MoO no task grant", async () => {
    for (const [locationId, instanceId] of [
      [B, CONFIRMED_B], [CLOSED, INSTANCE_CLOSED_SHOP], [B, "8b3f4e5a-0000-4000-8000-0000000000ff"], [B, "not-a-uuid"],
    ] as const) {
      expect(await refusal(uploadPhoto(actor("moo", [A]), { locationId, bytes, contentType: "image/jpeg", instanceId })), instanceId)
        .toEqual({ status: 404, code: "not_found" });
    }
    expect(h.uploads).toEqual([]);
  });

  it("an upload that names no instance (receiving, receipts, case photos) keeps the membership bind: the MoO is 404 at B", async () => {
    expect(await refusal(uploadPhoto(actor("moo", [A]), { locationId: B, bytes, contentType: "image/jpeg" })))
      .toEqual({ status: 404, code: "not_found" });
    expect(h.db).not.toHaveBeenCalled();
    expect(h.uploads).toEqual([]);
  });
});

describe("the closing item's photo button names its instance", () => {
  it("POST /api/photos passes the optional instanceId form field through to uploadPhoto", () => {
    const src = readFileSync("app/api/photos/route.ts", "utf8");
    expect(src).toMatch(/form\.get\("instanceId"\)/);
    expect(src).toMatch(/uploadPhoto\(ctx, \{[^}]*instanceId/);
  });
  it("the closing page threads instance.id into ChecklistItem → PhotoCapture → postPhoto", () => {
    const closing = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");
    expect(closing).toMatch(/<StationGroup[\s\S]*?instanceId=\{instance\.id\}/);
    expect(closing).toMatch(/<ChecklistItem[\s\S]*?instanceId=\{instanceId\}/);
    expect(readFileSync("components/ChecklistItem.tsx", "utf8")).toMatch(/<PhotoCapture[\s\S]*?instanceId=\{instanceId\}/);
    expect(readFileSync("components/photos/PhotoCapture.tsx", "utf8")).toMatch(/postPhoto\(prepared, locationId, undefined, \{ instanceId \}\)/);
  });
});
