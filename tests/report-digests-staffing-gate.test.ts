/**
 * Digests round 3, PR 2 (plan §1.1, §1.2, §2.1): the two DIGEST-ONLY grants of Juan 2026-11-27 in the data gate
 * (lib/report-digests-access-shared.ts) and the delivery the engine binds into every digest send.
 *   (a) `published_staffing`: scheduled staff in a digest for more roles than the schedule screen allows.
 *   (b) `sales_detail`: a flagged AGM or prep manager on the SHOP digest sees PR 3's sales detail for their own shop.
 *
 * THE EXPECTED TABLES BELOW ARE WRITTEN BY HAND FROM THE RULES, never derived from the function under test.
 */
import { describe, expect, it, vi } from "vitest";
import { digestAccessFor, digestCan, type DigestAccess, type DigestCapability, type DigestDelivery } from "@/lib/report-digests-access-shared";
import { canOpen, NO_ACCESS_VIEWER, type LinkViewer } from "@/lib/report-digests-links";
import { ROLES, type RoleCode } from "@/lib/roles";
import { runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestIO, type SendOutcome } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type RecipientOverride, type SendLogRow } from "@/lib/report-digests-shared";
import type { Envelope } from "@/lib/report-digests-compose";
import type { PackageIO, PackageRecipientRow } from "@/lib/report-package-shared";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const DAY = "2026-10-07";

const viewer = (role: string, locations: string[]): LinkViewer =>
  ({ role, level: role in ROLES ? ROLES[role as RoleCode].level : 9, locations });
const access = (role: string, locations: string[], digest?: DigestDelivery): DigestAccess | null => digestAccessFor(viewer(role, locations), digest);
const can = (a: DigestAccess | null, cap: DigestCapability, locationId: string | null, day = DAY) => digestCan(a, cap, { locationId, day });

// ── the pure matrix ──────────────────────────────────────────────────────────────────────────────
// The shop asked about is always A. Each cell string is four answers, in this order:
//   [A in digest.shops AND in memberships, A in digest.shops only, A in memberships only, A in neither]
// "in memberships only" = the viewer belongs to A but the delivery (a narrowed override) is B only;
// "in neither" = the viewer belongs to B and the delivery is B. Columns: gm_shop, unified, catering, no digest.
type Cells = [gm_shop: string, unified: string, catering: string, none: string];
const ROLE_CODES = Object.keys(ROLES) as RoleCode[];
const STAFFING: Record<string, Cells> = {
  cgs:                  ["1100", "1100", "1100", "0000"],
  owner:                ["1100", "1100", "1100", "0000"],
  moo:                  ["1100", "1100", "1100", "0000"],
  gm:                   ["1000", "1000", "1000", "0000"],
  agm:                  ["1000", "1000", "1000", "0000"],
  catering_mgr:         ["1000", "1000", "1000", "0000"],
  prep_mgr:             ["1000", "1000", "1000", "0000"],
  social_media_mgr:     ["0000", "0000", "0000", "0000"],
  shift_lead:           ["0000", "0000", "1000", "0000"],
  key_holder:           ["0000", "0000", "0000", "0000"],
  trainer:              ["0000", "0000", "0000", "0000"],
  employee:             ["0000", "0000", "0000", "0000"],
  trainee:              ["0000", "0000", "0000", "0000"],
  hired_not_yet_worked: ["0000", "0000", "0000", "0000"],
  prospect:             ["0000", "0000", "0000", "0000"],
  regional_wizard:      ["0000", "0000", "0000", "0000"], // an unknown role string, given level 9: nobody
};
// sales_detail = the Sales page gate (level 7+, own shop below 8; membership alone decides for a GM, the delivery
// never matters) OR (b): agm / prep_mgr, gm_shop digest, A delivered AND a membership.
const SALES: Record<string, Cells> = {
  cgs:                  ["1111", "1111", "1111", "1111"],
  owner:                ["1111", "1111", "1111", "1111"],
  moo:                  ["1111", "1111", "1111", "1111"],
  gm:                   ["1010", "1010", "1010", "1010"],
  agm:                  ["1000", "0000", "0000", "0000"],
  catering_mgr:         ["0000", "0000", "0000", "0000"],
  prep_mgr:             ["1000", "0000", "0000", "0000"],
  social_media_mgr:     ["0000", "0000", "0000", "0000"],
  shift_lead:           ["0000", "0000", "0000", "0000"],
  key_holder:           ["0000", "0000", "0000", "0000"],
  trainer:              ["0000", "0000", "0000", "0000"],
  employee:             ["0000", "0000", "0000", "0000"],
  trainee:              ["0000", "0000", "0000", "0000"],
  hired_not_yet_worked: ["0000", "0000", "0000", "0000"],
  prospect:             ["0000", "0000", "0000", "0000"],
  regional_wizard:      ["0000", "0000", "0000", "0000"],
};
const KINDS = ["gm_shop", "unified", "catering", null] as const;
const CELLS: Array<{ name: string; shops: string[]; memberships: string[] }> = [
  { name: "delivered + member", shops: [A, B], memberships: [A] },
  { name: "delivered, not a member", shops: [A, B], memberships: [B] },
  { name: "member, not delivered (narrowed)", shops: [B], memberships: [A] },
  { name: "neither", shops: [B], memberships: [B] },
];

