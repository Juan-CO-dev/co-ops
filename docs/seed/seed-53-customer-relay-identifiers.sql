-- Seed 53: remove the DoorDash relay "emails" stored as customer identifiers (customers page v2, Juan 2026-10-12).
-- AUTHORED, NOT YET APPLIED -- GATE CC: after 0249 on prod (needs its customer_email_is_relay), prod dry run first.
-- APPLIED TO PROD 2026-10-12 (25,887 relay identifiers deleted, 25,887 customers masked 'doordash', 1 audit row actor_context seed_53; prod dry run first).
-- Toast hands DoorDash orders dd.toast.orders+<order id>@gmail.com. 0234's relay rule only knew marketplace domains,
-- so 25,887 of these were stored as real emails: each DoorDash order became its own "reachable" person. 0249 fixes
-- the rule for new captures; this removes the historical ones. Every affected person keeps their name and orders
-- (they become name-only marketplace guests) and gains masked channel 'doordash'. No value is logged or audited:
-- one aggregate audit row with the counts.
begin;
lock table public.customer_identifiers, public.customers in share row exclusive mode;
create temp table s53 on commit drop as
  select i.id, i.customer_id from public.customer_identifiers i
  where i.kind = 'email' and public.customer_email_is_relay(i.value);
do $guard$
declare v_n int; v_dd int; v_other int;
begin
  select count(*) into v_n from s53;
  select count(*) into v_dd from s53 s join public.customer_identifiers i on i.id = s.id
    where split_part(split_part(i.value,'@',1),'+',1) = 'dd.toast.orders';
  select count(*) into v_other from s53 s join public.customer_identifiers j on j.customer_id = s.customer_id and j.id <> s.id;
  -- 25,887 at authoring; nothing new can land (0249 refuses relay identifiers), so the set is closed.
  if v_n <> 25887 or v_dd <> v_n then
    raise exception 'seed53: relay set drifted (% rows, % dd.toast.orders)', v_n, v_dd;
  end if;
  if v_other <> 0 then raise exception 'seed53: % relay holders also have a real identifier', v_other; end if;
end $guard$;
update public.customers c set masked_channels = array(select distinct unnest(c.masked_channels || array['doordash']) order by 1)
  where c.id in (select customer_id from s53);
delete from public.customer_identifiers i using s53 s where i.id = s.id;
insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
select null, null, 'customer_identifier.delete', 'customer_identifiers', null,
  jsonb_build_object('actor_context', 'seed_53', 'kind', 'email', 'rule', 'customer_email_is_relay (0249: dd.toast.orders)',
    'deleted', count(*), 'customers', count(distinct customer_id),
    'reason', 'Marketplace relay addresses are not the guest''s email (Juan 2026-10-12)'), true
from s53;
commit;
