/**
 * Password vault — the server lib (lib/vault.ts) over a recording fake client with a throwaway
 * master key. Spec Testing: floors, every shared reveal records + notifies, personal never does,
 * owner recovery records + notifies the owner, the cap, fail-closed decryption.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import type { RoleCode } from "@/lib/roles";
import {
  createVaultEntry, deactivateVaultEntry, listPersonalEntriesForRecovery, listVaultEntries, managementRecipients, recoverPersonalSecret,
  recoverPreviousSecret, revealVaultSecret, takeRevealSlot, updateVaultEntry, type VaultServerActor,
} from "@/lib/vault";
import { VAULT_REVEAL_BURST_THRESHOLD, VAULT_REVEAL_HOURLY_CAP, type VaultEntryInput } from "@/lib/vault-shared";
import { fakeVaultClient, type FakeVaultClient } from "./vault-fake-client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  enqueueNotification: vi.fn(async () => ({ notificationId: "n", recipientIds: [] })),
}));

const EM = "11111111-1111-4111-8111-111111111111";
const MEP = "22222222-2222-4222-8222-222222222222";
const U = {
  maya: "a0000000-0000-4000-8000-000000000001", // KH at EM
  gmEm: "a0000000-0000-4000-8000-000000000002", // GM at EM
  gmMep: "a0000000-0000-4000-8000-000000000003", // GM at MEP
  cristian: "a0000000-0000-4000-8000-000000000004", // moo (8)
  pete: "a0000000-0000-4000-8000-000000000005", // owner (9)
  juan: "a0000000-0000-4000-8000-000000000006", // cgs (10)
  slMep: "a0000000-0000-4000-8000-000000000007", // SL at MEP
  oldGm: "a0000000-0000-4000-8000-000000000008", // inactive GM at EM
};
const META = { ipAddress: "10.0.0.1", userAgent: "vitest" };
const actor = (userId: string, role: RoleCode, level: number, locations: string[], name = "Actor"): VaultServerActor => ({ userId, role, level, locations, name });
const maya = actor(U.maya, "key_holder", 4, [EM], "Maya");
const gmEm = actor(U.gmEm, "gm", 7, [EM], "Gina");
const cristian = actor(U.cristian, "moo", 8, [], "Cristian");
const pete = actor(U.pete, "owner", 9, [], "Pete");
const slMep = actor(U.slMep, "shift_lead", 5, [MEP], "Sam");

function baseTables() {
  return {
    users: [
      { id: U.maya, role: "key_holder", active: true }, { id: U.gmEm, role: "gm", active: true }, { id: U.gmMep, role: "gm", active: true },
      { id: U.cristian, role: "moo", active: true }, { id: U.pete, role: "owner", active: true }, { id: U.juan, role: "cgs", active: true },
      { id: U.slMep, role: "shift_lead", active: true }, { id: U.oldGm, role: "gm", active: false },
    ],
    user_locations: [
      { user_id: U.maya, location_id: EM, active: true }, { user_id: U.gmEm, location_id: EM, active: true }, { user_id: U.gmMep, location_id: MEP, active: true },
      { user_id: U.slMep, location_id: MEP, active: true }, { user_id: U.oldGm, location_id: EM, active: true },
    ],
    locations: [{ id: EM, code: "EM", active: true }, { id: MEP, code: "MEP", active: true }],
    vault_entries: [] as Record<string, unknown>[],
    vault_secrets: [] as Record<string, unknown>[],
    vault_reveals: [] as Record<string, unknown>[],
  };
}

const shared = (over: Partial<VaultEntryInput> = {}): VaultEntryInput => ({
  expectedRevision: 1, kind: "shared", name: "Toast back-office", entryType: "login", username: "ops@co", secret: "toast-pw-1", url: null, notes: null, locationId: EM, minLevel: 4, ...over,
});
const personal = (over: Partial<VaultEntryInput> = {}): VaultEntryInput => ({
  expectedRevision: 1, kind: "personal", name: "My bank", entryType: "login", username: "maya", secret: "mine-1", url: null, notes: null, locationId: null, minLevel: null, ...over,
});

let f: FakeVaultClient;
const notified = () => vi.mocked(enqueueNotification).mock.calls.map((c) => c[1]);
const audited = () => vi.mocked(audit).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.stubEnv("VAULT_ENABLED", "1");
  vi.stubEnv("VAULT_MASTER_KEY", randomBytes(32).toString("hex"));
  f = fakeVaultClient(baseTables());
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("the switch", () => {
  it("every entry point is off until VAULT_ENABLED=1, before any I/O", async () => {
    vi.stubEnv("VAULT_ENABLED", "");
    const calls = [
      () => listVaultEntries(f.client, maya), () => createVaultEntry(f.client, gmEm, shared(), META), () => takeRevealSlot(f.client, maya),
      () => revealVaultSecret(f.client, maya, "x", { burst: false }, META), () => recoverPersonalSecret(f.client, pete, "x", { burst: false }, META),
      () => recoverPreviousSecret(f.client, cristian, "x", { burst: false }, META), () => updateVaultEntry(f.client, gmEm, "x", shared(), META),
      () => deactivateVaultEntry(f.client, gmEm, "x", META), () => listPersonalEntriesForRecovery(f.client, pete, U.maya),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "not_enabled", status: 404 });
    expect(f.writes).toEqual([]);
    expect(f.rpcCalls).toEqual([]);
  });
});

describe("create", () => {
  it("a GM creates a shared entry for their shop: metadata row, encrypted v1 through the RPC, audit names it, management notified (not the actor)", async () => {
    const view = await createVaultEntry(f.client, gmEm, shared(), META);
    expect(view).toMatchObject({ kind: "shared", name: "Toast back-office", locationId: EM, minLevel: 4, canManage: true });
    expect(f.rpcCalls[0]).toMatchObject({ name: "vault_write_secret", args: { p_version: 1, p_master_key_id: "v1", p_actor_id: U.gmEm } });
    const stored = f.tables.vault_secrets![0]!;
    expect(JSON.stringify(stored)).not.toContain("toast-pw-1");
    expect(JSON.stringify(f.tables.vault_entries)).not.toContain("toast-pw-1");
    const a = audited()[0]!;
    expect(a).toMatchObject({ action: "vault_entry.create", metadata: expect.objectContaining({ kind: "shared", name: "Toast back-office", secret_version: 1 }) });
    expect(JSON.stringify(a)).not.toContain("toast-pw-1");
    const n = notified()[0]!;
    expect(n).toMatchObject({ type: "vault_entry_change", titleKey: "notifications.vault_entry_change.title.create", locationId: EM });
    expect(n.recipients.map((r) => r.userId).sort()).toEqual([U.cristian, U.juan, U.pete].sort()); // GM is the actor: excluded; MEP's GM is not this shop's
    expect(JSON.stringify(n)).not.toContain("toast-pw-1");
  });
  it("a both-shop entry notifies both shops' GMs; an inactive GM is never a recipient", async () => {
    await createVaultEntry(f.client, cristian, shared({ locationId: null }), META);
    expect(notified()[0]!.recipients.map((r) => r.userId).sort()).toEqual([U.gmEm, U.gmMep, U.juan, U.pete].sort());
  });
  it("binds the shop before any write: a GM of EM cannot create at MEP; a floor above their level and an AI key are refused", async () => {
    await expect(createVaultEntry(f.client, gmEm, shared({ locationId: MEP }), META)).rejects.toMatchObject({ code: "location_access_denied", status: 403 });
    await expect(createVaultEntry(f.client, gmEm, shared({ minLevel: 8 }), META)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createVaultEntry(f.client, gmEm, shared({ entryType: "ai_key", minLevel: 7 }), META)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createVaultEntry(f.client, maya, shared(), META)).rejects.toMatchObject({ code: "forbidden" });
    expect(f.writes).toEqual([]);
  });
  it("a personal entry: owner is the actor, id-only audit, NO notification", async () => {
    const view = await createVaultEntry(f.client, maya, personal(), META);
    expect(view).toMatchObject({ kind: "personal", ownerId: U.maya, canManage: true });
    expect(audited()[0]!.metadata).toEqual(expect.objectContaining({ kind: "personal", entry_id: view.id }));
    expect(audited()[0]!.metadata).not.toHaveProperty("name");
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
  it("without a master key nothing is stored and the entry is not left listed", async () => {
    vi.stubEnv("VAULT_MASTER_KEY", "");
    await expect(createVaultEntry(f.client, maya, personal(), META)).rejects.toMatchObject({ code: "vault_unavailable", status: 503 });
    expect(f.tables.vault_secrets).toEqual([]);
    expect(f.tables.vault_entries![0]).toMatchObject({ active: false });
    expect(audited().some((a) => a.action === "vault.decrypt_failure" && (a.metadata as { reason: string }).reason === "master_key_missing")).toBe(true);
  });
});

describe("reveal", () => {
  it("shared: decrypts the current version, writes ONE record, notifies level 8+ and the shop's GM (not the viewer), then returns the secret", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    vi.clearAllMocks();
    const id = f.tables.vault_entries![0]!.id as string;
    const r = await revealVaultSecret(f.client, maya, id, { burst: false }, META);
    expect(r).toEqual({ secret: "toast-pw-1", version: 1, recorded: true });
    const records = f.tables.vault_reveals!;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ entry_id: id, entry_kind: "shared", entry_type: "login", location_id: EM, viewer_id: U.maya, kind: "reveal", secret_version: 1, burst: false });
    expect(JSON.stringify(records)).not.toContain("toast-pw-1");
    const n = notified();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: "vault_reveal", titleKey: "notifications.vault_reveal.title", relatedTable: "vault_entries", relatedId: id, locationId: EM,
      titleParams: { viewerName: "Maya", roleShort: "KH", shopLabel: "EM", entryName: "Toast back-office" } });
    expect(n[0]!.recipients.map((x) => x.userId).sort()).toEqual([U.cristian, U.gmEm, U.juan, U.pete].sort());
    expect(JSON.stringify(n)).not.toContain("toast-pw-1");
    expect(audit).not.toHaveBeenCalled(); // the record IS vault_reveals, not audit_log
  });
  it("the burst flag rides on the record", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    await revealVaultSecret(f.client, maya, id, { burst: true }, META);
    expect(f.tables.vault_reveals![0]).toMatchObject({ burst: true });
  });
  it("below the floor or in another shop the entry does not exist for the viewer: no decrypt, no record", async () => {
    await createVaultEntry(f.client, gmEm, shared({ minLevel: 5 }), META);
    const id = f.tables.vault_entries![0]!.id as string;
    await expect(revealVaultSecret(f.client, maya, id, { burst: false }, META)).rejects.toMatchObject({ code: "entry_not_found", status: 404 });
    await expect(revealVaultSecret(f.client, slMep, id, { burst: false }, META)).rejects.toMatchObject({ code: "entry_not_found" });
    expect(f.tables.vault_reveals).toEqual([]);
    // level 8 sees every shop
    await expect(revealVaultSecret(f.client, cristian, id, { burst: false }, META)).resolves.toMatchObject({ secret: "toast-pw-1", recorded: true });
  });
  it("personal (owner): returns the secret with NO record and NO notification; anyone else gets not found", async () => {
    await createVaultEntry(f.client, maya, personal(), META);
    vi.clearAllMocks();
    const id = f.tables.vault_entries![0]!.id as string;
    await expect(revealVaultSecret(f.client, maya, id, { burst: false }, META)).resolves.toEqual({ secret: "mine-1", version: 1, recorded: false });
    expect(f.tables.vault_reveals).toEqual([]);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    for (const other of [gmEm, cristian, pete]) {
      await expect(revealVaultSecret(f.client, other, id, { burst: false }, META)).rejects.toMatchObject({ code: "entry_not_found" });
    }
  });
  it("a failed record write refuses the reveal (no view without its record)", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    f.failInsert.add("vault_reveals");
    await expect(revealVaultSecret(f.client, maya, id, { burst: false }, META)).rejects.toMatchObject({ code: "write_failed", status: 500 });
  });
  it("fails closed on a tampered row or a rotated master key: vault_unavailable, an audit observation, an alert to 8+, no plaintext", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    vi.clearAllMocks();
    vi.stubEnv("VAULT_MASTER_KEY", randomBytes(32).toString("hex"));
    await expect(revealVaultSecret(f.client, maya, id, { burst: false }, META)).rejects.toMatchObject({ code: "vault_unavailable", status: 503 });
    expect(f.tables.vault_reveals).toEqual([]);
    const a = audited()[0]!;
    expect(a).toMatchObject({ action: "vault.decrypt_failure", resourceTable: "vault_secrets", metadata: { entry_id: id, version: 1, reason: "decrypt_failed" }, ipAddress: "10.0.0.1" });
    const n = notified()[0]!;
    expect(n).toMatchObject({ type: "vault_alert", priority: "urgent" });
    expect(n.recipients.map((x) => x.userId).sort()).toEqual([U.cristian, U.juan, U.pete].sort());
    expect(JSON.stringify([a, n])).not.toContain("toast-pw-1");
  });
});

describe("the cap", () => {
  it("counts attempts, tells management once at the burst threshold, refuses past the cap", async () => {
    const verdicts = [];
    for (let i = 1; i <= VAULT_REVEAL_HOURLY_CAP; i += 1) verdicts.push(await takeRevealSlot(f.client, maya));
    expect(verdicts[0]).toEqual({ allowed: true, burst: false, notifyBurst: false });
    expect(verdicts[VAULT_REVEAL_BURST_THRESHOLD - 1]).toEqual({ allowed: true, burst: true, notifyBurst: true });
    expect(verdicts[VAULT_REVEAL_HOURLY_CAP - 1]).toMatchObject({ allowed: true, burst: true });
    expect(notified()).toHaveLength(1);
    expect(notified()[0]).toMatchObject({ type: "vault_burst", titleParams: { actorName: "Maya", attempts: VAULT_REVEAL_BURST_THRESHOLD, cap: VAULT_REVEAL_HOURLY_CAP } });
    expect(notified()[0]!.recipients.map((x) => x.userId).sort()).toEqual([U.cristian, U.juan, U.pete].sort());
    await expect(takeRevealSlot(f.client, maya)).rejects.toMatchObject({ code: "reveal_cap", status: 429 });
    expect(f.rpcCalls.filter((c) => c.name === "vault_take_reveal_slot")).toHaveLength(VAULT_REVEAL_HOURLY_CAP + 1);
    expect(notified()).toHaveLength(1);
  });
  it("a counter that cannot be written refuses the attempt", async () => {
    f.failRpc.set("vault_take_reveal_slot", "boom");
    await expect(takeRevealSlot(f.client, maya)).rejects.toMatchObject({ code: "write_failed" });
  });
});

describe("recoveries", () => {
  it("owner-level (9+) recovers a personal entry: record kind owner_recovery + the OWNER is notified; level 8 and the owner themselves are refused", async () => {
    await createVaultEntry(f.client, maya, personal(), META);
    vi.clearAllMocks();
    const id = f.tables.vault_entries![0]!.id as string;
    await expect(recoverPersonalSecret(f.client, cristian, id, { burst: false }, META)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(recoverPersonalSecret(f.client, { ...maya, level: 10, role: "cgs" }, id, { burst: false }, META)).rejects.toMatchObject({ code: "forbidden" });
    const r = await recoverPersonalSecret(f.client, pete, id, { burst: false }, META);
    expect(r).toEqual({ secret: "mine-1", version: 1, recorded: true });
    expect(f.tables.vault_reveals![0]).toMatchObject({ entry_id: id, entry_kind: "personal", viewer_id: U.pete, kind: "owner_recovery", secret_version: 1 });
    expect(notified()).toHaveLength(1);
    expect(notified()[0]).toMatchObject({ type: "vault_recovery", titleKey: "notifications.vault_recovery.title.owner", recipients: [{ userId: U.maya, deliveryMethod: "in_app" }] });
    expect(JSON.stringify(notified())).not.toContain("mine-1");
  });
  it("a shared entry is not a personal recovery", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    await expect(recoverPersonalSecret(f.client, pete, id, { burst: false }, META)).rejects.toMatchObject({ code: "entry_not_found" });
  });
  it("level 8+ recovers the previous secret within 30 days: record kind previous_recovery + management notified; GM refused; nothing older or scrubbed", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    await expect(recoverPreviousSecret(f.client, cristian, id, { burst: false }, META)).rejects.toMatchObject({ code: "no_previous_secret", status: 404 });
    await updateVaultEntry(f.client, gmEm, id, shared({ secret: "toast-pw-2" }), META);
    vi.clearAllMocks();
    await expect(recoverPreviousSecret(f.client, gmEm, id, { burst: false }, META)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const r = await recoverPreviousSecret(f.client, cristian, id, { burst: false }, META);
    expect(r).toEqual({ secret: "toast-pw-1", version: 1, recorded: true });
    expect(await revealVaultSecret(f.client, cristian, id, { burst: false }, META)).toMatchObject({ secret: "toast-pw-2", version: 2 });
    expect(f.tables.vault_reveals![0]).toMatchObject({ kind: "previous_recovery", secret_version: 1, viewer_id: U.cristian });
    expect(notified()[0]).toMatchObject({ type: "vault_recovery", titleKey: "notifications.vault_recovery.title.previous" });
    expect(notified()[0]!.recipients.map((x) => x.userId).sort()).toEqual([U.gmEm, U.juan, U.pete].sort());
    // Past the window / scrubbed: gone.
    const v1 = f.tables.vault_secrets!.find((s) => s.version === 1)!;
    v1.superseded_at = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await expect(recoverPreviousSecret(f.client, cristian, id, { burst: false }, META)).rejects.toMatchObject({ code: "no_previous_secret" });
    v1.superseded_at = new Date().toISOString();
    v1.scrubbed_at = new Date().toISOString();
    await expect(recoverPreviousSecret(f.client, cristian, id, { burst: false }, META)).rejects.toMatchObject({ code: "no_previous_secret" });
  });
});

describe("update and deactivate", () => {
  it("edits metadata (audited with the changed columns, notified) and rotates the secret as version 2 through the RPC", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    vi.clearAllMocks();
    const view = await updateVaultEntry(f.client, gmEm, id, shared({ name: "Toast BOH", secret: null }), META);
    expect(view.name).toBe("Toast BOH");
    expect(audit).not.toHaveBeenCalled();
    expect(f.tables.audit_log?.[0]).toMatchObject({ action: "vault_entry.update", metadata: expect.objectContaining({ changed: ["name"], secret_rotated: false, name: "Toast BOH" }) });
    expect(notified()[0]).toMatchObject({ titleKey: "notifications.vault_entry_change.title.update", bodyKey: "notifications.vault_entry_change.body.metadata", bodyParams: expect.objectContaining({ changed: "name" }) });
    vi.clearAllMocks();
    await updateVaultEntry(f.client, gmEm, id, shared({ expectedRevision: 2, name: "Toast BOH", secret: "toast-pw-2" }), META);
    expect(f.rpcCalls.at(-1)).toMatchObject({ name: "vault_write_secret", args: { p_version: 2 } });
    expect(audit).not.toHaveBeenCalled();
    expect(f.tables.audit_log?.slice(1).map((a) => a.action)).toEqual(["vault_entry.update", "vault_secret.rotate"]);
    expect(JSON.stringify(audited())).not.toContain("toast-pw-2");
    expect(notified()[0]).toMatchObject({ bodyKey: "notifications.vault_entry_change.body.secret" });
    expect(f.tables.vault_secrets!.filter((s) => s.superseded_at == null)).toHaveLength(1);
  });
  it("a stale concurrent write is a 409, never a mis-versioned row", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const id = f.tables.vault_entries![0]!.id as string;
    f.failRpc.set("vault_write_secret", "version_conflict");
    await expect(updateVaultEntry(f.client, gmEm, id, shared({ secret: "toast-pw-2" }), META)).rejects.toMatchObject({ code: "version_conflict", status: 409 });
  });
  it("a GM cannot edit another shop's entry (not found), an AI key (forbidden), or move an entry to a shop they lack", async () => {
    await createVaultEntry(f.client, cristian, shared({ locationId: MEP }), META);
    await createVaultEntry(f.client, cristian, shared({ entryType: "ai_key", minLevel: 7, name: "OpenAI key" }), META);
    const [mep, aiKey] = f.tables.vault_entries!.map((e) => e.id as string);
    await expect(updateVaultEntry(f.client, gmEm, mep!, shared({ locationId: MEP }), META)).rejects.toMatchObject({ code: "entry_not_found" });
    await expect(updateVaultEntry(f.client, gmEm, aiKey!, shared({ entryType: "ai_key", minLevel: 7, name: "OpenAI key" }), META)).rejects.toMatchObject({ code: "forbidden" });
    await createVaultEntry(f.client, gmEm, shared(), META);
    const mine = f.tables.vault_entries![2]!.id as string;
    await expect(updateVaultEntry(f.client, gmEm, mine, shared({ locationId: MEP }), META)).rejects.toMatchObject({ code: "location_access_denied" });
    await expect(deactivateVaultEntry(f.client, gmEm, aiKey!, META)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("deactivate: active=false (never a delete), audited, management notified; a personal entry notifies nobody", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    await createVaultEntry(f.client, maya, personal(), META);
    const [sharedId, personalId] = f.tables.vault_entries!.map((e) => e.id as string);
    vi.clearAllMocks();
    await deactivateVaultEntry(f.client, gmEm, sharedId!, META);
    expect(f.tables.vault_entries![0]).toMatchObject({ active: false, deactivated_by: U.gmEm });
    expect(audited()[0]).toMatchObject({ action: "vault_entry.deactivate" });
    expect(notified()[0]).toMatchObject({ titleKey: "notifications.vault_entry_change.title.deactivate" });
    vi.clearAllMocks();
    await deactivateVaultEntry(f.client, maya, personalId!, META);
    expect(enqueueNotification).not.toHaveBeenCalled();
    await expect(revealVaultSecret(f.client, maya, personalId!, { burst: false }, META)).rejects.toMatchObject({ code: "entry_not_found" });
    expect(f.writes.every((w) => w.op !== ("delete" as string))).toBe(true);
  });
});

describe("lists", () => {
  it("never selects a secret column; shows shared entries at/above the floor in allowed shops plus own personal; previous flag for 8+ only", async () => {
    await createVaultEntry(f.client, gmEm, shared({ name: "KH login", minLevel: 4 }), META);
    await createVaultEntry(f.client, gmEm, shared({ name: "GM login", minLevel: 7 }), META);
    await createVaultEntry(f.client, cristian, shared({ name: "MEP code", entryType: "code", locationId: MEP, minLevel: 4 }), META);
    await createVaultEntry(f.client, maya, personal(), META);
    await createVaultEntry(f.client, slMep, personal({ name: "Sam's" }), META);
    const ghId = f.tables.vault_entries![1]!.id as string;
    await updateVaultEntry(f.client, gmEm, ghId, shared({ name: "GM login", minLevel: 7, secret: "rotated" }), META);

    const asMaya = await listVaultEntries(f.client, maya);
    expect(asMaya.shared.map((e) => e.name)).toEqual(["KH login"]);
    expect(asMaya.personal.map((e) => e.name)).toEqual(["My bank"]);
    expect(asMaya.shared[0]).toMatchObject({ canManage: false, canRecoverPrevious: false });
    expect(JSON.stringify(asMaya)).not.toMatch(/toast-pw|mine-1|ciphertext|wrapped/);

    const asGm = await listVaultEntries(f.client, gmEm);
    expect(asGm.shared.map((e) => e.name)).toEqual(["GM login", "KH login"]);
    expect(asGm.shared.every((e) => e.canManage && !e.canRecoverPrevious)).toBe(true);

    const asCristian = await listVaultEntries(f.client, cristian);
    expect(asCristian.shared.map((e) => e.name)).toEqual(["GM login", "KH login", "MEP code"]);
    expect(asCristian.shared.find((e) => e.name === "GM login")).toMatchObject({ canRecoverPrevious: true });
    expect(asCristian.shared.find((e) => e.name === "KH login")).toMatchObject({ canRecoverPrevious: false });
    expect(asCristian.personal).toEqual([]);
  });
  it("another person's personal entry names: level 9+ only", async () => {
    await createVaultEntry(f.client, maya, personal(), META);
    await expect(listPersonalEntriesForRecovery(f.client, cristian, U.maya)).rejects.toMatchObject({ code: "forbidden" });
    expect((await listPersonalEntriesForRecovery(f.client, pete, U.maya)).map((e) => e.name)).toEqual(["My bank"]);
  });
  it("managementRecipients: 8+ everywhere, the shop's active GM, both shops' GMs for a both-shop entry, minus the actor", async () => {
    expect((await managementRecipients(f.client, EM, null)).sort()).toEqual([U.cristian, U.gmEm, U.juan, U.pete].sort());
    expect((await managementRecipients(f.client, MEP, U.pete)).sort()).toEqual([U.cristian, U.gmMep, U.juan].sort());
    expect((await managementRecipients(f.client, null, null)).sort()).toEqual([U.cristian, U.gmEm, U.gmMep, U.juan, U.pete].sort());
  });
});


describe("security review regressions", () => {
  it("P1 #1: failed floor-9 to floor-4 rotation changes neither metadata nor current secret", async () => {
    const entry = await createVaultEntry(f.client, pete, shared({ minLevel: 9 }), META);
    vi.clearAllMocks();
    const before = structuredClone(f.tables.vault_entries);
    const secrets = structuredClone(f.tables.vault_secrets);
    f.failRpc.set("vault_write_secret", "version_conflict");
    await expect(updateVaultEntry(f.client, pete, entry.id, shared({ minLevel: 4, secret: "new-secret" }), META))
      .rejects.toMatchObject({ code: "version_conflict", status: 409 });
    expect(f.tables.vault_entries).toEqual(before);
    expect(f.tables.vault_secrets).toEqual(secrets);
    expect(audit).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
    await expect(revealVaultSecret(f.client, maya, entry.id, { burst: false }, META)).rejects.toMatchObject({ status: 404 });
  });
  it.each([null, "replacement"])("P2 #3: stale sequential metadata/secret edit (%s) is refused", async (secret) => {
    const original = await createVaultEntry(f.client, gmEm, shared(), META);
    const updated = await updateVaultEntry(f.client, gmEm, original.id, shared({ name: "Newer", secret }), META);
    expect(updated.revision).toBe(original.revision + 1);
    vi.clearAllMocks();
    const before = structuredClone(f.tables);
    await expect(updateVaultEntry(f.client, gmEm, original.id, shared({ name: "Stale", secret: "stale-secret", expectedRevision: original.revision }), META))
      .rejects.toMatchObject({ code: "version_conflict", status: 409 });
    expect(f.tables).toEqual(before);
    expect(audit).not.toHaveBeenCalled();
  });
  it("P2 #3: the atomic boundary also refuses a writer that loses after its read", async () => {
    const entry = await createVaultEntry(f.client, gmEm, shared(), META);
    const before = structuredClone(f.tables);
    f.failRpc.set("vault_update_entry", "version_conflict");
    await expect(updateVaultEntry(f.client, gmEm, entry.id, shared({ name: "Race", secret: null }), META)).rejects.toMatchObject({ status: 409 });
    expect(f.tables).toEqual(before);
  });
  it("P2 #5: scopes before capped pages and retrieves all own, recovery and previous-version rows", async () => {
    const seed = await createVaultEntry(f.client, gmEm, shared(), META);
    const template = f.tables.vault_entries![0]!;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 1205; i++) {
      rows.push({ ...template, id: `a-other-${String(i).padStart(5, "0")}`, location_id: MEP });
      rows.push({ ...template, id: `b-floor-${String(i).padStart(5, "0")}`, min_level: 9 });
    }
    for (let i = 0; i < 207; i++) {
      const suffix = String(i).padStart(5, "0");
      rows.push({ ...template, id: `s-${suffix}`, name: `Shared ${suffix}` });
      rows.push({ ...template, id: `p-${suffix}`, kind: "personal", owner_id: U.maya, location_id: null, min_level: null });
    }
    const secrets = Array.from({ length: 1205 }, (_, i) => ({ id: `v-${String(i).padStart(5, "0")}`, entry_id: i === 1204 ? "s-00001" : "s-00000", superseded_at: new Date().toISOString(), scrubbed_at: null }));
    f = fakeVaultClient({ ...baseTables(), vault_entries: rows, vault_secrets: secrets }, 17);
    const asMaya = await listVaultEntries(f.client, maya);
    expect(asMaya.shared).toHaveLength(207);
    expect(asMaya.personal).toHaveLength(207);
    expect(asMaya.shared.every((r) => r.locationId === EM && r.minLevel === 4)).toBe(true);
    expect(await listPersonalEntriesForRecovery(f.client, pete, U.maya)).toHaveLength(207);
    const asManager = await listVaultEntries(f.client, cristian);
    expect(asManager.shared.find((r) => r.id === "s-00001")?.canRecoverPrevious).toBe(true);
    expect(asManager.shared.some((r) => r.minLevel === 9)).toBe(false);
    expect(seed.revision).toBe(1);
  });
});


describe("vault hardening", () => {
  it("post-filters broadened SQL results for kind, active, floor and location", async () => {
    await createVaultEntry(f.client, gmEm, shared(), META);
    const row = f.tables.vault_entries![0]!;
    f.tables.vault_entries!.push(
      { ...row, id: "wrong-shop", location_id: MEP }, { ...row, id: "high-floor", min_level: 9 },
      { ...row, id: "inactive", active: false }, { ...row, id: "personal", kind: "personal", owner_id: U.pete },
      { ...row, id: "no-floor", min_level: null }, { ...row, id: "both", location_id: null },
    );
    f.ignoreVisibilityFilters = true;
    expect((await listVaultEntries(f.client, maya)).shared.map((r) => r.id).sort()).toEqual([row.id, "both"].sort());
  });
  it("an RPC audit failure surfaces as a failed edit without an app audit fallback", async () => {
    const entry = await createVaultEntry(f.client, gmEm, shared(), META);
    vi.clearAllMocks();
    const before = structuredClone(f.tables);
    f.failInsert.add("audit_log");
    await expect(updateVaultEntry(f.client, gmEm, entry.id, shared(), META)).rejects.toMatchObject({ code: "write_failed" });
    expect(f.tables).toEqual(before);
    expect(audit).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});
