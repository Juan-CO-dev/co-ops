/**
 * Item 21 PR 3: Migration 0347 (the LINK step). File only; CC applies sim then prod on Juan's word.
 * Pins the file's shape and runs the offline PGlite proof (scripts/sql-harness-0347.mjs) against the REAL 0229
 * publisher, 0231 planner and 0330 reconciler. The two contracts PR 2 left for PR 3 (runbook, Astra r3 #1 and #2) are
 * proven there; this file pins that the planner is 0231 plus ADDED lines only and that no ezCater writer is re-emitted.
 * Migrations are pinned BY NAME, never "the latest".
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0347_catering_toast_link_step.sql");
const code = sql.replace(/--[^\n]*/g, "");
const fn = (src: string, name: string) => src.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?\\n(?:end \\$\\$;|\\$plan\\$;|\\$\\$;)`))![0];

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

describe("0347 header and shape", () => {
  it("gate header, one transaction, file only, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0347_catering_toast_link_step");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-18 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(sql).toMatch(/0346 may be claimed by board PR 2/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("re-emits the ezCater PLANNER only: 0231's body is a line-subsequence of the new one", () => {
    const old = fn(read("0231_ezcater_reconcile_planner_speed.sql"), "plan_ezcater_toast");
    const neu = fn(sql, "plan_ezcater_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    // The added lines are the 0347 ownership / dual-code predicates and nothing else.
    const added = neu.split("\n").filter((l) => !old.split("\n").includes(l));
    expect(added.length).toBeLessThanOrEqual(16);
    for (const line of added) expect(line).toMatch(/0347|house|catering_toast_|ezcater_toast_links z|z\.order_guid|tokens k$|r\.code_norm|^\s*(or )?exists|totals\. ezCater|^ and \(public|^ or exists|retires an owner/);
  });

  it("never re-emits the publisher, the reconciler, apply or transfer, and never updates ezcater_toast_links", () => {
    expect(code).not.toMatch(/function\s+public\.(publish_ezcater_shadow|reconcile_ezcater_toast|apply_ezcater_order|transfer_catering_lead)\b/i);
    expect(code).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.ezcater_toast_links\b/i);
    expect(code).toContain("create trigger ezcater_toast_links_house_guard before insert on public.ezcater_toast_links");
  });

  it("the publisher guard cannot raise: every statement sits inside one exception block that passes the row", () => {
    const guard = fn(sql, "ezcater_toast_links_house_guard");
    expect(guard).not.toMatch(/raise\s+exception/i);
    expect(guard).toMatch(/exception when others then\n\s+return new;/);
  });

  it("every link insert is the writer's, after the reconcile lock; audit names are literal", () => {
    const writer = fn(sql, "decide_catering_toast");
    const lock = writer.indexOf("perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));");
    expect(lock).toBeGreaterThan(0);
    expect(writer.indexOf("insert into public.catering_toast_links")).toBeGreaterThan(lock);
    expect(code.match(/insert into public\.catering_toast_links\b/g)).toHaveLength(1);
    for (const name of ["catering.toast_link", "catering.toast_unlink", "catering.toast_not_a_match", "catering.toast_no_ring_expected", "catering.toast_ring_expected"]) {
      expect(writer).toContain(`'${name}'`);
    }
  });

  it("the conflict ledger is deny-all with a service-role SELECT ceiling", () => {
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(code).toContain(`create policy catering_toast_conflicts_no_user_${op} on public.catering_toast_conflicts`);
    }
    expect(code).toContain("grant select on public.catering_toast_conflicts to service_role;");
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });

  it("the token rule is 0229's, verbatim", () => {
    const token = "regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok";
    expect(read("0231_ezcater_reconcile_planner_speed.sql")).toContain(token);
    expect(fn(sql, "catering_toast_check_house_code")).toContain(token);
  });
});

describe("0347 fix round 1 (review PORTAL3-r1): a house link never comes back; one owner rule", () => {
  const m0344 = read("0344_catering_toast_house_side.sql");
  const RAW_OWNER = [
    "              when exists (select 1 from public.catering_toast_links h where h.is_current and h.location_id = p_location_id",
    "                             and h.order_guid = b.order_guid and h.check_guid = b.check_guid) then 'house' end,",
    "         (select h.lead_id from public.catering_toast_links h where h.is_current and h.location_id = p_location_id",
    "            and h.order_guid = b.order_guid and h.check_guid = b.check_guid),",
  ].join("\n");
  const RULE_OWNER = [
    "              when public.catering_toast_house_owner(p_location_id, b.order_guid, b.check_guid) is not null then 'house' end,",
    "         public.catering_toast_house_owner(p_location_id, b.order_guid, b.check_guid),",
  ].join("\n");

  it("the house planner is 0344's body with ONE change: the owner comes from catering_toast_house_owner", () => {
    const old = fn(m0344, "plan_catering_toast");
    expect(old.split(RAW_OWNER)).toHaveLength(2);
    expect(fn(sql, "plan_catering_toast")).toBe(old.replace(RAW_OWNER, RULE_OWNER).replace("create function", "create or replace function"));
  });

  it("the orphans view is 0344's with the same one change", () => {
    const view = (src: string) => src.match(/create (?:or replace )?view public\.catering_toast_orphans[\s\S]*?;\n/)![0];
    const raw = "   and not exists (select 1 from public.catering_toast_links h where h.is_current and h.location_id = t.location_id\n"
      + "                    and h.order_guid = t.order_guid and h.check_guid = c.check_guid)\n";
    expect(view(m0344).split(raw)).toHaveLength(2);
    expect(view(sql)).toBe(view(m0344).replace(raw, "   and public.catering_toast_house_owner(t.location_id, t.order_guid, c.check_guid) is null\n")
      .replace("create view", "create or replace view"));
  });

  it("a lead that moves, is lost or becomes ezCater ENDS its links in the same transaction (a trigger on the lead)", () => {
    const end = fn(sql, "catering_pipeline_end_toast_links");
    expect(end).toMatch(/update public\.catering_toast_links h\s+set is_current = false, retired_at = clock_timestamp\(\)/);
    expect(end).not.toMatch(/exception\s+when/i); // it is part of the lead's write: both commit or neither
    expect(code).toMatch(/create trigger catering_pipeline_end_toast_links after update on public\.catering_pipeline\s+for each row when \(old\.location_id is distinct from new\.location_id or old\.stage is distinct from new\.stage\s+or old\.lead_source is distinct from new\.lead_source\)/);
    expect(code).toContain("check (retired_reason in ('unlinked', 'check_gone', 'lead_moved', 'lead_lost', 'lead_ezcater'))");
  });

  it("no statement ever sets a house link current again; the only way to own a check is a NEW row from the writer", () => {
    expect(code).not.toMatch(/is_current\s*=\s*true/i);
    for (const set of code.match(/update public\.catering_toast_links[\s\S]*?;/g) ?? []) expect(set).toMatch(/set is_current = false, retired_at = clock_timestamp\(\)/);
    expect(code.match(/update public\.catering_toast_links\b/g)).toHaveLength(4); // writer x2 (stale holder, unlink), the guard, the lead trigger
  });

  it("the publisher guard ends a dormant house row only when it ADMITS ezCater, inside its never-raising block", () => {
    const guard = fn(sql, "ezcater_toast_links_house_guard");
    const admit = guard.indexOf("if v_kind is null then");
    const end = guard.indexOf("update public.catering_toast_links h");
    expect(admit).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(admit);
    expect(guard.indexOf("exception when others then")).toBeGreaterThan(end);
  });

  it("the readiness probe names the writer and all three triggers", () => {
    const probe = fn(sql, "catering_toast_link_ready");
    for (const name of ["decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)", "ezcater_toast_links_house_guard", "catering_toast_links_ezcater_guard", "catering_pipeline_end_toast_links"]) {
      expect(probe).toContain(name);
    }
    expect(code).toContain("grant execute on function public.catering_toast_link_ready() to service_role;");
    expect(code).toContain("grant execute on function public.catering_toast_ended_links(uuid) to service_role;");
  });
});

describe("0347 fix round 3 (review PORTAL3-r3): a recorded conflict needs BOTH sides now", () => {
  it("the ledger branch binds the ezCater order's current shop and window to the recorded check", () => {
    const read3 = fn(sql, "ezcater_order_house_conflicts");
    expect(read3).toContain("and coalesce(p.location_id, o.location_id) = k.location_id");
    expect(read3).toContain("and t.business_date between o.event_date - 1 and o.event_date + 7");
    expect(read3).not.toMatch(/delete|update|insert/i); // a read: the ledger is history
  });
  it("'not a match' never touches a link row or checks ownership: it can clear a conflict, it cannot move an owner", () => {
    const writer = fn(sql, "decide_catering_toast");
    const branch = writer.slice(writer.indexOf("elsif p_kind = 'not_a_match' then"), writer.indexOf("elsif p_kind = 'no_ring_expected' then"));
    expect(branch).toContain("insert into public.catering_toast_link_decisions");
    expect(branch).not.toMatch(/update public.|insert into public.catering_toast_links|ezcater_toast_links/);
  });
});

describe("0347 executable proof", () => {
  it("scripts/sql-harness-0347.mjs passes on the real 0229 / 0231 / 0330 / 0344 bodies", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0347.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/sql-harness-0347: \d+ checks passed/);
  }, 180_000);
});
