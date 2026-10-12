-- Seed 52: decide the 33 open 'likely same person' customer suggestions (Juan 2026-10-12: "you do it and then get Astra to review it").
-- AUTHORED, NOT YET APPLIED — GATE CC: prod only (suggestion ids are prod-only).
-- APPLIED TO PROD 2026-10-12 (24 merged, 9 dismissed, 33 audit rows actor_context seed_52; prod dry run first; Juan: "Merge and apply everything properly").
-- CC decided; Astra cross-reviewed (32/33 agree; its one dismiss adopted; keep side = the fuller/clean name).
-- 24 merges (same or near-same full name + same card brand/last4, or same name across an email/phone split
-- WITH a shared card) and 9 dismisses (different people sharing an office/household phone or a company card;
-- one same-name pair with only a shared contact). Uses the app's own customer_merge / customer_merge_dismiss.
-- No names in this file: ids only. One audit row per decision, actor_context seed_52.
begin;
create temp table s52(suggestion_id uuid primary key, decision text not null, keep uuid) on commit drop;
insert into s52 values
 ('b8f1b45c-5f21-48a5-ae60-f72307e02045','merge','156c145d-6c54-4e57-889c-64e1e2696c32'),
 ('3306f45f-a8b4-4ca5-bb3f-d7c7f01e4a7a','merge','e170c32c-1e03-434d-a57f-3aca811bdbf9'),
 ('900ce5aa-ed5e-4fed-a617-7b90e0a33747','merge','b315949a-9658-4df3-8d2a-6fa0961ecd11'),
 ('b6fbbff1-0612-4a47-b78e-f8af06dd09cb','merge','7edf1285-2995-4668-a08a-8c617a541d79'),
 ('6b489d5d-1b15-4eda-b840-2e25968ba912','merge','b9ca2d31-551c-4f7f-a857-7bc5004626a7'),
 ('6104226c-9038-4d47-910f-508285e45c2a','merge','c4dbb5a8-04d2-4b5f-9f98-443efe569ea2'),
 ('7e75dac8-327b-4797-80dc-791c56435952','merge','ee55b5d6-eab2-4d43-9af3-281b670974e9'),
 ('c7df919f-a2d1-4b96-a01c-34b66a5bea96','merge','d76ed91d-aad6-4234-a151-ed7b13723bab'),
 ('ca0e6198-957c-41e3-a473-83656e5fc44f','merge','24961a1d-0dfa-4c6f-8311-3f025ea68d94'),
 ('0831c55b-002c-4468-b1ab-ddaac8a0ebb2','merge','9ddd65f0-eed2-4bda-a033-a6efead4d585'),
 ('9daafecf-5e80-455e-8d4c-d1a691c66a52','merge','4632ab46-9c96-4348-aa5e-ad864ad159ae'),
 ('2ff252d2-5f8e-47fa-815f-16aa937d713c','merge','fc8a7b6c-054e-409e-a102-e3e9092c04d2'),
 ('2d3d5bd7-e358-47e1-aba4-d90f2262a07a','merge','08403c53-ea49-4898-bbe4-10843994e5c4'),
 ('5db08f43-d433-4ffd-bf81-8cf43c8cdad0','merge','50627272-ae4c-4516-883c-5050ad520344'),
 ('2ce8c90c-fc73-452c-ad2a-3bcb61dd133e','merge','a2b66fb8-019a-48f4-831c-e3c001349ba4'),
 ('0e4ba042-7d4b-48a2-9c0e-bf5bb4033a37','merge','4f2017e8-2d33-4b29-8811-4bc2c23b7d77'),
 ('30ad5faf-e92a-4d9a-ad9d-d9963b91ed51','merge','ec760c38-7c70-4fb9-95a6-9f7afc78a7a8'),
 ('af196ad5-4d87-4e60-9388-183501d10b20','merge','31194873-b8dc-44a2-a421-e0cae4646966'),
 ('7ac41b69-a09c-4583-9733-18c9cf32b62e','merge','48904d10-f5eb-410d-ac23-d795c15fbe0d'),
 ('383c2e73-72d6-471c-bb76-48a11861db0f','merge','46af47a6-3904-405d-9f9f-41927883f58c'),
 ('2e4a32b1-a952-4699-9fde-8b96f3ae1085','merge','bc103683-a8a2-424b-86ca-ac41a988fa62'),
 ('675dd74b-44c9-451c-93ed-7aea5bcd40ca','merge','1f76b81d-dbb7-42da-9df0-5efe7633b6e2'),
 ('2bca8618-04d6-4e64-a2d2-29704e92745f','merge','0e5ce986-aad0-4bfa-b7ac-c457b58c5102'),
 ('29c60104-c128-4b7b-9f15-dc6322c87b45','merge','6952dc23-a702-415d-8b9e-a4f7b9b276c5'),
 ('26fa6de7-6ef0-4201-bbeb-559b5dd8f321','dismiss',null),
 ('7ef61b8b-5c43-46e3-8c7c-5807a2f6366c','dismiss',null),
 ('f94c7778-f33d-4a6a-a220-98a47cbd5360','dismiss',null),
 ('32af03cd-0272-4124-ba33-d58e4d00e329','dismiss',null),
 ('75436805-c835-492c-b1a4-805357da1be3','dismiss',null),
 ('8948a820-29a9-41fa-a575-36c4d56de2c6','dismiss',null),
 ('924dae5f-d0c3-4cf3-bb47-775e8fd7c0a6','dismiss',null),
 ('45735490-7569-44a9-8eba-8fbc557d24e9','dismiss',null),
 ('abfa80c9-806b-4306-92af-a2b9eab27ebe','dismiss',null);
do $guard$
begin
  if (select count(*) from public.customer_merge_suggestions s join s52 on s52.suggestion_id = s.id where s.status = 'open') is distinct from 33 then
    raise exception 'seed52: suggestions drifted';
  end if;
  if exists (select 1 from s52 join public.customer_merge_suggestions s on s.id = s52.suggestion_id
             where s52.decision = 'merge' and s52.keep not in (s.customer_a, s.customer_b)) then
    raise exception 'seed52: keep side not in pair';
  end if;
end $guard$;
do $apply$
declare r record; v jsonb;
begin
  for r in select * from s52 order by suggestion_id loop
    if r.decision = 'merge' then
      v := public.customer_merge(null, r.suggestion_id, r.keep);
      insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (null, null, 'customer.merge_confirm', 'customers', (v->>'kept')::uuid,
        jsonb_build_object('actor_context','seed_52','suggestion_id',r.suggestion_id,'merged',v->>'merged','changed',(v->>'changed')::boolean,
          'reason','CC decided, Astra reviewed (Juan 2026-10-12)'), true);
    else
      perform public.customer_merge_dismiss(null, r.suggestion_id);
      insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (null, null, 'customer.merge_dismiss', 'customer_merge_suggestions', r.suggestion_id,
        jsonb_build_object('actor_context','seed_52','reason','CC decided, Astra reviewed (Juan 2026-10-12)'), false);
    end if;
  end loop;
end $apply$;
commit;
