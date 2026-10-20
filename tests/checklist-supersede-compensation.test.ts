import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("R7 moves completion claim/insert/link into one SQL transaction; no app compensation remains", () => {
  const source = readFileSync("lib/checklists.ts", "utf8");
  const body = source.slice(source.indexOf("export async function completeItem("), source.indexOf("export async function submitBatch("));
  expect(body).toContain('rpc("checklist_write_completion"');
  expect(body).not.toMatch(/\.(?:insert|update|delete)\(/);
  const sql = readFileSync("supabase/migrations/0276_checklist_guarded_writers.sql", "utf8");
  const writer = sql.slice(sql.indexOf("create function public.checklist_write_completion("), sql.indexOf("create function public.checklist_submit_batch("));
  expect(writer.indexOf("for update;")).toBeLessThan(writer.indexOf("set superseded_at = v_at"));
  expect(writer.indexOf("set superseded_at = v_at")).toBeLessThan(writer.indexOf("insert into public.checklist_completions"));
  expect(writer).toContain("set superseded_by = v_new.id");
  expect(writer).not.toMatch(/exception\s+when/i);
  // Executable FK rollback + linking proof is in sql-harness-0276.mjs.
});

it("keeps the unrelated cash compensation and closed audit vocabulary", () => {
  expect(readFileSync("lib/cash.ts", "utf8")).toMatch(/\.update\(\{ superseded_at: null \}, \{ count: "exact" \}\)/);
  expect(readFileSync("lib/cash.ts", "utf8")).toMatch(/\.eq\("superseded_at", nowIso\)/);
  expect(readFileSync("lib/audit-actions.ts", "utf8")).not.toMatch(/supersede_reverted/);
});
