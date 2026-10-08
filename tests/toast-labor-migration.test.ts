import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0224_toast_time_entries.sql", "utf8");
const lines = sql.split(/\r?\n/);
const code = lines.filter((l) => !l.trim().startsWith("--")).join("\n");

describe("0224 toast_time_entries (authored only)", () => {
  it("is gated: authored, not applied", () => {
    expect(sql).toMatch(/NOT YET APPLIED -- GATE CC\/JUAN/);
  });
  it("is deny-all: RLS on, every user operation denied, no user grants, the service role never deletes", () => {
    expect(code).toContain("alter table public.toast_time_entries enable row level security");
    for (const op of ["select", "insert", "update", "delete"]) expect(code).toContain(`toast_time_entries_no_user_${op}`);
    expect(code).toContain("revoke all on public.toast_time_entries from public, anon, authenticated, service_role");
    expect(code).toContain("grant select, insert, update on public.toast_time_entries to service_role");
    for (const g of lines.filter((l) => /^\s*grant\b/i.test(l))) expect(g).not.toMatch(/delete|truncate/i);
  });
  it("stores no wages, tips, sales or contact fields, and never touches the digest switch or recipients", () => {
    const start = code.indexOf("create table");
    const table = code.slice(start, code.indexOf(");", start));
    expect(table).not.toMatch(/wage|tip|sales|last_name|email|phone/i);
    expect(code).not.toMatch(/report_settings|report_recipients|digest_delivery_mode/);
  });
});
