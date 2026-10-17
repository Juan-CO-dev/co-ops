# Catalog 4b chunk 5 work plan

Baseline: clean `34500311`, `feat/catalog-phase4b-job-pages`. Execute the supplied CC rulings and BUILD r2 chunk 5; leave uncommitted for CC review.

1. Part A first: NewItemJob summary/status/setup rendering, barcode/global link/vendor refresh; loader count and shop-import audit tests; reset marker classification and positive controls; read-boundary lint rename; BUILD wording. Record failing-first checks and changed assertions separately.
2. Part B: add SwapVendorJob and its server page using loadSwapVendorJobView; add ShareWithEveryShop and ItemJobsStrip; integrate the strip on the existing SKU page. Use public previews only, normalized preview.request plus previewToken, explicit dependency selection, Tier E, keyed scopes and invalidated delayed responses. Register the dynamic page in the test inventory under the existing SKU prefix. Validate the new-item return context rather than accepting arbitrary return URLs.
3. Test behavior before implementation: exact confirmation payload, delayed/stale preview and scope edits, eligibility, share dependency/owner binding, retained Back outcomes and journal reload. Render en/es controls and one-column responsive markup; no claim of measured browser layout from server renders.
4. Run focused tests, inventory/read-boundary/shop-context/tier-map, unchanged four equivalence suites, next typegen then tsc, changed-file eslint and full requested threads suite. Report tsx ENOMEM separately if observed.

Contracts checked: current jobs loaders/DTOs, swap parser/public preview/start/end/journal, share preview and request fields, NewItem and NewSandwich pages, step-up and shop inventories, installed Next component/page/handler docs. Existing BUILD r2 is the execution contract; the umbrella snippets are not authoritative.

Risks: Back's SQL outcome can differ from preview after a human edit, so render actual back/kept/primary/grouping. Uncertain writes require re-read and fresh review, never automatic retry. Prep-item blocker links need producer identity from authorized server reads. New-item reload can duplicate an uncertain create (BUILD chunk 7 deferral). No migration, engine rewrite, production access, commit, push or merge.

Shared A/B files anticipated: en/es dictionaries; shop-context test inventory; NewItemJob/new-item page only for validated swap-return context. All exact files and assertion changes go in RESULT.
