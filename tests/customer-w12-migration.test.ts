/**
 * 0312 (audit wave W12): the offline PGlite proof, plus a line-subsequence pin of every re-emitted body
 * against its source (0234 / 0249 / 0300), so only the lines W12 meant to change can differ.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0312_customer_consent_retention_fixes.sql");

function body(text: string, name: string, replace: boolean): string[] {
  const m = text.match(new RegExp(`create ${replace ? "or replace " : ""}function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  if (!m) throw new Error(`no body for ${name}`);
  return m[0].split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
}
/** Source lines that are not an ordered subsequence of the re-emitted body. */
function changedLines(file: string, name: string): string[] {
  const src = body(read(file), name, false), dst = body(sql, name, true);
  const missing: string[] = [];
  let j = 0;
  for (const line of src) {
    const k = dst.indexOf(line, j);
    if (k < 0) missing.push(line); else j = k + 1;
  }
  return missing;
}

describe("0312 header and shape", () => {
  it("house header, one transaction, file only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0312_customer_consent_retention_fixes");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED/);
    expect(sql).toContain("W12");
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("the retention unblock is never silent: the pre-flight counts it and needs the exact acknowledgement", () => {
    expect(sql).toContain("select count(*) into v_retention from public.customer_suppressions where reason = 'retention'");
    expect(sql).toContain("current_setting('co_ops.w12_retention_unblock', true)");
  });
  it("no marketing read gains a parameter that could widen it", () => {
    expect(sql).toContain("create or replace function public.customer_marketing_export(p_channel text)");
    expect(sql).not.toMatch(/customer_marketing_export\([^)]*,/);
  });
});

describe("re-emitted bodies change only the W12 lines", () => {
  it.each([
    ["0234_customer_profiles.sql", "customer_resolve", [
      "if v_email is not null and exists(select 1 from public.customer_suppressions s where s.kind='email' and s.value_sha256=public.customer_sha256(v_email)) then",
      "if v_phone is not null and exists(select 1 from public.customer_suppressions s where s.kind='phone' and s.value_sha256=public.customer_sha256(v_phone)) then",
    ]],
    ["0234_customer_profiles.sql", "customer_erase", [
      "on conflict (kind, value_sha256) do nothing;",
    ]],
    ["0234_customer_profiles.sql", "customer_marketing_export", [
      "and not exists(select 1 from public.customer_suppressions s where s.kind = i.kind and s.value_sha256 = i.value_sha256)",
    ]],
    ["0300_meta_leads.sql", "customer_consent_record_explicit", [
      "if exists(select 1 from public.customer_suppressions where kind='email' and value_sha256=public.customer_sha256(v_email)) then raise exception 'consent_suppressed'; end if;",
    ]],
    ["0234_customer_profiles.sql", "customer_retention_sweep", [
      "declare v_id uuid; v_n int := 0;",
      "return jsonb_build_object('erased', v_n);",
    ]],
  ])("%s %s", (file, name, allowed) => {
    expect(changedLines(file, name)).toEqual(allowed);
  });
  it("the import chunk and finish keep every other 0234 line", () => {
    expect(changedLines("0234_customer_profiles.sql", "customer_consent_import_chunk")).toEqual([
      "v_row jsonb; v_res record; v_email text; v_status text; v_cur record; v_effective timestamptz;",
      "insert into public.customer_consent_import_members(import_id, customer_id, status) values (p_import_id, v_res.customer_id, v_status)",
      "on conflict (import_id, customer_id) do update set status = case when excluded.status = 'opted_out' then 'opted_out' else customer_consent_import_members.status end;",
      "if v_cur.status = v_status and (v_status = 'opted_out' or v_cur.subject_sha256 = public.customer_sha256(v_email)) then",
      "values (v_res.customer_id, 'email', v_status, v_imp.source, public.customer_sha256(v_email), v_effective, p_import_id, p_actor_id);",
    ]);
    expect(changedLines("0234_customer_profiles.sql", "customer_consent_import_finish")).toEqual([
      "v_effective timestamptz; v_absent int := 0; v_absent_stale int := 0; v_prev int := 0; v_sum record;",
      "'suppressed', v_sum.p, 'new_customers', v_sum.n, 'masked', v_sum.m, 'baseline', v_imp.is_baseline);",
    ]);
  });
  it("customer_list_rows changes only the order aggregate", () => {
    expect(changedLines("0249_customer_list_v2.sql", "customer_list_rows")).toEqual([
      "select o.customer_id, count(*) visits,",
      "case when count(o.total_cents) = count(*) then sum(o.total_cents) end spend_cents,",
      "case when count(o.total_cents) = count(*) then round(avg(o.total_cents)) end avg_order_cents,",
      "min(o.business_date) first_order, max(o.business_date) last_order,",
      "count(*) filter (where o.source_kind <> 'toast' or o.channel = 'catering') catering_orders,",
    ]);
  });
});

it("0312 offline proof: every W12 bug red before, green after; upgrade, refusals and ceilings", () => {
  const output = execFileSync(process.execPath, ["scripts/sql-harness-0312.mjs"], { encoding: "utf8", timeout: 400_000 });
  for (const evidence of [
    "PASS ",
    "B071 reproduced before 0312: the corrected same-date re-import leaves alice opted out",
    "same-date corrected re-import restores the people a partial file dropped",
    "B173 reproduced before 0312: the subject flips and counts as a new opt-in",
    "a person with two listed addresses keeps one subject and is not a new opt-in",
    "when the address in use leaves the list, the subject moves to a still-listed address",
    "B174 reproduced before 0312: a returning guest is refused for good",
    "retention erasure leaves no suppression; a returning guest can opt in again as a new customer",
    "B070 reproduced before 0312: the sweep erased a person who had just become active",
    "a person made active after the candidate snapshot is skipped, not erased",
    "retention sweep takes the identity lock before reading candidates",
    "B070 reproduced before 0312: an import finish completes consent without the identity lock",
    "an import finish holds the identity lock until it commits, so it cannot land inside a sweep",
    "finish then sweep: the person the import opted in keeps identity, opt-in and the marketing file",
    "sweep then finish: the finish completes; the person erased before it stays erased, opted out and unmarketed",
    "import finish takes the import lock, then the identity lock, before it reads the import",
    "the sweep and the erase never take the import lock (no identity -> import order, no deadlock)",
    "B176 reproduced before 0312: a voided order still counts as a visit and spend",
    "a voided order leaves visits and spend but stays listed; an un-void brings it back; a re-capture never un-voids",
    "B177 reproduced before 0312: other shops fill the top 50 and the GM sees none",
    "a GM sees their shop's suggestions even when other shops fill the top 50",
    "after 0312: inside one import an opt-out still wins the tie",
    "after 0312: a non-import opt-out still beats an import at the same instant",
    "after 0312: a delete request still suppresses for good",
    "after 0312: an empty snapshot opts out the remaining subscriber",
    "unacknowledged retention unblock is refused with its count and leaves no partial DDL",
    "the acknowledged exact count applies",
    "existing wrongly opted-out people read opted_in after apply, with no row written",
    "backfill marks an already-voided order",
    "an old retention suppression no longer blocks a returning person",
    "a later delete request is still recorded beside the old retention row",
    "permissive ACL sabotage caught: no partial DDL",
    "a second apply is refused as already applied",
    "two-session sim proof remains required",
  ]) expect(output).toContain(evidence);
}, 420_000);
