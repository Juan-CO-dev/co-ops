/**
 * Migration 0359 (catering refund Part B1, REDESIGN v2: the Stripe mirror) pinned BY NAME. Plan PLAN-refundB1v2.md
 * sections 1, 2, 2.3, 10 and 15 (CC's build rulings T1-T9, S1-S12). CC applies sim then prod on Juan's word; nothing
 * here touches a database.
 *
 * STATIC (the SQL read as text, `--` comments stripped):
 *   1. the house header and gate line, one begin / commit, the only file numbered 0359;
 *   2. the row-count census: every UPDATE / INSERT / DELETE inside a function body is followed by GET DIAGNOSTICS ...
 *      ROW_COUNT before the next statement, or is in the NAMED allowlist below (each entry says why); no DELETE at all;
 *   3. no statement names catering_payments, catering_payment_refund_events, stripe_events, users or cron_route_leases
 *      as a write target;
 *   4. F6 raises nothing but invalid_request and the three named private conditions, and catches only CRB01 / CRB02
 *      (never `when others`; F4 is the one function allowed it);
 *   5. the lock order of every function ([S8]: actor -> payment rows -> state row), F13 / F17 never name a payment;
 *   6. the fingerprints written in the file are the real ones, computed here from the source files;
 *   7. no now() in any function body.
 * EXECUTABLE: scripts/sql-harness-0359.mjs (PGlite, the REAL 0357 -> 0358 -> 0359), every plan test by name.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NAME = "0359_catering_refund_mirror";
const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const sql = read(NAME);
const strip = (text: string) => text.replace(/--[^\n]*/g, "");
const code = strip(sql);
/** String literals emptied, so a `;` or a keyword inside a literal never decides a statement boundary. */
const unquote = (text: string) => text.replace(/'(?:[^']|'')*'/g, "''");

type Fn = { name: string; body: string };
/** Every function this file creates: its name and its body (the text Postgres stores as prosrc). */
const functions: Fn[] = [...code.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)]
  .map((m) => ({ name: m[1]!, body: m[2]! }));
const fn = (name: string) => {
  const f = functions.find((x) => x.name === name);
  if (!f) throw new Error(`function ${name} not found`);
  return f.body;
};
/** A body as its statements, in order (literals emptied, split on `;`). */
const statements = (body: string) => unquote(body).split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const house = (body: string) => md5(body.replace(/[^\x21-\x7E]+/g, ""));
const exact = (body: string) => md5(body.replace(/\s*[\r\n]+\s*/g, "\n").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""));
/** The body of `public.<name>(` as a source file defines it (its first CREATE). */
const sourceBody = (text: string, name: string) => {
  const at = text.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
  if (at < 0) throw new Error(`${name} not found`);
  const open = text.indexOf("$$", at);
  const close = text.indexOf("$$", open + 2);
  return text.slice(open + 2, close);
};

describe("0359 header and shape", () => {
  it("the house header and gate line, one transaction, the only 0359", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toBe("-- AUTHORED 2026-11-28 (refund Part B1, REDESIGN v2, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.");
    // An APPLIED stamp goes UNDER the gate line, never instead of it.
    const stamps = lines.slice(2, 6).filter((l) => /^-- APPLIED /.test(l));
    expect(stamps.every((l) => new RegExp(`^-- APPLIED TO (PROD|SIM) \\d{4}-\\d{2}-\\d{2}( UTC)? \\(schema_migrations version \\d{14}, name '${NAME}'\\)$`).test(l))).toBe(true);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    // The first statement after BEGIN is the one lock, taken once.
    const afterBegin = code.slice(code.indexOf("begin;") + 6).trim();
    expect(afterBegin.startsWith("lock table public.catering_refund_requests in access exclusive mode;")).toBe(true);
    expect(code.match(/\block table\b/g)).toHaveLength(1);
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0359_"))).toEqual([`${NAME}.sql`]);
  });

  it("creates the functions the plan names (section 2 + 15.2): 12 worker, 6 private + 5 constants, the guard", () => {
    expect(functions.map((f) => f.name).sort()).toEqual([
      "catering_refund_answer_matches", "catering_refund_arm", "catering_refund_attach", "catering_refund_cancel_unarmed",
      "catering_refund_claims", "catering_refund_dirty_at", "catering_refund_finish", "catering_refund_fresh_interval",
      "catering_refund_inventory", "catering_refund_liveness_interval", "catering_refund_observe_set", "catering_refund_parts_ready",
      "catering_refund_payment_figures", "catering_refund_read_begin", "catering_refund_read_max_age", "catering_refund_record_read",
      "catering_refund_release", "catering_refund_release_role", "catering_refund_requests_guard", "catering_refund_reread_interval",
      "catering_refund_reserve_fresh", "catering_refund_settle_interval", "catering_refund_summary", "catering_refund_sweep_begin",
      "catering_refund_sweep_due", "catering_refund_sweep_end",
    ]);
  });
});

