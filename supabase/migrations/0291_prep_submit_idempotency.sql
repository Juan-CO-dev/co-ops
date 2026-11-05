-- Migration 0291_prep_submit_idempotency
-- AUTHORED 2026-11-04. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0290.
-- Provenance: Track 3 chunk 3; CC rulings 3 and 5, prep double-submit.
-- Re-emitted from the applied 0290 body, preserving closing-reference semantics.
-- ROLLOUT: SQL before app. Named-arg calls without the trailing key/hash stay
-- compatible during the deployment drain. DROP/CREATE avoids PGRST203 overloads.
-- Global lock order: AM instance -> closing instance -> completion rows.
-- Ruling 3 intended change: the edit branch refreshes v_submitted_at with
-- clock_timestamp() AFTER all parent and chain locks, including any wait.
-- Keys are actor/instance scoped, nullable, and never backfilled.
-- Replays return persisted submission IDs; instance is the current instance.
-- Historical push ID is recovered from append-only reference metadata. Skip
-- reasons are advisory audit context, not persisted; replay returns null and
-- MUST NOT emit a second skip audit.
-- VERIFY AFTER APPLY:
--   select pg_get_functiondef('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)'::regprocedure);
--   select routine_name, grantee from information_schema.routine_privileges
--     where routine_schema='public' and routine_name='submit_am_prep_atomic';
--   Run sql-harness-0291 and CC's independent two-session sim proof.
-- ROLLBACK: revert app first; retain nullable columns/index and compatible RPC.
-- Forward-only: re-emit fixes through a new reviewed migration; never delete history.
begin;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='checklist_submissions' and column_name in ('client_request_id','client_request_hash')) then
    raise exception '0291: request columns already exist';
  end if;
  if to_regprocedure('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text)') is null then
    raise exception '0291: expected 0290 nine-argument signature';
  end if;
end $$;
alter table public.checklist_submissions add column client_request_id uuid,
  add column client_request_hash text;
create unique index checklist_submissions_client_request_unique
  on public.checklist_submissions(instance_id, submitted_by, client_request_id)
  where client_request_id is not null;
drop function public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text);

