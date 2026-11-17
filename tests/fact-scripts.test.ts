// Item 2 PR 2b: the backfill report and the parity probe are read-only scripts; with no env they read nothing.
import { afterEach, expect, it, vi } from "vitest";
import { main as backfill, parseArgs } from "../scripts/fact-backfill-report";
import { main as probe, windows } from "../scripts/fact-parity-probe";

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
it.each([["backfill", () => backfill(["--floor=2025-10-01"])], ["probe", () => probe(["--from=2026-10-01", "--to=2026-10-31"])]])(
  "%s without env exits 2 before any client exists", async (_n, run) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toBe(2);
    err.mockRestore();
  });