/**
 * The census allowlist: every write inside a function body that does NOT read its row count, each named with why
 * zero rows cannot be "done" there. Keyed by function and the statement's first words.
 */
const UNCHECKED_ALLOWED: { fn: string; starts: RegExp; why: string }[] = [
  { fn: "catering_refund_read_begin", starts: /^insert into public\.catering_refund_payment_state as x .* on conflict \(payment_id\) do update/,
    why: "F5's unconditional upsert under the payment lock (plan F5: census allowlist): it inserts or updates the one row, or raises" },
  { fn: "catering_refund_record_read", starts: /^if s\.payment_id is null or s\.open_read_id is distinct from p_read_id then if s\.payment_id is not null then update public\.catering_refund_payment_state y set dirty_since = v_now/,
    why: "F6 step 2's dirty stamp [T2]: unconditional, under the payment lock and the state row's FOR UPDATE; the answer is read_replaced whatever it touched" },
  { fn: "catering_refund_reserve_fresh", starts: /^insert into public\.catering_refund_requests \(/,
    why: "F8's request insert under the payment locks: a plain INSERT ... RETURNING writes exactly one row or raises (the unique index included)" },
  { fn: "catering_refund_reserve_fresh", starts: /^insert into public\.audit_log/,
    why: "F8's destructive catering.refund.request audit row (0357's): a plain INSERT, one row or a raise" },
  { fn: "catering_refund_finish", starts: /^insert into public\.catering_refund_payment_state as x \(payment_id, dirty_since\) .* on conflict \(payment_id\) do update set dirty_since = excluded\.dirty_since/,
    why: "F10's unconditional dirty-stamp upsert under the payment lock (inserts or updates the one row, or raises)" },
  { fn: "catering_refund_release", starts: /^insert into public\.audit_log/,
    why: "F12's destructive catering.refund.release audit row, written only after the request UPDATE read row count 1" },
  { fn: "catering_refund_attach", starts: /^insert into public\.audit_log/,
    why: "F16's destructive catering.refund.attach audit row, written only after both UPDATEs read row count 1" },
];
const WRITE = /\b(update\s+public\.\w+|insert\s+into\s+public\.\w+|delete\s+from)\b/i;

describe("the row-count census (plan 2.3)", () => {
  const unchecked: { fn: string; stmt: string }[] = [];
  let writes = 0;
  for (const f of functions) {
    const st = statements(f.body);
    st.forEach((s, i) => {
      if (!WRITE.test(s)) return;
      writes++;
      if (/^get diagnostics \w+ = row_count$/i.test(st[i + 1] ?? "")) return;
      unchecked.push({ fn: f.name, stmt: s });
    });
  }

  it("every write in a function body reads its row count, or is a NAMED allowlist entry; no entry is stale", () => {
    expect(writes).toBeGreaterThan(25);
    for (const u of unchecked) {
      const hits = UNCHECKED_ALLOWED.filter((a) => a.fn === u.fn && a.starts.test(u.stmt));
      expect(hits, `${u.fn}: ${u.stmt.slice(0, 160)}`).toHaveLength(1);
    }
    for (const a of UNCHECKED_ALLOWED) {
      expect(unchecked.filter((u) => u.fn === a.fn && a.starts.test(u.stmt)), `allowlist entry ${a.fn} ${a.starts}`).toHaveLength(1);
      expect(a.why.length).toBeGreaterThan(40);
    }
    expect(unchecked).toHaveLength(UNCHECKED_ALLOWED.length);
  });

  it("the conditional writes the plan names DO read their row count (F6, F9, F10, F11, F12, F13, F16, F17, F18)", () => {
    const counted = (name: string) => {
      const st = statements(fn(name));
      return st.filter((s, i) => WRITE.test(s) && /^get diagnostics \w+ = row_count$/i.test(st[i + 1] ?? "")).length;
    };
    // F6: insert-or-nothing, the guarded update, the not-complete stamp, the complete stamp, the bind's two, the link.
    expect(counted("catering_refund_record_read")).toBe(7);
    expect(counted("catering_refund_arm")).toBe(2);
    expect(counted("catering_refund_finish")).toBe(4);
    expect(counted("catering_refund_cancel_unarmed")).toBe(1);
    expect(counted("catering_refund_release")).toBe(1);
    expect(counted("catering_refund_attach")).toBe(2);
    expect(counted("catering_refund_sweep_begin")).toBe(2);
    expect(counted("catering_refund_observe_set")).toBe(2);
    expect(counted("catering_refund_sweep_end")).toBe(1);
  });

  it("no DELETE and no TRUNCATE exists anywhere in the file", () => {
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
  });
});

describe("B1 never writes main's tables (D1, [Q5], [T7])", () => {
  it("no statement names catering_payments, the refund events, the ledger, users or cron_route_leases as a write target", () => {
    const target = /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table(?:\s+only)?|lock\s+table|grant\s+[\w, ]+\s+on(?:\s+table)?|revoke\s+[\w, ]+\s+on(?:\s+table)?|create\s+(?:or\s+replace\s+)?(?:trigger|policy|index)\s+\w+\s+on)\s+(?:public\.)?(catering_payments|catering_payment_refund_events|stripe_events|users|cron_route_leases)\b/gi;
    expect([...code.matchAll(target)].map((m) => m[0])).toEqual([]);
    // The only things naming them are the reads and the three foreign keys of B1's own tables / columns.
    expect([...code.matchAll(/references public\.(catering_payments|users)\(id\)/g)].map((m) => m[1]).sort()).toEqual(["catering_payments", "catering_payments", "users"]);
  });

  it("the permitted audit_log appends are exactly the three named ones (F8, F12, F16)", () => {
    const appends = functions.filter((f) => /insert into public\.audit_log/.test(f.body)).map((f) => f.name).sort();
    expect(appends).toEqual(["catering_refund_attach", "catering_refund_release", "catering_refund_reserve_fresh"]);
    expect(code.match(/'catering\.refund\.(request|release|attach)'/g)?.sort()).toEqual(["'catering.refund.attach'", "'catering.refund.release'", "'catering.refund.request'"]);
  });
});

