# SIM DAY — compressed operational-day simulation (2026-08-11)

Juan-ratified: compressed run FIRST (one full operational day, all roles, both
locations — the INTERLOCK test: opening→am-prep→mid-day→receiving/ordering/
count→closing→cash→pm-report feeding each other same-day). Multi-day machinery
(variance windows, depletion accumulation, yesterday-alerts) DEFAULTED/stubbed —
the real multi-day run happens later IF this goes well. Chaos: mostly diligent
+ ONE gremlin. Casting: line staff = haiku · KH/SL = sonnet · AGM+ = opus.

## Architecture

- **Sandbox**: local `next dev` on Juan's always-on laptop + dedicated free
  Supabase project **co-ops-sim (`jepgzucrvklhqpthowsc`)**. Prod untouched.
  Dormant legs STAY dormant in sim (no RESEND/TWILIO/TOAST/ANTHROPIC keys).
- **Schema**: migrations dir starts at 0044 (foundation predates it) and no pg
  password exists locally → clone the FULL LIVE prod schema by introspection
  (execute_sql on prod emits ready DDL: extensions→sequences→enums→tables→FKs→
  indexes→functions(+ACLs)→triggers→RLS+policies→table grants→storage buckets),
  apply to sim via execute_sql batches. Live schema wins over replaying history.
- **Data**: copy CONFIG tables prod→sim (locations, checklist templates/items,
  prep_sections, vendors+vendor_items+cutoffs+ordering details, items, recipe
  graph, menu_items, item_sizes, catering packages/slots/rates, sku_pack_levels,
  measures, location_sku_settings). ALL history/ledger tables start EMPTY.
  NO prod users/PII: fresh SIM STAFF with known PINs/passwords, hashed with
  sim-only peppers (sim gets its own .env.sim: fresh AUTH_JWT_SECRET — a
  Supabase-registered HS256 key on the sim project — + fresh peppers).
- **Agents**: my in-house subagents drive the app over HTTP (login → cookie →
  the real API routes; the same contract the forms hit) + 2-3 browser-driven
  sessions (Playwright MCP vs localhost) for UI-comprehension checks. Each
  agent: persona card + shift script + CONFUSION JOURNAL. One gremlin agent
  (double-taps, abandons forms, junk input). Sequential-ish by shift phase;
  parallel within a phase where real staff overlap.
- **Instrumentation**: dev-server log capture, per-call HTTP status ledger
  (agents append to scratchpad JSONL), DB probes between phases (instance
  states, ledger rows, PO statuses), final report: what broke · what confused
  whom · interlock verdict · go/no-go for the multi-day run.

## Execution steps

1. ✅ Sim project created (`jepgzucrvklhqpthowsc`, us-east-1, $0).
2. Schema emitter: introspect prod → schema.sql → apply to sim → verify counts
   (tables/policies/functions/triggers prod == sim).
3. Config-data cloner: per-table SELECT on prod → INSERT batches on sim
   (curated table list, FK order). Verify row counts.
4. Sim staff seed: ~10 personas across levels 1-8 × two locations, known creds
   (scripts/sim/seed-staff.ts using the app's own hashing with sim env).
5. .env.sim + `npm run dev` against sim (env swap script; NEVER touches
   .env.local — dev server launched with explicit env file).
6. Personas + shift scripts (scripts/sim/personas/*.md) + the agent driver
   prompts. API cheat-sheet = the staff handbook (they figure flows out — that
   IS the test).
7. RUN the day in shift order: opening crew → AM prep → mid-day → truck
   drop + ordering walk + AGM count → closing → cash → PM report. Journals
   collected per phase; gremlin interleaved.
8. Report + go/no-go for the real multi-day run.

## Out of scope (compressed run)

Variance (needs 2nd count on a later day) · depletion windows (no Toast in sim
— consumed terms will be advisory-null: EXPECTED, agents should see honest
nulls not fabrications, which is itself a check) · email/SMS/parse legs ·
customer portal flows · multi-day alerts.
