-- scripts/guide-test/reset-sim-day.sql
-- SIM ONLY (project jepgzucrvklhqpthowsc). Guides v2 tester rounds: give the next tester a fresh day at both
-- shops. Deletes TODAY's (ET) report, board, delivery, cash and handoff rows at P Street and Capitol Hill,
-- children first. Leaves yesterday's closing and AM prep (the opener reads them), all config (stations,
-- positions, templates), audit history and notifications. Finalizes yesterday's closing if it is still
-- open, so today's opening is not gated. Then seeds Maya's assignments for today (see the end of the block).
-- Prep side effects on inventory (price history, depletion) are
-- not rolled back; they are sim noise.
-- Run through the Supabase MCP execute_sql as the owner. Never on production.
begin;
do $$
declare
  loc uuid;
  d date := (now() at time zone 'America/New_York')::date;
  b date;
  inst uuid[];
  dels uuid[];
begin
  if not exists (select 1 from public.users where email = 'maya@sim.co-ops') then
    raise exception 'SIM ONLY: sim persona sentinel missing';
  end if;
  foreach loc in array array['d2cced11-b167-49fa-bab6-86ec9bf4ff09', '54ce1029-400e-4a92-9c2b-0ccb3b031f0a']::uuid[] loop
    b := public.station_business_date(loc);

    delete from public.pulse_handoff_acks where note_id in
      (select id from public.pulse_handoff_notes where location_id = loc and business_date in (d, b));
    delete from public.pulse_handoff_notes where location_id = loc and business_date in (d, b);

    delete from public.assignment_changes where location_id = loc and operational_date in (d, b);
    delete from public.report_assignments where location_id = loc and operational_date in (d, b);
    delete from public.station_events where location_id = loc and business_date in (d, b);
    delete from public.station_break_events where location_id = loc and business_date in (d, b);
    delete from public.station_departures where location_id = loc and business_date in (d, b);
    delete from public.shift_ends where location_id = loc and business_date in (d, b);

    select coalesce(array_agg(id), '{}') into dels from public.vendor_deliveries where location_id = loc and delivery_date = d;
    delete from public.vendor_credits where delivery_id = any(dels) or resolved_by_delivery_id = any(dels);
    delete from public.vendor_delivery_items where delivery_id = any(dels);
    update public.email_receipts set linked_delivery_id = null where linked_delivery_id = any(dels);
    delete from public.vendor_deliveries where id = any(dels);

    delete from public.cash_reports where location_id = loc and report_date = d;
    delete from public.pm_employee_evals where pm_report_id in
      (select id from public.pm_reports where location_id = loc and report_date = d);
    delete from public.pm_reports where location_id = loc and report_date = d;

    select coalesce(array_agg(id), '{}') into inst from public.checklist_instances where location_id = loc and date = d;
    delete from public.productions where instance_id = any(inst);
    delete from public.prep_batch_sessions where instance_id = any(inst);
    delete from public.opening_closer_count_snapshots where opening_instance_id = any(inst) or closing_instance_id = any(inst);
    delete from public.opening_section_verifications where opening_instance_id = any(inst);
    delete from public.opening_setup_verifications where opening_instance_id = any(inst);
    delete from public.opening_phase1_drafts where instance_id = any(inst);
    delete from public.am_prep_drafts where location_id = loc and business_date = d;
    delete from public.checklist_instances where id = any(inst);

    update public.checklist_instances ci
       set status = 'auto_finalized', finalized_at_actor_type = 'system_auto'
      from public.checklist_templates t
     where ci.template_id = t.id and t.type = 'closing'
       and ci.location_id = loc and ci.date = d - 1 and ci.status = 'open';

    raise notice 'reset % for % (board date %): % report instances, % deliveries', loc, d, b, cardinality(inst), cardinality(dels);
  end loop;

  -- The morning a real crew member walks into: a manager (Priya, AGM, P Street) has already assigned Maya
  -- her reports for today. Report tiles show only to the person assigned that task (lib/assignment-sections.ts
  -- dashboardWorkVisibility → taskVisible); crew cannot take tasks themselves (level < 4). The manager tester
  -- at Capitol Hill starts with nothing assigned on purpose: taking tasks is part of the manager guide.
  insert into public.report_assignments (report_type, location_id, operational_date, assigner_id, assignee_id, active)
  select t.report_type::public.report_type_enum, 'd2cced11-b167-49fa-bab6-86ec9bf4ff09'::uuid, d,
         (select id from public.users where email = 'priya@sim.co-ops'),
         (select id from public.users where email = 'maya@sim.co-ops'), true
    from unnest(array['opening_report', 'mid_day_prep', 'am_prep']) as t(report_type);
end $$;
commit;
select 'reset done' as result;
