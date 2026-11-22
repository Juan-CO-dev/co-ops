// Nav PR 8: a fake service client for the not-rung readers (lib/catering/not-in-toast.ts, lib/catering/catering-toast.ts),
// shared by tests/catering-toast-house-state.test.ts and the reader-to-render test in tests/dashboard-catering-block.test.ts.
// A table is rows, or an error object the read returns. Every `from` is recorded, with the signal it carried.
type Row = Record<string, unknown>;
export type NotInToastTables = Record<string, Row[] | { code: string; message: string }>;

export const ezRow = (over: Row = {}): Row => ({ order_id: "ez1", lead_id: "ezlead", location_id: "shop", event_date: "2026-11-20", order_number: "ABC123",
  handoff_time: null, event_timestamp: null, headcount: 10, total_cents: 1000, status: "not_rung_in_toast", ...over });
export const houseRow = (over: Row = {}): Row => ({ lead_id: "h1", location_id: "shop", event_date: "2026-11-20", lead_source: "portal",
  ring_code: "CO-4KM7R", headcount: 20, value_cents: 50000, toast_origin: false, status: "not_rung_in_toast", ...over });
export const toastSettings = (over: Row = {}): Row => ({ location_id: "shop", enabled: true, include_toast_origin_leads: false, ...over });

export function notInToastClient(tables: NotInToastTables) {
  const reads: Array<{ table: string; signal: AbortSignal | null }> = [];
  const client = {
    from(table: string) {
      const read = { table, signal: null as AbortSignal | null };
      reads.push(read);
      const filters: Array<(row: Row) => boolean> = [];
      let columns = "";
      const q = {
        select(s: string) { columns = s; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        gte(k: string, v: string) { filters.push((r) => String(r[k]) >= v); return q; },
        lte(k: string, v: string) { filters.push((r) => String(r[k]) <= v); return q; },
        order() { return q; },
        abortSignal(s: AbortSignal) { read.signal = s; return q; },
        range(from: number, to: number) {
          const source = tables[table] ?? [];
          if (!Array.isArray(source)) return Promise.resolve({ data: null, error: source });
          const data = source.filter((r) => filters.every((f) => f(r))).slice(from, to + 1)
            .map((r) => Object.fromEntries(columns.split(",").map((k) => [k.trim(), r[k.trim()]])));
          return Promise.resolve({ data, error: null });
        },
      };
      return q;
    },
  };
  return { client: client as never, reads };
}
