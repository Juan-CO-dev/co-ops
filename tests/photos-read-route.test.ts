/**
 * GET /api/photos/[id] — a malformed id is "not found", never a server error (audit W10 / B166).
 *
 * The id reaches a uuid column. Before the fix "abc" went to PostgREST, came back 22P02 ("invalid
 * input syntax for type uuid"), and the route answered 500 internal_error. Two layers now:
 *   - the route refuses a non-uuid id with 404 BEFORE any database work (auth still first);
 *   - the lib maps 22P02 to the same 404 for any future caller that skips the route.
 * No real database: the service client is a stub.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { GET } from "@/app/api/photos/[id]/route";
import { getPhotoSignedUrl, PhotoError } from "@/lib/photos";
import { requireSession, type AuthContext } from "@/lib/session";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const PHOTO = "7a2e3d4f-0000-4000-8000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor = { user: { id: "u1", role: "employee" }, role: "employee", level: 3, locations: [SHOP] } as unknown as AuthContext;

type PgError = { code: string; message: string };
/** A photos table that behaves like Postgres on the id filter: a non-uuid is a 22P02, never "no row". */
function photosClient(opts: { error?: PgError } = {}) {
  return {
    from: (table: string) => {
      if (table !== "photos") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => {
              if (opts.error) return { data: null, error: opts.error };
              if (!UUID_RE.test(id)) return { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
              return { data: id === PHOTO ? { id, storage_path: `photos/${SHOP}/2026-11/${id}.jpg`, location_id: SHOP } : null, error: null };
            },
          }),
        }),
      };
    },
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null }) }) },
  };
}
const get = (id: string) => GET(new NextRequest(`https://ops.example.test/api/photos/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.mocked(requireSession).mockResolvedValue(actor as never);
  h.db.mockImplementation(() => photosClient());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("GET /api/photos/[id] with a malformed id (B166)", () => {
  it.each(["abc", "123", "7a2e3d4f-0000-4000-8000-00000000000", `${PHOTO}x`, `${PHOTO}'--`, "../etc/passwd"])(
    "%s → 404 not_found, and the database is never asked", async (id) => {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not_found" });
      expect(h.db).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

  it("auth still answers first: an unauthenticated malformed id is the session layer's 401", async () => {
    vi.mocked(requireSession).mockResolvedValue(new Response(null, { status: 401 }) as never);
    expect((await get("abc")).status).toBe(401);
    expect(h.db).not.toHaveBeenCalled();
  });

  it("a well-formed id still reads: 302 to the signed URL; an unknown uuid is the same 404", async () => {
    const ok = await get(PHOTO);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe(`https://signed.example/photos/${SHOP}/2026-11/${PHOTO}.jpg`);
    const upper = await get(PHOTO.toUpperCase());
    expect(upper.status).toBe(404); // a valid uuid spelling reaches the lib; this stub has no such row
    const missing = await get("7a2e3d4f-0000-4000-8000-0000000000ff");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
  });
});

describe("getPhotoSignedUrl (lib defence in depth, B166)", () => {
  it("PostgREST 22P02 (a non-uuid id) is PhotoError 404 not_found, never a plain Error", async () => {
    const err = await getPhotoSignedUrl(actor, "abc").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoError);
    expect(err).toMatchObject({ status: 404, code: "not_found" });
  });

  it("any other database error is still a server error (never masked as not found)", async () => {
    h.db.mockImplementation(() => photosClient({ error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    const err = await getPhotoSignedUrl(actor, PHOTO).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PhotoError);
    const res = await get(PHOTO);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal_error" });
  });
});