describe("the digest-only grants: every role × digest kind × shop delivered / not × member / not (hand-written)", () => {
  it("the table covers every role code in lib/roles.ts, plus an unknown role", () => {
    expect(Object.keys(STAFFING).sort()).toEqual([...ROLE_CODES, "regional_wizard"].sort());
    expect(Object.keys(SALES).sort()).toEqual([...ROLE_CODES, "regional_wizard"].sort());
  });
  for (const [label, table] of [["published_staffing", STAFFING], ["sales_detail", SALES]] as const) {
    for (const role of Object.keys(table)) {
      KINDS.forEach((kind, k) => {
        CELLS.forEach((cell, c) => {
          const expected = table[role]![k]![c] === "1";
          it(`${label}: ${role} · ${kind ?? "no digest"} · ${cell.name} → ${expected ? "yes" : "no"}`, () => {
            const a = access(role, cell.memberships, kind ? { kind, shops: cell.shops } : undefined);
            expect(can(a, label, A)).toBe(expected);
          });
        });
      });
    }
  }
});

describe('"all", a null shop, an invalid day, a null access and a null viewer', () => {
  const full: DigestDelivery = { kind: "gm_shop", shops: [A, B] };
  it('"all" is never a shop for a digest-only grant; the Sales page path keeps its own "all" (level 8+ only)', () => {
    for (const role of Object.keys(STAFFING)) {
      for (const kind of ["gm_shop", "unified", "catering"] as const) {
        const a = access(role, [A, B], { kind, shops: [A, B, "all"] });
        expect(can(a, "published_staffing", "all"), `${role} ${kind}`).toBe(false);
        expect(can(a, "sales_detail", "all"), `${role} ${kind}`).toBe(["moo", "owner", "cgs"].includes(role));
      }
    }
  });
  it("a null shop (no shop set) is no, for every role, both capabilities", () => {
    for (const role of Object.keys(STAFFING)) {
      const a = access(role, [A], full);
      expect(can(a, "published_staffing", null), role).toBe(false);
      expect(can(a, "sales_detail", null), role).toBe(false);
    }
  });
  it("an invalid day is no, even for the owner and a GM at their own delivered shop", () => {
    for (const day of ["", "2026-02-31", "2026-13-01", "yesterday", "2026-10-07T00:00:00Z"]) {
      for (const role of ["owner", "gm", "agm", "shift_lead"]) {
        const a = access(role, [A], { kind: "catering", shops: [A] });
        expect(can(a, "published_staffing", A, day), `${role} ${day}`).toBe(false);
        expect(can(access(role, [A], full), "sales_detail", A, day), `${role} ${day}`).toBe(false);
      }
    }
  });
  it("a null / absent access and a null viewer get nothing; an access without a digest gets no digest-only grant", () => {
    for (const cap of ["published_staffing", "sales_detail"] as const) {
      expect(digestCan(null, cap, { locationId: A, day: DAY })).toBe(false);
      expect(digestCan(undefined, cap, { locationId: A, day: DAY })).toBe(false);
      expect(digestAccessFor(null, full)).toBeNull();
      expect(digestAccessFor(undefined, full)).toBeNull();
      expect(can(digestAccessFor(NO_ACCESS_VIEWER, full), cap, A)).toBe(false);
    }
    expect(can(access("owner", []), "published_staffing", A)).toBe(false);
    expect(can(access("agm", [A]), "sales_detail", A)).toBe(false);
    expect(can(digestAccessFor(viewer("agm", [A]), null), "sales_detail", A)).toBe(false);
  });
});

