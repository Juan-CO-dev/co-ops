# Catalog 4b chunk 4 implementation plan

Authority: BUILD r2 and CC's no-migration ruling supplied in the dispatch. Part A precedes Part B; all changes remain uncommitted on feat/catalog-phase4b-job-pages.

Part A: repair Toast tier extraction/pin, claim filtering, retry/refresh gating, lint/accessibility, and reuse the builder scope resolver with the jobs' level-7 floor. Strip RESULT whitespace. Tests first against the old implementation; retain the existing recipe-builder omission behavior for legacy callers.

Part B: extend new-sandwich-shared.ts and new-sandwich.ts with optional correlation and strictly scoped read-only reconciliation; add the reconcile route and route inventories. Add a pure attempt/cost controller using the real request guard, NewSandwichJob and its thin server page, canonical shop registration, and catalog search query prefill. Reuse RecipeLineEditor, builder choices, menu links and ToastLinkSection. Add bilingual UI/recovery text and tests before implementation.

Contracts: creator equality in SQL query; active exact name/owner plus server age 0–10 minutes and a visible producing recipe. Read failures remain uncertain. attemptKey is correlation only, never replay. No migration, equivalence rebaseline, production access, push or merge.

Verification: focused failing-first and passing runs; origin/read-boundary/shop-context/tier inventories; next typegen then tsc; changed-file eslint and baseline delta versus 4db4efd0; full Vitest suite with threads, no cache, three workers and 60000 ms timeout. Record tsx ENOMEM independently. Check historical commit range and baseline-to-final diff whitespace separately.

Risks: same-account/name/time reconciliation is heuristic; partial cost must never appear complete; delayed preview/create results must not attach to a changed draft/scope. Browser proof is distinct from component tests and will be reported honestly.
