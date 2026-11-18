// Item 2 PR 2b: the backfill report and the parity probe are read-only scripts; with no env they read nothing.
import { afterEach, expect, it, vi } from "vitest";
import { main as backfill, parseArgs } from "../scripts/fact-backfill-report";
import { main as probe, windows } from "../scripts/fact-parity-probe";
import { main as payrollCheck, parseArgs as payrollArgs, compareSalaried } from "../scripts/check-labor-payroll-allocation";

afterEach(() => vi.unstubAllEnvs());

it("backfill args: a floor is required, --expect is a count, anything else refuses", () => {
  expect(parseArgs(["--floor=2025-10-01", "--expect=12"])).toEqual({ floor: "2025-10-01", expect: 12 });
  expect(parseArgs(["--floor=2025-10-01"])).toEqual({ floor: "2025-10-01", expect: null });
  expect(parseArgs([])).toBeNull();
  expect(parseArgs(["--floor=2025-10-01", "--apply"])).toBeNull();
});
it("probe windows are at most 31 days and tile the range exactly", () => {
  expect(windows("2026-01-01", "2026-03-05")).toEqual([["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-03-03"], ["2026-03-04", "2026-03-05"]]);
  expect(windows("2026-11-01", "2026-11-01")).toEqual([["2026-11-01", "2026-11-01"]]);
});
it("payroll check: only --allow-gaps is accepted; the comparison names both sides of a difference", () => {
  expect(payrollArgs([])).toEqual({ allowGaps: false });
  expect(payrollArgs(["--allow-gaps"])).toEqual({ allowGaps: true });
  expect(payrollArgs(["--apply"])).toBeNull();
  const row = { location_id: "a", salaried_cents: 100, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 };
  expect(compareSalaried([{ ...row, salaried_cents: "100" }], [row])).toEqual([]);
  expect(compareSalaried([row], [{ ...row, salaried_cents: null, unplaced_people: 1 }])).toEqual([
    "stored a cents=100 people=1 unplaced=0 missing=0", "fresh  a cents=null people=1 unplaced=1 missing=0"]);
});
it.each([["backfill", () => backfill(["--floor=2025-10-01"])], ["probe", () => probe(["--from=2026-10-01", "--to=2026-10-31"])],
  ["payroll check", () => payrollCheck([])]])(
  "%s without env exits 2 before any client exists", async (_n, run) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toBe(2);
    err.mockRestore();
  });
