import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/prune-sessions/route";
import { runVaultScrub } from "@/lib/vault-scrub-run";
import { runPruneSessions } from "@/lib/prune-sessions-run";
import { audit } from "@/lib/audit";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc }) }));
vi.mock("@/lib/prune-sessions-run", () => ({ runPruneSessions: vi.fn(async () => ({ revoked: 2 })) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const request = (token?: string) => new NextRequest("https://example.test/api/cron/prune-sessions", {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-token");
  vi.stubEnv("VAULT_ENABLED", "");
  rpc.mockResolvedValue({ data: 3, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("P2 #4: scheduled cryptographic deletion", () => {
  it("the existing daily Vercel path invokes the scrub even when the vault UI is disabled", async () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toContainEqual({ path: "/api/cron/prune-sessions", schedule: "30 8 * * *" });
    const response = await GET(request("test-cron-token"));
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: { job: "vault-scrub", scrubbed: 3, migrationPending: false } }));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("vault_scrub_expired_secrets");
    expect(await response.json()).toMatchObject({ vault: { scrubbed: 3, migrationPending: false } });
  });
  it("refuses missing/wrong Bearer credentials before touching the vault", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports a migration-pending skip only when the unapplied RPC is absent", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await runVaultScrub()).toEqual({ scrubbed: 0, migrationPending: true });
  });
  it("fails the cron and audits a fixed code, never the database error payload", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private database detail" } });
    const response = await GET(request("test-cron-token"));
    expect(response.status).toBe(500);
    expect(runPruneSessions).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: { job: "prune-sessions", revoked: 2 } }));
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: { job: "vault-scrub", error: "vault_scrub_failed" } }));
  });
  it("sanitizes thrown transport errors too", async () => {
    rpc.mockRejectedValue(new Error("private transport detail"));
    await expect(runVaultScrub()).rejects.toThrow(/^vault_scrub_failed$/);
  });
});


it("prune failure does not prevent a scrub success heartbeat", async () => {
  vi.mocked(runPruneSessions).mockRejectedValueOnce(new Error("private prune detail"));
  const response = await GET(request("test-cron-token"));
  expect(response.status).toBe(500);
  expect(rpc).toHaveBeenCalledOnce();
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: { job: "vault-scrub", scrubbed: 3, migrationPending: false } }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: { job: "prune-sessions", error: "session_prune_failed" } }));
  expect(JSON.stringify(await response.json())).not.toContain("private prune detail");
});
it("both failures get separate failure heartbeats", async () => {
  rpc.mockRejectedValueOnce(new Error("scrub failed"));
  vi.mocked(runPruneSessions).mockRejectedValueOnce(new Error("prune failed"));
  expect((await GET(request("test-cron-token"))).status).toBe(500);
  expect(vi.mocked(audit).mock.calls.map(([row]) => [row.action, row.metadata.job])).toEqual([
    ["cron.failure", "vault-scrub"], ["cron.failure", "prune-sessions"],
  ]);
});
