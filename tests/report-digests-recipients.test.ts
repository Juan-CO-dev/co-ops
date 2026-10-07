import { describe, expect, it } from "vitest";
import {
  expectedDeliveries,
  resolveDigestRecipients,
  type DigestDirectory,
  type DirectoryUser,
  type RecipientOverride,
} from "@/lib/report-digests-shared";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const user = (id: string, role: string, extra: Partial<DirectoryUser> = {}): DirectoryUser =>
  ({ id, name: id, email: `${id}@example.com`, role, language: "en", active: true, ...extra });
const override = (userId: string, extra: Partial<RecipientOverride> = {}): RecipientOverride => ({
  id: `ov-${userId}`, kind: "internal", userId, email: null, displayName: userId, active: true,
  cateringDigest: false, shopDigest: false, locationIds: null, ...extra,
});

function dir(users: DirectoryUser[], memberships: Array<[string, string]> = [], overrides: RecipientOverride[] = []): DigestDirectory {
  return { users, memberships: memberships.map(([userId, locationId]) => ({ userId, locationId })), overrides, locationIds: [A, B] };
}

describe("GM per-shop digest", () => {
  it("a GM gets exactly their own shop(s), nobody else's", () => {
    const d = dir([user("gm1", "gm"), user("gm2", "gm")], [["gm1", A], ["gm2", B], ["gm2", A]]);
    const r = resolveDigestRecipients("gm_shop", d);
    expect(r.find((x) => x.userId === "gm1")?.locationIds).toEqual([A]);
    expect(r.find((x) => x.userId === "gm2")?.locationIds).toEqual([A, B]);
    expect(expectedDeliveries("gm_shop", r)).toHaveLength(3);
  });

  it("AGMs, owners and catering managers are not per-shop recipients (Q2: role gm only)", () => {
    const d = dir([user("agm", "agm"), user("own", "owner"), user("keith", "catering_mgr")], [["agm", A], ["keith", A]]);
    expect(resolveDigestRecipients("gm_shop", d)).toEqual([]);
  });

  it("an internal override with shop_digest adds a non-GM for its shops", () => {
    const d = dir([user("agm", "agm")], [["agm", A]], [override("agm", { shopDigest: true })]);
    expect(resolveDigestRecipients("gm_shop", d)[0]?.locationIds).toEqual([A]);
  });

  it("an inactive membership location is never a shop", () => {
    const d = { ...dir([user("gm1", "gm")], [["gm1", "cccccccc-0000-4000-8000-000000000003"]]), locationIds: [A, B] };
    expect(resolveDigestRecipients("gm_shop", d)[0]).toMatchObject({ locationIds: [], skip: "no_locations" });
  });
});

describe("unified digest", () => {
  it("every active level ≥ 8 gets all shops; level 7 does not", () => {
    const d = dir([user("moo", "moo"), user("own", "owner"), user("cgs", "cgs"), user("gm1", "gm"), user("gone", "owner", { active: false })]);
    const r = resolveDigestRecipients("unified", d);
    expect(r.map((x) => x.userId).sort()).toEqual(["cgs", "moo", "own"]);
    for (const x of r) expect(x).toMatchObject({ locationIds: [A, B], allShops: true, skip: null });
  });

  it("location_ids on an override never narrows the unified digest", () => {
    const d = dir([user("moo", "moo")], [], [override("moo", { locationIds: [A] })]);
    expect(resolveDigestRecipients("unified", d)[0]?.locationIds).toEqual([A, B]);
  });
});

describe("catering digest", () => {
  it("Keith by role: his memberships, or every shop when he has none", () => {
    const scoped = dir([user("keith", "catering_mgr")], [["keith", B]]);
    expect(resolveDigestRecipients("catering", scoped)[0]).toMatchObject({ locationIds: [B], allShops: false });
    const unscoped = dir([user("keith", "catering_mgr")]);
    expect(resolveDigestRecipients("catering", unscoped)[0]).toMatchObject({ locationIds: [A, B], allShops: true });
  });

  it("each GM for their shop, level ≥ 8 for all shops, crew never", () => {
    const d = dir([user("gm1", "gm"), user("moo", "moo"), user("kh", "key_holder"), user("agm", "agm")], [["gm1", A], ["kh", A], ["agm", A]]);
    const r = resolveDigestRecipients("catering", d);
    expect(r.map((x) => [x.userId, x.locationIds])).toEqual([["gm1", [A]], ["moo", [A, B]]]);
  });

  it("the catering_digest flag adds anyone, scoped to location_ids when set", () => {
    const d = dir([user("sl", "shift_lead")], [["sl", A]], [override("sl", { cateringDigest: true, locationIds: [B] })]);
    expect(resolveDigestRecipients("catering", d)[0]?.locationIds).toEqual([B]);
  });

  it("speaks the recipient's language", () => {
    const d = dir([user("keith", "catering_mgr", { language: "es" })]);
    expect(resolveDigestRecipients("catering", d)[0]?.language).toBe("es");
  });
});

describe("skips are named, never silent", () => {
  it("no email → no_email (and the email is normalised when present)", () => {
    const d = dir([user("moo", "moo", { email: null }), user("own", "owner", { email: "  Pete@Example.COM " })]);
    const r = resolveDigestRecipients("unified", d);
    expect(r.find((x) => x.userId === "moo")?.skip).toBe("no_email");
    expect(r.find((x) => x.userId === "own")).toMatchObject({ email: "pete@example.com", skip: null });
  });

  it("an override with active=false → recipient_disabled", () => {
    const d = dir([user("moo", "moo")], [], [override("moo", { active: false })]);
    expect(resolveDigestRecipients("unified", d)[0]?.skip).toBe("recipient_disabled");
  });

  it("an inactive user named by an override → inactive; external rows never get a digest", () => {
    const ext: RecipientOverride = { ...override("x"), id: "ext", kind: "external", userId: null, email: "acct@example.com", cateringDigest: false };
    const d = dir([user("sl", "shift_lead", { active: false })], [], [override("sl", { cateringDigest: true }), ext]);
    expect(resolveDigestRecipients("catering", d)).toEqual([expect.objectContaining({ userId: "sl", skip: "inactive" })]);
  });
});
