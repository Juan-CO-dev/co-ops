// Item 2 fix round 1 (review r1 #4, BC-006): the stale-day list is read to completion or refused by
// name. PostgREST caps a response at its max-rows (1,000 by default) whatever p_limit says, so a count
// read in one request silently truncates; a partial count is never printed as complete.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAllStaleDays, STALE_LIST_CAP } from "@/lib/facts/parity-shared";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ day_location_id: i % 2 ? "loc-b" : "loc-a",
  day_business_date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-01`, day_fingerprint: "f".repeat(32) }));
/** A PostgREST stand-in for an RPC read with .range(): serves at most maxRows per response. */
function server(all: unknown[], maxRows = 1000) {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => { calls.push([from, to]); return { data: all.slice(from, Math.min(to + 1, from + maxRows)), error: null }; };
  return { page, calls };
}

describe("readAllStaleDays", () => {
  it("reads 1,200 stale days past the server's 1,000-row cap", async () => {
    const s = server(rows(1200));
    expect(await readAllStaleDays(s.page)).toHaveLength(1200);
  });
  it("is complete even when the server's max-rows is smaller than the page size (ends only on an empty page)", async () => {
    const s = server(rows(1200), 500);
    expect(await readAllStaleDays(s.page)).toHaveLength(1200);
  });
  it("refuses by name at the function's own cap: it cannot prove the list is complete", async () => {
    const s = server(rows(STALE_LIST_CAP));
    await expect(readAllStaleDays(s.page)).rejects.toThrow("fact_stale_list_capped");
  });
  it("a failed page refuses by name; it never returns the pages it had", async () => {
    let n = 0;
    const page = async (from: number, to: number) => (n++ === 1 ? { data: null, error: { message: "boom" } } : { data: rows(1200).slice(from, to + 1), error: null });
    await expect(readAllStaleDays(page)).rejects.toThrow("fact_stale_read_failed");
  });
});

const fake = vi.hoisted(() => ({ all: [] as unknown[], maxRows: 1000 }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (_name: string, args: { p_limit: number }) => ({
      range: async (from: number, to: number) => ({
        data: fake.all.slice(0, args.p_limit).slice(from, Math.min(to + 1, from + fake.maxRows)), error: null }),
    }),
  }),
}));
import { main as backfill } from "../scripts/fact-backfill-report";

describe("fact-backfill-report (1,200 stale days)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const env = () => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k"); };
  it("prints the whole count, and --expect=1000 is a mismatch", async () => {
    env(); fake.all = rows(1200);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await backfill(["--floor=2025-10-01", "--expect=1000"])).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ total: 1200, complete: true });
    expect(await backfill(["--floor=2025-10-01", "--expect=1200"])).toBe(0);
    log.mockRestore(); err.mockRestore();
  });
  it("at the cap it prints no count and exits 2, naming the refusal", async () => {
    env(); fake.all = rows(STALE_LIST_CAP + 10);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await backfill(["--floor=2025-10-01"])).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0]![0])).toContain("fact_stale_list_capped");
    log.mockRestore(); err.mockRestore();
  });
});
