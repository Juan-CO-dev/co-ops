/**
 * The digest alert path (job-watch shaped) and the real send store's 23505 mapping, against a
 * mocked service client. No database: the mocks stand in for PostgREST's answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertDigestProblem, supabaseSendStore } from "@/lib/report-digests";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mail" })), teamFrom: () => "team@example.com" }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const claims = new Set<string>();
const rpc = vi.fn(async (_name: string, args: { p_bucket_key: string }) => {
  const won = !claims.has(args.p_bucket_key);
  claims.add(args.p_bucket_key);
  return { data: won, error: null };
});
const sb = { rpc } as never;

beforeEach(() => { vi.clearAllMocks(); claims.clear(); vi.stubEnv("OPS_ALERT_EMAIL", "operator@example.com"); });

describe("alertDigestProblem", () => {
  it("emails the operator once per detector × kind × day and writes a cron.failure row", async () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const a = { kind: "catering" as const, day: "2026-10-07", detector: "digest-watch" as const, missing: ["user:1", "user:2"] };
    expect(await alertDigestProblem(sb, a, now)).toBe(true);
    expect(await alertDigestProblem(sb, a, now)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("portal_rate_limit_hit", {
      p_bucket_key: "digest-watch:catering:2026-10-07:2026-10-07", p_window_start: "2026-10-07T04:00:00.000Z", p_max: 1,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail.to).toBe("operator@example.com");
    expect(mail.subject).toBe("CO-OPS: the catering digest for 2026-10-07 did not reach 2 recipients");
    expect(mail.text).toContain("Resumen: catering"); // bilingual body, like job-watch
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cron.failure",
      metadata: expect.objectContaining({ job: "digest-catering", detector: "digest-watch", missing: ["user:1", "user:2"], email_error: null }),
    }));
  });

  it("a send failure alert names the recipient and the error", async () => {
    await alertDigestProblem(sb, { kind: "unified", day: "2026-10-06", detector: "digest-send", ref: "user:9", error: "422 domain not verified" }, new Date("2026-10-07T07:00:00Z"));
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail.subject).toBe("CO-OPS: a unified digest send failed (2026-10-06)");
    expect(mail.text).toContain("Recipient: user:9. Error: 422 domain not verified.");
  });

  it("never throws; a failed claim sends nothing (no duplicate storm)", async () => {
    const broken = { rpc: vi.fn(async () => ({ data: null, error: { message: "down" } })) } as never;
    expect(await alertDigestProblem(broken, { kind: "catering", day: "2026-10-07", detector: "digest-watch" }, new Date())).toBe(false);
    const throwing = { rpc: vi.fn(async () => { throw new Error("network"); }) } as never;
    expect(await alertDigestProblem(throwing, { kind: "catering", day: "2026-10-07", detector: "digest-watch" }, new Date())).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("supabaseSendStore", () => {
  function client(insertError: { code?: string; message: string } | null, updated: Array<{ id: string }> = [{ id: "r1" }]) {
    const inserted: unknown[] = [];
    const updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }> = [];
    const from = () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        const res = { data: insertError ? null : { id: "r1" }, error: insertError };
        return { select: () => ({ single: async () => res }), then: (ok: (v: unknown) => unknown) => ok({ error: insertError }) };
      },
      update: (patch: unknown) => {
        const entry = { patch, filters: [] as Array<[string, unknown]> };
        updates.push(entry);
        const q = { eq: (k: string, v: unknown) => { entry.filters.push([k, v]); return q; }, select: async () => ({ data: updated, error: null }) };
        return q;
      },
    });
    return { sb: { from } as never, inserted, updates };
  }
  const row = { kind: "catering" as const, business_day: "2026-10-07", recipient_ref: "user:1", location_id: null, revision: 1, mode: "live" as const };

  it("a claim refused by the unique index (23505) is 'duplicate', not an error", async () => {
    expect(await supabaseSendStore(client({ code: "23505", message: "duplicate key" }).sb).claim(row)).toBe("duplicate");
    await expect(supabaseSendStore(client({ code: "42501", message: "denied" }).sb).claim(row)).rejects.toThrow("digest claim: denied");
    const ok = client(null);
    expect(await supabaseSendStore(ok.sb).claim(row)).toEqual({ id: "r1" });
    expect(ok.inserted[0]).toMatchObject({ ...row, outcome: "claimed" });
  });

  it("finish is guarded on outcome='claimed' and reports a lost row", async () => {
    const c = client(null, []);
    expect(await supabaseSendStore(c.sb).finish("r1", { outcome: "sent", email_id: "m" })).toBe(false);
    expect(c.updates[0]!.filters).toEqual([["id", "r1"], ["outcome", "claimed"]]);
  });
});
