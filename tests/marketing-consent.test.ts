import { describe, expect, it, vi } from "vitest";
import { loadConsentAggregate } from "@/lib/customers/customers";

type Row = Record<string, string>;
function database(imports: Row[] = [
  { status: "completed", export_date: "2026-10-20" },
  { status: "completed", export_date: "2026-10-25" },
  { status: "failed", export_date: "2026-10-29" },
  { status: "running", export_date: "2026-10-30" },
]) {
  const reads: { table: string; columns: string; head: boolean }[] = [];
  const tables: Record<string, Row[]> = {
    customer_consent_current: [
      { channel: "email", status: "opted_in" },
      { channel: "email", status: "opted_in" },
      { channel: "sms", status: "opted_in" },
      { channel: "email", status: "opted_out" },
    ],
    customer_consent_imports: imports,
  };
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])], columns = "", head = false;
    const query = {
      select: (value: string, options?: { head?: boolean }) => {
        columns = value; head = options?.head ?? false;
        reads.push({ table, columns, head }); return query;
      },
      eq: (key: string, value: string) => { rows = rows.filter((row) => row[key] === value); return query; },
      order: (key: string, options: { ascending: boolean }) => {
        rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1));
        return query;
      },
      limit: (count: number) => { rows = rows.slice(0, count); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: head ? null : rows.map((row) => Object.fromEntries(columns.split(",").map((key) => [key, row[key]]))),
        count: rows.length, error: null,
      }).then(resolve),
    };
    return query;
  });
  return { from, rpc: vi.fn(), reads };
}

describe("marketing consent aggregate", () => {
  it.each([8, 9, 10])("gives level %i the same counts and latest completed import without contact reads", async (level) => {
    const db = database();
    await expect(loadConsentAggregate({ level }, { client: db as never, env: { CUSTOMER_PROFILES: "1" } }))
      .resolves.toEqual({ optedIn: 2, lastImportDate: "2026-10-25" });
    expect(db.reads).toEqual([
      { table: "customer_consent_current", columns: "customer_id", head: true },
      { table: "customer_consent_imports", columns: "export_date", head: false },
    ]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("has no latest import when all imports are incomplete", async () => {
    const db = database([{ status: "failed", export_date: "2026-10-29" }, { status: "running", export_date: "2026-10-30" }]);
    await expect(loadConsentAggregate({ level: 8 }, { client: db as never, env: { CUSTOMER_PROFILES: "1" } }))
      .resolves.toEqual({ optedIn: 2, lastImportDate: null });
  });

  it("checks the feature gate and role floor before any I/O", async () => {
    const db = database();
    await expect(loadConsentAggregate({ level: 10 }, { client: db as never, env: {} }))
      .rejects.toMatchObject({ status: 404, code: "not_enabled" });
    await expect(loadConsentAggregate({ level: 7 }, { client: db as never, env: { CUSTOMER_PROFILES: "1" } }))
      .rejects.toMatchObject({ status: 403, code: "role_insufficient" });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
