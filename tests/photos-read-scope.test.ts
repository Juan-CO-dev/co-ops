/**
 * Who may READ a photo vs who may UPLOAD one (audit W10 / B064).
 *
 * Every /api/photos/{id} link is shown on a report (closing / opening item photos, receiving receipts
 * and line photos) or on an operational form at the user's own shop. The reports open another shop to
 * level 8 (the Manager of Operations) through canReadReportLocation; the photo read used the narrower
 * lockLocationContext (all shops only at 9+), so the MoO opened the report and every photo link on it
 * answered "not found". The READ now uses the report grant. The UPLOAD keeps the membership bind.
 *
 * No real database: the in-memory fake stands in for the service client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { RoleCode } from "@/lib/roles";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";

const h = vi.hoisted(() => ({ db: vi.fn(), signed: [] as Array<{ bucket: string; path: string; ttl: number }>, uploads: [] as string[] }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { getPhotoSignedUrl, PhotoError, uploadPhoto } from "@/lib/photos";

const A = "6f1d2c3e-0000-4000-8000-00000000000a"; // the shop the actor belongs to
const B = "6f1d2c3e-0000-4000-8000-00000000000b"; // the shop the photo belongs to
const PHOTO_B = "7a2e3d4f-0000-4000-8000-0000000000b1";
const PATH_B = `photos/${B}/2026-11/${PHOTO_B}.jpg`;

const actor = (role: RoleCode, locations: string[]) =>
  ({ user: { id: `u-${role}`, role }, role, level: getRoleLevel(role), locations }) as unknown as AuthContext;

async function refusal(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof PhotoError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  h.signed.length = 0;
  h.uploads.length = 0;
  const fake = createFakeDb({ photos: [{ id: PHOTO_B, storage_path: PATH_B, location_id: B }] });
  h.db.mockImplementation(() => ({
    from: fake.client.from,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => { h.signed.push({ bucket, path, ttl }); return { data: { signedUrl: `https://signed.example/${bucket}/${path}` }, error: null }; },
        upload: async (path: string) => { h.uploads.push(path); return { data: { path }, error: null }; },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }));
});
afterEach(() => { vi.clearAllMocks(); });

describe("reading a photo follows the report grant (B064)", () => {
  it("a MoO with no membership at the photo's shop gets the signed URL (the reports already open that shop to level 8)", async () => {
    const res = await getPhotoSignedUrl(actor("moo", [A]), PHOTO_B);
    expect(res).toEqual({ signedUrl: `https://signed.example/photos/${PATH_B}` });
    expect(h.signed).toEqual([{ bucket: "photos", path: PATH_B, ttl: 60 }]); // still the 60-second URL of that one object
  });

  it("a MoO with no memberships at all reads it too", async () => {
    await expect(getPhotoSignedUrl(actor("moo", []), PHOTO_B)).resolves.toMatchObject({ signedUrl: expect.stringContaining(PATH_B) });
  });

  it.each<RoleCode>(["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee", "trainee"])(
    "a %s of the OTHER shop is still 404 not_found, and nothing is signed", async (role) => {
      expect(await refusal(getPhotoSignedUrl(actor(role, [A]), PHOTO_B))).toEqual({ status: 404, code: "not_found" });
      expect(await refusal(getPhotoSignedUrl(actor(role, []), PHOTO_B))).toEqual({ status: 404, code: "not_found" });
      expect(h.signed).toEqual([]);
    });

  it.each<RoleCode>(["employee", "key_holder", "gm", "social_media_mgr"])("a %s who IS a member of the photo's shop reads it, as before", async (role) => {
    await expect(getPhotoSignedUrl(actor(role, [B]), PHOTO_B)).resolves.toMatchObject({ signedUrl: expect.stringContaining(PATH_B) });
  });

  it.each<RoleCode>(["owner", "cgs"])("level 9+ (%s) reads every shop, as before", async (role) => {
    await expect(getPhotoSignedUrl(actor(role, []), PHOTO_B)).resolves.toMatchObject({ signedUrl: expect.stringContaining(PATH_B) });
  });

  it("an unknown photo is the same 404 for the MoO (the grant is about shops, not about existence)", async () => {
    expect(await refusal(getPhotoSignedUrl(actor("moo", [A]), "7a2e3d4f-0000-4000-8000-0000000000ff"))).toEqual({ status: 404, code: "not_found" });
    expect(h.signed).toEqual([]);
  });
});

describe("uploading a photo keeps the membership bind (B064 did not move it)", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it("a MoO uploading for a shop they are not a member of is 404, before any storage or database work", async () => {
    expect(await refusal(uploadPhoto(actor("moo", [A]), { locationId: B, bytes, contentType: "image/jpeg" }))).toEqual({ status: 404, code: "not_found" });
    expect(h.db).not.toHaveBeenCalled();
    expect(h.uploads).toEqual([]);
  });

  it.each<RoleCode>(["gm", "employee"])("a %s uploading for the other shop is 404 too", async (role) => {
    expect(await refusal(uploadPhoto(actor(role, [A]), { locationId: B, bytes, contentType: "image/jpeg" }))).toEqual({ status: 404, code: "not_found" });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("a member uploads for their own shop (the bind is membership, not a blanket refusal)", async () => {
    const { photoId } = await uploadPhoto(actor("moo", [A]), { locationId: A, bytes, contentType: "image/jpeg" });
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toContain(`photos/${A}/`);
  });
});
