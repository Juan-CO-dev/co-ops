/**
 * Unit spine — `reviseQuote`'s TWO STRANDS (audit v2, seat C5, finding F8).
 *
 * A quote revision is append-only: supersede the live row, insert version+1, then insert
 * the new revision's line items. Three round trips, no transaction, and neither of the two
 * writes below the supersede was compensated.
 *
 *   STRAND A — the HEADER insert fails. The family now has NO `superseded_at IS NULL` row
 *   at all: `loadCurrentQuote` returns null, the pipeline surface shows no quote, and
 *   `reviseQuote` on the old id 409s `not_current` from here on. The family is
 *   UNRECOVERABLE through this function. Fixed here, with lib/cash.ts's compare-and-set
 *   revert.
 *
 *   STRAND B — the ITEMS insert fails. The new revision is LIVE with zero line items and a
 *   non-zero snapshot total, so `resolveQuoteDemand` returns [] and prep demand silently
 *   reserves nothing for a real event. NOT fixed here, deliberately — see the test that
 *   pins the reasoning. It gets forensics instead of a rollback.
 *
 * The function's own header comment asserted the opposite ("the payload is fully validated
 * + the new stack computed BEFORE the supersede UPDATE, so a failed insert can't strand the
 * family"). Moving validation earlier does not make an INSERT infallible; that claim was the
 * finding, and it is corrected.
 *
 * WHY SOURCE ASSERTION. `reviseQuote` takes no client parameter — it reaches for
 * `getServiceRoleClient()` internally — so there is no seam to hang a tape on, and the
 * spine has no Supabase env by design. The guarantee under test is an ORDERING and an
 * ABSENCE, which is the shape the house asserts at the source.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const src = read("lib/catering/quotes.ts");
const body = (() => {
  const start = src.indexOf("export async function reviseQuote(");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
})();
/** The JSDoc block immediately above reviseQuote. */
const header = () => {
  const fn = src.indexOf("export async function reviseQuote(");
  return src.slice(Math.max(0, fn - 2600), fn);
};
const at = (needle: string) => {
  const i = body.indexOf(needle);
  expect(i, `reviseQuote body is missing ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("the supersede still guards on the live row — the existing design is untouched", () => {
  it("stamps only the still-live revision, and checks the rowcount", () => {
    expect(body).toMatch(/\.is\("superseded_at", null\)/);
    expect(body).toMatch(/count === 0/);
    expect(body).toMatch(/"not_current"/);
  });

  it("still validates and computes the whole new stack before the supersede", () => {
    // Correct as far as it goes, and worth keeping: it removes every AVOIDABLE failure
    // from below the supersede. It just never made the INSERT itself infallible.
    expect(at("computeChargeStack(")).toBeLessThan(at("reviseQuote supersede:"));
  });
});

describe("STRAND A — a failed header insert puts the live revision back", () => {
  it("captures the supersede stamp as a value", () => {
    expect(body).toMatch(/const supersededAt = new Date\(\)\.toISOString\(\)/);
    expect(body).toMatch(/superseded_at: supersededAt/);
  });

  it("reverts superseded_at to null on the header-insert error path", () => {
    const revert = body.indexOf("superseded_at: null");
    expect(revert).toBeGreaterThan(-1);
    expect(revert).toBeGreaterThan(at("reviseQuote insert:") - 2000);
  });

  it("matches on the quote id AND our own stamp, never the row alone", () => {
    // Two revisers racing both read `current`; the loser must not lift the winner's stamp.
    const revert = body.slice(body.indexOf("superseded_at: null"));
    expect(revert).toMatch(/\.eq\("id", quoteId\)/);
    expect(revert).toMatch(/\.eq\("superseded_at", supersededAt\)/);
  });

  it("checks the revert's rowcount and reports a failure loudly", () => {
    const revert = body.slice(body.indexOf("superseded_at: null"));
    expect(revert).toMatch(/\{ count: "exact" \}/);
    expect(revert).toMatch(/console\.error/);
  });

  it("still rethrows — the revision genuinely did not land", () => {
    expect(body).toMatch(/throw new Error\(`reviseQuote insert: \$\{iErr\.message\}`\)/);
    expect(body.indexOf("superseded_at: null")).toBeLessThan(at("throw new Error(`reviseQuote insert:"));
  });
});

describe("STRAND B — a failed items insert is made QUERYABLE, not rolled back", () => {
  it("catches the items-insert failure instead of letting it escape unrecorded", () => {
    expect(at("insertQuoteItems(")).toBeGreaterThan(at("reviseQuote insert:"));
    expect(body).toMatch(/catch \(itemsErr\)/);
  });

  it("records it on the action this write already speaks — no new vocabulary", () => {
    // AGENTS.md: the audit action vocabulary is CLOSED and compiler-enforced. The signal
    // rides `catering.quote.revise`'s metadata, the way pack-chain's sync outcome does.
    const failure = body.slice(at("catch (itemsErr)"));
    expect(failure).toMatch(/action: "catering\.quote\.revise"/);
    expect(failure).toMatch(/outcome: "items_insert_failed"/);
  });

  it("awaits that audit row before rethrowing — a fail-open helper never throws", () => {
    const failure = body.slice(at("catch (itemsErr)"));
    expect(failure).toMatch(/await audit\(/);
    expect(failure.indexOf("await audit(")).toBeLessThan(failure.indexOf("throw itemsErr"));
  });

  it("does NOT attempt a two-write rollback, and says why", () => {
    // THE REASONING, PINNED. Undoing strand B means superseding the new revision AND
    // un-superseding the old one — two more un-transactional writes whose own partial
    // failure lands the family in STRAND A, the unrecoverable state this PR just closed.
    // A repair path that can produce a worse outcome than the fault is not a repair. The
    // correct fix is one RPC (0188's shape for cash), which is a migration + a wiring PR.
    const failure = body.slice(at("catch (itemsErr)"));
    expect(failure).not.toMatch(/superseded_at: null/);
    expect(header()).toMatch(/ONE RPC/);
  });
});

describe("the docstring no longer claims the strand is impossible", () => {
  it("the false assertion is gone", () => {
    expect(src).not.toMatch(/so a failed insert can't strand the family/);
  });

  it("and the header names both strands honestly", () => {
    expect(header()).toMatch(/audit v2|F8/);
    expect(header()).toMatch(/insertQuoteItems|items/);
  });
});
