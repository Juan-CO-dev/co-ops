/**
 * 0234 r1 — regressions for Astra's privacy review (REWORK, 2026-10-09). One block per finding.
 * SQL behaviour is proven by scripts/test-customer-profiles.sql (sections 11-14, PGlite here, sim by CC)
 * and scripts/test-customer-concurrency.sh (two real sessions on the sim); these pin the contracts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { audit } from "@/lib/audit";
import { canonicalImportPayload, mergeConsentFiles, parseConsentCsv } from "@/lib/customers/consent-shared";
import { MASKED_EMAIL_DOMAINS } from "@/lib/customers/identity-shared";
import { suggestFromCards } from "@/lib/customers/capture";
import { cancelConsentImport, importConsentCsv } from "@/lib/customers/customers";

const sql = readFileSync("supabase/migrations/0234_customer_profiles.sql", "utf8").replace(/\r\n/g, "\n");
const harness = readFileSync("scripts/test-customer-profiles.sql", "utf8");
const fn = (name: string) => { const i = sql.indexOf(`create function public.${name}`); return sql.slice(i, sql.indexOf("end $$;", i) + 7); };
const meta = { ipAddress: null, userAgent: null };
const owner = { userId: "u9", role: "owner" as const, level: 9, locations: [] };
const ID = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.mocked(audit).mockClear(); process.env.CUSTOMER_PROFILES = "1"; });

describe("P1 BC-031: repeated list contents never swallow a real opt-out", () => {
  it("the snapshot key includes the export date", () => {
    const rows = [{ email: "a@example.com" }];
    expect(canonicalImportPayload(rows, false, "2026-10-01")).not.toBe(canonicalImportPayload(rows, false, "2026-10-03"));
  });
  it("SQL replays only when the snapshot IS the latest completed import; no uniqueness on the rows hash", () => {
    const begin = fn("customer_consent_import_begin");
    expect(begin).toContain("v_last.rows_sha256 = p_rows_sha256 and v_last.export_date = p_export_date");
    // the completed shortcut comes AFTER the latest-baseline read, never before it
    expect(begin.indexOf("status = 'completed'")).toBeLessThan(begin.indexOf("'state', 'completed'"));
    expect(begin).not.toMatch(/where source = p_source and rows_sha256 = p_rows_sha256/);
    expect(sql).not.toMatch(/unique \(source, rows_sha256\)/);
  });
  it("the TS path sends day 3's {A} as a new snapshot after {A,B}", async () => {
    const shas: string[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "customer_consent_import_begin") { shas.push(args.p_rows_sha256 as string); return { data: { import_id: ID, state: "started" }, error: null }; }
      if (name === "customer_consent_import_finish") return { data: { import_id: ID, replay: false, opt_outs: 1 }, error: null };
      return { data: {}, error: null };
    });
    const client = { rpc, from: vi.fn() } as never;
    await importConsentCsv(owner, { files: [{ name: "d1.csv", text: "email\na@example.com\n" }], exportDate: "2026-10-01", allowLargeOptOut: false }, meta, { client });
    await importConsentCsv(owner, { files: [{ name: "d3.csv", text: "email\na@example.com\n" }], exportDate: "2026-10-03", allowLargeOptOut: false }, meta, { client });
    expect(shas[0]).not.toBe(shas[1]);
  });
  it("the harness runs the exact three-import sequence and checks B is opted out and not exportable", () => {
    for (const s of ["the same rows as day 1 after an intervening import are a NEW snapshot", "B ends opted_out", "B is not exportable"]) expect(harness).toContain(s);
  });
});

describe("P1 BC-037: concurrent identity resolution yields one person", () => {
  it("every identity writer takes the one identity lock before reading owners", () => {
    const resolve = fn("customer_resolve");
    expect(resolve.indexOf("perform public.customer_identity_lock();")).toBeGreaterThan(-1);
    expect(resolve.indexOf("perform public.customer_identity_lock();")).toBeLessThan(resolve.indexOf("from public.customer_identifiers i where i.kind='email'"));
    for (const w of ["customer_erase", "customer_merge"]) expect(fn(w), w).toContain("perform public.customer_identity_lock();");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('customer-identity',0))");
  });
  it("an identifier owned by anyone else after the insert is a loud error, never a second profile", () => {
    expect(fn("customer_resolve").match(/raise exception 'customer_identity_conflict'/g)).toHaveLength(2);
  });
  it("the harness and the sim script prove one profile and complete erasure", () => {
    expect(harness).toContain("one profile per email");
    expect(harness).toContain("erasure removed every identifier");
    const sh = readFileSync("scripts/test-customer-concurrency.sh", "utf8");
    expect(sh).toContain("PASS: one person, erased completely");
    expect(sh).toContain("refusing: that is the PROD project");
  });
});

describe("P2 BC-031: relay addresses never enter through the CSV", () => {
  it("the parser drops relay and placeholder rows and counts them", () => {
    const f = parseConsentCsv("email\nfixture@relay.toasttab.com\nnoemail@gmail.com\nana@example.com\n");
    expect(f.rows).toEqual([{ email: "ana@example.com" }]);
    expect(f.masked).toBe(2);
    expect(mergeConsentFiles([f]).masked).toBe(2);
  });
  it("SQL refuses them too, with the same domain list as the TypeScript classifier", () => {
    const relay = sql.slice(sql.indexOf("create function public.customer_email_is_relay"), sql.indexOf("$$;", sql.indexOf("create function public.customer_email_is_relay")));
    const lists = [...relay.matchAll(/array\[([^\]]+)\]::text\[\]/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(lists).toHaveLength(2);
    for (const l of lists) expect([...l].sort()).toEqual([...MASKED_EMAIL_DOMAINS].sort());
    expect(fn("customer_consent_import_chunk")).toContain("if public.customer_email_is_relay(v_email) then v_masked := v_masked + 1; continue; end if;");
    expect(fn("customer_resolve")).toContain("public.customer_email_is_relay(v_email) then v_email := null;");
    expect(harness).toContain("relay never stored");
  });
});

describe("P2 BC-036: a wedged import can be cancelled safely", () => {
  it("an import's events count only once it completed; cancel exists and deletes nothing", () => {
    const view = sql.slice(sql.indexOf("create view public.customer_consent_current"), sql.indexOf("-- ───────────────────────────── private helpers"));
    expect(view).toContain("i.status = 'completed'");
    expect(fn("customer_consent_latest")).toContain("i.status = 'completed'");
    const cancel = fn("customer_consent_import_cancel");
    expect(cancel).toContain("status = 'cancelled'");
    expect(cancel).not.toMatch(/delete from/);
    expect(harness).toContain("cancelled import changed nobody");
    expect(harness).toContain("the corrected file can begin");
  });
  it("cancel is level 9+, refused before I/O below, and audited when it changes something", async () => {
    const noIo = { rpc: vi.fn(() => { throw new Error("I/O"); }), from: vi.fn() } as never;
    await expect(cancelConsentImport({ ...owner, role: "moo", level: 8 }, ID, meta, { client: noIo })).rejects.toMatchObject({ status: 403 });
    const rpc = vi.fn(async () => ({ data: { import_id: ID, changed: true, neutralised_events: 50 }, error: null }));
    await cancelConsentImport(owner, ID, meta, { client: { rpc, from: vi.fn() } as never });
    expect(rpc).toHaveBeenCalledWith("customer_consent_import_cancel", { p_actor_id: "u9", p_import_id: ID });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "customer.consent_import_cancel", metadata: { neutralised_events: 50 } });
  });
});

describe("P2 BC-040: no suggestion writes after the capture is cancelled", () => {
  it("a mid-loop abort stops further writes, and every write carries the signal", async () => {
    const controller = new AbortController();
    const candidates = [1, 2, 3].map((i) => ({ customer_id: `c${i}`, other_id: `o${i}`, name_key: "ana diaz", other_name_key: "ana diaz", same_shop: false, shared_cards: 1 }));
    const writes: string[] = [];
    const attached: AbortSignal[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      const q = {
        abortSignal: (s: AbortSignal) => { attached.push(s); return q; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (name === "customer_card_candidates") return Promise.resolve({ data: candidates, error: null }).then(res, rej);
          writes.push(String(args.p_a));
          controller.abort(); // the capture deadline fires during the first write
          return Promise.resolve({ data: true, error: null }).then(res, rej);
        },
      };
      return q;
    });
    await expect(suggestFromCards({ rpc, from: vi.fn() } as never, ["c1", "c2", "c3"], controller.signal)).rejects.toThrow();
    expect(writes).toEqual(["c1"]);
    expect(attached.length).toBe(2); // the candidate read and the one write
    expect(attached.every((s) => s === controller.signal)).toBe(true);
  });
});

describe("Juan 2026-10-09 consent basis: the Toast list is explicit opt-ins only", () => {
  it("the copy says so in both languages and the import audit records the basis", () => {
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(en["customers.import.basis"]).toMatch(/explicitly opted in/);
    expect(es["customers.import.basis"]).toMatch(/explícitamente/);
    expect(readFileSync("lib/customers/customers.ts", "utf8")).toContain(`consent_basis: "toast_list_explicit_opt_in"`);
  });
});
