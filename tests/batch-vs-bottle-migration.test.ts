/**
 * Unit spine — migration 0215 (batch vs bottle, Phase A) is a faithful re-emission.
 *
 * 0215 redefines eight RPCs. Every one of them was built MECHANICALLY from its latest
 * definer: the source body, plus exact-anchor INSERTIONS, plus an enumerated list of
 * MODIFIED lines (the `*_MODS` tables below, one `[old, new]` pair each). The proof that
 * nothing was dropped is therefore mechanical too: apply the same MODS to the same source
 * and assert the result is a line-SUBSEQUENCE of the emitted body. Any line of 0185 / 0060 /
 * 0063 / 0056 / 0199 / 0197 / 0187 that went missing fails here by name (GO correction 5).
 *
 * The rest pins the batch contract the build GO asked for: eligibility derived inside both
 * save RPCs (ruling 2), the 0056:184 NULL-refusal idiom on batches / came_out_to / the Other
 * note (ruling G), the over-batch gate on BOTH surfaces (addendum 2), the session upsert
 * that never rewrites produced_at / made_by and moves tossed_at / tossed_by only with the
 * quantity (corrections 1, 3), the instance-bound session (correction 4), the revoke RPC that
 * retracts by SESSION KEY (correction 1), the deny-all posture and the grants.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (f: string) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").replace(/\r\n/g, "\n");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const file0215 = files.find((f) => /^0215_batch_vs_bottle\.sql$/.test(f));
expect(file0215, "0215_batch_vs_bottle.sql must exist").toBeDefined();
const src0215 = read(file0215!);

function extract(src: string, start: string, endMarker: string): string {
  const a = src.indexOf(start);
  expect(a, `function start not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(endMarker, a);
  expect(b, `function end not found after: ${start}`).toBeGreaterThan(a);
  return src.slice(a, b + endMarker.length);
}

/** The LAST migration that (re)defines `start`, and its body. */
function latestDefiner(start: string, endMarker: string): { file: string; body: string } {
  const defining = files.filter((f) => read(f).includes(start));
  expect(defining.length, `no definer for ${start}`).toBeGreaterThan(0);
  const file = defining[defining.length - 1]!;
  return { file, body: extract(read(file), start, endMarker) };
}

function applyMods(text: string, mods: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [oldText, newText] of mods) {
    expect(out.split(oldText).length - 1, `mod anchor must occur exactly once: ${oldText.slice(0, 70)}`).toBe(1);
    out = out.replace(oldText, newText);
  }
  return out;
}

/** Every line of `needle` appears, in order, in `hay` (right-trimmed, blank lines ignored). */
function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null; at: number } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (let i = 0; i < n.length; i++) {
    while (j < h.length && h[j] !== n[i]) j++;
    if (j >= h.length) return { ok: false, missing: n[i]!, at: i };
    j++;
  }
  return { ok: true, missing: null, at: -1 };
}

