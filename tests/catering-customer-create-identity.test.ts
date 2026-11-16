/**
 * W23/B130 (owner decision W23-2 a) — adding a catering customer by hand with an email an existing
 * contact already holds: an ACTIVE holder was a bare 23505 → 500, a DEACTIVATED holder forked the
 * person into a second identity. Both are now refused BEFORE any write with a typed 409; an insert
 * that loses a race on the partial unique index is a 409 too. editCustomer refuses the same way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
let rows: Row[];
let inserts: Row[];
let updates: Row[];
let insertError: { code: string; message: string } | null;

function builder() {
  const preds: Array<(r: Row) => boolean> = [];
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  let single = false;
  const unescape = (s: string) => s.replace(/\\([\\%_])/g, "$1");
  const run = () => {
    if (mode === "insert") {
      if (insertError) return { data: null, error: insertError };
      inserts.push(payload!);
      return { data: { id: "new-id" }, error: null };
    }
    const matched = rows.filter((r) => preds.every((p) => p(r)));
    if (mode === "update") { updates.push(payload!); matched.forEach((r) => Object.assign(r, payload)); return { error: null, count: matched.length }; }
    return { data: single ? (matched[0] ?? null) : matched, error: null };
  };
  const q = {
    select() { return q; },
    eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return q; },
    neq(c: string, v: unknown) { preds.push((r) => r[c] !== v); return q; },
    ilike(c: string, v: string) { preds.push((r) => typeof r[c] === "string" && (r[c] as string).toLowerCase() === unescape(v).toLowerCase()); return q; },
    limit() { return q; },
    returns() { return q; },
    maybeSingle() { single = true; return q; },
    single() { single = true; return q; },
    insert(p: Row) { mode = "insert"; payload = p; return q; },
    update(p: Row) { mode = "update"; payload = p; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return q;
}

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: () => builder() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));

import { createCustomer, editCustomer } from "@/lib/catering/customers";

const LOC = "00000000-0000-4000-8000-0000000000a1";
const mgr = { user: { id: "u-cm", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: [LOC] } as unknown as AuthContext;

beforeEach(() => {
  rows = [
    { id: "x-active", email: "taken@corp.com", active: true, primary_location_id: LOC },
    { id: "x-dormant", email: "Dormant@Corp.com", active: false, primary_location_id: LOC },
    { id: "me", email: "me@corp.com", active: true, primary_location_id: LOC },
  ];
  inserts = []; updates = []; insertError = null;
});

describe("W23/B130 createCustomer checks existing contacts first", () => {
  it("an active contact's email is 409 email_taken and nothing is inserted", async () => {
    await expect(createCustomer(mgr, { name: "A", email: " TAKEN@corp.com ", primaryLocationId: LOC }))
      .rejects.toMatchObject({ status: 409, code: "email_taken" });
    expect(inserts).toHaveLength(0);
  });

  it("a deactivated contact's email is 409 email_inactive_contact (reactivate it) and nothing is inserted", async () => {
    await expect(createCustomer(mgr, { name: "A", email: "dormant@corp.com", primaryLocationId: LOC }))
      .rejects.toMatchObject({ status: 409, code: "email_inactive_contact" });
    expect(inserts).toHaveLength(0);
  });

  it("a race lost on the partial unique index is 409 email_taken, not a 500", async () => {
    insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    await expect(createCustomer(mgr, { name: "A", email: "fresh@corp.com", primaryLocationId: LOC }))
      .rejects.toMatchObject({ status: 409, code: "email_taken" });
  });

  it("an unrelated email inserts as before (lowercased)", async () => {
    expect(await createCustomer(mgr, { name: "A", email: "New@Corp.com", primaryLocationId: LOC })).toEqual({ id: "new-id" });
    expect(inserts[0]).toMatchObject({ email: "new@corp.com", active: true });
  });

  it("no email skips the lookup and inserts", async () => {
    expect(await createCustomer(mgr, { name: "A", primaryLocationId: LOC })).toEqual({ id: "new-id" });
    expect(inserts[0]).toMatchObject({ email: null });
  });
});

describe("W23/B130 editCustomer refuses another contact's email", () => {
  it("retyping a deactivated contact's email is 409 email_inactive_contact and nothing is updated", async () => {
    await expect(editCustomer(mgr, "me", { email: "dormant@corp.com" }))
      .rejects.toMatchObject({ status: 409, code: "email_inactive_contact" });
    expect(updates).toHaveLength(0);
  });

  it("keeping one's own email is not a conflict", async () => {
    await editCustomer(mgr, "me", { email: "ME@corp.com", name: "Me" });
    expect(updates[0]).toMatchObject({ email: "me@corp.com", name: "Me" });
  });
});