describe("F6 never raises for evidence ([R3], [S12])", () => {
  const body = fn("catering_refund_record_read");

  it("its raises are invalid_request and the three named private conditions only", () => {
    const raises = [...body.matchAll(/raise exception ([^;]*);/g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    expect(raises).toEqual([
      "'invalid_request' using errcode = 'P0001'",
      "using errcode = 'CRB01', message = 'refund_under_another_payment'",
      "using errcode = 'CRB02', message = 'read_contested'",
      "using errcode = 'CRB01', message = 'refund_under_another_payment'",
      "using errcode = 'CRB02', message = 'read_contested'",
      "using errcode = 'CRB03', message = 'refund_bind_defect'",
    ]);
    expect(body).not.toMatch(/\braise\s+(notice|warning|info|log|debug)\b/i);
  });

  it("its one handler catches only sqlstate CRB01 and CRB02, never `when others`", () => {
    const handlers = [...body.matchAll(/\bwhen\s+(sqlstate\s+'[A-Z0-9]+'|others|[a-z_]+)\s+then/gi)].map((m) => m[1]!.replace(/\s+/g, " "));
    expect(handlers).toEqual(["sqlstate 'CRB01'", "sqlstate 'CRB02'"]);
    expect(body.match(/\bexception\b\s*\n\s*when/g)).toHaveLength(1);
  });

  it("F4 catering_refund_parts_ready is the ONE function with a `when others`", () => {
    expect(functions.filter((f) => /\bwhen\s+others\b/i.test(f.body)).map((f) => f.name)).toEqual(["catering_refund_parts_ready"]);
    expect(code.match(/\bwhen\s+others\b/gi)).toHaveLength(1);
  });
});

describe("the lock order of every function (plan 2.3 as re-stated by [S8])", () => {
  const at = (body: string, re: RegExp) => { const st = statements(body); return st.findIndex((s) => re.test(s)); };
  const PAYMENT_LOCK = /public\.catering_payments p where .* for no key update$/;
  const STATE_LOCK = /from public\.catering_refund_payment_state \w+ where .* for update$/;
  const ACTOR = /catering_refund_actor_ok\(|catering_refund_release_role\(/;
  const LOCKERS = ["catering_refund_read_begin", "catering_refund_record_read", "catering_refund_reserve_fresh", "catering_refund_arm",
    "catering_refund_finish", "catering_refund_cancel_unarmed", "catering_refund_release", "catering_refund_attach"];

  it("every function that takes a payment lock takes it FOR NO KEY UPDATE before any state-row FOR UPDATE", () => {
    const withPaymentLock = functions.filter((f) => at(f.body, PAYMENT_LOCK) >= 0).map((f) => f.name).sort();
    expect(withPaymentLock).toEqual([...LOCKERS].sort());
    for (const f of functions) {
      const p = at(f.body, PAYMENT_LOCK);
      const s = at(f.body, STATE_LOCK);
      if (s >= 0) expect(p, `${f.name}: a state-row lock needs the payment lock first`).toBeGreaterThanOrEqual(0);
      if (s >= 0) expect(p, `${f.name}: payment lock before the state row`).toBeLessThan(s);
      // No lock on main's payment row in any other mode.
      expect(statements(f.body).filter((x) => /public\.catering_payments\b.*\bfor (update|share|key share)$/.test(x)), f.name).toEqual([]);
    }
  });

  it("F8, F12 and F16 read the actor (users FOR SHARE) before the payment lock", () => {
    for (const name of ["catering_refund_reserve_fresh", "catering_refund_release", "catering_refund_attach"]) {
      const a = at(fn(name), ACTOR);
      expect(a, name).toBeGreaterThanOrEqual(0);
      expect(a, name).toBeLessThan(at(fn(name), PAYMENT_LOCK));
    }
    expect(fn("catering_refund_release_role")).toMatch(/from public\.users u where u\.id = p_actor_id and u\.active for share;/);
  });

  it("F9 notes the clock at entry, takes the payment lock and THEN the state row FOR UPDATE before its first check, and reads the clock after both [S8]", () => {
    const body = fn("catering_refund_arm");
    expect(body).toMatch(/v_t0 timestamptz := clock_timestamp\(\);/);
    const st = statements(body);
    const p = st.findIndex((s) => PAYMENT_LOCK.test(s));
    const s = st.findIndex((x) => STATE_LOCK.test(x));
    const clock = st.findIndex((x, i) => i > s && /^v_now := clock_timestamp\(\)$/.test(x));
    const firstCheck = st.findIndex((x) => /^if r\.status <> '' or r\.create_armed_at is not null then/.test(x));
    expect(p).toBeGreaterThan(-1);
    expect(p).toBeLessThan(s);
    expect(clock).toBe(s + 1);
    expect(firstCheck).toBeGreaterThan(clock);
    // The only earlier answer is `not_found` (no row: no lock to take).
    const before = st.slice(0, p).filter((x) => /return jsonb_build_object/.test(x));
    expect(before).toHaveLength(1);
    expect(unquote(body)).toContain("if v_now - v_t0 >= v_wait * interval '' then");
  });

  it("F6, F10, F12 and F16 lock the state row after the payment; F11 locks the payment only", () => {
    for (const name of ["catering_refund_record_read", "catering_refund_finish", "catering_refund_release", "catering_refund_attach", "catering_refund_read_begin"]) {
      expect(at(fn(name), STATE_LOCK), name).toBeGreaterThan(at(fn(name), PAYMENT_LOCK));
    }
    expect(at(fn("catering_refund_cancel_unarmed"), STATE_LOCK)).toBe(-1);
  });

  it("F13 and F17 never name catering_payments; they lock the observation row first", () => {
    for (const name of ["catering_refund_sweep_begin", "catering_refund_observe_set"]) {
      expect(fn(name), name).not.toMatch(/catering_payments/);
      const st = statements(fn(name));
      const obs = st.findIndex((s) => /from public\.catering_refund_observation x where x\.id for update$/.test(s));
      const firstWrite = st.findIndex((s) => WRITE.test(s));
      expect(obs, name).toBeGreaterThanOrEqual(0);
      expect(obs, name).toBeLessThan(firstWrite);
    }
  });
});

describe("the fingerprints written in the file are the real ones", () => {
  const sources: [string, string, string, string][] = [
    // [signature as the file writes it, source file, function name, source label]
    ["catering_refund_requests_guard()", "0357_catering_refund_requests", "catering_refund_requests_guard", "0357"],
    ["catering_refund_figures(uuid)", "0357_catering_refund_requests", "catering_refund_figures", "0357"],
    ["catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)", "0357_catering_refund_requests", "catering_refund_record_snapshot", "0357"],
    ["catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)", "0357_catering_refund_requests", "catering_refund_reserve", "0357"],
    ["catering_refund_claim(uuid)", "0357_catering_refund_requests", "catering_refund_claim", "0357"],
    ["catering_refund_actor_ok(uuid, uuid)", "0358_catering_refund_roles", "catering_refund_actor_ok", "0358"],
    ["claim_cron_route(text)", "0343_demand_signal_sources", "claim_cron_route", "0343"],
  ];

  it("the pre-flight's two values for every body it relies on are its source file's (house and exact)", () => {
    for (const [sig, file, name, src] of sources) {
      const body = sourceBody(read(file), name);
      const row = new RegExp(`\\('${sig.replace(/[()[\]]/g, "\\$&")}',\\s+'${house(body)}', '${exact(body)}', '${src}'\\)`);
      expect(sql, `${sig}: house ${house(body)} exact ${exact(body)}`).toMatch(row);
    }
  });

  it("the guard written (this file's body) is the pair the assertion block compares, and differs from 0357's", () => {
    // prosrc is the RAW body, comments included: read it from the file as written.
    const mine = sourceBody(sql, "catering_refund_requests_guard");
    const theirs = sourceBody(read("0357_catering_refund_requests"), "catering_refund_requests_guard");
    expect(sql).toContain(`<> '${house(mine)}'`);
    expect(sql).toContain(`<> '${exact(mine)}'`);
    expect(house(mine)).not.toBe(house(theirs));
    // 0357's body is a prefix of this file's, line for line, up to the write-once rules it adds.
    const t = theirs.trimEnd().split("\n");
    const m = mine.split("\n");
    expect(m.slice(0, t.length - 2)).toEqual(t.slice(0, t.length - 2));
  });

  it("0358's actor rule, unchanged, is asserted by its house value", () => {
    const body = sourceBody(read("0358_catering_refund_roles"), "catering_refund_actor_ok");
    expect(sql).toContain(`'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure) <> '${house(body)}' then`);
  });
});

describe("time is the database's clock_timestamp() (plan 2, [P3-6])", () => {
  it("no now() call in any 0359 function body", () => {
    for (const f of functions) expect(unquote(f.body), f.name).not.toMatch(/\bnow\s*\(\s*\)/i);
    expect(functions.filter((f) => /clock_timestamp\(\)/.test(f.body)).length).toBeGreaterThan(12);
  });
});

/** Every test the plan names in section 10's four "H" blocks and section 15.3, plus the twin check: the harness's groups. */
const PLAN_TESTS = [
  // H — install and OFF
  "install_shape", "stale_sender_is_refused", "operator_statement_is_owner_only", "preflight_refusals", "legacy_attempted_rows_are_armed",
  "mains_tables_carry_only_the_named_foreign_keys", "mains_payment_writes_are_unchanged_by_the_foreign_keys", "cron_lease_objects_are_untouched",
  "mains_ledger_insert_is_untouched", "b1_never_writes_mains_tables",
  // H — reads, dirty, known
  "read_begin_opens_the_read_with_the_databases_clock_and_no_token", "only_the_open_read_can_record",
  "a_read_opened_and_never_recorded_takes_the_figures_away_after_15_minutes", "read_too_old_is_recorded_as_not_complete",
  "complete_read_makes_a_never_read_payment_known_after_the_settle_interval", "first_read_that_fails_is_recorded_and_a_later_success_says_complete",
  "complete_needs_both_terminal_lists_and_every_id", "the_charges_refunded_amount_is_not_part_of_any_decision",
  "a_read_that_does_not_end_complete_takes_the_figures_away", "a_refund_id_under_two_payments_marks_dirty_and_commits",
  "evidence_mismatch_writes_nothing", "refund_without_a_payment_intent_needs_the_owner_charge", "dirty_is_read_from_the_ledger_in_every_shape",
  "the_ledger_window_is_the_reads_own", "a_ledger_that_cannot_prove_coverage_reads_dirty", "known_needs_five_minutes_after_the_dirty_instant",
  "every_turn_on_invalidates_every_payment", "a_flip_between_two_ticks_is_detected", "liveness_is_measured_from_the_claim",
  "the_sweep_does_nothing_until_on_is_recorded", "figures_are_stripes_truth_or_nothing", "every_refund_is_counted_once_whatever_it_claims",
  "status_disagreement_is_reported_never_written",
  // H — the send
  "gate_b2_b3_in_the_database", "probe_writes_nothing_and_replays_scoped", "reserve_needs_this_requests_tokens",
  "a_stale_reserve_call_still_replays_under_the_lock", "reserve_refuses_a_figure_the_person_did_not_see", "reserve_allocates_and_audits_as_0357",
  "allocation_never_touches_an_ineligible_payment", "duplicate_tap_returns_the_original_request", "one_unresolved_request_per_payment",
  "arm_is_write_once", "arm_rechecks_freshness_under_the_lock", "arm_refuses_after_a_long_lock_wait", "arm_and_cancel_exactly_one_wins",
  "not_armable_names_the_rows_real_state", "finish_created_binds_only_a_matching_answer", "finish_after_a_read_bound_the_same_refund_is_created",
  "finish_unconfirmed_after_a_read_bound_it_says_so", "finish_with_another_refund_is_a_conflict", "finish_after_release_changes_nothing_and_says_so",
  "unconfirmed_stays_reserved_and_blocks", "read_binds_only_the_unique_candidate_of_a_complete_read",
  "claims_that_do_not_match_are_counted_never_bound_and_block_nothing", "attach_binds_a_retrieved_refund_and_sends_nothing",
  "two_candidates_are_resolved_by_attach_not_release",
  "release_needs_24_hours_a_token_read_after_them_a_release_role_the_right_account_and_a_releasable_finding",
  "bind_and_release_in_both_orders", "released_then_the_refund_appears", "attach_and_finish_in_both_orders", "crash_after_reserve_is_cancelled_by_the_sweep",
  // H — sweep and inventory
  "sweep_begin_is_the_one_claim_and_the_work_list", "sweep_due_classes", "sweep_due_reads_the_ledger_once", "inventory_counts_and_lists",
  "sweep_due_agrees_with_figures",
  // H — section 15.3
  "t1_strict_arm_time_never_binds_a_pre_arm_refund", "t1_attach_has_no_time_condition", "t2_a_replaced_read_marks_dirty",
  "t3_reread_is_hourly_inside_120_days", "t4_never_read_payment_waits_after_turn_on_and_resume", "t5_credential_fingerprint_at_arm",
  "t6_pass_end_stamp", "s7_conflict_with_is_stored", "s8_arm_waits_on_the_state_row_inside_its_budget", "s9_finish_same_refund_is_verified",
  "s12_live_at_5959_paused_at_6000", "f10_closed_and_not_armed", "f5_on_an_ineligible_payment_writes_nothing",
];

describe("the executable proof", () => {
  const harness = readFileSync("scripts/sql-harness-0359.mjs", "utf8");

  it("the harness registers every plan test by name, once, and nothing else", () => {
    const registered = [...harness.matchAll(/^await group\("([a-z0-9_]+)"/gm)].map((m) => m[1]);
    expect([...registered].sort()).toEqual([...PLAN_TESTS].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("scripts/sql-harness-0359.mjs (PGlite, the REAL 0357 -> 0358 -> 0359) runs green, every group by name", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0359.mjs"], { encoding: "utf8", timeout: 1_500_000, maxBuffer: 64 * 1024 * 1024 });
    expect(out).not.toContain("FAIL ");
    expect(out).toMatch(/^PASS 0359: \d+ checks in 80 groups/m);
    for (const name of PLAN_TESTS) expect(out, name).toMatch(new RegExp(`^ok   GROUP ${name} \\(\\d+ checks`, "m"));
  }, 1_600_000);
});