// ── The enumerated modifications (mirrors the generator; reviewers read THIS list) ────────
const P2_MODS = [
  [`  p_user_agent text DEFAULT NULL
)
RETURNS jsonb`, `  p_user_agent text DEFAULT NULL,
  p_batch jsonb DEFAULT NULL
)
RETURNS jsonb`],
  [`    IF v_delta > 0 AND (p_over_par IS NULL OR p_over_par = 'null'::jsonb) THEN`,
   `    IF NOT v_is_batch AND v_delta > 0 AND (p_over_par IS NULL OR p_over_par = 'null'::jsonb) THEN`],
] as const;
const MD2_MODS = [
  [`  p_over_under jsonb DEFAULT NULL
)
RETURNS jsonb`, `  p_over_under jsonb DEFAULT NULL,
  p_batch jsonb DEFAULT NULL
)
RETURNS jsonb`],
] as const;
const FIN_MODS = [
  [`    v_prep_need          := NULLIF(v_phase1->>'prep_need', '')::numeric;`,
   `    -- 0215 batch-vs-bottle: a batch row's delta is measured against its LINE need (plan S §2.4).
    v_prep_need          := COALESCE(NULLIF(v_phase2->'batch'->>'need_for_line', '')::numeric, NULLIF(v_phase1->>'prep_need', '')::numeric);`],
] as const;
const CRF_MODS = [
  [`  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)`,
   `  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by, batch_mode, shelf_life_days)`],
  [`    nullif(p_header->>'directions_es',''), true, p_created_by
  ) returning id into v_recipe_id;`,
   `    nullif(p_header->>'directions_es',''), true, p_created_by,
    coalesce((p_header->>'batch_mode')::boolean, false), coalesce((p_header->>'shelf_life_days')::integer, 5)
  ) returning id into v_recipe_id;`],
] as const;
const ARO_MODS = [
  [`declare v_id uuid; v_order integer; v_clash uuid;
begin
  -- Same scope as the app check: the single-producer rule is about ITEMS only, so a`,
   `declare v_id uuid; v_order integer; v_clash uuid; v_batch_mode boolean;
begin
  -- 0215 batch-vs-bottle (ruling H): serialise EVERY output mutation on the recipe row, and a
  -- batch_mode recipe never gets a second output. The row lock is the serialisation point; the
  -- 0187 per-item advisory lock below still guards the one-active-producer rule.
  select r.batch_mode into v_batch_mode from recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if coalesce(v_batch_mode, false) and exists (select 1 from recipe_outputs ro where ro.recipe_id = p_recipe_id) then
    raise exception 'batch_mode_single_output'
      using errcode = 'P0001',
            detail  = 'a batch_mode recipe already has its one output';
  end if;
  -- Same scope as the app check: the single-producer rule is about ITEMS only, so a`],
] as const;

interface Reemit {
  name: string;
  sourceFile: string;
  start: string;
  end: string;
  mods: ReadonlyArray<readonly [string, string]>;
}
const REEMITS: Reemit[] = [
  { name: "submit_phase1_atomic", sourceFile: "0185_phase1_chain_edit_supersede.sql", start: "CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(", end: "$function$;", mods: [] },
  { name: "submit_mid_day_phase1_atomic", sourceFile: "0060_create_submit_mid_day_phase1_atomic_rpc.sql", start: "CREATE OR REPLACE FUNCTION public.submit_mid_day_phase1_atomic(", end: "$function$;", mods: [] },
  { name: "create_opening_instance_atomic", sourceFile: "0063_fix_opening_instance_create_onconflict.sql", start: "CREATE OR REPLACE FUNCTION public.create_opening_instance_atomic(", end: "$function$;", mods: [] },
  { name: "save_phase2_item_atomic", sourceFile: "0056_create_submit_phase2_atomic_rpc.sql", start: "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", end: "$function$;", mods: P2_MODS },
  { name: "save_mid_day_phase2_item_atomic", sourceFile: "0199_mid_day_phase2_supersede_before_insert.sql", start: "CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(", end: "$function$;", mods: MD2_MODS },
  { name: "submit_phase2_atomic", sourceFile: "0197_submit_phase2_universe_active_only.sql", start: "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(", end: "$function$;", mods: FIN_MODS },
  { name: "create_recipe_full", sourceFile: "0187_one_active_producer_backstop.sql", start: "create or replace function create_recipe_full(", end: "end $$;", mods: CRF_MODS },
  { name: "add_recipe_output", sourceFile: "0187_one_active_producer_backstop.sql", start: "create or replace function add_recipe_output(", end: "end $$;", mods: ARO_MODS },
];

