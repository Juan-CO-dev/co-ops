/** SQL contract checks for 0234; they complement (never replace) scripts/test-customer-profiles.sql (PGlite here, sim by CC). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { profileStats } from "@/lib/customers/stats-shared";

const sql = readFileSync("supabase/migrations/0234_customer_profiles.sql", "utf8").replace(/\r\n/g, "\n");
const harness = readFileSync("scripts/test-customer-profiles.sql", "utf8");
const TABLES = ["customers", "customer_identifiers", "customer_cards", "customer_orders", "customer_consent_imports",
  "customer_consent_import_chunks", "customer_consent_import_members", "customer_consent_events", "customer_merge_suggestions", "customer_suppressions"];

describe("0234 discipline", () => {
  it("is numbered 0234, authored only, and never touches 0235", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0234_customer_profiles");
    expect(sql).toContain("NOT YET APPLIED -- GATE CC/JUAN");
    expect(sql).not.toMatch(/0235/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("every table: RLS on, explicit no_user_delete, service_role SELECT only, nothing for staff roles", () => {
    for (const t of TABLES) {
      expect(sql, t).toContain(`create table public.${t} (`);
    }
    const loop = sql.slice(sql.indexOf("foreach t in array array['customers'"), sql.indexOf("end loop;", sql.indexOf("foreach t in array array['customers'")));
    for (const t of TABLES) expect(loop, t).toContain(`'${t}'`);
    expect(loop).toContain("enable row level security");
    expect(loop).toContain("for delete using (false)");
    expect(loop).toContain("revoke all on public.%I from public, anon, authenticated, service_role");
    expect(loop).toContain("grant select on public.%I to service_role");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*customer/i);
    expect(sql).not.toMatch(/for all/i);
    expect(sql).toContain("raise exception '0234: table grant escaped'");
    expect(sql).toContain("raise exception '0234: RPC grant escaped'");
  });
  it("every function is SECURITY DEFINER with a pinned search_path (except the immutable hash helper)", () => {
    const fns = [...sql.matchAll(/create function public\.(\w+)\(([\s\S]*?)\$\$/g)];
    expect(fns.length).toBeGreaterThanOrEqual(18);
    for (const [, name, body] of fns) {
      expect(body, name).toContain("set search_path = pg_catalog, public");
      // Ungranted helpers that only run inside definer RPCs (hash, relay test, identity lock) need no definer.
      if (!["customer_sha256", "customer_email_is_relay", "customer_identity_lock"].includes(name!)) expect(body, name).toContain("security definer");
    }
  });
  it("cards hold brand + last4 only, and identifiers are normalised by constraint", () => {
    expect(sql).toContain("last4 text not null check (last4 ~ '^[0-9]{4}$')");
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/\b(pan|card_number|expiry|cvv)\b/i);
    expect(sql).toContain("value = lower(btrim(value))");
    expect(sql).toContain("value ~ '^\\+[1-9][0-9]{7,14}$'");
  });
  it("identity resolves email then phone and never merges two existing people itself", () => {
    const resolve = sql.slice(sql.indexOf("create function public.customer_resolve"), sql.indexOf("-- ───────────────────────────── writers"));
    expect(resolve).toContain("customer_id := coalesce(v_by_email, v_by_phone);");
    expect(resolve).toContain("'email_phone_split'");
    expect(resolve).not.toMatch(/merged_into\s*=/);
    // the only writer of merged_into is the manager-confirmed customer_merge
    const writers = [...sql.matchAll(/create function public\.(\w+)[\s\S]*?end \$\$;/g)].filter(([body]) => /set merged_into\s*=|merged_into = v_keep/.test(body)).map(([, n]) => n);
    expect(writers).toEqual(["customer_merge"]);
  });
  it("consent events are append-only: no update/delete anywhere in the SQL", () => {
    expect(sql).not.toMatch(/update public\.customer_consent_events/);
    expect(sql).not.toMatch(/delete from public\.customer_consent_events/);
  });
  it("delete-on-request suppresses hashes and opts out; ingest and import honour the suppression", () => {
    const erase = sql.slice(sql.indexOf("create function public.customer_erase"), sql.indexOf("-- Retention:"));
    expect(erase).toContain("insert into public.customer_suppressions");
    expect(erase).toContain("'opted_out', p_reason");
    expect(erase).toContain("delete from public.customer_identifiers");
    expect(erase).toContain("delete from public.customer_cards");
    expect(sql).toContain("if suppressed then return; end if;");
  });
  it("the harness covers the rules this PR claims and rolls back", () => {
    for (const s of ["name + card must not auto-merge", "same file = replay", "baseline is never \"newly opted in\"", "absent from the new list = opted out",
      "opt-out drops immediately", "a deleted person is not re-created", "39 of 40 vanishing needs confirmation", "a PAN never fits in last4", "events only through RPCs"]) {
      expect(harness, s).toContain(s);
    }
    expect(harness.trimEnd().endsWith("rollback;")).toBe(true);
    // Only invented example.com guests, plus the relay fixtures r1 proves are refused.
    expect(harness.replace(/fixture@relay\.toasttab\.com|x1@doordash\.com/g, "")).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]/i);
  });
});

describe("profile stats", () => {
  it("visits, spend, favourites, channels, frequency", () => {
    const s = profileStats([
      { business_date: "2026-10-01", channel: "online", total_cents: 1200, items: [{ name: "Crunchy Boi", qty: 1 }], location_id: "x" },
      { business_date: "2026-10-05", channel: "dine_in", total_cents: 800, items: [{ name: "Crunchy Boi", qty: 1 }, { name: "Chips", qty: 3 }], location_id: "x" },
      { business_date: "2026-10-09", channel: "online", total_cents: 1000, items: null, location_id: "x" },
    ]);
    expect(s).toMatchObject({ visits: 3, spendCents: 3000, firstOrder: "2026-10-01", lastOrder: "2026-10-09", avgDaysBetween: 4 });
    expect(s.favourites).toEqual([{ name: "Chips", qty: 3 }, { name: "Crunchy Boi", qty: 2 }]);
    expect(s.channels).toEqual([{ channel: "online", visits: 2 }, { channel: "dine_in", visits: 1 }]);
  });
  it("an unknown order total makes spend unknown, never a smaller number", () => {
    const s = profileStats([{ business_date: "2026-10-01", channel: "online", total_cents: null, items: [], location_id: "x" },
      { business_date: "2026-10-01", channel: "online", total_cents: 500, items: [], location_id: "x" }]);
    expect(s.spendCents).toBeNull();
    expect(s.unknownSpend).toBe(1);
    expect(s.avgDaysBetween).toBeNull();
  });
});
