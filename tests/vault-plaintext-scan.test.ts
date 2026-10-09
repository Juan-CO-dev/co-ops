/**
 * REQUIRED SCAN (GO 2026-10-08): no plaintext secret and no master key reaches any log line, audit
 * row, notification, database row, error, or route response other than a successful reveal's own
 * `secret` field. A canary secret and a throwaway master key are planted; the whole lifecycle runs
 * through the REAL lib and the REAL reveal route over the recording fake client; every sink is
 * collected and scanned. The static half pins the import rules that keep the crypto out of the
 * client bundle (the post-build `scripts/vault-bundle-scan.mjs` checks the emitted static chunks).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as revealRoute } from "@/app/api/vault/entries/[id]/reveal/route";
import { audit } from "@/lib/audit";
import { verifyActorPin } from "@/lib/auth-flows";
import { enqueueNotification } from "@/lib/notifications";
import { requireSession } from "@/lib/session";
import {
  createVaultEntry, deactivateVaultEntry, listVaultEntries, recoverPersonalSecret, recoverPreviousSecret, revealVaultSecret, takeRevealSlot,
  updateVaultEntry, type VaultServerActor,
} from "@/lib/vault";
import { VAULT_REVEAL_BURST_THRESHOLD, type VaultEntryInput } from "@/lib/vault-shared";
import { fakeVaultClient, type FakeVaultClient } from "./vault-fake-client";

const holder: { f: FakeVaultClient | null } = { f: null };
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  enqueueNotification: vi.fn(async () => ({ notificationId: "n", recipientIds: [] })),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth-flows", () => ({ verifyActorPin: vi.fn(async () => true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => holder.f!.client }));

const CANARY = "CANARY-7f3a-" + randomBytes(8).toString("hex") + "-SECRET";
const CANARY_2 = "CANARY-2nd-" + randomBytes(8).toString("hex");
const CANARY_PERSONAL = "CANARY-mine-" + randomBytes(8).toString("hex");
const MASTER = randomBytes(32);
const MASTER_HEX = MASTER.toString("hex");
const MASTER_B64 = MASTER.toString("base64");
const NEEDLES = [CANARY, CANARY_2, CANARY_PERSONAL, MASTER_HEX, MASTER_B64, MASTER_HEX.toUpperCase()];

const EM = "11111111-1111-4111-8111-111111111111";
const U = { maya: "a0000000-0000-4000-8000-000000000001", gm: "a0000000-0000-4000-8000-000000000002", moo: "a0000000-0000-4000-8000-000000000004", pete: "a0000000-0000-4000-8000-000000000005" };
const META = { ipAddress: "10.0.0.1", userAgent: "vitest" };
const maya: VaultServerActor = { userId: U.maya, role: "key_holder", level: 4, locations: [EM], name: "Maya" };
const gm: VaultServerActor = { userId: U.gm, role: "gm", level: 7, locations: [EM], name: "Gina" };
const moo: VaultServerActor = { userId: U.moo, role: "moo", level: 8, locations: [], name: "Cristian" };
const pete: VaultServerActor = { userId: U.pete, role: "owner", level: 9, locations: [], name: "Pete" };

const sinks: Array<{ sink: string; text: string }> = [];
const consoleLines: string[] = [];
const sink = (name: string, value: unknown) => sinks.push({ sink: name, text: typeof value === "string" ? value : JSON.stringify(value, (_k, v) => (v instanceof Error ? { ...v, name: v.name, message: v.message, stack: v.stack } : v)) });
async function capture<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { sink(`${name} (thrown)`, e); return undefined; }
}

let shared: VaultEntryInput;
let personal: VaultEntryInput;
let sharedId = "";
let personalId = "";
const revealed: string[] = [];

beforeAll(async () => {
  vi.stubEnv("VAULT_ENABLED", "1");
  vi.stubEnv("VAULT_MASTER_KEY", MASTER_HEX);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); });
  }
  holder.f = fakeVaultClient({
    users: [{ id: U.maya, role: "key_holder", active: true }, { id: U.gm, role: "gm", active: true }, { id: U.moo, role: "moo", active: true }, { id: U.pete, role: "owner", active: true }],
    user_locations: [{ user_id: U.maya, location_id: EM, active: true }, { user_id: U.gm, location_id: EM, active: true }],
    locations: [{ id: EM, code: "EM", active: true }],
    vault_entries: [], vault_secrets: [], vault_reveals: [],
  });
  const f = holder.f;
  shared = { kind: "shared", name: "Toast back-office", entryType: "login", username: "ops@co", secret: CANARY, url: "https://toast.example", notes: "front register", locationId: EM, minLevel: 4 };
  personal = { kind: "personal", name: "My bank", entryType: "login", username: "maya", secret: CANARY_PERSONAL, url: null, notes: null, locationId: null, minLevel: null };

  // The lifecycle, every step through the real lib.
  const s = await capture("create shared", () => createVaultEntry(f.client, gm, shared, META));
  sharedId = s?.id ?? "";
  const p = await capture("create personal", () => createVaultEntry(f.client, maya, personal, META));
  personalId = p?.id ?? "";
  await capture("list", () => listVaultEntries(f.client, moo).then((v) => sink("list view", v)));
  const r1 = await capture("reveal shared", () => revealVaultSecret(f.client, maya, sharedId, { burst: false }, META));
  if (r1) revealed.push(r1.secret);
  const r2 = await capture("reveal personal", () => revealVaultSecret(f.client, maya, personalId, { burst: false }, META));
  if (r2) revealed.push(r2.secret);
  await capture("reveal personal by other", () => revealVaultSecret(f.client, gm, personalId, { burst: false }, META));
  await capture("update secret", () => updateVaultEntry(f.client, gm, sharedId, { ...shared, expectedRevision: 1, name: "Toast BOH", secret: CANARY_2 }, META).then((v) => sink("update view", v)));
  const r3 = await capture("recover previous", () => recoverPreviousSecret(f.client, moo, sharedId, { burst: false }, META));
  if (r3) revealed.push(r3.secret);
  const r4 = await capture("owner recovery", () => recoverPersonalSecret(f.client, pete, personalId, { burst: true }, META));
  if (r4) revealed.push(r4.secret);
  for (let i = 0; i < VAULT_REVEAL_BURST_THRESHOLD; i += 1) await capture("slot", () => takeRevealSlot(f.client, maya));
  // Routes: a successful reveal and a failing one (rotated key) through the real handler.
  vi.mocked(requireSession).mockResolvedValue({ user: { id: U.maya, name: "Maya", role: "key_holder" }, role: "key_holder", level: 4, locations: [EM], session: { id: "s" } } as never);
  const call = () => revealRoute(new NextRequest(`https://ops.example.test/api/vault/entries/${sharedId}/reveal`, {
    method: "POST", headers: { origin: "https://ops.example.test", "content-type": "application/json" }, body: JSON.stringify({ pin: "1234" }),
  }), { params: Promise.resolve({ id: sharedId }) });
  const ok = await call();
  const okBody = (await ok.json()) as { secret?: string };
  sink("route ok headers", Object.fromEntries(ok.headers.entries()));
  if (okBody.secret) revealed.push(okBody.secret);
  sink("route ok body minus secret", { ...okBody, secret: undefined });
  vi.stubEnv("VAULT_MASTER_KEY", randomBytes(32).toString("hex"));
  const bad = await call();
  sink("route failure body", await bad.json());
  sink("route failure status", String(bad.status));
  await capture("reveal with rotated key", () => revealVaultSecret(f.client, maya, sharedId, { burst: false }, META));
  vi.stubEnv("VAULT_MASTER_KEY", MASTER_HEX);
  await capture("deactivate", () => deactivateVaultEntry(f.client, gm, sharedId, META));
  await capture("reveal deactivated", () => revealVaultSecret(f.client, maya, sharedId, { burst: false }, META));

  // Collect every sink.
  for (const w of f.writes) sink(`db write ${w.table} ${w.op}`, w.payload);
  for (const c of f.rpcCalls) sink(`rpc ${c.name}`, c.args);
  for (const [table, rows] of Object.entries(f.tables)) sink(`table ${table}`, rows);
  for (const row of f.tables.vault_secrets ?? []) {
    const r = row as { ciphertext: string | null; wrapped_key: string | null };
    if (r.ciphertext) sink("decoded ciphertext", Buffer.from(r.ciphertext, "base64").toString("latin1"));
    if (r.wrapped_key) sink("decoded wrapped key", Buffer.from(r.wrapped_key, "base64").toString("latin1"));
  }
  for (const c of vi.mocked(audit).mock.calls) sink("audit()", c[0]);
  for (const c of vi.mocked(enqueueNotification).mock.calls) sink("enqueueNotification()", c[1]);
  for (const line of consoleLines) sink("console", line);
  expect(verifyActorPin).toHaveBeenCalled();
});
afterAll(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("runtime: the canary and the master key reach no sink", () => {
  it("the lifecycle actually ran (the secrets came back only through reveal results)", () => {
    expect(revealed).toEqual([CANARY, CANARY_PERSONAL, CANARY, CANARY_PERSONAL, CANARY_2]);
    expect(sinks.length).toBeGreaterThan(40);
    expect(sinks.some((s) => s.sink === "audit()")).toBe(true);
    expect(sinks.some((s) => s.sink === "enqueueNotification()")).toBe(true);
    expect(sinks.some((s) => s.sink.startsWith("db write vault_reveals"))).toBe(true);
    expect(sinks.some((s) => s.sink === "route failure body")).toBe(true);
    expect(sinks.some((s) => s.sink.endsWith("(thrown)"))).toBe(true);
  });
  it("no database row, RPC argument, audit row, notification, console line, error or route response carries a secret or the key", () => {
    const hits = sinks.filter((s) => NEEDLES.some((n) => s.text.includes(n))).map((s) => s.sink);
    expect(hits).toEqual([]);
  });
  it("the stored envelope is not the plaintext in disguise", () => {
    const rows = (holder.f!.tables.vault_secrets ?? []) as Array<{ ciphertext: string | null; master_key_id: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.master_key_id).toBe("v1");
      if (r.ciphertext) expect(Buffer.from(r.ciphertext, "base64").toString("utf8")).not.toMatch(/CANARY/);
    }
    expect(JSON.stringify(rows)).not.toMatch(/CANARY/);
  });
});

// ── Static: what keeps the crypto and the key out of the client bundle ──────────────────────
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");

describe("static: import rules", () => {
  it("the server modules are server-only", () => {
    for (const p of ["lib/vault-crypto.ts", "lib/vault.ts", "lib/vault-route.ts"]) expect(read(p).startsWith('import "server-only";'), p).toBe(true);
  });
  it("VAULT_MASTER_KEY is read in exactly one place (lib/vault-crypto.ts) across lib/, app/ and components/", () => {
    const hits = [...walk("lib"), ...walk("app"), ...walk("components")].filter((p) => read(p).includes("VAULT_MASTER_KEY")).map((p) => p.split(path.sep).join("/"));
    expect(hits).toEqual(["lib/vault-crypto.ts"]);
  });
  it("no vault UI file imports the server lib, the crypto, node:crypto, or touches browser storage", () => {
    const ui = [...walk("app/(authed)/vault"), ...walk("components/vault")];
    for (const p of ui) {
      const src = read(p);
      if (src.startsWith('"use client"')) {
        expect(src, p).not.toMatch(/from "@\/lib\/vault"|from "@\/lib\/vault-crypto"|from "@\/lib\/vault-route"|from "node:crypto"|from "crypto"/);
      }
      expect(src, p).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
      expect(src, p).not.toMatch(/console\.(log|info|debug)/);
    }
  });
  it("the client-safe vault modules import nothing server-side", () => {
    for (const p of ["lib/vault-shared.ts", "lib/vault-flag.ts"]) {
      expect(read(p), p).not.toMatch(/import "server-only"|from "(server-only|@\/lib\/supabase-server|node:crypto|crypto|@\/lib\/vault|@\/lib\/vault-crypto|@\/lib\/vault-route)"/);
    }
  });
});
