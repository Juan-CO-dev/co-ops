# Void: sim fault (2026-10-14)

These round-2 reports were run while the sim was broken. The sim's Next server crash-restarted at 04:56 ET
(free RAM was ~2.7 GB). After that, logins did not stick and logged-in writes returned 404:
`/api/opening/phase1/draft` 207×, `/api/opening/prep/item` 88×, `/api/opening/submit/phase1` 29×,
`/api/prep/mid-day/phase1` 16×, `/api/users/me/language` 14×. A clean restart fixed it (language switch 200 again).
Production was checked and was not touched. Luna ran just before the restart, but its manager run showed slowness,
so it is re-run too. Terra (04:07–04:29) is kept. These files are kept only as a record; do not count them.
