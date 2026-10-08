-- SIM ONLY after 0221 + 0222. Synthetic, real claim/page/finish RPCs; rolls back.
begin;
do $$
declare
 loc uuid; d date := '1900-01-02'; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
 select id into loc from public.locations order by id limit 1;
 if loc is null then raise exception 'sim needs a location'; end if;
 if not public.toast_capture_claim(a,loc,d) then raise exception 'initial claim refused'; end if;
 if public.toast_capture_claim(b,loc,d) then raise exception 'running claim not debounced'; end if;
 perform public.toast_capture_page(a,loc,d,1,'[]'::jsonb);
 perform public.toast_capture_finish(a,loc,d,1);
 if public.toast_capture_claim(b,loc,d) then raise exception 'recent completion not debounced'; end if;
 update public.toast_capture_runs set finished_at=clock_timestamp()-interval '6 minutes' where id=a;
 if not public.toast_capture_claim(b,loc,d) then raise exception 'elapsed debounce not released'; end if;
 -- Yesterday must remain debounced for a full hour, not just five minutes.
 if public.toast_capture_claim(b,loc,d,interval '1 hour') then raise exception 'running hourly claim accepted'; end if;
 perform public.toast_capture_page(b,loc,d,1,'[]'::jsonb);
 perform public.toast_capture_finish(b,loc,d,1);
 update public.toast_capture_runs set finished_at=clock_timestamp()-interval '59 minutes' where id=b;
 if public.toast_capture_claim(c,loc,d,interval '1 hour') then raise exception 'hourly debounce released early'; end if;
 update public.toast_capture_runs set finished_at=clock_timestamp()-interval '61 minutes' where id in (a,b);
 if not public.toast_capture_claim(c,loc,d,interval '1 hour') then raise exception 'hourly debounce not released'; end if;
 -- A crashed run cannot block either interval indefinitely; unrelated days stay running.
 insert into public.toast_capture_runs(id,location_id,business_date,started_at)
 values(unrelated,loc,d-1,clock_timestamp()-interval '3 minutes');
 update public.toast_capture_runs set started_at=clock_timestamp()-interval '3 minutes' where id=c;
 if not public.toast_capture_claim(gen_random_uuid(),loc,d,interval '1 hour') then raise exception 'stale running claim not released'; end if;
 if not exists(select 1 from public.toast_capture_runs where id=c and status='failed' and error_code='capture_stale' and finished_at is not null)
 then raise exception 'stale run not marked failed'; end if;
 if not exists(select 1 from public.toast_capture_runs where id=unrelated and status='running') then raise exception 'swept unrelated date'; end if;
 begin
  perform public.toast_capture_claim(gen_random_uuid(),loc,d,interval '1 minute');
  raise exception 'short interval accepted';
 exception when raise_exception then
  if sqlerrm<>'toast_capture_invalid_interval' then raise; end if;
 end;
 if has_function_privilege('authenticated','public.toast_capture_claim(uuid,uuid,date,interval)','EXECUTE')
 or has_function_privilege('anon','public.toast_capture_claim(uuid,uuid,date,interval)','EXECUTE') then
  raise exception 'claim callable by user role';
 end if;
 if has_table_privilege('authenticated','public.toast_capture_debounce','UPDATE') then raise exception 'user debounce write'; end if;
 raise notice 'debounce real RPC checks passed';
end $$;
rollback;
