/** Pure restore planning from CC's schema receipt. No database or filesystem I/O. */
import { canonical, ordered, sortedRows, type Inventory, type Row, type Snapshot } from "./fixtures";

export type ForeignKey = { child: string; parent: string; name: string; columns: string[] };
export type SchemaMeta = {
  tables: string[]; primary_keys: Record<string, string[]>; foreign_keys: ForeignKey[];
  columns_nullable: Record<string, boolean>;
  /** "<table>.<column>" for GENERATED ALWAYS / identity columns — never inserted, only read back (prod probe, CC 2026-09-09). */
  columns_generated?: string[];
};
const approvedStages = [
  { child: "catering_companies", parent: "catering_customers", column: "claimed_by_customer_id" },
  { child: "email_receipts", parent: "vendor_deliveries", column: "linked_delivery_id" },
  { child: "checklist_template_items", parent: "maintenance_equipment", column: "equipment_id" },
] as const;
export function deriveOrders(schema: SchemaMeta, inventory: Inventory) {
  const tables = Object.values(inventory).flat();
  const identifier = /^[a-z][a-z0-9_]*$/;
  if (new Set(tables).size !== tables.length || new Set(schema.tables).size !== schema.tables.length ||
      canonical([...tables].sort()) !== canonical([...schema.tables].sort())) throw new Error("Schema/inventory table set disagreement");
  for (const table of schema.tables) {
    if (!identifier.test(table)) throw new Error("Invalid schema table");
    sortedRows([], schema.primary_keys[table] ?? []);
  }
  for (const fk of schema.foreign_keys) {
    if (!tables.includes(fk.child) || !tables.includes(fk.parent) || !identifier.test(fk.name) ||
        !fk.columns.length || fk.columns.some(c => !identifier.test(c) || typeof schema.columns_nullable?.[`${fk.child}.${c}`] !== "boolean")) {
      throw new Error("Invalid or incomplete FK metadata");
    }
  }
  const stages = approvedStages.filter(stage => {
    const edges = schema.foreign_keys.filter(fk => fk.child === stage.child && fk.parent === stage.parent);
    if (!edges.length) return false;
    if (edges.length !== 1 || canonical(edges[0]!.columns) !== canonical([stage.column]) ||
        !schema.foreign_keys.some(fk => fk.child === stage.parent && fk.parent === stage.child)) throw new Error("Reviewed cycle edge changed");
    if (schema.columns_nullable[`${stage.child}.${stage.column}`] !== true) throw new Error(`Cannot stage NOT NULL ${stage.child}.${stage.column}`);
    return true;
  });
  const edges = schema.foreign_keys.filter(fk => !stages.some(s => s.child === fk.child && s.parent === fk.parent));
  return {
    deleteOrder: ordered(schema.tables, edges).reverse(),
    loadOrder: ordered(inventory.CONFIG, edges),
    deleteStages: stages,
    loadStages: stages.filter(s => inventory.CONFIG.includes(s.child) && inventory.CONFIG.includes(s.parent)),
  };
}

/** A pointer may resolve only to an earlier row, never to an assumed existing DB row. */
export function leafFirst(table: string, rows: Row[], pk: string[], selfFks: ForeignKey[]): Row[] {
  if (selfFks.some(fk => fk.child !== table || fk.parent !== table || fk.columns.length !== 1) ||
      (selfFks.length && (pk.length !== 1 || pk[0] !== "id"))) throw new Error(`Unsupported self-FK shape: ${table}`);
  let pending = sortedRows(rows, pk);
  const inserted = new Set<string>(), result: Row[] = [];
  while (pending.length) {
    const ready = pending.filter(row => selfFks.every(fk => {
      const value = row[fk.columns[0]!];
      return value === null || (value !== undefined && inserted.has(canonical(value)));
    }));
    if (!ready.length) throw new Error(`Unresolved self-FK ${table} PK=${canonical(pk.map(key => pending[0]![key]))}`);
    const batch = new Set(ready);
    for (const row of ready) { result.push(row); inserted.add(canonical(row[pk[0]!])); }
    pending = pending.filter(row => !batch.has(row));
  }
  return result;
}

export function planConfig(schema: SchemaMeta, inventory: Inventory, snapshot: Snapshot) {
  const orders = deriveOrders(schema, inventory);
  const rows: Snapshot = {}, leafFirstCounts: Record<string, number> = {};
  for (const table of orders.loadOrder) {
    const selfFks = schema.foreign_keys.filter(fk => fk.child === table && fk.parent === table);
    rows[table] = leafFirst(table, snapshot[table] ?? [], schema.primary_keys[table]!, selfFks);
    if (selfFks.length) leafFirstCounts[table] = rows[table].length;
    for (const fk of schema.foreign_keys.filter(fk => fk.child === table && !inventory.CONFIG.includes(fk.parent))) {
      for (const row of rows[table]) if (fk.columns.every(column => row[column] !== null)) {
        throw new Error(`CONFIG references unseeded table: ${table}.${fk.columns.join(",")}`);
      }
    }
    for (const stage of orders.loadStages.filter(s => s.child === table)) {
      if (rows[table].some(row => row[stage.column] === undefined)) throw new Error(`Missing staged snapshot column: ${table}.${stage.column}`);
    }
  }
  return { ...orders, rows, leafFirstCounts };
}