describe("the named cases of the packet", () => {
  const cases: Array<[string, DigestAccess | null, DigestCapability, string, boolean]> = [
    ["social media manager, flagged, own delivered shop: staffing no", access("social_media_mgr", [A], { kind: "gm_shop", shops: [A] }), "published_staffing", A, false],
    ["social media manager, flagged, own delivered shop: sales no", access("social_media_mgr", [A], { kind: "gm_shop", shops: [A] }), "sales_detail", A, false],
    ["social media manager on a catering digest: staffing no", access("social_media_mgr", [A], { kind: "catering", shops: [A] }), "published_staffing", A, false],
    ["unknown role string (level 9 claimed): staffing no", access("regional_wizard", [A], { kind: "unified", shops: [A] }), "published_staffing", A, false],
    ["unknown role string: sales no", access("regional_wizard", [A], { kind: "gm_shop", shops: [A] }), "sales_detail", A, false],
    ["key holder on a catering digest, own shop: staffing no", access("key_holder", [A], { kind: "catering", shops: [A] }), "published_staffing", A, false],
    ["shift lead on a gm_shop digest, own shop: staffing no", access("shift_lead", [A], { kind: "gm_shop", shops: [A] }), "published_staffing", A, false],
    ["shift lead on catering, own shop: staffing YES", access("shift_lead", [A], { kind: "catering", shops: [A] }), "published_staffing", A, true],
    ["shift lead on catering, own shop: sales no", access("shift_lead", [A], { kind: "catering", shops: [A] }), "sales_detail", A, false],
    ["AGM on a catering digest, own shop: staffing YES", access("agm", [A], { kind: "catering", shops: [A] }), "published_staffing", A, true],
    ["AGM on a catering digest, own shop: sales_detail NO", access("agm", [A], { kind: "catering", shops: [A] }), "sales_detail", A, false],
    ["AGM on a gm_shop digest, own shop: sales_detail YES (b)", access("agm", [A], { kind: "gm_shop", shops: [A] }), "sales_detail", A, true],
    ["prep manager on a gm_shop digest, own shop: sales_detail YES (b)", access("prep_mgr", [A], { kind: "gm_shop", shops: [A] }), "sales_detail", A, true],
    ["catering manager on gm_shop, own shop: staffing YES", access("catering_mgr", [A], { kind: "gm_shop", shops: [A] }), "published_staffing", A, true],
    ["catering manager on gm_shop, own shop: sales_detail no", access("catering_mgr", [A], { kind: "gm_shop", shops: [A] }), "sales_detail", A, false],
    ["AGM, member of A, delivery narrowed to B: staffing at A no", access("agm", [A, B], { kind: "gm_shop", shops: [B] }), "published_staffing", A, false],
    ["AGM, member of A, delivery narrowed to B: sales at A no", access("agm", [A, B], { kind: "gm_shop", shops: [B] }), "sales_detail", A, false],
    ["AGM, A delivered but not a member: staffing no", access("agm", [B], { kind: "gm_shop", shops: [A, B] }), "published_staffing", A, false],
    ["AGM, A delivered but not a member: sales no", access("agm", [B], { kind: "gm_shop", shops: [A, B] }), "sales_detail", A, false],
    ["level 8, no memberships, A delivered: staffing yes", access("moo", [], { kind: "unified", shops: [A, B] }), "published_staffing", A, true],
    ["level 8, no memberships, B delivered: staffing yes", access("moo", [], { kind: "unified", shops: [A, B] }), "published_staffing", B, true],
    ["level 8, no memberships, C not delivered: staffing no", access("moo", [], { kind: "unified", shops: [A, B] }), "published_staffing", C, false],
    ["owner, no memberships, C not delivered: staffing no", access("owner", [], { kind: "catering", shops: [A, B] }), "published_staffing", C, false],
    ["catering manager with no membership (fallback: all shops delivered): staffing no (O1)", access("catering_mgr", [], { kind: "catering", shops: [A, B] }), "published_staffing", A, false],
  ];
  it.each(cases)("%s", (_name, a, cap, loc, expected) => {
    expect(can(a, cap, loc)).toBe(expected);
  });

  it("the role read is the CLOSED allowlist, never the level the viewer carries", () => {
    // A social media manager claiming level 9 and an AGM claiming level 8 do not become level 8+.
    expect(can(digestAccessFor({ role: "social_media_mgr", level: 9, locations: [A] }, { kind: "unified", shops: [A] }), "published_staffing", A)).toBe(false);
    expect(can(digestAccessFor({ role: "agm", level: 8, locations: [] }, { kind: "unified", shops: [A] }), "published_staffing", A)).toBe(false);
  });

  it("digestAccessFor copies the delivery (a later change to the caller's array grants nothing)", () => {
    const shops = [A];
    const a = digestAccessFor(viewer("agm", [A, B]), { kind: "gm_shop", shops });
    shops.push(B);
    expect(can(a, "published_staffing", B)).toBe(false);
    expect(digestAccessFor(viewer("gm", [A]))).toEqual({ viewer: viewer("gm", [A]) });
  });
});

