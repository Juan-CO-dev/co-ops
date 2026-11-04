-- Migration 0290_checklist_closing_ref_atomic
-- AUTHORED 2026-11-03. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0288.
-- Provenance: Track 3 chunk 2, open-items-plan.md and CC track3-rulings.md (3,7,10-12).
-- 0288/0289 are occupied; this is the rulings' replacement RPC renumbered 0290.
-- Global lock order: AM instance -> closing instance -> completion rows.
-- New parent locks use FOR NO KEY UPDATE. Reconcile remains allowed on confirmed
-- closings. No index tightening, prep request key, or generic-correction changes.
-- ROLLOUT: SQL before app; run preflight-0276 and checklist-0290-lock-check on sim.
-- Drain old app deployments before claiming all JS reference replacements cooperate.
-- Other opening/phase SQL writers remain an explicit chunk-3 audit boundary.
-- Existing ambiguous heads must be diagnosed/repaired in a separately reviewed
-- transaction under the closing lock; this RPC refuses rather than choosing one.
-- VERIFY AFTER APPLY:
--   select pg_get_functiondef('public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
--   select pg_get_functiondef('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text)'::regprocedure);
--   select routine_name, grantee from information_schema.routine_privileges
--     where routine_schema='public' and routine_name in
--     ('checklist_replace_closing_ref','submit_am_prep_atomic'); -- service_role (+ owner) only
--   Verify one unsuperseded head per reference/phase including revoked rows;
--   run preflight and CC's two-session sim proof before app rollout.
-- ROLLBACK: revert app first; retain RPC. Re-emit changed bodies only through a
-- new reviewed migration; never delete history or undo supersession links.
begin;

do $$
begin
  if to_regprocedure('public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb)') is not null then
    raise exception '0290: replacement function already exists';
  end if;
  if to_regprocedure('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text)') is null then
    raise exception '0290: expected 0186 submit_am_prep_atomic signature';
  end if;
  if to_regprocedure('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])') is null then
    raise exception '0290: expected 0288 confirmation';
  end if;
  if strpos(pg_get_functiondef('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure),
      'if v_filtered is distinct from v_expected then') = 0 then
    raise exception '0290: expected 0288 filtered-only confirmation';
  end if;
  if to_regclass('public.checklist_completions_one_live_head_per_phase') is null then
    raise exception '0290: expected 0196 per-phase live-head index';
  end if;
end $$;

create function public.checklist_replace_closing_ref(
  p_instance uuid, p_item uuid, p_actor uuid, p_expected_head uuid, p_meta jsonb
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype;
  v_head public.checklist_completions%rowtype;
  v_heads uuid[]; v_new uuid; v_at timestamptz;
  v_head_at timestamptz; v_ours_at timestamptz;
begin
  -- No AM row is mutated by this RPC. Its AM caller acquires AM first.
  select * into v_instance from public.checklist_instances
    where id = p_instance for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if not exists(select 1 from public.checklist_templates where id = v_instance.template_id and type = 'closing')
    or not exists(select 1 from public.checklist_template_items
      where id = p_item and template_id = v_instance.template_id
        and (report_reference_type = p_meta->>'reportType'
          or (ref_track_item_completion and references_template_item_id is not null
            and p_meta->'refTrack' = 'true'::jsonb
            and references_template_item_id::text = p_meta->>'referencedTemplateItemId'))) then
    raise exception 'invalid_payload';
  end if;
  -- Include revoked heads. The live unique index alone cannot detect ambiguity.
  select array_agg(id order by id) into v_heads from public.checklist_completions
    where instance_id = p_instance and template_item_id = p_item
      and superseded_at is null and not coalesce(prep_data ? 'phase2', false);
  if cardinality(v_heads) > 1 then raise exception 'closing_ref_multiple_heads'; end if;
  if cardinality(v_heads) = 1 then
    select * into v_head from public.checklist_completions
      where id = v_heads[1] for no key update;
    if v_head.revoked_at is not null then raise exception 'closing_ref_revoked'; end if;
  end if;
  if v_head.id is distinct from p_expected_head then
    return jsonb_build_object('result','lost','completionId',v_head.id);
  end if;
  -- Recheck mid-day monotonicity in the same transaction as the CAS. Prefer
  -- actual confirmation over legacy metadata that incorrectly stored load time.
  if v_head.id is not null and p_meta->>'reportType' = 'mid_day_prep' then
    if (v_head.auto_complete_meta->>'count')::integer > (p_meta->>'count')::integer then
      return jsonb_build_object('result','skipped','completionId',v_head.id);
    end if;
    if (v_head.auto_complete_meta->>'count')::integer = (p_meta->>'count')::integer then
      if v_head.auto_complete_meta->>'reportInstanceId' is distinct from p_meta->>'reportInstanceId' then
        select confirmed_at into v_head_at from public.checklist_instances
          where id = (v_head.auto_complete_meta->>'reportInstanceId')::uuid;
        v_head_at := coalesce(v_head_at,(v_head.auto_complete_meta->>'reportSubmittedAt')::timestamptz);
        v_ours_at := (p_meta->>'reportSubmittedAt')::timestamptz;
        if v_ours_at is null or v_ours_at <= v_head_at then
          return jsonb_build_object('result','skipped','completionId',v_head.id);
        end if;
      elsif p_meta->>'reportSubmittedAt' is null or
        (p_meta->>'reportSubmittedAt')::timestamptz = (v_head.auto_complete_meta->>'reportSubmittedAt')::timestamptz then
        return jsonb_build_object('result','skipped','completionId',v_head.id);
      end if;
    end if;
  end if;
  v_at := clock_timestamp();
  if v_head.id is not null then
    update public.checklist_completions set superseded_at = v_at where id = v_head.id;
  end if;
  insert into public.checklist_completions(instance_id,template_item_id,completed_by,completed_at,auto_complete_meta)
    values(p_instance,p_item,p_actor,v_at,p_meta) returning id into v_new;
  if v_head.id is not null then
    update public.checklist_completions set superseded_by = v_new where id = v_head.id;
  end if;
  return jsonb_build_object('result',case when v_head.id is null then 'inserted' else 'superseded' end,
    'completionId',v_new);
end $$;

CREATE OR REPLACE FUNCTION public.submit_am_prep_atomic(
  p_prep_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_closing_report_ref_item_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_entry jsonb;
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_submitted_at timestamptz := now();
  v_auto_complete_id uuid := NULL;
  v_prep_instance_row jsonb;
  v_max_edit_count int;
  v_new_edit_count int;
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  -- 0186 (block 1): the closing instance the auto-complete writes into, resolved
  -- BEFORE the write so the live head on that key can be flipped first.
  v_closing_instance_id uuid;
  -- 0290: the unsuperseded head, including revocation; the shared RPC diagnoses
  -- revoked/ambiguous heads instead of treating them as an empty key.
  v_superseded_completion_id uuid;
  v_ref_result jsonb;
BEGIN
  -- 0290: lock ALL parents before either branch takes completion/chain locks.
  -- Global order: AM instance -> closing instance -> completion rows.
  PERFORM 1 FROM public.checklist_instances
    WHERE id = p_prep_instance_id FOR NO KEY UPDATE;
  IF NOT p_is_update AND p_closing_report_ref_item_id IS NOT NULL THEN
      SELECT ci.id
      INTO v_closing_instance_id
      FROM checklist_instances ci
      JOIN checklist_template_items cti
        ON cti.template_id = ci.template_id
      JOIN checklist_instances prep_ci
        ON prep_ci.location_id = ci.location_id
        AND prep_ci.date = ci.date
      WHERE cti.id = p_closing_report_ref_item_id
        AND prep_ci.id = p_prep_instance_id
      LIMIT 1;

      IF v_closing_instance_id IS NULL THEN
        RAISE EXCEPTION 'submit_am_prep_atomic: no closing instance found for prep instance % to auto-complete report-ref item %',
          p_prep_instance_id, p_closing_report_ref_item_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

    PERFORM 1 FROM public.checklist_instances
      WHERE id = v_closing_instance_id FOR NO KEY UPDATE;
  END IF;
  v_submitted_at := clock_timestamp();
  IF NOT p_is_update THEN
    -- ================================================================
    -- ORIGINAL-SUBMISSION PATH (preserved verbatim from 0041/0043)
    -- ================================================================

    -- 1. Insert one checklist_completion per entry.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        prep_data
      )
      VALUES (
        p_prep_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'inputs', v_entry->'inputs',
          'snapshot', v_entry->'snapshot'
        )
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- 2. Insert checklist_submissions row.
    INSERT INTO checklist_submissions (
      instance_id,
      submitted_by,
      submitted_at,
      completion_ids,
      is_final_confirmation
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true
    )
    RETURNING id INTO v_submission_id;

    -- 3. Pessimistic transition prep instance → confirmed.
    UPDATE checklist_instances
    SET
      status = 'confirmed',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id
    WHERE id = p_prep_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: prep instance % is not open or does not exist', p_prep_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 4. Auto-complete the closing's report-reference item if one exists.
    IF p_closing_report_ref_item_id IS NOT NULL THEN
      -- 0290: the parent is already held; bind the exact head seen under it.
      -- Do not filter revoked heads. The shared RPC refuses them (and ambiguity).
      SELECT id INTO v_superseded_completion_id
      FROM checklist_completions
      WHERE instance_id = v_closing_instance_id
        AND template_item_id = p_closing_report_ref_item_id
        AND superseded_at IS NULL
        AND NOT coalesce(prep_data ? 'phase2', false);
      v_ref_result := public.checklist_replace_closing_ref(
        v_closing_instance_id, p_closing_report_ref_item_id, p_actor_id,
        v_superseded_completion_id,
        jsonb_build_object('reportType', 'am_prep',
          'reportInstanceId', p_prep_instance_id,
          'reportSubmittedAt', to_jsonb(v_submitted_at)));
      IF v_ref_result->>'result' = 'lost' THEN
        RAISE EXCEPTION 'closing_ref_changed';
      END IF;
      v_auto_complete_id := (v_ref_result->>'completionId')::uuid;
    END IF;

  ELSE
    -- ================================================================
    -- UPDATE PATH (C.46 A6) — chained attribution; cap-checked; locked
    -- ================================================================

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 1. Lock the chain head.
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_prep_instance_id THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_prep_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    -- 2. Cap check (post-lock; safe under concurrency).
    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- 3. Insert new completions, each linked to the chain-head completion
    --    for its template_item_id.
    --
    --    C.44 alignment: every entry's template_item_id must exist in the
    --    chain head's completions. This guard prevents adding new items via
    --    edit — edits operate on the original submission's snapshot, not
    --    the live template. A future "add missing item" capability would be
    --    a separate operation, not a chain edit.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      SELECT cc.id INTO v_original_completion_id
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = (v_entry->>'templateItemId')::uuid
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_am_prep_atomic: template_item_id % in update entries not found in chain head submission %',
          (v_entry->>'templateItemId')::uuid, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      -- ──── 0186 BLOCK 3: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- This branch bare-INSERTED a second live row for a key whose predecessor is still
      -- live, and lib/prep.ts's submitAmPrepUpdate flips nothing either — so the moment a
      -- manager taps Edit on an AM Prep report, this raises a raw 23505 that lib/prep.ts
      -- does not map (it names only P0001, 23514 and foreign_key_violation), i.e. an
      -- opaque 500 at 6 AM on every chain edit. The flip below is the same shape
      -- save_phase2_item_atomic (0056), lib/checklists.ts completeItem and lib/cash.ts
      -- already use: clear the live head's null superseded_at BEFORE the insert, then
      -- back-point it once the new id exists.
      --
      -- It supersedes THE LIVE HEAD, not v_original_completion_id. Those are the same row
      -- on the first edit and diverge on the second: the C.44 alignment read above
      -- deliberately keys on the CHAIN HEAD's completion_ids (so the chain link points at
      -- the original submission, edit after edit — that is what
      -- original_completion_id MEANS), while the row that actually holds the index slot is
      -- whichever edit is currently live. Superseding the chain head on edit 2 would be a
      -- no-op and the 23505 would come straight back. The edit cap is 3, so edits 2 and 3
      -- are reachable, not theoretical — prod already holds chains at max edit_count 3.
      --
      -- At most one row can match — that is precisely what 0176's index guarantees — so a
      -- single-row RETURNING INTO is safe here. No live head (a revoked predecessor)
      -- leaves it NULL and the insert stands alone.
      --
      -- C.46 A4/A6 are untouched by this: an UPDATE of superseded_at on
      -- checklist_completions is not a status change and not a closing-side write.
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = p_prep_instance_id
        AND template_item_id = (v_entry->>'templateItemId')::uuid
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        prep_data,
        original_completion_id,
        edit_count
      )
      VALUES (
        p_prep_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'inputs', v_entry->'inputs',
          'snapshot', v_entry->'snapshot'
        ),
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);

      -- 0186 BLOCK 4: close the chain link. superseded_by can only be written once the
      -- successor's id exists, which is why the flip above is two statements rather than
      -- one — the same order lib/cash.ts and completeItem take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_completion_id
        WHERE id = v_superseded_completion_id;
      END IF;
    END LOOP;

    -- 4. Insert new submission row, linked to the chain head.
    INSERT INTO checklist_submissions (
      instance_id,
      submitted_by,
      submitted_at,
      completion_ids,
      is_final_confirmation,
      original_submission_id,
      edit_count
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_original_submission_id,
      v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- 5. Audit emission inside transaction (atomic with chain write per A7).
    --    FIX (migration 0044): ip_address + user_agent are NOT columns on
    --    audit_log; they live inside metadata JSONB per the JS-side audit()
    --    helper convention. Migration 0043 incorrectly placed them as
    --    top-level INSERT columns, raising sqlstate 42703.
    --
    --    audit_log column shape (canonical, verified via
    --    information_schema.columns):
    --      id, occurred_at, actor_id, actor_role, action, resource_table,
    --      resource_id, before_state, after_state, metadata, destructive
    --
    --    Future RPC migrations writing to audit_log: query
    --    information_schema.columns for the table first; mirror exact
    --    column shape; place forensic enrichment (IP/UA/etc.) inside
    --    metadata JSONB to align with lib/audit.ts conventions.
    INSERT INTO audit_log (
      actor_id,
      action,
      resource_table,
      resource_id,
      metadata,
      destructive
    )
    VALUES (
      p_actor_id,
      'report.update',
      'checklist_submissions',
      v_submission_id,
      jsonb_build_object(
        'report_type', 'am_prep',
        'report_instance_id', p_prep_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        -- IP + UA inside metadata to match JS-side audit() helper convention.
        'ip_address', p_ip_address,
        'user_agent', p_user_agent
      ),
      true
    );

    -- 6. Per A6: do NOT change checklist_instances.status.
    -- 7. Per A4: do NOT touch closing's auto-complete row.
  END IF;

  SELECT to_jsonb(ci) INTO v_prep_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_prep_instance_id;

  RETURN jsonb_build_object(
    'instance', v_prep_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', v_auto_complete_id,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END
  );
END;
$function$;

revoke all on function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text) to service_role;
commit;
