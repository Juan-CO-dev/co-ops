/**
 * Catalog Phase 2b — the door report (0261): parsed strictly; FILING is a door act bound to the shop
 * (and to that shop's delivery and photo) before any write; READING and DISMISSING are catalog acts
 * (the social media manager refused — a role check) bound to the report's shop and SKU.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import {
  packRequestReviewAllowed, parsePackChangeProposal, proposalToSentence,
} from "@/lib/pack-change-requests-shared";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
/**
 * The in-memory DB plus a stand-in for 0261's file_sku_pack_change_request (the SQL itself is proven
 * in scripts/sql-harness-0261.mjs A9): open a report, or JOIN the open one and ADD what was brought.
 */
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  const db = current;
  return {
    from: db.client.from,
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, ttl: number) => ({ data: { signedUrl: `https://signed/${bucket}/${path}?ttl=${ttl}` }, error: null }) }) },
    async rpc(name: string, a: Record<string, unknown>) {
      if (name !== "file_sku_pack_change_request") throw new Error(`unexpected rpc ${name}`);
      const open = await db.client.from("sku_pack_change_requests").select("id").eq("sku_id", a.p_sku).eq("location_id", a.p_location).eq("status", "open").maybeSingle<{ id: string }>();
      if (!open.data) {
        const ins = await db.client.from("sku_pack_change_requests").insert({
          sku_id: a.p_sku, location_id: a.p_location, delivery_id: a.p_delivery, note: a.p_note, proposal: a.p_proposal, photo_id: a.p_photo, filed_by: a.p_actor, status: "open",
        }).select("id").maybeSingle<{ id: string }>();
        return { data: { id: ins.data!.id, already: false, added: false }, error: null };
      }
      const something = a.p_note != null || a.p_proposal != null || a.p_photo != null;
      if (something) await db.client.from("sku_pack_change_request_additions").insert({ request_id: open.data.id, note: a.p_note, proposal: a.p_proposal, photo_id: a.p_photo, filed_by: a.p_actor }).select("id").maybeSingle();
      return { data: { id: open.data.id, already: true, added: something }, error: null };
    },
  };
} }));
type Notified = { recipients: Array<{ userId: string }>; titleParams?: Record<string, unknown> };
const notified = vi.hoisted(() => [] as Array<{ recipients: Array<{ userId: string }>; titleParams?: Record<string, unknown> }>);
vi.mock("@/lib/notifications", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications")>()),
  enqueueNotification: async (_sb: unknown, args: Notified) => { notified.push(args); return { notificationId: "n1", recipientIds: [] }; },
}));
import {
  dismissPackChangeRequest, filePackChangeRequest, loadOpenPackChangeRequests, PackChangeRequestError, signPackRequestPhoto,
} from "@/lib/pack-change-requests";
afterEach(() => { current = null; notified.length = 0; });

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode, level: number, locations: string[], id = "u1") =>
  ({ user: { id, role }, role, level, locations }) as unknown as AuthContext;
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof PackChangeRequestError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}
const NO_EXTRAS = { deliveryId: null, note: null, proposal: null, photoId: null };
type Row = Record<string, unknown>;

describe("parsePackChangeProposal", () => {
  it("absent is null; numbers within reason; anything else is invalid", () => {
    expect(parsePackChangeProposal(undefined)).toBeNull();
    expect(parsePackChangeProposal({ innerCount: 4, eachWeight: 10, eachUnit: "lb" })).toEqual({ innerCount: 4, eachWeight: 10, eachUnit: "lb" });
    expect(parsePackChangeProposal({ innerCount: null, eachWeight: null, eachUnit: null })).toBeNull();
    expect(parsePackChangeProposal({ innerCount: -1, eachWeight: null, eachUnit: null })).toBe("invalid");
    expect(parsePackChangeProposal({ innerCount: 2.5, eachWeight: null, eachUnit: null })).toBe("invalid");
    expect(parsePackChangeProposal({ innerCount: 2, eachWeight: 3, eachUnit: "kg" })).toBe("invalid");
    expect(parsePackChangeProposal({ innerCount: 2, eachWeight: 3, eachUnit: null })).toBe("invalid");
    expect(parsePackChangeProposal({ innerCount: 2, extra: 1 })).toBe("invalid");
    expect(parsePackChangeProposal([4])).toBe("invalid");
  });
});