describe("sales_detail without a digest is exactly today's Sales page gate", () => {
  for (const role of [...ROLE_CODES, "regional_wizard"]) {
    for (const memberships of [[A], [B], [], [A, B]]) {
      for (const loc of [A, B, "all"]) {
        it(`${role} · member of [${memberships.map((m) => m.slice(0, 1)).join(",")}] · ${loc === "all" ? "all" : loc.slice(0, 1)}`, () => {
          const v = viewer(role, memberships);
          expect(digestCan({ viewer: v }, "sales_detail", { locationId: loc, day: DAY })).toBe(canOpen(v, { to: "sales", location: loc, day: DAY }));
        });
      }
    }
  }
});

// ── the engine binds the delivery ─────────────────────────────────────────────────────────────────

const envelopes = vi.hoisted(() => [] as Array<{ kind: string; env: Envelope }>);
vi.mock("@/lib/report-digests-compose", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/report-digests-compose")>();
  return {
    ...real,
    renderShopDigest: (f: Parameters<typeof real.renderShopDigest>[0], env: Envelope) => { envelopes.push({ kind: "gm_shop", env }); return real.renderShopDigest(f, env); },
    renderUnifiedDigest: (x: Parameters<typeof real.renderUnifiedDigest>[0], env: Envelope) => { envelopes.push({ kind: "unified", env }); return real.renderUnifiedDigest(x, env); },
    renderCateringDigest: (f: Parameters<typeof real.renderCateringDigest>[0], s: Parameters<typeof real.renderCateringDigest>[1], env: Envelope) => { envelopes.push({ kind: "catering", env }); return real.renderCateringDigest(f, s, env); },
  };
});

