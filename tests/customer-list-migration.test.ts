/** Static contracts only: CC must execute and time 0249 on sim before applying. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELAY_EMAIL_LOCALS } from "@/lib/customers/identity-shared";

const sql = readFileSync("supabase/migrations/0249_customer_list_v2.sql", "utf8").replace(/\r\n/g, "\n");
const original = readFileSync("supabase/migrations/0234_customer_profiles.sql", "utf8").replace(/\r\n/g, "\n");
function body(source: string, name: string): string {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}

describe("0249 customer list contracts", () => {
  it("retains the exact unapplied gate and transaction", () => {
    expect(sql).toContain("-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first, then prod.");
    expect(sql).toContain("\nbegin;\n");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).not.toMatch(/delete from public\.customer_identifiers/);
  });
  it("keeps every original relay branch byte-identical and pins local-base parity", () => {
    const previous = body(original, "customer_email_is_relay").replace("create function", "create or replace function").replace(/\n\$\$;$/, "");
    const next = body(sql, "customer_email_is_relay");
    expect(next.startsWith(previous)).toBe(true);
    const bases = next.match(/regexp_replace\(split_part\(p_email,'@',1\),'\\\+\.\*\$',''\) = any\(array\[([^\]]+)\]\)/)?.[1];
    expect(bases).toBeDefined();
    expect([...bases!.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(RELAY_EMAIL_LOCALS);
    expect(next).toContain("language sql immutable");
  });
  it("reasserts RLS and service SELECT-only table grants", () => {
    expect(sql).toContain("alter table public.customer_probable_links enable row level security;");
    expect(sql).toContain("create policy customer_probable_links_no_user_delete on public.customer_probable_links for delete using (false);");
    expect(sql).toContain("revoke all on public.customer_probable_links from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant select on public.customer_probable_links to service_role;");
    expect(sql).not.toMatch(/grant (insert|update|delete)|for all/i);
    expect(sql).toContain("customer_probable_links(guest_id) where revoked_at is null");
  });
  it("explicitly revokes every function and grants only public RPCs", () => {
    const privateNames = ["customer_email_is_relay", "customer_marketplace_guest", "customer_list_rows", "customer_marketplace_candidate_rows"];
    const revokes = [...sql.matchAll(/revoke all on function ([\s\S]*?);/g)].map((m) => m[1]!);
    const grants = [...sql.matchAll(/grant execute on function ([\s\S]*?);/g)].map((m) => m[1]!).join("\n");
    for (const match of sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      const name = match[1]!;
      const fn = body(sql, name);
      expect(fn).toContain("set search_path = pg_catalog, public");
      if (name !== "customer_email_is_relay") expect(fn).toContain("security definer");
      const revoke = revokes.find((r) => r.includes(`public.${name}(`));
      expect(revoke, name).toContain("from public, anon, authenticated");
      if (privateNames.includes(name)) {
        expect(revoke).toContain("service_role");
        expect(grants).not.toContain(`public.${name}(`);
      } else expect(grants).toContain(`public.${name}(`);
    }
  });
  it("serializes recapture, refuses erased orders, checks suppression before creating a guest", () => {
    const ingest = body(sql, "customer_ingest_orders");
    expect(ingest.indexOf("perform public.customer_identity_lock()")).toBeLessThan(ingest.indexOf("select public.customer_root(o.customer_id)"));
    expect(ingest.indexOf("erased_at is not null")).toBeLessThan(ingest.indexOf("from public.customer_resolve"));
    expect(ingest).toContain("v_res.customer_id is null and not v_res.suppressed");
    expect(ingest).toContain("v_res.customer_id := v_existing;");
    expect(ingest).toContain("v_existing is distinct from v_res.customer_id");
    // An owner conflict keeps the owner and is counted; it never raises (the pinger re-feeds the whole day).
    expect(ingest).not.toContain("customer_order_identity_conflict");
    expect(ingest).toContain("v_conflicts := v_conflicts + 1;");
    expect(ingest).toContain("'owner_conflicts', v_conflicts");
    const helper = body(sql, "customer_marketplace_guest");
    expect(helper).toContain("perform public.customer_identity_lock()");
    expect(helper).toContain("insert into public.customers(");
    expect(helper).not.toMatch(/customer_identifiers|customer_consent/);
    const previousTail = body(original, "customer_ingest_orders").split("    if v_res.created then")[1];
    expect(ingest.split("    if v_res.created then")[1]!.replace("\n    'owner_conflicts', v_conflicts, 'customer_ids'", "\n    'customer_ids'"))
      .toBe(previousTail);
  });
  it("avoids fanout, preserves unknown money and reads consent setwise", () => {
    const rows = body(sql, "customer_list_rows");
    expect(rows).toContain("count(o.total_cents) = count(*) then sum(o.total_cents)");
    expect(rows).toContain("count(o.total_cents) = count(*) then round(avg(o.total_cents))");
    expect(rows).toContain("o.location_id = any(p_location_ids)");
    expect(rows).toContain("from public.customer_consent_current k group by k.customer_id");
    expect(rows).not.toMatch(/customer_consent_latest|customer_root\(/);
    // The one permitted read of a contact value: the relay test, evaluated in SQL and never projected.
    expect(rows).toContain("public.customer_email_is_relay(i.value)");
    expect(rows.replaceAll("public.customer_email_is_relay(i.value)", "")).not.toMatch(/\bi\.value\b|value_sha256/);
    expect(body(sql, "customer_list_page")).toContain("r.customer_id\n  limit");
  });
  it("pages guests before item aggregation, never truncates candidate pairs", () => {
    const candidates = body(sql, "customer_marketplace_candidate_rows");
    expect(candidates).toContain("p.id > p_after");
    expect(candidates).toContain("btrim(regexp_replace(regexp_replace(lower(c.name_key),'[.]','','g'),'\\s+',' ','g')) name_key");
    expect(candidates).toContain("limit least(greatest(coalesce(p_limit,100),1),100)");
    expect(candidates).toContain("row_number() over (partition by q.customer_id order by q.qty desc, q.name)");
    expect(candidates).toContain("filter (where r.rank <= 5)");
    expect(candidates.match(/\blimit\b/g)).toHaveLength(1);
    expect(candidates.replaceAll("public.customer_email_is_relay(i.value)", "")).not.toMatch(/\bi\.value\b|value_sha256/);
  });
  it("revalidates advisory writes under the identity lock and refuses conflicting replay", () => {
    const writer = body(sql, "customer_probable_link_upsert");
    expect(writer).toContain("perform public.customer_identity_lock()");
    expect(writer).toContain("jsonb_array_length(v_evidence.candidates) <> 1");
    expect(writer).toContain("if not v_same and not v_shared then continue;");
    expect(writer).toContain("customer_probable_link_stale");
    expect(writer).toContain("customer_probable_link_conflict");
    expect(writer).not.toMatch(/update public\.customers|update public\.customer_orders|customer_merge\(/);
  });
});
