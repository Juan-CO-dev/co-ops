# Vendor export groundwork (offline)

From the repository root, using installed dependencies (no network or environment file):

```powershell
node_modules/.bin/tsx.cmd scripts/vendor-exports/normalize.ts
node_modules/.bin/tsx.cmd scripts/vendor-exports/diff.ts --as-of 2026-09-18
node_modules/.bin/vitest.cmd run tests/vendor-exports-parsers.test.ts tests/vendor-exports-diff.test.ts
npm.cmd test
```

`diff.ts` normalizes all current inputs once, then writes `docs/seed/source/vendor-exports/reports/<as-of>-{pfg,usfoods,receipts}-diff.md`. Receipt sections are vendor-scoped. Both entry points are import-safe. There is no apply mode, database dependency, `react-server` condition or credential read.

The sandbox used for this run denies Node's Windows `os.userInfo()` lookup, which tsx calls during startup (`uv_os_get_passwd` ENOMEM). In that environment only, this process-local launcher sets tsx's temporary-directory discriminator and uses its installed CJS hook; it neither edits tsx nor changes OS identity/privileges:

```powershell
node -e "process.geteuid=()=>0;process.argv[1]=require('node:path').resolve('scripts/vendor-exports/normalize.ts');require('tsx/cjs');require(process.argv[1]);"
node -e "process.geteuid=()=>0;process.argv[1]=require('node:path').resolve('scripts/vendor-exports/diff.ts');require('tsx/cjs');require(process.argv[1]);"
```

Inputs live under `docs/seed/source/vendor-exports/<vendor>/`, including nested folders. `context`, `reports` and `normalized` are reserved. `README.md` metadata is excluded; every data file must match one registered adapter. Unknown formats stop the run before output writes. PFG CustomerFirst, US Foods MOXē and CC receipt JSON transcriptions are implemented; OCR is not. US Foods account binding is specific to this reviewed capture, with list/date metadata pinned by filename. New adapters must pin independently measured real-file counts and malformed-input cases.

Outputs are JSON arrays of `ExportRow` from `model.ts`. Item numbers stay strings. `pack_size` is numeric except can designations such as `"#10"`; `pack_unparsed` appears only when parsing failed. Raw pack is always retained. Decimal cents are intentional: `$2.7263/lb` is `price_per_lb_cents: 272.63`, with `price_cents: null`. Date-only ISO strings preserve source precision. `source_line` is the original physical CSV row start, including when a quoted field spans lines. `account_id` and last-purchase UOM prevent unsafe cross-shop/unit comparisons.

The report separates exact guide numbers from description-family hypotheses. `diff-core.ts` holds review-only family synonyms: adding one changes candidate reporting, never authorizes an import. Its pure comparison functions accept an optional enriched catalog shape (item_number, raw pack, UOM and separate case/lb cents); the supplied readiness snapshot has none of those fields. Missing values stay unavailable. Physical pack equality requires matching hierarchy, not merely equal total contents. Price impact uses only a comparable last-event quantity in the inclusive 60-calendar-day window; it is not cumulative spend.

Repeated runs overwrite generated artifacts deterministically and read them back. Source files are untouched. Stale JSON may remain after an input is removed, but reports use only the current manifest. PFG/US Foods list comparisons reject mixed accounts. Receipt observations stay separate by vendor/document/line; missing account IDs remain unknown. PFG uses dated last events; US Foods uses undated Recently Purchased membership; receipts use actual document dates and measured pounds. None is cumulative purchase history for an assumed time window.

Ranges retain `pack_size_min`/`pack_size_max` with `pack_size: null`; LBA sets `pack_catch_weight`; three-level packs retain `pack_inner_qty`. Raw padding is retained in `pack`, while descriptions are trimmed. Price absence never means zero. Receipt `price_basis` preserves each/case/lb/dozen/bundle; printed quantity and billed rate remain separate from clarified bag prices. `net_wt_lb`, not piece quantity, extends catch-weight prices. See the handoff's exact export contract before enriching catalog comparisons.