describe("0215 re-emits every RPC from its latest definer — nothing dropped (GO correction 5)", () => {
  for (const r of REEMITS) {
    it(`${r.name}: 0215 is now the latest definer and the ${r.sourceFile} body (± enumerated mods) is a line-subsequence of it`, () => {
      const latest = latestDefiner(r.start, r.end);
      expect(latest.file).toBe(file0215);
      const source = applyMods(extract(read(r.sourceFile), r.start, r.end), r.mods);
      const emitted = extract(src0215, r.start, r.end);
      const check = isLineSubsequence(source, emitted);
      expect(check.ok, `${r.name}: source line #${check.at} missing from 0215 → ${check.missing}`).toBe(true);
      // The source really was the PREVIOUS latest definer (we did not re-emit from a stale copy).
      const before0215 = files.filter((f) => f < file0215! && read(f).includes(r.start));
      expect(before0215[before0215.length - 1]).toBe(r.sourceFile);
    });
  }

  it("submit_phase1_atomic keeps BOTH 0185 branches and its three chain-edit blocks", () => {
    const body = extract(src0215, "CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(", "$function$;");
    expect(body).toContain("IF NOT p_is_update THEN");
    expect(body).toContain("C.46 CHAIN-EDIT PATH");
    expect(body).toContain("v_superseded_completion_id uuid;");
    expect(body).toContain("RETURNING id INTO v_superseded_completion_id;");
    expect(body).toContain("SET superseded_by = v_completion_id");
    // The two-box recount landed on BOTH branches.
    expect(body.split("recount_split_required").length - 1).toBe(2);
    expect(body.split("'opener_recount_line', v_recount_line").length - 1).toBe(2);
    expect(body).toContain("v_opener_recount := v_recount_line + v_recount_back_up;");
  });

  it("submit_mid_day_phase1_atomic validates the LINE + BACK UP pair and derives the COUNT total in SQL (ruling 4)", () => {
    const body = extract(src0215, "CREATE OR REPLACE FUNCTION public.submit_mid_day_phase1_atomic(", "$function$;");
    expect(body).toContain("mid_day_backup_required");
    expect(body).toContain("mid_day_count_negative");
    expect(body).toContain("jsonb_build_object('total', v_on_hand + v_back_up)");
    // 0060's own INSERT line is untouched: non-batch items store exactly what they always did.
    expect(body).toContain("jsonb_build_object('inputs', v_entry->'inputs', 'snapshot', v_entry->'snapshot')");
  });
});

