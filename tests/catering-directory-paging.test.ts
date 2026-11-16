/**
 * W23/B207 — the catering customer directory and the company list were one request each, so
 * PostgREST's 1,000-row cap truncated them silently (no warning; late-alphabet and null-company
 * contacts vanished from the list and the quote picker). They now page with an `id` tiebreak.
 * loadCompany's domains read is error-checked and its contacts read is paged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";

let current: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));

import { loadCustomers } from "@/lib/catering/customers";
import { loadCompanies, loadCompany } from "@/lib/catering/companies";

const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 10, locations: [] } as unknown as AuthContext;
const N = 1050;
const pad = (i: number) => String(i).padStart(5, "0");

function tables(): Tables {
  return {
    catering_customers: Array.from({ length: N }, (_, i) => ({
      id: `00000000-0000-4000-8000-${pad(i).padStart(12, "0")}`, name: `Contact ${pad(i)}`,
      company: i % 3 === 0 ? null : `Company ${String.fromCharCode(65 + (i % 26))}`, company_id: "co-1",
      contact_person: null, email: `c${i}@corp.com`, phone: null, primary_location_id: null, notes: null,
      active: true, created_at: "2026-10-01T00:00:00Z", created_by: null,
    })),
    catering_companies: Array.from({ length: N }, (_, i) => ({
      id: i === 0 ? "co-1" : `co-${pad(i)}`, name: `Company ${pad(i)}`, notes: null, claimed_by_customer_id: null,
      claimed_at: null, active: true, created_at: "2026-10-01T00:00:00Z", created_by: null,
    })),
    catering_company_domains: [{ id: "d1", company_id: "co-1", domain: "corp.com", active: true }],
  };
}

beforeEach(() => { current = createFakeDb(tables()); });

describe("W23/B207 the catering directory reads every row", () => {
  it("loadCustomers returns all 1,050 contacts (was 1,000), each once", async () => {
    const rows = await loadCustomers(owner);
    expect(rows).toHaveLength(N);
    expect(new Set(rows.map((r) => r.id)).size).toBe(N);
  });

  it("loadCompanies returns all 1,050 companies (was 1,000)", async () => {
    const rows = await loadCompanies(owner);
    expect(rows).toHaveLength(N);
    expect(new Set(rows.map((r) => r.id)).size).toBe(N);
  });

  it("loadCompany lists every contact of the company", async () => {
    const detail = await loadCompany(owner, "co-1");
    expect(detail?.contacts).toHaveLength(N);
    expect(detail?.domains.map((d) => d.domain)).toEqual(["corp.com"]);
  });
});