describe("proposalToSentence — what the GM sees prefilled", () => {
  it("edits the inner count and the leaf weight of the current sentence", () => {
    expect(proposalToSentence({ innerCount: 4, eachWeight: 10, eachUnit: "lb" },
      { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "6" }], leafQty: "5", leafUnit: "lb" }))
      .toEqual({ containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" });
  });
  it("adds an inner level when the current sentence has none, and starts from a case when there is no chain", () => {
    expect(proposalToSentence({ innerCount: 12, eachWeight: null, eachUnit: null }, null))
      .toEqual({ containers: [{ label: "case", qty: "1" }, { label: "inner", qty: "12" }], leafQty: "", leafUnit: "oz" });
  });
});

describe("who reviews door reports: a role check, never level-only", () => {
  it("AGM, prep and catering managers and GM+ yes; the social media manager and a shift lead no", () => {
    for (const [role, level] of [["agm", 6], ["prep_mgr", 6], ["catering_mgr", 6], ["gm", 7], ["moo", 8]] as const) expect(packRequestReviewAllowed({ role, level }), role).toBe(true);
    for (const [role, level] of [["social_media_mgr", 6], ["shift_lead", 5], ["key_holder", 4]] as const) expect(packRequestReviewAllowed({ role, level }), role).toBe(false);
  });
});

