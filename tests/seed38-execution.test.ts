/** Offline exercise of the actual CLI runner. No fetch or database connection. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Row } from "../scripts/seed/38-manifest";

const mock = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, zeroUpdate: false, loseAudit: false, writes: 0 }));
vi.mock("../lib/audit", () => ({ audit: async (input: Row) => {
  if (mock.loseAudit) return;
  const { isDestructive } = await import("../lib/destructive-actions");
  mock.tables.audit_log!.push({ id: `audit-${mock.tables.audit_log!.length}`, action: input.action, destructive: isDestructive(String(input.action)), metadata: { ...input.metadata as Row, ip_address: null, user_agent: null } });
  mock.writes++;
} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  rpc: async (name: string, args: Row) => {
    if (name === "angel_wave7_snapshot") {
      const columns = Object.entries(mock.tables).flatMap(([table, rows]) => [...new Set(rows.flatMap(r => Object.keys(r)))].map(column_name => ({ table_name: table, column_name, data_type: "text", udt_name: "text" })));
      for (const column_name of ["actor_id", "actor_role", "action", "resource_table", "resource_id", "metadata", "destructive"]) columns.push({ table_name: "audit_log", column_name, data_type: "text", udt_name: "text" });
      for (const column_name of ["source", "source_note", "recorded_by"]) columns.push({ table_name: "vendor_price_history", column_name, data_type: "text", udt_name: "text" });
      columns.push({ table_name: "vendors", column_name: "notes", data_type: "text", udt_name: "text" });
      return { data: { capability: "angel-wave7-atomic-v1", columns }, error: null };
    }
    if (name !== "save_order_guide") throw new Error("Unexpected RPC");
    const guide = mock.tables.vendor_order_guides!.find(g => g.id === args.p_guide_id)!;
    if (guide.updated_at !== args.p_expected_updated_at) return { error: { code: "stale" } };
    for (const section of args.p_sections as { lines: Row[] }[]) for (const line of section.lines) {
      const target = mock.tables.order_guide_lines!.find(l => l.id === line.id)!;
      Object.assign(target, { sku_id: line.skuId, label: line.label, item_number: line.itemNumber, note: line.note, position: line.position });
    }
    guide.updated_at = "2026-09-20T12:00:00.000001Z";
    mock.writes++;
    return { data: {}, error: null };
  },
  from: (table: string) => {
    let mode = "select", payload: Row = {}, head = false, single = false, range: [number, number] | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: (_fields?: string, options?: { head?: boolean }) => { head = options?.head ?? false; return q; },
      order: () => q,
      range: (from: number, to: number) => { range = [from, to]; return q; },
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => { filters.push(r => (r[key] ?? null) === value); return q; },
      contains: (key: string, value: Row) => { filters.push(r => Object.entries(value).every(([k, v]) => (r[key] as Row)?.[k] === v)); return q; },
      single: () => { single = true; return q; },
      insert: (row: Row) => { mode = "insert"; payload = row; return q; },
      update: (row: Row) => { mode = "update"; payload = row; return q; },
      then: (resolve: (result: unknown) => unknown) => {
        let rows = mock.tables[table]!.filter(r => filters.every(f => f(r))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (mode === "insert") {
          if (mock.tables[table]!.some(r => r.id === payload.id)) return Promise.resolve(resolve({ error: { code: "23505" }, data: null, count: 0 }));
          mock.tables[table]!.push(structuredClone({ ...payload, ...(table === "vendor_price_history" ? { recorded_at: "2026-09-20T12:00:00.000000Z" } : {}) })); mock.writes++;
        } else if (mode === "update") {
          if (mock.zeroUpdate) return Promise.resolve(resolve({ error: null, data: [], count: 0 }));
          for (const r of rows) Object.assign(r, structuredClone(payload));
          mock.writes += rows.length;
        }
        const count = rows.length;
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return Promise.resolve(resolve({ error: null, count, data: head ? null : structuredClone(single ? rows[0] : rows) }));
      },
    };
    return q;
  },
}) }));
import { loadInputs, main, HOSTS, ACTION_ORDER } from "../scripts/seed/38-catalog-repair";
beforeEach(() => {
  mock.tables = Object.fromEntries(Object.entries(structuredClone(loadInputs().baseline)).filter(([, rows]) => Array.isArray(rows)));
  mock.tables.audit_log = [];
  mock.tables.measure_units!.forEach((r, i) => r.id = `measure-${i}`);
  mock.tables.vendor_items!.forEach(r => r.price_basis = null);
  mock.tables.vendors!.forEach(r => r.notes = null);
  mock.zeroUpdate = false; mock.loseAudit = false; mock.writes = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${HOSTS.sim}`);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "offline-fixture-only");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("dry-run makes zero writes; execute verifies nine audits; rerun makes zero additional writes", async () => {
  await main(["--target", "sim"]);
  expect(mock.writes).toBe(0);
  await main(["--target", "sim", "--execute"]);
  expect(mock.tables.audit_log!.map(r => r.action)).toEqual(ACTION_ORDER);
  const written = mock.writes;
  await main(["--target", "sim", "--execute"]);
  expect(mock.writes).toBe(written);
});
it("refuses a silent UPDATE 0 and stops before later classes", async () => {
  mock.zeroUpdate = true;
  await expect(main(["--execute", "--target", "sim"])).rejects.toThrow("rowcount != 1");
  expect(mock.tables.audit_log!.map(r => r.action)).toEqual(["vendor.create"]);
});
it("detects the fail-open audit loss and refuses an unaudited retry", async () => {
  mock.loseAudit = true;
  await expect(main(["--execute", "--target", "sim"])).rejects.toThrow("audit read-back failed");
  mock.loseAudit = false;
  await expect(main(["--execute", "--target", "sim"])).rejects.toThrow("missing provenance");
});
