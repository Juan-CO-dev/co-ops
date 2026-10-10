#!/usr/bin/env bash
# 0234 r1 (Astra BC-037): two concurrent resolutions of the same NEW email must yield ONE person.
# SIM ONLY. Needs SIM_DB_URL (a postgres connection string for the sim project; never prod).
# Session A resolves and holds its transaction 4 s; session B resolves the same email meanwhile and must
# wait on the identity lock, then attach to A's person. The fixture is erased afterwards (a tombstone row
# and a suppression hash remain on the sim, by design of delete-on-request).
set -euo pipefail
: "${SIM_DB_URL:?set SIM_DB_URL to the SIM database}"
case "$SIM_DB_URL" in *bgcvurheqzylyfehqgzh*) echo "refusing: that is the PROD project" >&2; exit 2;; esac
EMAIL="race-$(date +%s)-$RANDOM@example.com"
q() { psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }
psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "begin; select (public.customer_resolve('$EMAIL', null, 'Race Sim', 'Race', 'Sim', null, now(), 'toast_online', null)).customer_id; select pg_sleep(4); commit;" > /tmp/race-a.txt &
sleep 1
psql "$SIM_DB_URL" -v ON_ERROR_STOP=1 -At -c "begin; select (public.customer_resolve('$EMAIL', null, 'Race Sim', 'Race', 'Sim', null, now(), 'toast_pos', null)).customer_id; commit;" > /tmp/race-b.txt
wait
A=$(grep -E '^[0-9a-f-]{36}$' /tmp/race-a.txt | head -1); B=$(grep -E '^[0-9a-f-]{36}$' /tmp/race-b.txt | head -1)
N=$(q "select count(*) from public.customers where name_key = 'race sim' and erased_at is null")
echo "A=$A B=$B live_profiles=$N"
q "select public.customer_erase(null, '$A', 'delete_request')" > /dev/null
LEFT=$(q "select count(*) from public.customer_identifiers where value = '$EMAIL'")
if [ "$A" = "$B" ] && [ "$N" = "1" ] && [ "$LEFT" = "0" ]; then echo "PASS: one person, erased completely"; else echo "FAIL"; exit 1; fi