CREATE FUNCTION public.submit_am_prep_atomic(
  p_prep_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_closing_report_ref_item_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL,
  p_client_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_replay checklist_submissions%ROWTYPE;
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
  v_ref_heads uuid[];
  v_ref_skip_reason text := NULL;
BEGIN
  -- 0290: lock ALL parents before either branch takes completion/chain locks.
  -- Global order: AM instance -> closing instance -> completion rows.
  PERFORM 1 FROM public.checklist_instances
    WHERE id = p_prep_instance_id FOR NO KEY UPDATE;
  IF NOT p_is_update THEN

    -- 0291: actor-scoped identity, under the parent/chain lock, before state/cap.
    IF p_client_request_id IS NOT NULL THEN
      SELECT * INTO v_replay FROM public.checklist_submissions
      WHERE instance_id = p_prep_instance_id AND submitted_by = p_actor_id
        AND client_request_id = p_client_request_id;
      IF FOUND THEN
        IF v_replay.client_request_hash IS DISTINCT FROM p_client_request_hash
          OR v_replay.original_submission_id IS DISTINCT FROM
            (CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END) THEN
          RAISE EXCEPTION 'prep_request_key_reused';
        END IF;
        -- Historical reference completions remain append-only, even superseded.
        -- Materialization prevents the planner casting unrelated metadata before
        -- restricting to the indexed closing-instance/reference-item key.
        WITH replay_refs AS MATERIALIZED (
          SELECT cc.id, cc.completed_at, cc.auto_complete_meta
          FROM public.checklist_completions cc
          JOIN public.checklist_instances closing_ci ON closing_ci.id = cc.instance_id
          JOIN public.checklist_templates closing_ct
            ON closing_ct.id = closing_ci.template_id AND closing_ct.type = 'closing'
          JOIN public.checklist_template_items cti
            ON cti.template_id = closing_ci.template_id AND cti.id = cc.template_item_id
          JOIN public.checklist_instances prep_ci
            ON prep_ci.location_id = closing_ci.location_id AND prep_ci.date = closing_ci.date
          WHERE prep_ci.id = p_prep_instance_id
            AND cti.report_reference_type = 'am_prep'
            AND cc.auto_complete_meta->>'reportInstanceId' = p_prep_instance_id::text
            AND cc.auto_complete_meta->>'reportType' = 'am_prep'
            AND v_replay.original_submission_id IS NULL
        )
        SELECT cc.id INTO v_auto_complete_id FROM replay_refs cc
        WHERE (cc.auto_complete_meta->>'reportSubmittedAt')::timestamptz = v_replay.submitted_at
        ORDER BY cc.completed_at, cc.id LIMIT 1;
        SELECT to_jsonb(ci) INTO v_prep_instance_row FROM public.checklist_instances ci
          WHERE ci.id = p_prep_instance_id;
        RETURN jsonb_build_object('instance', v_prep_instance_row,
          'submissionId', v_replay.id, 'completionIds', to_jsonb(v_replay.completion_ids),
          'autoCompleteId', v_auto_complete_id, 'closingRefSkip', NULL,
          'editCount', v_replay.edit_count,
          'originalSubmissionId', v_replay.original_submission_id, 'replayed', true);
      END IF;
    END IF;
  END IF;
  -- Preserve 0186 refusal precedence before resolving the closing parent.
  IF NOT p_is_update AND NOT EXISTS (
    SELECT 1 FROM public.checklist_instances
    WHERE id = p_prep_instance_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'submit_am_prep_atomic: prep instance % is not open or does not exist', p_prep_instance_id
      USING ERRCODE = 'check_violation';
  END IF;
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
      is_final_confirmation,
      client_request_id,
      client_request_hash
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_client_request_id,
      p_client_request_hash
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
      -- Parent is held: manager revocation/ambiguity must not wedge AM submit.
      SELECT array_agg(id ORDER BY id) INTO v_ref_heads
      FROM checklist_completions
      WHERE instance_id = v_closing_instance_id
        AND template_item_id = p_closing_report_ref_item_id
        AND superseded_at IS NULL
        AND NOT coalesce(prep_data ? 'phase2', false);
      IF cardinality(v_ref_heads) > 1 THEN
        v_ref_skip_reason := 'closing_ref_multiple_heads';
      ELSIF EXISTS (SELECT 1 FROM checklist_completions
        WHERE id = v_ref_heads[1] AND revoked_at IS NOT NULL) THEN
        v_ref_skip_reason := 'closing_ref_revoked';
      ELSE
        v_superseded_completion_id := v_ref_heads[1];
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


    -- 0291: actor-scoped identity, under the parent/chain lock, before state/cap.
    IF p_client_request_id IS NOT NULL THEN
      SELECT * INTO v_replay FROM public.checklist_submissions
      WHERE instance_id = p_prep_instance_id AND submitted_by = p_actor_id
        AND client_request_id = p_client_request_id;
      IF FOUND THEN
        IF v_replay.client_request_hash IS DISTINCT FROM p_client_request_hash
          OR v_replay.original_submission_id IS DISTINCT FROM
            (CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END) THEN
          RAISE EXCEPTION 'prep_request_key_reused';
        END IF;
        -- Historical reference completions remain append-only, even superseded.
        -- Materialization prevents the planner casting unrelated metadata before
        -- restricting to the indexed closing-instance/reference-item key.
        WITH replay_refs AS MATERIALIZED (
          SELECT cc.id, cc.completed_at, cc.auto_complete_meta
          FROM public.checklist_completions cc
          JOIN public.checklist_instances closing_ci ON closing_ci.id = cc.instance_id
          JOIN public.checklist_templates closing_ct
            ON closing_ct.id = closing_ci.template_id AND closing_ct.type = 'closing'
          JOIN public.checklist_template_items cti
            ON cti.template_id = closing_ci.template_id AND cti.id = cc.template_item_id
          JOIN public.checklist_instances prep_ci
            ON prep_ci.location_id = closing_ci.location_id AND prep_ci.date = closing_ci.date
          WHERE prep_ci.id = p_prep_instance_id
            AND cti.report_reference_type = 'am_prep'
            AND cc.auto_complete_meta->>'reportInstanceId' = p_prep_instance_id::text
            AND cc.auto_complete_meta->>'reportType' = 'am_prep'
            AND v_replay.original_submission_id IS NULL
        )
        SELECT cc.id INTO v_auto_complete_id FROM replay_refs cc
        WHERE (cc.auto_complete_meta->>'reportSubmittedAt')::timestamptz = v_replay.submitted_at
        ORDER BY cc.completed_at, cc.id LIMIT 1;
        SELECT to_jsonb(ci) INTO v_prep_instance_row FROM public.checklist_instances ci
          WHERE ci.id = p_prep_instance_id;
        RETURN jsonb_build_object('instance', v_prep_instance_row,
          'submissionId', v_replay.id, 'completionIds', to_jsonb(v_replay.completion_ids),
          'autoCompleteId', v_auto_complete_id, 'closingRefSkip', NULL,
          'editCount', v_replay.edit_count,
          'originalSubmissionId', v_replay.original_submission_id, 'replayed', true);
      END IF;
    END IF;

    -- Timestamp after all parent and chain locks, including any wait.
    v_submitted_at := clock_timestamp();

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
      edit_count,
      client_request_id,
      client_request_hash
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_original_submission_id,
      v_new_edit_count,
      p_client_request_id,
      p_client_request_hash
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
    'closingRefSkip', CASE WHEN v_ref_skip_reason IS NOT NULL THEN jsonb_build_object(
      'instanceId', v_closing_instance_id, 'itemId', p_closing_report_ref_item_id,
      'reason', v_ref_skip_reason) ELSE NULL END,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END
  );
END;
$function$;

revoke all on function public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text) to service_role;
do $$
declare f regprocedure := 'public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)'::regprocedure;
begin
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
    or not has_function_privilege('service_role', f, 'EXECUTE')
    or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid=f and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception '0291: RPC execution grant escaped';
  end if;
  if exists(select 1 from pg_proc where oid=f and (not prosecdef or
    not ('search_path=pg_catalog, public'=any(coalesce(proconfig,'{}'::text[]))))) then
    raise exception '0291: RPC execution context escaped';
  end if;
end $$;
commit;
