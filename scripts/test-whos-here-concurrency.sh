#!/usr/bin/env bash
# CC SIM ONLY, after 0233 (r1). Two-connection checks a single-session harness cannot make:
#   1. FAIL-OPEN (Astra P1-4): with the shop/day lock held by another session, reconcile_shop_closed
#      returns {"skipped":"busy"} at once instead of waiting (no blocking lock, no query_canceled).
#   2. LINK SERIALIZATION (Astra P1-3): while a link/unlink holds the 'toast-link' lock, a labor write
#      to toast_time_entries WAITS for it (here: hits a 1 s lock_timeout) instead of reading a stale link.
# Usage: SIM_DB_URL=postgres://... bash scripts/test-whos-here-concurrency.sh
# Nothing is written: session B rolls back; session A only holds advisory locks, then exits.
set -euo pipefail
: "${SIM_DB_URL:?set SIM_DB_URL to the SIM database (never production)}"
q() { psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }

[ "$(q "select count(*) from public.users where email='maya@sim.co-ops'")" = "1" ] || { echo "SIM ONLY"; exit 1; }
LOC=$(q "select location_id from public.user_locations where active group by location_id order by count(*) desc, location_id limit 1")
DAY=$(q "select (now() at time zone 'America/New_York')::date")

# 1. Fail-open: A holds the shop/day lock for 8 s; B must return 'busy' well inside 3 s.
psql "$SIM_DB_URL" -At -c "select pg_advisory_lock(hashtextextended('station/day/${LOC}/${DAY}',0)); select pg_sleep(8);" >/dev/null &
A=$!; sleep 2
START=$(date +%s%N)
OUT=$(psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "begin; set local statement_timeout='3s'; select public.reconcile_shop_closed('${LOC}','${DAY}',true)::text; rollback;" | grep skipped || true)
MS=$(( ($(date +%s%N) - START) / 1000000 ))
wait $A
case "$OUT" in *'"skipped": "busy"'*|*'"skipped":"busy"'*) echo "PASS fail-open: busy in ${MS} ms";; *) echo "FAIL fail-open: got '${OUT}' in ${MS} ms"; exit 1;; esac
[ "$MS" -lt 3000 ] || { echo "FAIL fail-open: waited ${MS} ms"; exit 1; }

# 2. Link serialization: A holds the link lock (as link/unlink do); B's labor insert must wait.
psql "$SIM_DB_URL" -At -c "begin; select pg_advisory_xact_lock(hashtextextended('toast-link',0)); select pg_sleep(6); rollback;" >/dev/null &
A=$!; sleep 2
if psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "begin; set local lock_timeout='1s';
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,in_at)
    values('${LOC}','sim-concurrency-'||gen_random_uuid(),'${DAY}','sim-concurrency',now()); rollback;" 2>/tmp/whos-here-b.err; then
  wait $A; echo "FAIL link serialization: the labor insert did not wait for the link lock"; exit 1
fi
wait $A
grep -q "lock timeout" /tmp/whos-here-b.err && echo "PASS link serialization: labor insert waited on the link lock" \
  || { echo "FAIL link serialization: unexpected error"; cat /tmp/whos-here-b.err; exit 1; }
echo "whos-here concurrency checks PASS"
