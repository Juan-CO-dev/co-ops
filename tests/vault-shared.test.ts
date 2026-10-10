/**
 * Password vault — the PURE rules (lib/vault-shared.ts, lib/vault-flag.ts).
 * Role/shop floors, manage rights, the reveal cap verdict, the 30-day previous-secret window,
 * input validation and the VAULT_ENABLED switch. No I/O anywhere in here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import { vaultEnabled } from "@/lib/vault-flag";
import {
  VAULT_AUTO_HIDE_SECONDS, VAULT_PREVIOUS_SECRET_RETENTION_DAYS, VAULT_REVEAL_BURST_THRESHOLD, VAULT_REVEAL_HOURLY_CAP,
  VAULT_ROLE_FLOORS, VaultError, canCreateShared, canManageEntry, canRevealEntry, canSeeSharedEntry, previousSecretRecoverable,
  revealCapVerdict, validateEntryInput, type VaultActor, type VaultEntryAccess,
} from "@/lib/vault-shared";

const EM = "11111111-1111-4111-8111-111111111111";
const MEP = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const roleAt = (level: number): RoleCode => Object.values(ROLES).find((r) => r.level === level)!.code;
const actor = (level: number, locations: string[] = [EM]): VaultActor => ({ userId: ME, role: roleAt(level), level, locations });
const shared = (minLevel: number, locationId: string | null = EM, entryType: "login" | "code" | "ai_key" = "login"): VaultEntryAccess =>
  ({ kind: "shared", entryType, locationId, minLevel, ownerId: null, active: true });
const personal = (ownerId: string): VaultEntryAccess => ({ kind: "personal", entryType: "login", locationId: null, minLevel: null, ownerId, active: true });
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("constants the spec fixes", () => {
  it("30 s auto-hide, 30-day retention, floors KH+ SL+ AGM+ GM+ 8+ owner/cgs", () => {
    expect(VAULT_AUTO_HIDE_SECONDS).toBe(30);
    expect(VAULT_PREVIOUS_SECRET_RETENTION_DAYS).toBe(30);
    expect([...VAULT_ROLE_FLOORS]).toEqual([4, 5, 6, 7, 8, 9]);
    expect(VAULT_REVEAL_BURST_THRESHOLD).toBeLessThan(VAULT_REVEAL_HOURLY_CAP);
  });
});

describe("shared entries: nobody below the floor, and only in their shops", () => {
  it.each(VAULT_ROLE_FLOORS)("floor %s: visible iff level >= floor (same shop)", (floor) => {
    for (const level of LEVELS) {
      expect(canSeeSharedEntry(actor(level), shared(floor)), `level ${level}`).toBe(level >= floor);
      expect(canRevealEntry(actor(level), shared(floor)), `reveal level ${level}`).toBe(level >= floor);
    }
  });
  it("another shop's entry is invisible below level 8; level 8+ sees every shop", () => {
    for (const level of [4, 5, 6, 7]) expect(canSeeSharedEntry(actor(level, [MEP]), shared(4, EM))).toBe(false);
    for (const level of [8, 9, 10]) expect(canSeeSharedEntry(actor(level, []), shared(4, EM))).toBe(true);
  });
  it("a both-shop entry (no shop) is visible to anyone at or above its floor", () => {
    expect(canSeeSharedEntry(actor(4, [MEP]), shared(4, null))).toBe(true);
    expect(canSeeSharedEntry(actor(3, [MEP]), shared(4, null))).toBe(false);
  });
  it("an inactive entry is never visible or revealable", () => {
    expect(canSeeSharedEntry(actor(10), { ...shared(4), active: false })).toBe(false);
    expect(canRevealEntry(actor(10), { ...shared(4), active: false })).toBe(false);
  });
});

describe("personal entries: only their owner", () => {
  it("the owner sees and reveals; nobody else does, whatever their level", () => {
    expect(canRevealEntry(actor(2), personal(ME))).toBe(true);
    for (const level of LEVELS) expect(canRevealEntry(actor(level), personal(OTHER)), `level ${level}`).toBe(false);
    expect(canSeeSharedEntry(actor(10), personal(OTHER))).toBe(false);
  });
});

describe("who manages what", () => {
  it("below GM nobody creates a shared entry; everyone manages their own personal entry only", () => {
    for (const level of [0, 1, 2, 3, 4, 5, 6]) expect(canCreateShared(actor(level), { locationId: EM, minLevel: 4, entryType: "login" })).toBe(false);
    expect(canManageEntry(actor(0), personal(ME))).toBe(true);
    expect(canManageEntry(actor(10), personal(OTHER))).toBe(false);
  });
  it("a GM manages their own shop's logins and codes: not AI keys, not both-shop, not another shop, not a floor above 7", () => {
    const gm = actor(7, [EM]);
    expect(canCreateShared(gm, { locationId: EM, minLevel: 4, entryType: "login" })).toBe(true);
    expect(canCreateShared(gm, { locationId: EM, minLevel: 7, entryType: "code" })).toBe(true);
    expect(canCreateShared(gm, { locationId: EM, minLevel: 4, entryType: "ai_key" })).toBe(false);
    expect(canCreateShared(gm, { locationId: null, minLevel: 4, entryType: "login" })).toBe(false);
    expect(canCreateShared(gm, { locationId: MEP, minLevel: 4, entryType: "login" })).toBe(false);
    expect(canCreateShared(gm, { locationId: EM, minLevel: 8, entryType: "login" })).toBe(false);
    expect(canManageEntry(gm, shared(4, EM))).toBe(true);
    expect(canManageEntry(gm, shared(4, MEP))).toBe(false);
    expect(canManageEntry(gm, shared(4, null))).toBe(false);
    expect(canManageEntry(gm, shared(4, EM, "ai_key"))).toBe(false);
    expect(canManageEntry(gm, shared(8, EM))).toBe(false);
  });
  it("level 8+ manages everything, but never a floor above their own level", () => {
    const moo = actor(8, []);
    expect(canCreateShared(moo, { locationId: null, minLevel: 9, entryType: "ai_key" })).toBe(false);
    expect(canCreateShared(moo, { locationId: null, minLevel: 8, entryType: "ai_key" })).toBe(true);
    expect(canCreateShared(actor(9, []), { locationId: null, minLevel: 9, entryType: "ai_key" })).toBe(true);
    expect(canManageEntry(moo, shared(4, MEP, "ai_key"))).toBe(true);
    expect(canManageEntry(moo, shared(9, null, "ai_key"))).toBe(false);
    expect(canManageEntry(actor(10, []), shared(9, null, "ai_key"))).toBe(true);
  });
});

describe("the hourly reveal cap", () => {
  it("allows up to the cap, flags a burst from the threshold, notifies once at the threshold", () => {
    expect(revealCapVerdict(1)).toEqual({ allowed: true, burst: false, notifyBurst: false });
    expect(revealCapVerdict(VAULT_REVEAL_BURST_THRESHOLD - 1).burst).toBe(false);
    expect(revealCapVerdict(VAULT_REVEAL_BURST_THRESHOLD)).toEqual({ allowed: true, burst: true, notifyBurst: true });
    expect(revealCapVerdict(VAULT_REVEAL_BURST_THRESHOLD + 1)).toEqual({ allowed: true, burst: true, notifyBurst: false });
    expect(revealCapVerdict(VAULT_REVEAL_HOURLY_CAP)).toMatchObject({ allowed: true, burst: true });
    expect(revealCapVerdict(VAULT_REVEAL_HOURLY_CAP + 1)).toMatchObject({ allowed: false, burst: true, notifyBurst: false });
  });
});

describe("the previous secret lives 30 days", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  it("recoverable inside the window, gone after it or once scrubbed; a current version is not 'previous'", () => {
    expect(previousSecretRecoverable({ supersededAt: daysAgo(1), scrubbedAt: null }, now)).toBe(true);
    expect(previousSecretRecoverable({ supersededAt: daysAgo(29.9), scrubbedAt: null }, now)).toBe(true);
    expect(previousSecretRecoverable({ supersededAt: daysAgo(30.1), scrubbedAt: null }, now)).toBe(false);
    expect(previousSecretRecoverable({ supersededAt: daysAgo(1), scrubbedAt: daysAgo(0.5) }, now)).toBe(false);
    expect(previousSecretRecoverable({ supersededAt: null, scrubbedAt: null }, now)).toBe(false);
  });
});

describe("entry input validation", () => {
  const good = { name: "  Toast back-office  ", entryType: "login", username: "ops@co", secret: "s3cret", url: "https://toast.example", notes: "front register" };
  it("normalises a good shared entry and a good personal entry", () => {
    expect(validateEntryInput({ ...good, kind: "shared", locationId: EM, minLevel: 4 }, { requireSecret: true })).toEqual({
      kind: "shared", name: "Toast back-office", entryType: "login", username: "ops@co", secret: "s3cret", url: "https://toast.example",
      notes: "front register", locationId: EM, minLevel: 4,
    });
    expect(validateEntryInput({ ...good, kind: "personal" }, { requireSecret: true })).toMatchObject({ kind: "personal", locationId: null, minLevel: null });
  });
  it("an edit may leave the secret out; a create may not", () => {
    expect(validateEntryInput({ ...good, kind: "personal", secret: undefined, expectedRevision: 1 }, { requireSecret: false }).secret).toBeNull();
    expect(() => validateEntryInput({ ...good, kind: "personal", secret: undefined, expectedRevision: 1 }, { requireSecret: true })).toThrow(VaultError);
  });
  it.each([
    ["name", { name: "" }], ["name", { name: "x".repeat(121) }], ["entryType", { entryType: "token" }],
    ["username", { username: "u".repeat(201) }], ["url", { url: "javascript:alert(1)" }], ["url", { url: "https://" + "a".repeat(500) }],
    ["notes", { notes: "n".repeat(2001) }], ["secret", { secret: "" }], ["secret", { secret: "s".repeat(4097) }],
    ["minLevel", { kind: "shared", locationId: EM, minLevel: 3 }], ["minLevel", { kind: "shared", locationId: EM, minLevel: undefined }],
    ["locationId", { kind: "shared", locationId: 42, minLevel: 4 }], ["locationId", { kind: "personal", locationId: EM }],
    ["minLevel", { kind: "personal", minLevel: 4 }], ["kind", { kind: "team" }],
  ])("refuses a bad %s with invalid_payload naming the field", (field, patch) => {
    let caught: unknown;
    try { validateEntryInput({ ...good, kind: "personal", ...patch } as Record<string, unknown>, { requireSecret: true }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultError);
    expect(caught).toMatchObject({ code: "invalid_payload", status: 400, field });
  });
  it("AI keys default to the owner/cgs floor when none is given", () => {
    expect(validateEntryInput({ ...good, kind: "shared", entryType: "ai_key", locationId: null }, { requireSecret: true }).minLevel).toBe(9);
  });
});

describe("the switch", () => {
  afterEach(() => { delete process.env.VAULT_ENABLED; });
  it("is on only for exactly '1'", () => {
    delete process.env.VAULT_ENABLED;
    expect(vaultEnabled()).toBe(false);
    process.env.VAULT_ENABLED = "true";
    expect(vaultEnabled()).toBe(false);
    process.env.VAULT_ENABLED = "1";
    expect(vaultEnabled()).toBe(true);
  });
});


describe("edit revisions", () => {
  const input = { kind: "personal", name: "Login", entryType: "login" };
  it("requires a positive integer client revision on every edit", () => {
    for (const expectedRevision of [undefined, null, 0, -1, 1.5, "1"]) {
      expect(() => validateEntryInput({ ...input, expectedRevision }, { requireSecret: false })).toThrow("invalid_payload");
    }
    expect(validateEntryInput({ ...input, expectedRevision: 3 }, { requireSecret: false }).expectedRevision).toBe(3);
  });
});
