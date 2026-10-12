import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const old = read("supabase/migrations/0232_reports_sales_reads.sql");
const raw = read("supabase/migrations/0248_sales_server_names.sql");
const sql = raw.replace(/--[^\n]*/g, "");
const harness = read("docs/seed/check-0248-equivalence.sql");
const body = (source: string, name: string) => {
  const start = source.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("end $$;", start) + 7);
};
const between = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));
const functions = ["sales_report_breakdown", "sales_report_check_page", "sales_report_check_detail"];

describe("0248 sales display changes preserve numeric contracts", () => {
  it("replaces only the three display RPCs, with service-role grants and no data writes", () => {
    expect([...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])).toEqual(functions);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|alter table|create table|create index|drop)\b/i);
    expect(raw).toContain("NOT YET APPLIED -- GATE CC: sim first, then prod");
    for (const name of functions) {
      expect(body(raw, name)).toContain("security definer set search_path = pg_catalog, public");
      expect(body(raw, name)).toContain("perform public.sales_report_assert_window(");
      expect(sql.slice(sql.indexOf("revoke all on function"), sql.indexOf("grant execute"))).toContain(name);
      expect(sql.slice(sql.indexOf("grant execute"))).toContain(name);
    }
    expect(sql).toContain("from public, anon, authenticated, service_role;");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toMatch(/grant[^;]+to (public|anon|authenticated)\b/);
  });

  it("keeps channel, hour, discount, item counting and check filters byte-identical", () => {
    const previous = body(old, functions[0]!);
    const current = body(raw, functions[0]!);
    expect(between(current, "  elsif p_dimension = 'channel'", "  else\n"))
      .toBe(between(previous, "  elsif p_dimension = 'channel'", "  else\n"));
    expect(between(current, "        'units', sum", "  elsif p_dimension = 'channel'"))
      .toBe(between(previous, "        'units', sum", "  elsif p_dimension = 'channel'"));
    expect(between(body(raw, functions[1]!), "  with page as (", "  ), names as ("))
      .toBe(between(body(old, functions[1]!), "  with page as (", "  ), names as ("));
    expect(between(body(raw, functions[1]!), "      'amount_cents'", "  from page f"))
      .toBe(between(body(old, functions[1]!), "      'amount_cents'", "  from page f"));
    expect(body(raw, functions[2]!).slice(body(raw, functions[2]!).indexOf("    'amount_cents'")))
      .toBe(body(old, functions[2]!).slice(body(old, functions[2]!).indexOf("    'amount_cents'")));
    expect(current).toContain("'checks', count(*), 'cents', coalesce(sum(f.amount_cents), 0),");
    expect(current).toContain("group by coalesce(f.server_guid, '')");
  });

  it("uses only active same-shop links and first tokens, after the existing bounded Toast first name", () => {
    for (const name of functions) {
      const b = body(raw, name);
      expect(b).toContain("l.location_id = p_location_id and l.employee_guid = f.server_guid and l.active");
      expect(b).toContain("u.id = l.user_id");
      expect(b).toContain("substring(u.name from '\\S+')");
      expect(b).toMatch(/t\.business_date between p_(from|business_date) - 1 and p_(to|business_date) \+ 1/);
    }
    expect(sql).toContain("coalesce(n.employee_first_name, substring(");
    expect(sql).not.toMatch(/u\.(email|phone|first_name)|employee_last_name|customer/);
    // The active index prevents the fallback join multiplying facts (or their money).
    expect(read("supabase/migrations/0233_whos_here.sql"))
      .toContain("create unique index toast_employee_links_one_active_employee on public.toast_employee_links(location_id,employee_guid) where active;");
  });

  it("labels only unresolved explicitly online groups, never unknown or mixed in-store groups", () => {
    expect(body(raw, functions[0]!)).toContain("is null and bool_and(f.channel in ('online', 'app', 'third_party', 'delivery'))");
    expect(body(raw, functions[1]!)).toContain("is null and f.channel in ('online', 'app', 'third_party', 'delivery')");
    expect(body(raw, functions[2]!)).toContain("is null and f.channel in ('online', 'app', 'third_party', 'delivery')");
    expect(sql).not.toContain("server:online");
    expect(sql).not.toContain("channel <> 'in_store'");
  });

  it("uses most recent item date with max-name ties and raises only the page capacity", () => {
    expect(sql).toContain("(array_agg(s->>'name' order by f.business_date desc, s->>'name' desc nulls last))[1]");
    expect(body(raw, functions[1]!)).toContain("p_limit < 1 or p_limit > 1000");
  });

  it("embeds the exact migration in a rollback-only repeatable-read full-pagination equivalence harness", () => {
    const migrationBody = raw.split("begin;\n")[1]!.split("commit;")[0]!.trim();
    const embedded = harness.split("-- BEGIN EXACT 0248 TRANSACTION BODY (no transaction control)\n")[1]!
      .split("-- END EXACT 0248 TRANSACTION BODY")[0]!.trim();
    expect(embedded).toBe(migrationBody);
    expect(harness).toContain("begin isolation level repeatable read;");
    expect(harness).toContain("<> 2 then");
    expect(harness).toContain("'last31', current_date - 31, current_date - 1");
    expect(harness).toContain("exit when jsonb_array_length(rows) < page_size;");
    expect(harness).toContain("prior.result->dim is distinct from actual->dim");
    expect(harness).toContain("raise exception 'PASS:");
    expect(harness).not.toContain("\ncommit;");
  });
});
