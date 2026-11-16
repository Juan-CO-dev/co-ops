/**
 * Migration 0327 (audit W20: B197 atomic delivery write, B114 locked verdict, the manager unlink,
 * and the one automatic link writer that reads the unlink record under the lock, review W20-r4).
 * FILE ONLY: never applied from here. The executable proof is scripts/sql-harness-0327.mjs (PGlite,
 * the real receiving DDL); this file runs it and pins the file's contract.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0327_receiving_atomic_writers.sql", "utf8").replace(/\r\n/g, "\n");
const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

describe("0327 receiving atomic writers", () => {
  it("carries the house header and is authored, not applied", () => {
    expect(sql.startsWith("-- Migration 0327_receiving_atomic_writers\n")).toBe(true);
    expect(sql).toContain("NOT YET APPLIED");
    expect(sql).not.toMatch(/APPLIED TO PROD/);
    for (const part of ["B197", "B114", "W20-2", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY", "-- ROLLBACK", "-- EXISTING ROWS", "-- APP COMPATIBILITY", "-- LOCK ORDER", "-- DEPENDS ON"]) {
      expect(sql).toContain(part);
    }
    expect(statements.trimStart().startsWith("begin;")).toBe(true);
    expect(statements.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("is idempotent by construction and touches no existing row", () => {
    expect(statements).toContain("create table if not exists public.delivery_receipt_unlinks");
    expect(statements.match(/create or replace function public\./g)).toHaveLength(4);
    expect(statements).not.toMatch(/\bcreate function\b/i);
    expect(statements.match(/drop policy if exists/g)).toHaveLength(4);
    // No statement outside a function body or a guard block deletes, truncates or rewrites data.
    const outsideFunctions = statements.replace(/(as|do) \$\$[\s\S]*?end \$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/\b(delete\s+from|truncate|update\s+public\.|insert\s+into)\b/i);
    expect(outsideFunctions).not.toMatch(/\bdrop\s+(table|column|function|index)\b/i);
  });

  it("never deletes: the unlink clears a link and appends a record", () => {
    expect(statements).not.toMatch(/\bdelete\s+from\b/i);
    expect(statements).not.toMatch(/\bfor all\b/i);
    for (const op of ["select", "insert", "update", "delete"]) expect(statements).toContain(`delivery_receipt_unlinks_no_user_${op}`);
  });

  it("locks the delivery FOR NO KEY UPDATE, and the receipt only after it", () => {
    const fn = (name: string) => { const at = statements.indexOf(`create or replace function public.${name}(`); return statements.slice(at, statements.indexOf("end $$;", at)); };
    for (const name of ["delivery_match_verdict", "delivery_receipt_unlink", "delivery_receipt_auto_link"]) {
      expect(fn(name)).toContain("select * into d from public.vendor_deliveries where id = p_delivery for no key update;");
      expect(fn(name)).not.toMatch(/for update;/);
    }
    const unlink = fn("delivery_receipt_unlink");
    expect(unlink.indexOf("from public.vendor_deliveries where id = p_delivery for no key update")).toBeLessThan(unlink.indexOf("from public.email_receipts r where r.id = d.email_receipt_id for no key update"));
    // The verdict's terminal check is read from the LOCKED row.
    const verdict = fn("delivery_match_verdict");
    expect(verdict.indexOf("for no key update")).toBeLessThan(verdict.indexOf("if d.match_state = 'override' then raise exception 'already_overridden'"));
  });

  it("review W20-r1: a verdict names its receipt, compared under the lock (attest and override)", () => {
    const at = statements.indexOf("create or replace function public.delivery_match_verdict(");
    const verdict = statements.slice(at, statements.indexOf("end $$;", at));
    expect(verdict).toContain("delivery_match_verdict(p_delivery uuid, p_kind text, p_verdict text, p_note text, p_receipt uuid)");
    const lock = verdict.indexOf("for no key update");
    const attest = verdict.indexOf("if d.email_receipt_id <> p_receipt then raise exception 'receipt_changed'");
    const override = verdict.indexOf("if d.email_receipt_id is distinct from p_receipt then raise exception 'receipt_changed'");
    expect(attest).toBeGreaterThan(lock);
    expect(override).toBeGreaterThan(lock);
    // Both checks come before their own UPDATE.
    const updates = [...verdict.matchAll(/update public\.vendor_deliveries/g)].map((m) => m.index!);
    expect(updates).toHaveLength(2);
    expect(attest).toBeLessThan(updates[0]!);
    expect(override).toBeGreaterThan(updates[0]!);
    expect(override).toBeLessThan(updates[1]!);
    // Review W20-r2: a null receipt is refused for BOTH kinds, before the lock, and is never compared.
    const required = verdict.indexOf("if p_receipt is null then raise exception 'receipt_required'; end if;");
    expect(required).toBeGreaterThan(-1);
    expect(required).toBeLessThan(lock);
    expect(verdict).not.toContain("p_kind = 'attest' and p_receipt is null");
    expect(verdict).not.toMatch(/p_receipt is not null and/);
    expect(sql).toContain("invalid_verdict, note_required, already_overridden, receipt_changed, receipt_required, forbidden.");
    // The four-argument form is refused at apply and exists nowhere in the file as a function.
    expect(statements).toContain("to_regprocedure('public.delivery_match_verdict(uuid,text,text,text)') is not null");
    expect(statements).not.toContain("delivery_match_verdict(p_delivery uuid, p_kind text, p_verdict text, p_note text)");
  });

  it("review W20-r1 (P3): the atomic writer stamps the creation lines with the header's instant", () => {
    const at = statements.indexOf("create or replace function public.record_delivery_atomic(");
    const record = statements.slice(at, statements.indexOf("end $$;", at));
    expect(record).toContain("returning id, created_at into v_id, v_created;");
    expect(record).toContain("v_created := coalesce(v_created, now());");
    expect(record).toMatch(/expected_qty, discrepancy_type, created_at\)\s+select v_id,[\s\S]*?l\.discrepancy_type, v_created/);
    // The line's own instant is never taken from the payload.
    expect(record).not.toMatch(/l\.created_at/);
    for (const column of ["('vendor_deliveries','created_at')", "('vendor_delivery_items','created_at')"]) expect(statements).toContain(column);
  });

  it("review W20-r4: the automatic link reads the unlink record under the locks, in the transaction that writes", () => {
    const at = statements.indexOf("create or replace function public.delivery_receipt_auto_link(");
    expect(at).toBeGreaterThan(-1);
    const auto = statements.slice(at, statements.indexOf("end $$;", at));
    expect(auto).toContain("p_delivery uuid, p_receipt uuid, p_location uuid, p_vendor uuid, p_delivery_date date, p_parse_state text, p_received_at timestamptz)");
    // The unlink's lock order: the delivery, then the receipt. Then the history, then the snapshot, then both writes.
    const order = [
      "select * into d from public.vendor_deliveries where id = p_delivery for no key update;",
      "select * into r from public.email_receipts where id = p_receipt for no key update;",
      "if exists (select 1 from public.delivery_receipt_unlinks u where u.delivery_id = d.id and u.receipt_id = r.id) then",
      "return jsonb_build_object('linked', false, 'reason', 'pair_unlinked');",
      "if d.email_receipt_id is not null",
      "if r.linked_delivery_id is not null",
      "or r.doc_kind is distinct from 'invoice'",
      "update public.email_receipts set linked_delivery_id = d.id where id = r.id;",
      "update public.vendor_deliveries set email_receipt_id = r.id where id = d.id;",
      "return jsonb_build_object('linked', true, 'location_id', d.location_id);",
    ].map((text) => { const i = auto.indexOf(text); expect(i, text).toBeGreaterThan(-1); return i; });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Exactly two writes (the two sides), nothing else: no history row, no match state, no delete.
    expect(auto.match(/\bupdate public\./g)).toHaveLength(2);
    expect(auto).not.toMatch(/\binsert into\b|\bdelete from\b|match_state/);
    // The same two locks, in the same order, as the manager unlink.
    const unlinkAt = statements.indexOf("create or replace function public.delivery_receipt_unlink(");
    const unlink = statements.slice(unlinkAt, statements.indexOf("end $$;", unlinkAt));
    expect(unlink.indexOf("from public.vendor_deliveries where id = p_delivery for no key update")).toBeLessThan(unlink.indexOf("from public.email_receipts r where r.id = d.email_receipt_id for no key update"));
    // The receipt columns it reads are in the pre-flight, and the header says what happens before the file is applied.
    for (const column of ["('email_receipts','doc_kind')", "('email_receipts','attribution_conflict')", "('email_receipts','vendor_guess_id')", "('email_receipts','parse_state')", "('email_receipts','received_at')"]) {
      expect(statements).toContain(column);
    }
    expect(sql).toContain("THE AUTOMATIC LINK LINKS NOTHING");
    expect(sql).toContain("pair_unlinked, delivery_changed, receipt_changed.");
    expect(sql).toContain("--   drop function public.delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz);");
  });

  it("grants execute to service_role only and asserts the ceilings itself", () => {
    for (const signature of ["record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)", "delivery_match_verdict(uuid,text,text,text,uuid)", "delivery_receipt_unlink(uuid,uuid,text,uuid)",
      "delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz)"]) {
      expect(statements).toContain(`revoke all on function public.${signature} from public, anon, authenticated, service_role;`);
      expect(statements).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(statements).toContain("revoke all on public.delivery_receipt_unlinks from public, anon, authenticated, service_role;");
    expect(statements).toContain("grant select on public.delivery_receipt_unlinks to service_role;");
    expect(statements.match(/\bgrant\b/gi)).toHaveLength(5);
    for (const guard of ["'0327: receiving RPC escape'", "'0327: delivery_receipt_unlinks privilege escape'", "'0327: delivery_receipt_unlinks must have RLS on'"]) expect(statements).toContain(guard);
    expect(statements.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(4);
  });

  it("real DDL: atomic write, locked verdict, unlink, guards and ceilings", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0327.mjs"], { encoding: "utf8", timeout: 400_000 });
    for (const pin of [
      "a schema missing a column the writer names is refused by name, nothing created",
      "where vendor mail is installed, 0327 waits for 0326; with 0326 it applies",
      "applies, and re-applying is a no-op (idempotent)",
      "each lined credit points at the line its line_index named",
      "the creation lines carry the header's own created_at (the identity the append guard reads)",
      "with a drifting line default the lines STILL carry the header's instant (stamped by the writer, not inferred)",
      "a line appended later does not carry the header's instant",
      "a bad discrepancy flag on line 2 is refused",
      "...and leaves no delivery, no line and no credit behind",
      '...so the corrected retry of the SAME invoice saves (it used to be "already received")',
      "the same invoice in another case is refused by the 0169 index",
      "two credits for one (line, reason) are refused by the 0168 index",
      "an attestation after an override is refused already_overridden",
      "...and the manager's decision and note are untouched",
      "two discrepancy notes are both kept, trimmed, in order",
      "a different receipt than the one the person saw is receipt_changed",
      "unlink, a replacement, then the stale attestation: refused receipt_changed",
      "...and the replacement receipt is NOT marked on the first one's comparison: state and note untouched",
      "an override decided on the first receipt is refused receipt_changed too",
      "an attestation that names no receipt is receipt_required",
      "an override that names no receipt is receipt_required, even with one linked",
      'with no receipt linked: an override that names none is receipt_required (null is never "none linked")',
      "with no receipt linked: an override that names one (it was unlinked) is receipt_changed",
      "after the replacement, an attestation that names no receipt is receipt_required: the replacement is not marked",
      "after the replacement, an override that names no receipt is receipt_required too",
      "an override that names a receipt other than the one linked is receipt_changed",
      "a delivery with no receipt is not overridden by a caller that names none: receipt_required, nothing written",
      "the four-argument form does not exist: no caller can skip naming the receipt",
      "a four-argument draft of the verdict writer (one that cannot name its receipt) is refused, never left beside the real one",
      "the delivery has no receipt and its match is back to counted_only (an override is cleared too)",
      "the unlink is recorded: pair, shop, prior state, reason, who",
      "a receipt table without the columns the automatic link reads (0175 doc_kind, 0294 attribution_conflict) is refused by name",
      "automatic link: BOTH sides are written, in the one call",
      "automatic link: a delivery that already has a receipt is never given another (nothing is replaced)",
      "a manager unlinks it: both link columns are NULL again, exactly as worker B read them, and the pair is on record",
      "A links, a manager unlinks, B resumes with the pair it chose earlier: B is refused pair_unlinked",
      "...and the unlinked pair is NOT put back: both sides still empty, the record unchanged",
      "the unlink record is read first: an unlinked pair is pair_unlinked whatever else moved",
      "the unlinked receipt still links to a DIFFERENT delivery it was never unlinked from",
      "a PERSON can still link the pair they unlinked (the rule binds automation only)",
      "automatic link: a receipt of kind statement is refused (only an invoice links by itself, B112, inside the writer)",
      "...and the receipt side is rolled back with it: no half link, nothing to compensate",
      "the four functions: SECURITY DEFINER, pinned search_path, service_role execute only, no PUBLIC",
      "service_role cannot delete unlink history",
      "RLS is on with the four deny policies, split per operation (never FOR ALL)",
      "a variant that widens a grant fails its own assertion, rolls back, and keeps the history",
      "PASS 0327:",
    ]) expect(output).toContain(pin);
  }, 420_000);
});
