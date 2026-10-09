/** 0234 exports: opted-in only (twice), opt-outs drop, Meta file hashed correctly, no override, switch OFF blocks. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { audit } from "@/lib/audit";
import { marketingCsv, metaAudienceCsv, metaAudienceEnabled, metaEmailHash, metaPhoneHash, optedInOnly } from "@/lib/customers/exports-core";
import { exportCustomers } from "@/lib/customers/customers";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const row = (id: string, value: string, status = "opted_in") => ({ customer_id: id, value, first_name: "A", last_name: "B", opted_in_at: "2026-10-01T04:00:00Z", source: "toast_csv_import", status });

describe("the second filter", () => {
  it("drops anything not explicitly opted_in", () => {
    expect(optedInOnly([{ status: "opted_in" }, { status: "opted_out" }, {}, { status: "unknown" }])).toEqual([{ status: "opted_in" }]);
  });
  it("an opted-out row never reaches the email list", () => {
    const { csv, count } = marketingCsv([row("1", "ana@example.com"), row("2", "bo@example.com", "opted_out")]);
    expect(count).toBe(1);
    expect(csv).toContain("ana@example.com");
    expect(csv).not.toContain("bo@example.com");
  });
});

describe("Meta customer file", () => {
  it("hashes Meta's normalisation: email trimmed + lowercased; phone digits with country code, no +", () => {
    expect(metaEmailHash("  Ana@Example.COM ")).toBe(sha("ana@example.com"));
    expect(metaPhoneHash("+12025550101")).toBe(sha("12025550101"));
    expect(metaPhoneHash("2025550101")).toBeNull();
  });
  it("contains hashes only, one row per person, opted-in channels only", () => {
    const { csv, count } = metaAudienceCsv(
      [row("1", "ana@example.com"), row("2", "bo@example.com", "opted_out")],
      [row("1", "+12025550101"), row("3", "+12025550199", "opted_out")],
    );
    expect(count).toBe(1);
    expect(csv).toBe(`email,phone\r\n${sha("ana@example.com")},${sha("12025550101")}\r\n`);
    expect(csv).not.toMatch(/@|\+1/);
  });
  it("is OFF unless META_AUDIENCE_EXPORT=1", () => {
    expect(metaAudienceEnabled({})).toBe(false);
    expect(metaAudienceEnabled({ META_AUDIENCE_EXPORT: "true" })).toBe(false);
    expect(metaAudienceEnabled({ META_AUDIENCE_EXPORT: "1" })).toBe(true);
  });
});

describe("exportCustomers guards", () => {
  const meta = { ipAddress: null, userAgent: null };
  const owner = { userId: "u9", role: "owner" as const, level: 9, locations: [] };
  beforeEach(() => { vi.mocked(audit).mockClear(); process.env.CUSTOMER_PROFILES = "1"; delete process.env.META_AUDIENCE_EXPORT; });

  it("the Meta export is refused (and the refusal audited) while the switch is off, before any read", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() };
    await expect(exportCustomers(owner, "meta_audience", meta, { client: client as never })).rejects.toMatchObject({ status: 403, code: "meta_export_off" });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.export_refused", metadata: { kind: "meta_audience", code: "meta_export_off" } });
  });
  it("below level 9 every export is refused and audited", async () => {
    const client = { rpc: vi.fn(), from: vi.fn() };
    await expect(exportCustomers({ ...owner, role: "moo", level: 8 }, "marketing_email", meta, { client: client as never })).rejects.toMatchObject({ code: "role_insufficient" });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0]![0].action).toBe("customer.export_refused");
  });
  it("an allowed export reads the opted-in RPC only, re-filters, and audits the row count", async () => {
    const range = vi.fn().mockResolvedValue({ data: [row("1", "ana@example.com"), row("2", "leak@example.com", "opted_out")], error: null });
    const client = { rpc: vi.fn(() => ({ range })), from: vi.fn() };
    const file = await exportCustomers(owner, "marketing_email", meta, { client: client as never, now: new Date("2026-10-08T12:00:00Z") });
    expect(client.rpc).toHaveBeenCalledWith("customer_marketing_export", { p_channel: "email" });
    expect(file.count).toBe(1);
    expect(file.csv).not.toContain("leak@example.com");
    expect(file.filename).toBe("marketing-opted-in-2026-10-08.csv");
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.export_marketing", metadata: { rows: 1 } });
  });
  it("with the switch on, the Meta file is hashed and audited as not uploaded", async () => {
    process.env.META_AUDIENCE_EXPORT = "1";
    const range = vi.fn().mockResolvedValue({ data: [row("1", "ana@example.com")], error: null });
    const client = { rpc: vi.fn(() => ({ range })), from: vi.fn() };
    const file = await exportCustomers(owner, "meta_audience", meta, { client: client as never });
    expect(file.csv).toContain(sha("ana@example.com"));
    expect(file.csv).not.toContain("ana@example.com");
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.export_meta_audience", metadata: { uploaded: false } });
  });
});

describe("no override, by construction", () => {
  const sql = readFileSync("supabase/migrations/0234_customer_profiles.sql", "utf8");
  it("the SQL export takes only the channel and hard-codes opted_in", () => {
    const fn = sql.slice(sql.indexOf("create function public.customer_marketing_export"), sql.indexOf("-- \"Newly opted in\""));
    expect(fn).toContain("customer_marketing_export(p_channel text)");
    expect(fn).toContain("k.status = 'opted_in'");
    expect(fn).toContain("c.erased_at is null");
    expect(fn).toMatch(/customer_suppressions/);
  });
  it("the TS export entry takes a kind, never a filter or status", () => {
    const src = readFileSync("lib/customers/customers.ts", "utf8");
    expect(src).toMatch(/export async function exportCustomers\(actor: CustomerActor, kind: CustomerExportKind, meta: RequestMeta, deps: CustomerDeps = \{\}\)/);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/includeNonOptedIn|override|allStatuses/i);
  });
  it("there is no Meta upload client anywhere", () => {
    const src = readFileSync("lib/customers/exports-core.ts", "utf8") + readFileSync("lib/customers/customers.ts", "utf8");
    expect(src).not.toMatch(/graph\.facebook\.com|customaudiences|fetch\(/i);
  });
});