const HOLDS = new Set(["claimed", "sent", "ambiguous", "failed_ambiguous"]);
type Row = SendLogRow & { id: string; error: string | null };
/** The smallest in-memory send log the engine needs (the same guarded transitions as tests/report-digests-send.test.ts). */
class Store {
  rows: Row[] = [];
  private seq = 0;
  private key(r: ClaimRow) { return [r.recipient_ref, r.kind, r.business_day, r.revision, r.mode, r.location_id ?? ""].join("|"); }
  async claim(r: ClaimRow) {
    if (this.rows.some((x) => HOLDS.has(x.outcome) && this.key(x as ClaimRow) === this.key(r))) return "duplicate" as const;
    const id = `row-${++this.seq}`;
    this.rows.push({ ...r, id, outcome: "claimed", skip_reason: null, attempted_at: "2026-10-08T00:00:00Z", error: null, first_attempt_at: null, provider_message_id: null });
    return { id };
  }
  async markAttempt(id: string, patch: { first_attempt_at: string; idempotency_key: string }) {
    const row = this.rows.find((x) => x.id === id && x.outcome === "claimed" && !x.first_attempt_at);
    if (!row) return false;
    row.first_attempt_at = patch.first_attempt_at;
    return true;
  }
  async recordAccepted(id: string, patch: { provider_message_id: string; sent_at: string }) {
    const row = this.rows.find((x) => x.id === id && (x.outcome === "claimed" || x.outcome === "ambiguous"));
    if (!row) return false;
    row.provider_message_id = patch.provider_message_id;
    return true;
  }
  async reclaim() { return false; }
  async finish(id: string, from: SendOutcome[], patch: { outcome: string; error?: string | null }) {
    const row = this.rows.find((x) => x.id === id && (from as string[]).includes(x.outcome));
    if (!row) return false;
    Object.assign(row, { outcome: patch.outcome, error: patch.error ?? null });
    return true;
  }
  async skip(r: ClaimRow & { skip_reason: string }) {
    this.rows.push({ ...r, id: `row-${++this.seq}`, outcome: "skipped", attempted_at: "2026-10-08T00:00:00Z", error: null, first_attempt_at: null, provider_message_id: null });
  }
}

// Synthetic people only. Two shops; memberships below.
const users = [
  { id: "gm-a", name: "Person A", email: "a@example.com", role: "gm", language: "en", active: true },
  { id: "agm-a", name: "Person B", email: "b@example.com", role: "agm", language: "en", active: true },
  { id: "gm-ab", name: "Person C", email: "c@example.com", role: "gm", language: "es", active: true },
  { id: "own", name: "Person D", email: "d@example.com", role: "owner", language: "en", active: true },
  { id: "sl-a", name: "Person E", email: "e@example.com", role: "shift_lead", language: "en", active: true },
];
const memberships = [
  { userId: "gm-a", locationId: A }, { userId: "agm-a", locationId: A },
  { userId: "gm-ab", locationId: A }, { userId: "gm-ab", locationId: B },
  { userId: "sl-a", locationId: A },
];
const ov = (id: string, userId: string, o: Partial<RecipientOverride>): RecipientOverride =>
  ({ id, kind: "internal", userId, email: null, displayName: "x", active: true, cateringDigest: false, shopDigest: false, locationIds: null, ...o });
const overrides = [
  ov("o1", "agm-a", { shopDigest: true }),                                         // a flagged AGM
  ov("o2", "gm-ab", { shopDigest: true, cateringDigest: true, locationIds: [A] }), // narrowed to one of two shops
  ov("o3", "sl-a", { cateringDigest: true }),                                      // a catering-only shift lead
];
const ownerPackageRow: PackageRecipientRow = {
  id: "11111111-1111-4111-8111-111111111111", kind: "internal", user_id: "own", email: null, display_name: "Person D", active: true,
  location_ids: null, packages: ["sales"], cadence: "daily_close", formats: ["csv"],
};

function makeIO(now: string, packageEnvs: Envelope[] = []): DigestIO {
  const store = new Store();
  const packages: PackageIO = {
    recipients: async () => [ownerPackageRow],
    compose: async (_r, cadence, day, env) => { packageEnvs.push(env); return { subject: `PACKAGE ${cadence} ${day}`, html: "<p>files</p>", text: "files", attachments: [] }; },
    recordSend: async () => {},
  };
  let n = 0;
  return {
    now: new Date(now), baseUrl: "https://ops.example.com",
    previewRecipient: async () => "operator@example.com",
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live" }),
    directory: async () => ({ dir: { users, memberships, overrides, locationIds: [A, B] }, locations: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }] }),
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set([A, B])])),
    shopFacts: async (location, day) => ({ location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null }),
    cateringFacts: async (today) => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] }),
    store,
    sendEmail: async () => ({ id: `mail-${++n}` }),
    sha: (c) => String(c.length),
    alert: async () => true,
    packages,
    recordRun: async () => {},
  };
}

