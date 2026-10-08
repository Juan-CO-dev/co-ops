-- SIM ONLY after 0221 + 0222. Synthetic, real claim/page/finish RPCs; rolls back.
begin;
do $$
declare
 loc uuid; d date := '1900-01-02'; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
begin
 select id into loc from public.locations order by id limit 1;
 if loc is null then raise exception 'sim needs a location'; end if;
 if not public.toast_capture_claim(a,loc,d) then raise exception 'initial claim refused'; end if;
 if public.toast_capture_claim(b,loc,d) then raise exception 'running claim not debounced'; end if;
 perform public.toast_capture_page(a,loc,d,1,'[]'::jsonb);
 perform public.toast_capture_finish(a,loc,d,1);
 if public.toast_capture_claim(b,loc,d) then raise exception 'recent completion not debounced'; end if;
 update public.toast_capture_runs set finished_at=clock_timestamp()-interval '6 minutes' where id=a;
 if not public.toast_capture_claim(b,loc,d) then raise exception 'elapsed debounce not released'; end if;
 if has_function_privilege('authenticated','public.toast_capture_claim(uuid,uuid,date)','EXECUTE')
 or has_function_privilege('anon','public.toast_capture_claim(uuid,uuid,date)','EXECUTE') then
  raise exception 'claim callable by user role';
 end if;
 if has_table_privilege('authenticated','public.toast_capture_debounce','UPDATE') then raise exception 'user debounce write'; end if;
 raise notice 'debounce real RPC checks passed';
end $$;
rollback;
