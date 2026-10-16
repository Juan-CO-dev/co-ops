/**
 * Chunk D review (Astra P2, 2026-10-15): a compare loads ONCE over the union of its windows, so the PM
 * report ids of BOTH windows reach one `.in("pm_report_id", …)`. With 120 + 120 daily reports that
 * request line is ~9.6 KB, over the 8,192-byte budget of the proxy in front of PostgREST
 * (REQUEST_LINE_BUDGET_BYTES) — the read is refused before any SQL runs. The id filters are chunked.
 *
 * The transport here is the REAL Supabase client with a fetch that refuses any request line over the
 * budget, so the golden's fake database (which cannot see URLs) is not the only witness.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadPeopleFacts } from "@/lib/people/facts";
import { LEGACY_PERSON_FAMILIES, LEGACY_TEAM_FAMILIES } from "@/lib/people/facts-shared";
import { reportTimestampBounds } from "@/lib/report-range";
import { REQUEST_LINE_BUDGET_BYTES } from "@/lib/supabase-paginate";

const SHOP = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const REPORTS = 240; // two 120-day windows of daily finalized reports

const reportId = (n: number) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000).toISOString().slice(0, 10);

function client(lines: number[]) {
  return createClient("http://localhost", "test-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        const line = `GET ${url.pathname}${url.search} HTTP/1.1`;
        lines.push(line.length);
        if (line.length > REQUEST_LINE_BUDGET_BYTES) return new Response("URI Too Long", { status: 414 });
        let rows: unknown[] = [];
        if (url.pathname.endsWith("/pm_reports") && url.searchParams.get("offset") !== "1000") {
          rows = Array.from({ length: REPORTS }, (_, n) => ({
            id: reportId(n), report_date: day(n), submitted_by: EMP, submitted_at: `${day(n)}T22:00:00.000Z`,
          }));
        }
        return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
}

const window = { bounds: reportTimestampBounds(day(0), day(REPORTS - 1)), dates: { from: day(0), to: day(REPORTS - 1) } };

describe("the union load stays under the request-line budget (Astra chunk D P2)", () => {
  it(`a PERSON compare over ${REPORTS} report ids: every request line fits ${REQUEST_LINE_BUDGET_BYTES} bytes`, async () => {
    const lines: number[] = [];
    const facts = await loadPeopleFacts(client(lines), {
      locationId: SHOP, subject: { kind: "person", personId: EMP }, window, families: LEGACY_PERSON_FAMILIES,
    });
    expect(facts.pmReports).toHaveLength(REPORTS);
    expect(facts.pmGradedReports).toHaveLength(REPORTS);
    expect(Math.max(...lines)).toBeLessThanOrEqual(REQUEST_LINE_BUDGET_BYTES);
  });

  it(`a TEAM compare over ${REPORTS} report ids (the PM notes read): every request line fits`, async () => {
    const lines: number[] = [];
    const facts = await loadPeopleFacts(client(lines), {
      locationId: SHOP, subject: { kind: "team", memberIds: [EMP] }, window, families: LEGACY_TEAM_FAMILIES,
    });
    expect(facts.pmReports).toHaveLength(REPORTS);
    expect(Math.max(...lines)).toBeLessThanOrEqual(REQUEST_LINE_BUDGET_BYTES);
  });
});
