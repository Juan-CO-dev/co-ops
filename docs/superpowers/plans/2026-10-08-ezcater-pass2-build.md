# ezCater PASS 2 and catering shop transfers

CC-preapproved dispatch, 2026-10-08. Branch `feat/ezcater-pass2`; leave uncommitted, no git writes, no provider/production operations. Migration 0224 belongs to digest v2; this work uses 0225.

## Short implementation plan

1. Register human transfer and provider reassignment audit actions before emitting them. Add atomic transfer and ezCater reassignment contracts in migration 0225, fresh library authorization, same-stage events, manual/provider ordering and conflict disclosure. Transfer lead/quote/reserved prep demand attribution; preserve recorded production. W4b is derived from W4a, not a separately stored ledger.
2. Add a triggered pipeline detail transfer form, en/es labels and 44px controls. Enforce catering manager or level 8+, fresh step-up in the library, and a narrowly scoped transfer endpoint exception to session step-up clearing.
3. Implement same-location, ±1-day normalized-code links at selection grain; retain raw provider item/size identity and POS identity, probe exact GUID evidence, queue name-only candidates and duplicate leads. Publish source-tagged diagnostics and shadow comparisons without connecting them to effective depletion.
4. Compute shadow consumption with existing recipe math and production suppression including D-1. Connect reconciliation to the existing nightly pipeline and expose diagnostics for review.
5. Supply a dry-run-first, expected-count-guarded historical reassignment script and rollback SQL harness for CC. Run targeted tests, `npm.cmd test`, `npm.cmd run typecheck`, and whitespace checks; record actual results and file anchors in the PR body.

## Confirmed references and risks

- The saved enrichment plan labels PASS 2 future work; this dispatch explicitly authorizes it and D-1 tests now.
- W4a owns reserved item demand; W4b reads those rows. Production records must remain at the shop where prep occurred.
- Existing step-up survives quote-send routes only outside admin; the new transfer action needs an exact additional path.
- ezCater items already retain raw POS IDs and size IDs; neither name nor a UUID-shaped value alone proves a Toast mapping.
- Provider observation ordering and manual overrides must be explicit; missing upstream revision evidence cannot justify silently overriding a manager.
- SQL execution is an operator/sim verification gate. No migration is applied by this build.


## PASS 2b - reviewed correction plan (Opus APPROVE WITH CHANGES)

The 2026-10-08 dispatch authorizes these corrections on the existing branch, with no git writes and no commits. The initial plan above describes PASS 2; the following supersedes its identity, conflict, and capture assumptions.

1. Update `orders-shared.ts`, `pass2-shared.ts`, `pass2.ts`, and 0225: stable menu-size/customization identities; blank POS IDs become NULL; confirmed mappings feed shadow math. Add catering-admin review page/API/library with fresh catering_mgr or level 8+ authorization, Tier B step-up, destructive audit, and append-only decisions. Cover menu, item and package targets using existing recipe/assortment math.
2. Remove free-text-derived tokens from capture serialization. Reconcile raw notes transiently against known order numbers, restricted to captured catering orders with matching source timestamps. Give the shadow its own heartbeat, independent of operational sales health.
3. Preserve completed/lost manual transfers, bounded deadlock retry, informational provider/shop mismatch, and retryable missing-schema behavior. Check D-1/D production at every late-transfer shop without moving production records.
4. Edit 0225 in place (SIM version 20261008073152 only); supply sentinel/version-guarded SIM revert, updated rollback harnesses, and deploy order. Run full tests, typecheck and build; report actual results.

Contract risks: historical options without IDs remain unidentifiable until refreshed; source-version mismatch refuses a transient link; SQL and browser verification remain CC's gates. No operational depletion activation is part of PASS 2b.