describe("0215 — the batch contract inside BOTH save RPCs", () => {
  const opening = extract(src0215, "CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(", "$function$;");
  const midday = extract(src0215, "CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(", "$function$;");
  const both: Array<[string, string]> = [["opening", opening], ["mid-day", midday]];

  it.each(both)("%s: eligibility is derived from the item/recipe and the payload cannot opt out or in (ruling 2)", (_n, body) => {
    expect(body).toContain("FROM public.prep_batch_context(p_template_item_id) c;");
    expect(body).toContain("batch_payload_required");
    expect(body).toContain("batch_payload_not_allowed");
    expect(body).toContain("batch_recipe_unresolved");
  });

  it.each(both)("%s: a batch_mode recipe that is NOT eligible is refused BEFORE payload dispatch (Astra P1 #4)", (_n, body) => {
    expect(body).toContain("SELECT c.item_id, c.recipe_id, c.output_count, c.yield, c.is_batch, c.batch_mode");
    const backstopAt = body.indexOf("IF v_batch_mode AND NOT v_is_batch THEN");
    const requiredAt = body.indexOf("batch_payload_required");
    expect(backstopAt).toBeGreaterThan(-1);
    expect(backstopAt).toBeLessThan(requiredAt);
    // The raise in that block names the contract code.
    expect(body.slice(backstopAt, backstopAt + 400)).toContain("batch_recipe_unresolved");
  });

  it.each(both)("%s: the prior toss is read under the row lock and the session facts ride back (Astra P2 #6/#7)", (_n, body) => {
    const prevAt = body.indexOf("SELECT s.tossed_qty INTO v_prev_toss");
    const insertAt = body.indexOf("INSERT INTO prep_batch_sessions");
    expect(prevAt).toBeGreaterThan(-1);
    expect(prevAt).toBeLessThan(insertAt);
    expect(body.slice(prevAt, insertAt)).toContain("FOR UPDATE;");
    for (const k of ["'tossPrevious'", "'tossCurrent'", "'producedAt'", "'madeBy'"]) expect(body).toContain(k);
    // The batch RETURN is an INSERTION before the source RETURN (a single-box save answers as before).
    const batchReturnAt = body.indexOf("'tossPrevious', COALESCE(v_prev_toss, 0)");
    const sourceReturnAt = body.lastIndexOf("RETURN jsonb_build_object(");
    expect(batchReturnAt).toBeGreaterThan(-1);
    expect(batchReturnAt).toBeLessThan(sourceReturnAt);
    expect(body.slice(0, batchReturnAt)).toMatch(/IF v_is_batch THEN\s*RETURN jsonb_build_object\(\s*$/m);
  });

  it.each(both)("%s: batches, came_out_to and the Other note are NULL-refused with the 0056:184 idiom (ruling G)", (_n, body) => {
    expect(body).toContain("p_batch->'batches' IS NULL OR p_batch->'batches' = 'null'::jsonb");
    expect(body).toContain("p_batch->'came_out_to' IS NULL OR p_batch->'came_out_to' = 'null'::jsonb");
    expect(body).toContain("over_batch_note_required");
    expect(body).toContain("v_b_reason->'note' IS NULL OR v_b_reason->'note' = 'null'::jsonb");
    expect(body).toContain("'^[0-9]+$'"); // whole batches only
  });

  it.each(both)("%s: ruling B arithmetic and the over-batch gate from the four-code list (addendum 2)", (_n, body) => {
    expect(body).toContain("v_available := v_backup_before - v_b_tossed + v_b_came_out;");
    expect(body).toContain("bottled_exceeds_available");
    expect(body).toContain("tossed_exceeds_backup");
    expect(body).toContain("NOT IN ('catering_order', 'busy_day_expected', 'prepping_ahead', 'other')");
    expect(body).toContain("v_b_batches > v_min_batches AND v_b_reason_code IS NULL");
    expect(body).toContain("over_batch_reason_missing");
  });

  it.each(both)("%s: the session upsert never rewrites produced_at / made_by and moves tossed_at / tossed_by only with the qty (corrections 1, 3)", (_n, body) => {
    const upsertAt = body.indexOf("INSERT INTO prep_batch_sessions");
    expect(upsertAt).toBeGreaterThan(-1);
    const setList = body.slice(body.indexOf("ON CONFLICT (instance_id, template_item_id) DO UPDATE SET", upsertAt), body.indexOf("RETURNING prep_batch_sessions.produced_at", upsertAt));
    expect(setList).not.toMatch(/\bproduced_at\s*=/);
    expect(setList).not.toMatch(/\bmade_by\s*=/);
    expect(setList).toContain("THEN v_saved_at ELSE prep_batch_sessions.tossed_at END");
    expect(setList).toContain("THEN p_actor_id ELSE prep_batch_sessions.tossed_by END");
  });

  it.each(both)("%s: the session is bound to the authorized instance and its template (correction 4)", (_n, body) => {
    expect(body).toContain("SELECT ci.location_id, ci.date, ci.template_id");
    expect(body).toContain("WHERE cti.id = p_template_item_id AND cti.template_id = v_template_id;");
    expect(body).toContain("template_item_not_in_instance");
    // The session row takes location + date from THOSE reads, never from the payload.
    expect(body).toMatch(/VALUES \(\s*p_(opening_)?instance_id, p_template_item_id, v_location_id, v_item_id, v_business_date/);
  });

  it("opening: the batch object rides BESIDE the 14 §8.4 fields and the over-PREP gate is skipped only for batch rows", () => {
    for (const f of ["'opener_prepped'", "'delta_vs_prep_need'", "'over_under_status'", "'saved_at'", "'saved_by'"]) expect(opening).toContain(f);
    expect(opening).toContain("v_prep_data_phase2 := v_prep_data_phase2 || jsonb_build_object('batch', v_batch_record);");
    expect(opening).toContain("IF NOT v_is_batch AND v_delta > 0");
    // The under gate is untouched.
    expect(opening).toContain("IF v_delta < 0 AND (p_under_par IS NULL OR p_under_par = 'null'::jsonb) THEN");
  });

  it("mid-day: the batch object is a SIBLING key written after the 0199 insert; the code never names 'phase2'", () => {
    expect(midday).toContain("SET prep_data = prep_data || jsonb_build_object('batch', v_batch_record)");
    expect(midday.replace(/--[^\n]*/g, "")).not.toMatch(/'phase2'/);
  });
});

describe("0215 — revoke retracts the toss by SESSION KEY (correction 1)", () => {
  const body = extract(src0215, "create or replace function public.revoke_phase2_item_atomic(", "$function$;");
  it("performs the completion revoke with the lib's exact predicates, then zeroes the session's toss by (instance_id, template_item_id)", () => {
    expect(body).toContain("and cc.revoked_at is null");
    expect(body).toContain("and cc.superseded_at is null");
    expect(body).toContain("revoke_conflict");
    expect(body).toContain("where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id");
    expect(body).toContain("set tossed_qty = 0");
    // Nothing in the revoke reads the completion's JSON shape to decide.
    expect(body).not.toMatch(/prep_data->/);
    // produced_at / made_by are untouched by revoke.
    expect(body).not.toMatch(/produced_at\s*=/);
    expect(body).not.toMatch(/made_by\s*=/);
  });
});

describe("0215 — update_recipe_atomic (Astra P2 #8): lock, validate, ONE update", () => {
  const body = extract(src0215, "create or replace function public.update_recipe_atomic(", "$$;");
  it("locks the recipe row first, validates the patch and the toggle, then writes once", () => {
    const lockAt = body.indexOf("for update;");
    const checkAt = body.indexOf("batch_mode_single_output");
    const updateAt = body.indexOf("update recipes set");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(checkAt);
    expect(checkAt).toBeLessThan(updateAt);
    expect(body.split("update recipes set").length - 1).toBe(1);
    expect(body).toContain("invalid_shelf_life_days");
    expect(body).toContain("batch_mode      = case when p_batch_mode is null then batch_mode else p_batch_mode end");
  });
});

describe("0215 — schema, posture and grants", () => {
  it("adds the three column sets with their comments and the pre-flight guard", () => {
    expect(src0215).toContain("add column batch_mode boolean not null default false");
    expect(src0215).toContain("add column shelf_life_days integer not null default 5 check (shelf_life_days > 0)");
    expect(src0215).toContain("add column line_count numeric null");
    expect(src0215).toContain("add column back_up_count numeric null");
    for (const c of ["batches_made", "came_out_to", "yield_at_time", "made_by"]) expect(src0215).toContain(`add column ${c}`);
    expect(src0215).toContain("0215 pre-flight: recipes.batch_mode already exists");
  });

  it("prep_batch_sessions is keyed on the Phase 2 row, deny-all, no policies, no triggers anywhere", () => {
    expect(src0215).toContain("primary key (instance_id, template_item_id)");
    expect(src0215).toContain("alter table public.prep_batch_sessions enable row level security;");
    expect(src0215).toContain("revoke all on public.prep_batch_sessions from anon, authenticated;");
    expect(src0215).toContain("revoke all on public.prep_batch_sessions from public;");
    expect(src0215).not.toMatch(/create policy/i);
    expect(src0215).not.toMatch(/create trigger/i);
    expect(src0215).not.toMatch(/for all/i);
  });

  it("drops the two old signatures before re-creating them with p_batch", () => {
    expect(src0215).toContain("drop function if exists public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text);");
    expect(src0215).toContain("drop function if exists public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);");
  });

  it("every function is revoked from PUBLIC/anon/authenticated and granted to service_role", () => {
    const fns = [
      "prep_batch_context(uuid)",
      "set_recipe_batch_mode(uuid, boolean, uuid)",
      "remove_recipe_output(uuid, uuid)",
      "update_recipe_atomic(uuid, jsonb, boolean, uuid)",
      "revoke_phase2_item_atomic(uuid, uuid, uuid, text, text)",
      "submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text)",
      "submit_mid_day_phase1_atomic(uuid, uuid, jsonb)",
      "create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb)",
      "save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb)",
      "save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, jsonb)",
      "submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text)",
      "create_recipe_full(jsonb, jsonb, jsonb, uuid)",
      "add_recipe_output(uuid, uuid, uuid, numeric, text, uuid)",
    ];
    for (const f of fns) {
      expect(src0215, `revoke for ${f}`).toMatch(new RegExp(`revoke execute on function (public\\.)?${f.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`));
      expect(src0215, `grant for ${f}`).toMatch(new RegExp(`grant execute on function (public\\.)?${f.replace(/[()]/g, "\\$&")} to service_role;`));
    }
  });

  it("is authored-only and wrapped in one transaction", () => {
    expect(src0215).toContain("NOT YET APPLIED");
    expect(src0215.trim().startsWith("-- Migration 0215_batch_vs_bottle")).toBe(true);
    expect(src0215).toMatch(/\nbegin;\n/);
    expect(src0215.trimEnd().endsWith("commit;")).toBe(true);
  });
});