/** The envelope a compose received for one digest kind and one recipient (by their role and memberships). */
function envFor(kind: string, role: string, locations: string[]): Envelope[] {
  return envelopes.filter((e) => e.kind === kind && e.env.viewer?.role === role && JSON.stringify(e.env.viewer.locations) === JSON.stringify(locations)).map((e) => e.env);
}

describe("the engine binds { kind, shops } of the resolved recipient into every digest send (and none into a package)", () => {
  it("closing: shop digests for a GM, a flagged AGM and a recipient narrowed to one of two shops; the unified for level 8", async () => {
    envelopes.length = 0;
    const packageEnvs: Envelope[] = [];
    const io = makeIO("2026-10-08T02:30:00Z", packageEnvs); // one send log: A's finalize, then B's (the last shop)
    await runClosingDigestsWith(io, A, DAY);
    await runClosingDigestsWith(io, B, DAY);
    // A GM of A: their shop digest is delivered for A.
    expect(envFor("gm_shop", "gm", [A]).map((e) => e.access?.digest)).toEqual([{ kind: "gm_shop", shops: [A] }]);
    // A flagged AGM (override shop_digest): delivered for their own shop.
    const agm = envFor("gm_shop", "agm", [A]);
    expect(agm.map((e) => e.access?.digest)).toEqual([{ kind: "gm_shop", shops: [A] }]);
    expect(digestCan(agm[0]!.access, "sales_detail", { locationId: A, day: DAY })).toBe(true);
    expect(digestCan(agm[0]!.access, "published_staffing", { locationId: A, day: DAY })).toBe(true);
    // A GM of A and B narrowed by an override to A: one shop digest, `shops` = [A]; nothing for B.
    const narrowed = envFor("gm_shop", "gm", [A, B]);
    expect(narrowed.map((e) => e.access?.digest)).toEqual([{ kind: "gm_shop", shops: [A] }]);
    expect(digestCan(narrowed[0]!.access, "published_staffing", { locationId: B, day: DAY })).toBe(false);
    // The level-8 unified recipient: every shop.
    expect(envFor("unified", "owner", []).map((e) => e.access?.digest)).toEqual([{ kind: "unified", shops: [A, B] }]);
    // A package send through the same engine carries NO delivery: no digest-only grant.
    expect(packageEnvs.length).toBeGreaterThan(0);
    for (const env of packageEnvs) {
      expect(env.access).not.toBeNull();
      expect(env.access?.digest).toBeUndefined();
      expect(digestCan(env.access, "published_staffing", { locationId: A, day: DAY })).toBe(false);
    }
  });

  it("the catering digest: the shift lead, the narrowed GM and the owner each get their own resolved shops", async () => {
    envelopes.length = 0;
    await runDigestTickWith(makeIO("2026-10-08T11:05:00Z"));
    expect(envFor("catering", "shift_lead", [A]).map((e) => e.access?.digest)).toEqual([{ kind: "catering", shops: [A] }]);
    expect(envFor("catering", "gm", [A, B]).map((e) => e.access?.digest)).toEqual([{ kind: "catering", shops: [A] }]);
    expect(envFor("catering", "gm", [A]).map((e) => e.access?.digest)).toEqual([{ kind: "catering", shops: [A] }]);
    expect(envFor("catering", "owner", []).map((e) => e.access?.digest)).toEqual([{ kind: "catering", shops: [A, B] }]);
    const sl = envFor("catering", "shift_lead", [A])[0]!.access;
    expect(digestCan(sl, "published_staffing", { locationId: A, day: DAY })).toBe(true);
    expect(digestCan(sl, "sales_detail", { locationId: A, day: DAY })).toBe(false);
    // Every envelope's access still carries its own viewer.
    for (const { env } of envelopes) expect(env.access?.viewer).toEqual(env.viewer);
  });
});
