/**
 * Item 21 PR 4: Migration 0348 (the HOUSE RECONCILER). File only; CC applies sim then prod on Juan's word.
 * Pins the file's shape and runs the offline PGlite proof (scripts/sql-harness-0348.mjs) against the REAL 0225
 * transfer, 0229 publisher, 0231 planner, 0330 reconciler and the 0344 / 0347 files. Migrations are pinned BY NAME.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0348_catering_toast_reconciler.sql");
const m0347 = read("0347_catering_toast_link_step.sql");
const code = sql.replace(/--[^\n]*/g, "");
const fn = (src: string, name: string) => src.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$plan\\$;|\\$\\$;)`))![0];

/** Every line of `a` appears in `b`, in order (b may add lines). */
function isLineSubsequence(a: string, b: string): boolean {
  const bs = b.split("\n");
  let j = 0;
  for (const line of a.split("\n")) {
    while (j < bs.length && bs[j] !== line) j += 1;
    if (j === bs.length) return false;
    j += 1;
  }
  return true;
}
const added = (old: string, neu: string) => neu.split("\n").filter((l) => !old.split("\n").includes(l));

describe("0348 header and shape", () => {
  it("gate header, one transaction, file only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0348_catering_toast_reconciler");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-19 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    expect(code).toContain("raise exception '0348: apply 0347 first'");
    expect(code).toContain("raise exception '0348: the live plan_ezcater_toast is not the 0347 body");
    expect(code).toContain("raise exception '0348: the live plan_catering_toast is not the 0347 body");
  });

  it("re-emits the ezCater PLANNER by adding lines only: 0347's body is a line-subsequence of the new one", () => {
    const old = fn(m0347, "plan_ezcater_toast");
    const neu = fn(sql, "plan_ezcater_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    const lines = added(old, neu);
    expect(lines).toHaveLength(8);
    // The one addition: a note-typed live ring code, recorded on this very capture, joins house_coded.
    expect(lines.join("\n")).toContain("join public.catering_toast_note_codes n on n.toast_snapshot_id=c.toast_snapshot_id and n.check_guid=c.check_guid");
    // Every added line is the note branch of house_coded: its two comment lines and six lines keyed on `checks c`.
    expect(lines.filter((l) => l.startsWith(" -- "))).toHaveLength(2);
    for (const line of lines.filter((l) => !l.startsWith(" -- "))) expect(line).toMatch(/checks c$|catering_toast_note_codes n |=c\.location_id|,c\.location_id,|=c\.order_guid/);
  });

  it("re-emits the HOUSE planner by adding lines only: recorded note codes are tokens", () => {
    const old = fn(m0347, "plan_catering_toast");
    const neu = fn(sql, "plan_catering_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    expect(added(old, neu)).toEqual([
      "    -- (c) 0348 (contract #3): codes the one note lookup RECORDED on this very capture (codes only, never text).",
      "    select c.toast_snapshot_id, c.check_guid, n.code_norm",
      "      join public.catering_toast_note_codes n",
      "        on n.location_id = c.location_id and n.toast_snapshot_id = c.toast_snapshot_id and n.check_guid = c.check_guid",
    ]);
  });

  it("never re-emits the publisher, the ezCater reconciler, apply or transfer, and never writes ezcater_toast_links", () => {
    expect(code).not.toMatch(/function\s+public\.(publish_ezcater_shadow|reconcile_ezcater_toast|apply_ezcater_order|transfer_catering_lead)\b/i);
    expect(code).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.ezcater_toast_links\b/i);
    expect(code).not.toMatch(/\bdecide_catering_toast\s*\(uuid[^)]*\)\s+returns/i);
  });

  it("the ezCater reconciler never runs in a subtransaction: nothing here calls it, and the house reconciler has no exception block", () => {
    // 0347's incumbent rule reads xmin of a row retired in the SAME top-level transaction.
    expect(code).not.toMatch(/reconcile_ezcater_toast\s*\(/);
    expect(code).not.toMatch(/publish_ezcater_shadow\s*\(/);
    const house = fn(sql, "reconcile_catering_toast").replace(/--[^\n]*/g, "");
    expect(house).not.toMatch(/\bexception\s+when\b/i);
    expect(house).not.toMatch(/savepoint/i);
  });

  it("the house reconciler: off before the lock, the lock before the leads, the leads before any link row", () => {
    const house = fn(sql, "reconcile_catering_toast");
    const off = house.indexOf("return jsonb_build_object('skipped', 'off');");
    const lock = house.indexOf("perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));");
    const leads = house.indexOf("order by p.id for no key update");
    const insert = house.indexOf("insert into public.catering_toast_links");
    expect(off).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(off);
    expect(leads).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(leads);
    // The settings are read AGAIN under the lock.
    expect(house.slice(lock).match(/return jsonb_build_object\('skipped', 'off'\);/g)).toHaveLength(1);
    expect(code.match(/insert into public\.catering_toast_links\b/g)).toHaveLength(1);
    // Automatic evidence only, never 'manual'; never a decision row.
    expect(house).toContain("r.lead_id, p_location_id, r.order_guid, r.check_guid, r.toast_snapshot_id, v_evidence)");
    expect(code).not.toMatch(/insert into public\.catering_toast_link_decisions/);
  });

  it("every refusal of the automatic link is named, in one order", () => {
    const house = fn(sql, "reconcile_catering_toast");
    const order = ["'blocked'", "'no_ring_expected'", "'switch_off'", "'before_start_date'", "then 'owned'", "'out_of_window'", "'dual_code'",
      "'two_house_orders'", "'ezcater_dining_option'"];
    let at = house.indexOf("v_reason := case");
    for (const name of order) {
      const next = house.indexOf(name, at);
      expect([name, next > at]).toEqual([name, true]);
      at = next;
    }
  });

  it("no statement sets a house link current again; the run is audited as a system observation", () => {
    expect(code).not.toMatch(/is_current\s*=\s*true/i);
    for (const set of code.match(/update public\.catering_toast_links[\s\S]*?;/g) ?? []) expect(set).toMatch(/set is_current = false, retired_at = clock_timestamp\(\)/);
    const house = fn(sql, "reconcile_catering_toast");
    expect(house).toContain("values (null, null, 'catering.toast_reconciled', 'catering_toast_links', null,");
    expect(house).toMatch(/'link_ids', to_jsonb\(v_links\[1:50\]\)\),\n\s+false\);/);
  });

  it("the note codes: codes only, deny-all, one definer writer", () => {
    expect(code).toContain("code_norm         text not null check (code_norm ~ '^[A-Z0-9]{4,32}$')");
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(code).toContain(`create policy catering_toast_note_codes_no_user_${op} on public.catering_toast_note_codes`);
    }
    expect(code).toContain("grant select on public.catering_toast_note_codes to service_role;");
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
    const writer = fn(sql, "record_catering_toast_note_codes");
    expect(writer).toContain("raise exception 'catering_toast_note_codes_invalid'");
    // Stored only for the order's CURRENT capture and only if the code IS a known code.
    expect(writer).toContain("join public.toast_orders_latest t on t.id = x.toast_snapshot_id");
    expect(writer).toMatch(/exists \(select 1 from public\.catering_pipeline p[\s\S]*or exists \(select 1 from public\.ezcater_orders e/);
    expect(code.match(/insert into public\.catering_toast_note_codes\b/g)).toHaveLength(1);
  });

  it("ONE rule for house code evidence: 0347's dual-code test is its first element, and the token rule is 0229's", () => {
    const token = "regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok";
    expect(fn(sql, "catering_toast_check_code_leads")).toContain(token);
    expect(fn(sql, "catering_toast_check_house_code")).toContain("select (public.catering_toast_check_code_leads(p_location_id, p_order_guid, p_check_guid))[1]");
    expect(fn(sql, "reconcile_catering_toast")).toContain("v_codes := public.catering_toast_check_code_leads(p_location_id, r.order_guid, r.check_guid);");
  });

  it("every new function is definer with a pinned search_path and no user EXECUTE", () => {
    const names = ["record_catering_toast_note_codes", "catering_toast_check_code_leads", "catering_toast_check_on_ezcater_option",
      "ensure_catering_ring_codes", "reconcile_catering_toast"];
    for (const name of names) {
      expect(fn(sql, name)).toMatch(/security definer set search_path = pg_catalog, public as \$\$/);
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });
});

describe("0348 behaviour (PGlite, real writers)", () => {
  it("scripts/sql-harness-0348.mjs passes", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0348.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/sql-harness-0348: \d+ checks passed/);
    expect(Number(out.match(/(\d+) checks passed/)![1])).toBeGreaterThanOrEqual(86);
  }, 600_000);
});
