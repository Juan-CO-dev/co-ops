#!/usr/bin/env bash
# Sim health check for tester chains: sign in as the staff test persona and make one real logged-in write.
# On 2026-10-14 the sim's Next server crash-restarted mid-chain and every logged-in write then failed with 404,
# which voided five testers' runs. A page load still answered 200, so only a real write catches it.
# Exit 0 = healthy. SIM ONLY: the user id and PIN are the sim persona's test values (make-workspace.mjs).
sim="http://localhost:3100"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT
# A single network blip should not fail the check: try up to 3 times, 15 s apart.
for try in 1 2 3; do
pin=$(curl -s -c "$jar" -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -H "origin: $sim" \
  -d '{"user_id":"9d1dd4ad-a879-448b-aead-1731693f7921","pin":"1111"}' "$sim/api/auth/pin")
lang=$(curl -s -b "$jar" -o /dev/null -w "%{http_code}" -X PATCH -H "content-type: application/json" -H "origin: $sim" \
  -d '{"language":"en"}' "$sim/api/users/me/language")
[ "$pin" = 200 ] && [ "$lang" = 200 ] && { echo "pin $pin · write $lang (try $try)"; exit 0; }
[ "$try" -lt 3 ] && sleep 15
done
echo "pin $pin · write $lang (3 tries)"
exit 1
