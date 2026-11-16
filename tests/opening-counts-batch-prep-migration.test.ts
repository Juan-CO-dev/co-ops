/**
 * Unit spine — migration 0315 (audit W14, opening counts and batch prep) is a faithful re-emission.
 *
 * 0315 redefines six RPCs. Each was built MECHANICALLY from its latest definer: the source body
 * plus an enumerated list of `[old, new]` modifications (the `*_MODS` tables — reviewers read
 * THOSE). Applying the same mods to the source must give a line-SUBSEQUENCE of the emitted body
 * (the batch-vs-bottle-migration.test.ts idiom), and nothing but comment lines may be left over,
 * so a dropped or smuggled line fails here by name.
 *
 *   B020  save_phase2_item_atomic  ← 0215   a blank BACK UP with a known LINE is 0
 *   B080  save / revoke / submit   ← 0215, 0215, 0255   the opening instance lock FIRST
 *   B181  revoke_phase2_item_atomic          the batch session BEFORE the completion
 *   B078  save_opening_phase1_draft (new)    the same-tab compare-and-set
 *   B182  the three corrections ← 0305       item-tracking ticks refuse like report references
 *         (0305 = audit W05's re-emission of 0287 with the ACTIVE-membership line; it merged to main
 *          while this wave was built, so it — not 0287 — is the latest definer 0315 re-emits from)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (f: string) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").replace(/\r\n/g, "\n");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const FILE = "0315_opening_counts_batch_prep.sql";
const raw = read(FILE);

function extract(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `function start not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a);
  expect(b, `function end not found after: ${start}`).toBeGreaterThan(a);
  return src.slice(a, b + end.length);
}
function applyMods(text: string, mods: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [oldText, newText] of mods) {
    expect(out.split(oldText).length - 1, `mod anchor must occur exactly once: ${oldText.slice(0, 70)}`).toBe(1);
    out = out.replace(oldText, newText);
  }
  return out;
}
function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}
/** Lines of `emitted` that are neither in `source` nor a comment. */
function extraCode(source: string, emitted: string): string[] {
  const src = new Set(source.split("\n").map((l) => l.trimEnd()));
  return emitted.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "" && !src.has(l) && !l.trim().startsWith("--"));
}
const code = (body: string) => body.replace(/--[^\n]*/g, "").toLowerCase();
/** prosrc = the text between the dollar quotes; the fingerprint ignores everything but printable ASCII. */
function fingerprint(fn: string, tag: string): string {
  const body = fn.slice(fn.indexOf(tag) + tag.length, fn.lastIndexOf(tag));
  return createHash("md5").update(body.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
}

// ── The enumerated modifications ───────────────────────────────────────────────────────────
const SAVE_MODS = [
  [`  SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id;`,
   `  SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;`],
  [`    v_par_value_b := NULLIF(v_phase1->>'par_value', '')::numeric;
`,
   `    v_par_value_b := NULLIF(v_phase1->>'par_value', '')::numeric;
    IF v_backup_before IS NULL AND v_line IS NOT NULL THEN
      v_backup_before := 0;
    END IF;
`],
] as const;
const SUBMIT_MODS = [
  [`  -- ──── Pre-load instance + location ────
`,
   `  PERFORM 1 FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;

  -- ──── Pre-load instance + location ────
`],
] as const;
/** The session lock that MOVED: removed from after the completion UPDATE, re-emitted before it. */
const REVOKE_SESSION_BLOCK = `  -- The session key, not the JSON shape (correction 1). Lock the row, read the toss, zero it.
  select s.tossed_qty into v_toss_retracted
  from prep_batch_sessions s
  where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id
  for update;
`;
const REVOKE_MODS = [
  [REVOKE_SESSION_BLOCK, ""],
  [`  v_toss_retracted numeric := 0;
begin
`,
   `  v_toss_retracted numeric := 0;
  v_status text;
begin
  select ci.status into v_status
  from checklist_instances ci
  where ci.id = p_instance_id
  for no key update;
  if not found then
    raise exception 'revoke_phase2_item_atomic: revoke_conflict — instance % not found', p_instance_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'phase1_complete' then
    raise exception 'revoke_phase2_item_atomic: phase2_not_eligible — instance % status is "%" (expected phase1_complete)',
      p_instance_id, v_status using errcode = 'P0001';
  end if;
  select cc.template_item_id into v_template_item_id
  from checklist_completions cc
  where cc.id = p_completion_id and cc.instance_id = p_instance_id;
${REVOKE_SESSION_BLOCK}`],
] as const;
const correctionMods = () => [
  [`  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and report_reference_type is not null) then`,
   `  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and (report_reference_type is not null
      or (ref_track_item_completion and references_template_item_id is not null))) then`],
] as const;

interface Reemit {
  name: string;
  signature: string;
  sourceFile: string;
  /** How the SOURCE file spells the definition. */
  sourceStart: string;
  /** How 0315 spells it. */
  start: string;
  end: string;
  tag: string;
  mods: ReadonlyArray<readonly [string, string]>;
}
const REEMITS: Reemit[] = [
  { name: "save_phase2_item_atomic", signature: "public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)",
    sourceFile: "0215_batch_vs_bottle.sql", sourceStart: "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(",
    start: "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", end: "$function$;", tag: "$function$", mods: SAVE_MODS },
  { name: "revoke_phase2_item_atomic", signature: "public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)",
    sourceFile: "0215_batch_vs_bottle.sql", sourceStart: "create or replace function public.revoke_phase2_item_atomic(",
    start: "create or replace function public.revoke_phase2_item_atomic(", end: "$function$;", tag: "$function$", mods: REVOKE_MODS },
  { name: "submit_phase2_atomic", signature: "public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)",
    sourceFile: "0255_under_par_alert_recipients.sql", sourceStart: "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(",
    start: "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(", end: "$function$;", tag: "$function$", mods: SUBMIT_MODS },
  ...(["checklist_revoke_completion(uuid,uuid)", "checklist_revoke_with_reason(uuid,uuid,text,text)", "checklist_mark_not_done(uuid,uuid,text)"] as const).map((sig): Reemit => {
    const name = sig.slice(0, sig.indexOf("("));
    return { name, signature: `public.${sig}`, sourceFile: "0305_rls_membership_and_read_floors.sql",
      sourceStart: `create or replace function public.${name}(`, start: `create or replace function public.${name}(`,
      end: "end $$;", tag: "$$", mods: correctionMods() };
  }),
];
const definersOf = (r: Reemit) => files.filter((f) => read(f).includes(r.start) || read(f).includes(r.sourceStart));
/**
 * Later definers built FROM 0315 (each pins 0315's body as a line-subsequence of its own in its own test):
 * 0320 (audit W15/B085, the frozen Phase 2 universe) re-emits 0315's submit_phase2_atomic →
 * tests/checklist-publish-activation-migration.test.ts. 0315 stays the source of record for that body.
 */
const LATER_REEMITTERS: Readonly<Record<string, string>> = {
  submit_phase2_atomic: "0320_checklist_publish_activation.sql",
};

describe("0315 re-emits every RPC from its latest definer — nothing dropped, nothing smuggled", () => {
  for (const r of REEMITS) {
    it(`${r.name}: ${r.sourceFile} was the latest definer, and its body (± the enumerated mods) is a line-subsequence of 0315's`, () => {
      const defining = definersOf(r);
      const later = LATER_REEMITTERS[r.name];
      if (later) expect(defining.pop()).toBe(later);
      expect(defining[defining.length - 1]).toBe(FILE);
      expect(defining[defining.length - 2]).toBe(r.sourceFile);
      const source = applyMods(extract(read(r.sourceFile), r.sourceStart, r.end), r.mods);
      const emitted = extract(raw, r.start, r.end);
      const check = isLineSubsequence(source, emitted);
      expect(check.ok, `${r.name}: missing from 0315 → ${check.missing}`).toBe(true);
      expect(extraCode(source, emitted), `${r.name}: code lines beyond the mods`).toEqual([]);
    });

    it(`${r.name}: the pre-flight fingerprints are the source body's and this file's own`, () => {
      const sourceMd5 = fingerprint(extract(read(r.sourceFile), r.sourceStart, r.end), r.tag);
      const ownMd5 = fingerprint(extract(raw, r.start, r.end), r.tag);
      expect(sourceMd5).not.toBe(ownMd5);
      const source = r.sourceFile.slice(0, 4);
      expect(raw).toContain(`('${r.signature}', '${source}', '${sourceMd5}', '${ownMd5}')`);
      // …and the post-apply assertion demands this file's body.
      expect(raw).toMatch(new RegExp(`\\('${r.signature.replace(/[.()]/g, "\\$&")}', '${ownMd5}', (true|false)\\)`));
    });
  }

  it("the corrections come from 0305, not 0287: W05's active-membership line is in all three", () => {
    for (const name of ["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"]) {
      const body = extract(raw, `create or replace function public.${name}(`, "end $$;");
      expect(body, name).toContain("where user_id = p_actor and location_id = v_instance.location_id and active for share;");
      expect(body, name).not.toContain("location_id = v_instance.location_id for share;");
      // 0287 spells its definitions `create function`; it is two definers back.
      expect(read("0287_checklist_corrections_serialized.sql")).toContain(`create function public.${name}(`);
    }
    // 0305's own pre-flight accepts only 0287's bodies, so 0315 must come after it — and says so.
    expect(raw).toContain("raise exception '0315: 0305 (checklist corrections require an active membership) must be applied first';");
    expect(raw).toContain("APPLY ORDER: 0305 BEFORE 0315.");
  });

  it("the new draft writer carries its own fingerprint in the post-apply assertion", () => {
    const fn = extract(raw, "create or replace function public.save_opening_phase1_draft(", "end $$;");
    expect(raw).toContain(`('public.save_opening_phase1_draft(uuid,uuid,jsonb,uuid,uuid,bigint)', '${fingerprint(fn, "$$")}', true)`);
  });
});

describe("0315 — B080 / B181: one lock order for every opening Phase 2 writer", () => {
  const save = code(extract(raw, "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", "$function$;"));
  const revoke = code(extract(raw, "create or replace function public.revoke_phase2_item_atomic(", "$function$;"));
  const submit = code(extract(raw, "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(", "$function$;"));
  const writers: Array<[string, string]> = [["save", save], ["revoke", revoke], ["submit", submit]];

  it.each(writers)("%s: locks the instance FOR NO KEY UPDATE before any completion, session or submission write", (_n, body) => {
    const lock = body.search(/from checklist_instances[^;]*for no key update;/);
    expect(lock).toBeGreaterThan(-1);
    for (const write of ["update checklist_completions", "insert into checklist_completions", "from prep_batch_sessions", "insert into prep_batch_sessions", "insert into checklist_submissions", "insert into notifications"]) {
      const at = body.indexOf(write);
      if (at >= 0) expect(lock, `instance lock precedes: ${write}`).toBeLessThan(at);
    }
    // Never the stronger FOR UPDATE on a parent (it would block the FK key-share checks of every insert).
    expect(body).not.toMatch(/from checklist_instances[^;]*for update;/);
  });

  it("the save and the finalize were RED before: neither source body locks the instance", () => {
    expect(code(extract(read("0215_batch_vs_bottle.sql"), "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", "$function$;"))).not.toContain("for no key update");
    expect(code(extract(read("0215_batch_vs_bottle.sql"), "create or replace function public.revoke_phase2_item_atomic(", "$function$;"))).not.toContain("for no key update");
    expect(code(extract(read("0255_under_par_alert_recipients.sql"), "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(", "$function$;"))).not.toContain("for no key update");
  });

  it("revoke re-checks the status under the lock and refuses past phase1_complete", () => {
    const lock = revoke.search(/from checklist_instances ci[^;]*for no key update;/);
    const refusal = revoke.indexOf("phase2_not_eligible");
    expect(refusal).toBeGreaterThan(lock);
    expect(refusal).toBeLessThan(revoke.indexOf("update checklist_completions"));
    expect(revoke).toContain("if v_status <> 'phase1_complete' then");
  });

  it("revoke locks the batch session before it updates the completion (B181); the 0215 body did the opposite", () => {
    const session = revoke.search(/from prep_batch_sessions s[^;]*for update;/);
    expect(session).toBeGreaterThan(-1);
    expect(session).toBeLessThan(revoke.indexOf("update checklist_completions"));
    const old = code(extract(read("0215_batch_vs_bottle.sql"), "create or replace function public.revoke_phase2_item_atomic(", "$function$;"));
    expect(old.indexOf("update checklist_completions")).toBeLessThan(old.search(/from prep_batch_sessions s[^;]*for update;/));
    // The save takes them in the same order.
    expect(save.search(/from prep_batch_sessions s[^;]*for update;/)).toBeLessThan(save.indexOf("update checklist_completions"));
  });

  it("the completion UPDATE of the revoke keeps its columns and predicates", () => {
    const body = extract(raw, "create or replace function public.revoke_phase2_item_atomic(", "$function$;");
    expect(body).toContain(`  update checklist_completions cc
  set revoked_at = v_now,
      revoked_by = p_actor_id,
      revocation_reason = p_revocation_reason,
      revocation_note = p_revocation_note
  where cc.id = p_completion_id
    and cc.instance_id = p_instance_id
    and cc.revoked_at is null
    and cc.superseded_at is null
  returning to_jsonb(cc), cc.template_item_id into v_row, v_template_item_id;`);
    expect(body).toContain("return jsonb_build_object('completion', v_row, 'tossRetracted', v_toss_retracted);");
  });

  it("finalize keeps its guarded status UPDATE as the second line of defence", () => {
    expect(submit).toContain("where id = p_opening_instance_id\n    and status = 'phase1_complete';");
    expect(submit.search(/perform 1 from checklist_instances[^;]*for no key update;/)).toBeLessThan(submit.indexOf("select count(*) into v_missing_count"));
  });
});

describe("0315 — B020: a blank BACK UP with a known LINE is zero", () => {
  const save = extract(raw, "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", "$function$;");
  it("the rule sits after both COALESCEs and before the backup_unknown refusal", () => {
    const recount = save.indexOf("v_backup_before := COALESCE(NULLIF(v_phase1->>'opener_recount_back_up', '')::numeric, v_backup_before);");
    const rule = save.indexOf("IF v_backup_before IS NULL AND v_line IS NOT NULL THEN\n      v_backup_before := 0;\n    END IF;");
    const refusal = save.indexOf("IF v_line IS NULL OR v_backup_before IS NULL THEN");
    expect(recount).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(recount);
    expect(refusal).toBeGreaterThan(rule);
    // A blank LINE is still unknown: the refusal itself is untouched.
    expect(save.slice(refusal, refusal + 260)).toContain("backup_unknown");
  });
  it("mid-day is not re-emitted (its Phase 1 already requires both boxes)", () => {
    expect(raw).not.toContain("function public.save_mid_day_phase2_item_atomic(");
    expect(raw).not.toContain("function public.submit_phase1_atomic(");
  });
});

describe("0315 — B078: the Phase 1 draft writer", () => {
  const fn = extract(raw, "create or replace function public.save_opening_phase1_draft(", "end $$;");
  it("adds the revision columns idempotently and never rewrites a row", () => {
    expect(raw).toContain("alter table public.opening_phase1_drafts\n  add column if not exists client_tab uuid null,\n  add column if not exists client_seq bigint null;");
    expect(raw.replace(/--[^\n]*/g, "")).not.toMatch(/\bupdate public\.opening_phase1_drafts\b/i);
    expect(raw.replace(/--[^\n]*/g, "")).not.toMatch(/\bdelete from\b/i);
  });
  it("locks the instance FOR SHARE and requires open inside the write", () => {
    const lock = fn.indexOf("   for share;");
    expect(lock).toBeGreaterThan(-1);
    expect(fn.indexOf("opening_draft:phase1_not_open")).toBeGreaterThan(lock);
    expect(fn.indexOf("insert into public.opening_phase1_drafts")).toBeGreaterThan(fn.indexOf("opening_draft:phase1_not_open"));
  });
  it("the compare-and-set refuses only an older request from the SAME tab", () => {
    expect(fn).toContain(`    where excluded.client_tab is null
       or d.client_tab is distinct from excluded.client_tab
       or d.client_seq is null
       or excluded.client_seq > d.client_seq`);
    expect(fn).toContain("return jsonb_build_object('applied', false, 'savedAt', v_applied);");
    expect(fn).toContain("return jsonb_build_object('applied', true, 'savedAt', v_applied);");
  });
  it("is a definer with a pinned search_path, service_role only", () => {
    expect(fn).toContain("security definer\nset search_path = pg_catalog, public");
    expect(raw).toContain("revoke all on function public.save_opening_phase1_draft(uuid, uuid, jsonb, uuid, uuid, bigint) from public, anon, authenticated;");
    expect(raw).toContain("grant execute on function public.save_opening_phase1_draft(uuid, uuid, jsonb, uuid, uuid, bigint) to service_role;");
  });
});

describe("0315 — B182: item-tracking ticks refuse generic corrections", () => {
  it.each(["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"])("%s: the widened check raises the existing code, between the parent lock and the completion lock", (name) => {
    const body = code(extract(raw, `create or replace function public.${name}(`, "end $$;"));
    const widened = body.indexOf("or (ref_track_item_completion and references_template_item_id is not null))) then");
    expect(widened).toBeGreaterThan(body.indexOf("for no key update"));
    expect(widened).toBeLessThan(body.lastIndexOf("for no key update"));
    expect(body.slice(widened, widened + 140)).toContain("raise exception 'reference_row_not_correctable'");
    expect(body).toContain("security invoker set search_path = pg_catalog, public");
  });
});

describe("0315 — the file's conventions", () => {
  it("is authored-only, one transaction, with the house header", () => {
    expect(raw.startsWith("-- Migration 0315_opening_counts_batch_prep\n-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review")).toBe(true);
    expect(raw).not.toMatch(/^-- APPLIED TO (SIM|PROD)/m);
    for (const section of ["-- Provenance:", "-- WHAT", "-- LOCK ORDER", "-- EXISTING ROWS:", "-- CONSUMERS", "-- APP COMPATIBILITY", "-- DEPENDS ON:", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY:", "-- ROLLBACK:"]) {
      expect(raw, section).toContain(section);
    }
    const sql = raw.replace(/--[^\n]*/g, "").trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
    expect(sql.match(/\bbegin;/g)?.length).toBe(1);
  });
  it("restates every grant and asserts the ceilings after apply", () => {
    for (const sig of ["save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb)", "revoke_phase2_item_atomic(uuid, uuid, uuid, text, text)",
      "submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text)", "checklist_revoke_completion(uuid, uuid)",
      "checklist_revoke_with_reason(uuid, uuid, text, text)", "checklist_mark_not_done(uuid, uuid, text)"]) {
      expect(raw).toMatch(new RegExp(`revoke (all|execute) on function public\\.${sig.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`));
      expect(raw).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(raw).toContain("has_function_privilege('public', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')");
    expect(raw).toContain("raise exception '0315: RPC grant escaped on %', r.sig;");
    expect(raw).toContain("raise exception '0315: unexpected opening_phase1_drafts table grant';");
  });
  it("refuses a database whose live body is neither the source nor this file's", () => {
    expect(raw).toContain("if v_live is distinct from r.source_md5 and v_live is distinct from r.own_md5 then");
    expect(raw).toContain("a later definer exists; re-emit from it. Refusing.");
    expect(raw.match(/regexp_replace\(p\.prosrc, '\[\^\\x21-\\x7E\]\+', '', 'g'\)/g)?.length).toBe(2);
  });
});

describe("0315 SQL harness (PGlite, the real files)", () => {
  it("reproduces the five bugs on the source bodies", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0315.mjs", "--against-source"], { encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("BEFORE 0315 B020: a blank BACK UP with a known LINE raises backup_unknown");
    expect(output).toContain("BEFORE 0315 B080: an Undo commits on a FINALIZED opening");
    expect(output).toContain("BEFORE 0315 B181: revoke updates the completion THEN locks the session");
    expect(output).toContain("BEFORE 0315 B182: a generic correction revokes an item-tracking tick");
    expect(output).toContain("BEFORE 0315 B078: opening_phase1_drafts has no revision and no ordered writer");
    expect(output).toContain("PASS 0315 --against-source:");
  }, 130_000);

  it("proves the fixed behaviour after 0315", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0315.mjs"], { encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("0315 guards: re-run is a no-op; catalog fingerprints equal the file; a later definer, a missing source and a database without 0305 refuse");
    expect(output).toContain("0315 ceilings: seven RPCs service_role only, postures and search_path kept, drafts table deny-all");
    expect(output).toContain("0315 B020: a blank BACK UP with a known LINE saves as 0; a blank LINE is still backup_unknown");
    expect(output).toContain("0315 B080/B181: instance lock first in save / revoke / finalize; session before completion; an Undo or a save after finalize is refused");
    expect(output).toContain("0315 B078: an older same-tab draft is refused; another tab, a NULL revision and a pre-0315 row keep last-write-wins");
    expect(output).toContain("0315 B182: an item-tracking tick refuses all three corrections; ordinary ticks, the 0287 order and the 0305 active-membership rule are unchanged");
    expect(output).toContain("PASS 0315:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 130_000);
});

/**
 * scripts/phase2-discipline-check.sh is the CI gate for a file that defines save_phase2_item_atomic
 * (no opening→closing auto-complete branch; the §8.4 twelve core fields; no 0050 blob). CI runs it
 * on 0056 and 0215. 0315 is the latest definer now, so the same two disciplines are held here,
 * reading the banned symbols and the core fields from the script itself (one list).
 */
describe("0315 holds the Phase 2 disciplines of scripts/phase2-discipline-check.sh", () => {
  const script = readFileSync("scripts/phase2-discipline-check.sh", "utf8");
  const list = (name: string) => {
    const block = script.slice(script.indexOf(`${name}=(`) + name.length + 2);
    return [...block.slice(0, block.indexOf("\n)")).matchAll(/^\s*"([^"]+)"\s*$/gm)].map((m) => m[1]!);
  };
  it("Discipline 1: no auto-complete branch symbol", () => {
    const banned = list("BANNED");
    expect(banned.length).toBeGreaterThanOrEqual(7);
    for (const symbol of banned) expect(raw, symbol).not.toContain(symbol);
  });
  it("Discipline 2: the twelve core §8.4 fields, and no 0050 blob signature", () => {
    const core = list("CORE_FIELDS");
    expect(core).toHaveLength(12);
    const save = extract(raw, "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", "$function$;");
    for (const field of core) expect(save, field).toContain(field);
    expect(raw).not.toContain("closerEstimateSnapshot");
    // The two provenance fields are kept as well (the canonical set is 14).
    expect(save).toContain("'saved_at', v_saved_at,");
    expect(save).toContain("'saved_by', p_actor_id");
  });
});
