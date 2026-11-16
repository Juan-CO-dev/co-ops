/**
 * W21/B116 migration 0328 — station_business_date keeps 0217's rule plus ONE addition: an open
 * closing holds its day only until 01:00 ET the morning after its date (owner decision W21-1 b).
 * Same signature, same grants; the offline PGlite harness passes with its deliberately broken variant.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const m0328 = read("0328_station_business_date_cutoff.sql");
const m0217 = read("0217_assignments_stations.sql");

function fn(source: string, marker: string, end: string): string {
  const start = source.indexOf(marker);
  expect(start, `marker ${marker}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(end, start) + end.length);
}
const lines = (body: string) => body.split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter(Boolean);

describe("0328 station business-day cutoff", () => {
  it("station_business_date_at is 0217's rule at p_at plus the 01:00 ET cutoff line, nothing else", () => {
    const prior = lines(fn(m0217, "create or replace function public.station_business_date(", "\n$$;"))
      .slice(2).map((l) => l.replaceAll("now()", "p_at"));
    const next = lines(fn(m0328, "create function public.station_business_date_at(", "\n$$;")).slice(2);
    const added = next.filter((l) => !prior.includes(l));
    expect(added).toEqual(["and (p_at at time zone 'America/New_York') < (i.date + 1)::timestamp + interval '1 hour'"]);
    expect(prior.every((l) => next.includes(l))).toBe(true);
  });

  it("keeps station_business_date(uuid)'s signature and delegates at now()", () => {
    const wrapper = fn(m0328, "create or replace function public.station_business_date(", "\n$$;");
    expect(wrapper).toContain("create or replace function public.station_business_date(p_location_id uuid)\nreturns date language sql stable security definer set search_path=pg_catalog,public as $$");
    expect(wrapper).toContain("select public.station_business_date_at(p_location_id, now())");
  });

  it("refuses drift and a second apply, re-asserts service-role-only grants, writes one audit row", () => {
    expect(m0328).toContain("-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.");
    expect(m0328).toContain("raise exception '0328: station_business_date drifted from 0217'");
    expect(m0328).toContain("raise exception '0328: station_business_date_at already exists'");
    expect(m0328).toContain("revoke all on function public.station_business_date_at(uuid,timestamptz) from public, anon, authenticated;");
    expect(m0328).toContain("revoke all on function public.station_business_date(uuid) from public, anon, authenticated;");
    expect(m0328).toContain("grant execute on function public.station_business_date_at(uuid,timestamptz) to service_role;");
    expect(m0328).toContain("grant execute on function public.station_business_date(uuid) to service_role;");
    expect(m0328).toContain("'migration', '0328_station_business_date_cutoff'");
    expect(m0328.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("runs actual SQL: 0217 reproduces B116, 0328 flips at 01:00 ET across EDT, EST and both DST changes", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0328.mjs"], { encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("EXPECTED FAIL 0328 broken variant:");
    expect(output).toContain("PASS 0328:");
  }, 130_000);
});