describe("filing: the bind holds before any I/O (no database is installed for these)", () => {
  it("a key holder at shop A cannot report for shop B; an employee cannot report at all", async () => {
    expect(await refused(filePackChangeRequest(actor("key_holder", 4, [A]), { skuId: "s", locationId: B, ...NO_EXTRAS }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(filePackChangeRequest(actor("employee", 3, [A]), { skuId: "s", locationId: A, ...NO_EXTRAS }))).toEqual({ status: 403, code: "forbidden" });
  });
});

const world = () => ({
  vendor_items: [
    { id: "s", name: "Turkey", location_id: null, active: true },
    { id: "s-owned-b", name: "Store ham", location_id: B, active: true },
  ] as Row[],
  vendor_deliveries: [{ id: "d-a", location_id: A }, { id: "d-b", location_id: B }] as Row[],
  photos: [{ id: "p-a", location_id: A }, { id: "p-b", location_id: B }] as Row[],
  locations: [{ id: A, name: "P Street" }, { id: B, name: "Cap Hill" }] as Row[],
  user_locations: [{ user_id: "gm-a", location_id: A, active: true }, { user_id: "kh", location_id: A, active: true }, { user_id: "gm-b", location_id: B, active: true }] as Row[],
  users: [
    { id: "gm-a", role: "gm", active: true, name: "Gia" }, { id: "kh", role: "key_holder", active: true, name: "Kai" },
    { id: "gm-b", role: "gm", active: true, name: "Bo" }, { id: "moo", role: "moo", active: true, name: "Cris" },
  ] as Row[],
  sku_pack_change_requests: [] as Row[],
  sku_pack_change_request_additions: [] as Row[],
  audit_log: [] as Row[],
});
const auditActions = (db: ReturnType<typeof createFakeDb>) => db.writes.filter((w) => w.table === "audit_log").flatMap((w) => w.rows.map((x) => x.action));

describe("filing a report", () => {
  it("a key holder files for their shop: one open row, the shop's GM notified, audited", async () => {
    current = createFakeDb(world());
    const r = await filePackChangeRequest(actor("key_holder", 4, [A], "kh"), {
      skuId: "s", locationId: A, deliveryId: "d-a", photoId: "p-a", note: "  4 bags not 6  ", proposal: { innerCount: 4, eachWeight: null, eachUnit: null },
    });
    expect(r.already).toBe(false);
    const rows = current.writes.filter((w) => w.table === "sku_pack_change_requests").flatMap((w) => w.rows);
    expect(rows).toEqual([expect.objectContaining({ id: r.id, sku_id: "s", location_id: A, delivery_id: "d-a", photo_id: "p-a", note: "4 bags not 6", filed_by: "kh", proposal: { innerCount: 4, eachWeight: null, eachUnit: null } })]);
    expect(notified.map((n) => n.recipients)).toEqual([[{ userId: "gm-a" }]]);
    expect(notified[0]!.titleParams).toEqual({ item: "Turkey", shop: "P Street" });
    expect(auditActions(current)).toEqual(["sku.pack_change_request.file"]);
  });
  it("a second report of the same case JOINS the open one: its note, numbers and photo are ADDED, the GM is not re-notified (chunk-3 review P3a)", async () => {
    current = createFakeDb(world());
    const first = await filePackChangeRequest(actor("key_holder", 4, [A], "kh"), { skuId: "s", locationId: A, ...NO_EXTRAS, note: "bigger bags" });
    const second = await filePackChangeRequest(actor("gm", 7, [A], "gm-a"), {
      skuId: "s", locationId: A, deliveryId: null, note: " 10 lb each ", photoId: "p-a", proposal: { innerCount: 4, eachWeight: 10, eachUnit: "lb" },
    });
    expect(second).toEqual({ id: first.id, already: true, added: true });
    expect(current.writes.filter((w) => w.table === "sku_pack_change_request_additions").flatMap((w) => w.rows))
      .toEqual([expect.objectContaining({ request_id: first.id, note: "10 lb each", photo_id: "p-a", filed_by: "gm-a", proposal: { innerCount: 4, eachWeight: 10, eachUnit: "lb" } })]);
    expect(notified).toHaveLength(1); // the first report only
    const third = await filePackChangeRequest(actor("key_holder", 4, [A], "kh"), { skuId: "s", locationId: A, ...NO_EXTRAS });
    expect(third).toEqual({ id: first.id, already: true, added: false });
    // The reviewer sees the addition under the report, with who added it.
    const [open] = await loadOpenPackChangeRequests(actor("gm", 7, [A]), { locationIds: [A] });
    expect(open!.additions).toEqual([expect.objectContaining({ filedBy: "Gia", note: "10 lb each", photoId: "p-a" })]);
  });
  it("another shop's delivery, photo or owned SKU, or a missing SKU, is refused by name — and nothing is written", async () => {
    current = createFakeDb(world());
    const kh = actor("key_holder", 4, [A], "kh");
    expect(await refused(filePackChangeRequest(kh, { skuId: "s", locationId: A, ...NO_EXTRAS, deliveryId: "d-b" }))).toEqual({ status: 404, code: "delivery_not_found" });
    expect(await refused(filePackChangeRequest(kh, { skuId: "s", locationId: A, ...NO_EXTRAS, photoId: "p-b" }))).toEqual({ status: 404, code: "photo_not_found" });
    expect(await refused(filePackChangeRequest(kh, { skuId: "s-owned-b", locationId: A, ...NO_EXTRAS }))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
    expect(await refused(filePackChangeRequest(kh, { skuId: "nope", locationId: A, ...NO_EXTRAS }))).toEqual({ status: 404, code: "sku_not_found" });
    expect(current.writes).toEqual([]);
  });
});

describe("reading the open list", () => {
  const withRequests = () => ({
    ...world(),
    sku_pack_change_requests: [
      { id: "r1", sku_id: "s", location_id: A, status: "open", filed_by: "kh", filed_at: "2026-10-15T10:00:00Z", note: null, proposal: null, photo_id: "p-a" },
      { id: "r2", sku_id: "s", location_id: B, status: "open", filed_by: "gm-b", filed_at: "2026-10-15T11:00:00Z", note: "x", proposal: null },
      { id: "r3", sku_id: "s", location_id: A, status: "dismissed", filed_by: "kh", filed_at: "2026-10-15T12:00:00Z", note: null, proposal: null },
    ] as Row[],
  });
  it("the social media manager is refused, never handed a list", async () => {
    current = createFakeDb(withRequests());
    expect(await refused(loadOpenPackChangeRequests(actor("social_media_mgr", 6, [A]), { locationIds: [A] }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("an AGM sees only their shop's OPEN reports; an unassigned MoO sees every shop's, newest first", async () => {
    current = createFakeDb(withRequests());
    expect((await loadOpenPackChangeRequests(actor("agm", 6, [A]), { locationIds: [A, B] })).map((r) => [r.id, r.skuName, r.filedBy, r.photoId])).toEqual([["r1", "Turkey", "Kai", "p-a"]]);
    expect((await loadOpenPackChangeRequests(actor("moo", 8, []), { locationIds: [A, B] })).map((r) => r.id)).toEqual(["r2", "r1"]);
  });
});

describe("dismiss is bound to the report's SKU and shop, and a reviewer role", () => {
  const open = (sku: string, loc: string, status = "open") => ({ ...world(), sku_pack_change_requests: [{ id: "r1", sku_id: sku, location_id: loc, status }] as Row[] });
  it("a shift lead and the social media manager are refused before any read", async () => {
    expect(await refused(dismissPackChangeRequest(actor("shift_lead", 5, [A]), { requestId: "r", skuId: "s" }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(dismissPackChangeRequest(actor("social_media_mgr", 6, [A]), { requestId: "r", skuId: "s" }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("a report for another SKU cannot be dismissed through this SKU's page (404)", async () => {
    current = createFakeDb(open("s-other", A));
    expect(await refused(dismissPackChangeRequest(actor("gm", 7, [A]), { requestId: "r1", skuId: "s" }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a GM elsewhere cannot dismiss shop B's report (404), and nothing is written", async () => {
    current = createFakeDb(open("s", B));
    expect(await refused(dismissPackChangeRequest(actor("gm", 7, [A]), { requestId: "r1", skuId: "s" }))).toEqual({ status: 404, code: "not_found" });
    expect(current.writes).toEqual([]);
  });
  it("an UNASSIGNED MoO dismisses shop B's report (D2): the row is closed and audited", async () => {
    current = createFakeDb(open("s", B));
    await dismissPackChangeRequest(actor("moo", 8, [], "moo"), { requestId: "r1", skuId: "s" });
    const row = current.writes.find((w) => w.table === "sku_pack_change_requests")!.rows[0]!;
    expect(row).toMatchObject({ id: "r1", status: "dismissed", resolved_by: "moo" });
    expect(typeof row.resolved_at).toBe("string");
    expect(current.writes.filter((w) => w.table === "audit_log").flatMap((w) => w.rows.map((x) => [x.action, (x.metadata as Row).outcome])))
      .toEqual([["sku.pack_change_request.resolve", "dismissed"]]);
  });
  it("a report already closed is 409 already_resolved", async () => {
    current = createFakeDb(open("s", A, "applied"));
    expect(await refused(dismissPackChangeRequest(actor("gm", 7, [A]), { requestId: "r1", skuId: "s" }))).toEqual({ status: 409, code: "already_resolved" });
  });
});

describe("the REPORT-BOUND photo read (Astra 2b r2)", () => {
  const photoWorld = () => ({
    ...world(),
    photos: [{ id: "p-a", location_id: A, storage_path: "a/door.png" }, { id: "p-a2", location_id: A, storage_path: "a/second.png" },
      { id: "p-other", location_id: A, storage_path: "a/unrelated.png" }, { id: "p-b", location_id: B, storage_path: "b/x.png" }] as Row[],
    sku_pack_change_requests: [{ id: "r1", sku_id: "s", location_id: A, status: "open", photo_id: "p-a" }, { id: "r-nophoto", sku_id: "s", location_id: A, status: "open", photo_id: null }] as Row[],
    sku_pack_change_request_additions: [{ id: "add-1", request_id: "r1", photo_id: "p-a2" }, { id: "add-x", request_id: "r-nophoto", photo_id: "p-other" }] as Row[],
  });
  it("a MoO WITHOUT a membership at the report's shop gets the report's photo, and an addition's (200 → signed)", async () => {
    current = createFakeDb(photoWorld());
    const moo = actor("moo", 8, [], "moo");
    expect(await signPackRequestPhoto(moo, { requestId: "r1", additionId: null })).toEqual({ signedUrl: "https://signed/photos/a/door.png?ttl=60" });
    expect(await signPackRequestPhoto(moo, { requestId: "r1", additionId: "add-1" })).toEqual({ signedUrl: "https://signed/photos/a/second.png?ttl=60" });
  });
  it("a GM of the OTHER shop is 404; the social media manager is refused before any read", async () => {
    current = createFakeDb(photoWorld());
    expect(await refused(signPackRequestPhoto(actor("gm", 7, [B]), { requestId: "r1", additionId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(signPackRequestPhoto(actor("social_media_mgr", 6, [A]), { requestId: "r1", additionId: null }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("only the photo STORED on that report / addition is ever signed: another report's addition, a report with no photo, a missing report → 404", async () => {
    current = createFakeDb(photoWorld());
    const gm = actor("gm", 7, [A]);
    expect(await refused(signPackRequestPhoto(gm, { requestId: "r1", additionId: "add-x" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(signPackRequestPhoto(gm, { requestId: "r-nophoto", additionId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(signPackRequestPhoto(gm, { requestId: "nope", additionId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(await signPackRequestPhoto(gm, { requestId: "r1", additionId: null })).toEqual({ signedUrl: "https://signed/photos/a/door.png?ttl=60" });
  });
  it("a stored photo that is not the report shop's is never signed (404)", async () => {
    const w = photoWorld();
    (w.sku_pack_change_requests[0] as Row).photo_id = "p-b";
    current = createFakeDb(w);
    expect(await refused(signPackRequestPhoto(actor("moo", 8, []), { requestId: "r1", additionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("the routes go through it, and lib/photos.ts was not widened", () => {
    for (const f of ["app/api/admin/catalog/pack-requests/[requestId]/photo/route.ts", "app/api/admin/catalog/pack-requests/[requestId]/additions/[additionId]/photo/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("signPackRequestPhoto(ctx,");
      expect(src).toContain("requireSession(");
      expect(src).not.toContain("assertStepUp");
    }
    const photos = readFileSync("lib/photos.ts", "utf8");
    expect(photos).toContain("if (!lockLocationContext(actorLoc(actor), row.location_id)) {");
    expect(readFileSync("components/catalog/DoorPhoto.tsx", "utf8")).not.toContain("/api/photos/");
  });
});
