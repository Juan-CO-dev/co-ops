/**
 * Password vault routes: the switch, CSRF, the reveal gate order (slot → PIN → reveal), and that no
 * response ever carries more than it should. The lib is mocked; the gate's own behaviour is real.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createOrList, GET as list } from "@/app/api/vault/entries/route";
import { PATCH as patch } from "@/app/api/vault/entries/[id]/route";
import { POST as deactivate } from "@/app/api/vault/entries/[id]/deactivate/route";
import { POST as reveal } from "@/app/api/vault/entries/[id]/reveal/route";
import { POST as recover } from "@/app/api/vault/entries/[id]/recover/route";
import { GET as personal } from "@/app/api/vault/personal/[userId]/route";
import { verifyActorPin } from "@/lib/auth-flows";
import { requireSession } from "@/lib/session";
import * as vault from "@/lib/vault";
import { VaultError } from "@/lib/vault-shared";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth-flows", () => ({ verifyActorPin: vi.fn(async () => true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ tag: "service" }) }));
vi.mock("@/lib/vault", () => ({
  listVaultEntries: vi.fn(async () => ({ shared: [], personal: [] })),
  listPersonalEntriesForRecovery: vi.fn(async () => []),
  createVaultEntry: vi.fn(async () => ({ id: "e1", name: "Toast" })),
  updateVaultEntry: vi.fn(async () => ({ id: "e1", name: "Toast" })),
  deactivateVaultEntry: vi.fn(async () => undefined),
  takeRevealSlot: vi.fn(async () => ({ allowed: true, burst: false, notifyBurst: false })),
  revealVaultSecret: vi.fn(async () => ({ secret: "CANARY-plain", version: 3, recorded: true })),
  recoverPersonalSecret: vi.fn(async () => ({ secret: "CANARY-owner", version: 1, recorded: true })),
  recoverPreviousSecret: vi.fn(async () => ({ secret: "CANARY-prev", version: 2, recorded: true })),
}));

const ORIGIN = "https://ops.example.test";
const params = (id: string) => ({ params: Promise.resolve({ id, userId: id }) });
function req(path: string, method: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function session(level = 4, role = "key_holder") {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: "actor", name: "Maya", role }, role, level, locations: ["shop"], session: { id: "s" },
  } as never);
}
const callOrder: string[] = [];

beforeEach(() => {
  vi.stubEnv("VAULT_ENABLED", "1");
  session();
  callOrder.length = 0;
  vi.mocked(vault.takeRevealSlot).mockImplementation(async () => { callOrder.push("slot"); return { allowed: true, burst: false, notifyBurst: false }; });
  vi.mocked(verifyActorPin).mockImplementation(async () => { callOrder.push("pin"); return true; });
  vi.mocked(vault.revealVaultSecret).mockImplementation(async () => { callOrder.push("reveal"); return { secret: "CANARY-plain", version: 3, recorded: true }; });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("the switch and the front door", () => {
  it("every route is 404 not_enabled when VAULT_ENABLED is off, before the lib is touched", async () => {
    vi.stubEnv("VAULT_ENABLED", "");
    const responses = await Promise.all([
      list(req("/api/vault/entries", "GET", undefined, {})),
      createOrList(req("/api/vault/entries", "POST", {})),
      patch(req("/api/vault/entries/e1", "PATCH", {}), params("e1")),
      deactivate(req("/api/vault/entries/e1/deactivate", "POST", {}), params("e1")),
      reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }), params("e1")),
      recover(req("/api/vault/entries/e1/recover", "POST", { pin: "1234", mode: "previous" }), params("e1")),
      personal(req("/api/vault/personal/u2", "GET", undefined, {}), params("u2")),
    ]);
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ code: "not_enabled" });
    }
    for (const fn of Object.values(vault)) expect(fn).not.toHaveBeenCalled();
  });
  it("state-changing routes fail closed on a missing or foreign Origin (CSRF); reads do not need one", async () => {
    for (const headers of [{}, { origin: "https://evil.example" }] as Record<string, string>[]) {
      expect((await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }, headers), params("e1"))).status).toBe(403);
      expect((await createOrList(req("/api/vault/entries", "POST", {}, headers))).status).toBe(403);
      expect((await patch(req("/api/vault/entries/e1", "PATCH", {}, headers), params("e1"))).status).toBe(403);
      expect((await deactivate(req("/api/vault/entries/e1/deactivate", "POST", {}, headers), params("e1"))).status).toBe(403);
      expect((await recover(req("/api/vault/entries/e1/recover", "POST", { pin: "1", mode: "owner" }, headers), params("e1"))).status).toBe(403);
    }
    expect(vault.takeRevealSlot).not.toHaveBeenCalled();
    expect((await list(req("/api/vault/entries", "GET", undefined, {}))).status).toBe(200);
  });
  it("an unauthenticated request is the session layer's 401", async () => {
    vi.mocked(requireSession).mockResolvedValue(new Response(null, { status: 401 }) as never);
    expect((await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }), params("e1"))).status).toBe(401);
  });
});

describe("the reveal gate", () => {
  it("no PIN → 400 naming the field; nothing counted, nothing verified, nothing revealed", async () => {
    const r = await reveal(req("/api/vault/entries/e1/reveal", "POST", {}), params("e1"));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "invalid_payload", field: "pin" });
    expect(callOrder).toEqual([]);
  });
  it("takes the hourly slot BEFORE checking the PIN; a wrong PIN is 401 pin_invalid and reveals nothing", async () => {
    vi.mocked(verifyActorPin).mockImplementation(async () => { callOrder.push("pin"); return false; });
    const r = await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "0000" }), params("e1"));
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ code: "pin_invalid" });
    expect(callOrder).toEqual(["slot", "pin"]);
    expect(verifyActorPin).toHaveBeenCalledWith("actor", "0000");
  });
  it("over the cap → 429 reveal_cap before the PIN is even checked", async () => {
    vi.mocked(vault.takeRevealSlot).mockRejectedValue(new VaultError("reveal_cap", 429));
    const r = await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }), params("e1"));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: "reveal_cap" });
    expect(verifyActorPin).not.toHaveBeenCalled();
    expect(vault.revealVaultSecret).not.toHaveBeenCalled();
  });
  it("success: slot → PIN → reveal; the body is exactly { secret, version, autoHideSeconds: 30, recorded } and the burst flag travels", async () => {
    vi.mocked(vault.takeRevealSlot).mockImplementation(async () => { callOrder.push("slot"); return { allowed: true, burst: true, notifyBurst: false }; });
    const r = await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }), params("e1"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ secret: "CANARY-plain", version: 3, autoHideSeconds: 30, recorded: true });
    expect(callOrder).toEqual(["slot", "pin", "reveal"]);
    expect(vault.revealVaultSecret).toHaveBeenCalledWith({ tag: "service" },
      { userId: "actor", role: "key_holder", level: 4, locations: ["shop"], name: "Maya" }, "e1", { burst: true }, { ipAddress: null, userAgent: null });
    expect(r.headers.get("cache-control") ?? "").not.toMatch(/public/);
  });
  it("a lib refusal is its own status/code and the body carries nothing else", async () => {
    vi.mocked(vault.revealVaultSecret).mockRejectedValue(new VaultError("vault_unavailable", 503));
    const r = await reveal(req("/api/vault/entries/e1/reveal", "POST", { pin: "1234" }), params("e1"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "vault_unavailable", code: "vault_unavailable" });
  });
});

describe("recover", () => {
  it("validates mode before the gate; owner → recoverPersonalSecret, previous → recoverPreviousSecret, same slot→PIN order", async () => {
    const bad = await recover(req("/api/vault/entries/e1/recover", "POST", { pin: "1234", mode: "latest" }), params("e1"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "mode" });
    expect(vault.takeRevealSlot).not.toHaveBeenCalled();
    const owner = await recover(req("/api/vault/entries/e1/recover", "POST", { pin: "1234", mode: "owner" }), params("e1"));
    expect(await owner.json()).toEqual({ secret: "CANARY-owner", version: 1, autoHideSeconds: 30, recorded: true });
    expect(vault.recoverPersonalSecret).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["slot", "pin"]);
    const prev = await recover(req("/api/vault/entries/e1/recover", "POST", { pin: "1234", mode: "previous" }), params("e1"));
    expect(await prev.json()).toMatchObject({ secret: "CANARY-prev", version: 2 });
    expect(vault.recoverPreviousSecret).toHaveBeenCalledOnce();
  });
  it("a wrong PIN on a recovery is 401 and recovers nothing", async () => {
    vi.mocked(verifyActorPin).mockResolvedValue(false);
    const r = await recover(req("/api/vault/entries/e1/recover", "POST", { pin: "0000", mode: "owner" }), params("e1"));
    expect(r.status).toBe(401);
    expect(vault.recoverPersonalSecret).not.toHaveBeenCalled();
  });
});

describe("entries", () => {
  const good = { expectedRevision: 1, kind: "shared", name: "Toast", entryType: "login", username: "ops", secret: "CANARY-new", locationId: "11111111-1111-4111-8111-111111111111", minLevel: 4 };
  it("GET lists through the lib with the session actor", async () => {
    const r = await list(req("/api/vault/entries", "GET", undefined, {}));
    expect(await r.json()).toEqual({ shared: [], personal: [] });
    expect(vault.listVaultEntries).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ userId: "actor", level: 4 }));
  });
  it("POST validates the body (400 names the field), creates, returns 201 with the view and never the secret", async () => {
    const bad = await createOrList(req("/api/vault/entries", "POST", { ...good, secret: "" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_payload", field: "secret" });
    expect(vault.createVaultEntry).not.toHaveBeenCalled();
    const r = await createOrList(req("/api/vault/entries", "POST", good));
    expect(r.status).toBe(201);
    const text = JSON.stringify(await r.json());
    expect(text).toContain("Toast");
    expect(text).not.toContain("CANARY");
    expect(vi.mocked(vault.createVaultEntry).mock.calls[0]![2]).toMatchObject({ kind: "shared", name: "Toast", secret: "CANARY-new", minLevel: 4 });
  });
  it("PATCH allows a blank secret (keep current) and maps lib refusals", async () => {
    const r = await patch(req("/api/vault/entries/e1", "PATCH", { ...good, secret: undefined }), params("e1"));
    expect(r.status).toBe(200);
    expect(vi.mocked(vault.updateVaultEntry).mock.calls[0]![3]).toMatchObject({ secret: null });
    vi.mocked(vault.updateVaultEntry).mockRejectedValue(new VaultError("version_conflict", 409));
    expect((await patch(req("/api/vault/entries/e1", "PATCH", good), params("e1"))).status).toBe(409);
    vi.mocked(vault.updateVaultEntry).mockRejectedValue(new VaultError("forbidden", 403));
    expect((await patch(req("/api/vault/entries/e1", "PATCH", good), params("e1"))).status).toBe(403);
  });
  it("deactivate posts through the lib; not found is 404", async () => {
    expect((await deactivate(req("/api/vault/entries/e1/deactivate", "POST", {}), params("e1"))).status).toBe(200);
    vi.mocked(vault.deactivateVaultEntry).mockRejectedValue(new VaultError("entry_not_found", 404));
    expect((await deactivate(req("/api/vault/entries/e1/deactivate", "POST", {}), params("e1"))).status).toBe(404);
  });
  it("personal listing for recovery forwards the lib's forbidden below level 9", async () => {
    vi.mocked(vault.listPersonalEntriesForRecovery).mockRejectedValue(new VaultError("forbidden", 403));
    expect((await personal(req("/api/vault/personal/u2", "GET", undefined, {}), params("u2"))).status).toBe(403);
    vi.mocked(vault.listPersonalEntriesForRecovery).mockResolvedValue([]);
    session(9, "owner");
    const r = await personal(req("/api/vault/personal/u2", "GET", undefined, {}), params("u2"));
    expect(await r.json()).toEqual({ entries: [] });
    expect(vault.listPersonalEntriesForRecovery).toHaveBeenLastCalledWith({ tag: "service" }, expect.objectContaining({ level: 9 }), "u2");
  });
});
