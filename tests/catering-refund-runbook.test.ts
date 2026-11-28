/**
 * The catering refunds runbook (docs/runbooks/catering-refunds.md) is pinned on the sentences that carry weight in
 * Part B1 (0359): the operator statement and its order, the four switch rows, the precondition, the staff exits, the
 * three required statements of step 8 ([Q6] / [S12], [T3], the purge order), and the Stripe citations, which may only
 * be the ones the plan's section 8 cites (PLAN-refundB1v2.md, fetched 2026-11-28). Text only; no database, no network.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runbook = readFileSync("docs/runbooks/catering-refunds.md", "utf8").replace(/\r\n/g, "\n");

/** Every run of whitespace (the 120-column line wrapping included) is one space. */
const squash = (s: string) => s.replace(/\s+/g, " ");

const PART_B_HEADING = "## Part B1: the Stripe mirror (0359)";
const partBStart = runbook.indexOf(PART_B_HEADING);
const partBEnd = runbook.indexOf("\n## ", partBStart + PART_B_HEADING.length);
const partBRaw = runbook.slice(partBStart, partBEnd === -1 ? undefined : partBEnd);
const partB = squash(partBRaw);
const flat = squash(runbook);

/** One Part B1 subsection ("### <n>. ..."), squashed. */
function step(n: number): string {
  const re = new RegExp(`\\n### ${n}\\. [^\\n]*\\n([\\s\\S]*?)(?=\\n### |$)`);
  const m = partBRaw.match(re);
  if (!m) throw new Error(`runbook Part B1 has no step ${n}`);
  return squash(m[0]);
}

/** Sentences of a text: split after . ; ! ? followed by a space. Table rows are split on their cells too. */
function sentences(text: string): string[] {
  return text
    .split("\n")
    .map((line) => (line.trimStart().startsWith("|") ? `\n${line.split("|").join("\n\n")}\n` : line))
    .join("\n")
    .split(/\n\s*\n/)
    .map(squash)
    .flatMap((block) => block.split(/(?<=[.;!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const NEGATION = /\b(never|not|no|do not|don['’]t|cannot|nothing|nobody|refuses?|refused|without)\b/i;

/** Plan section 8's URLs (hosts and paths exactly as the table cites them). Hard-coded: the plan is not in the repo. */
const PLAN_SECTION_8_URLS = [
  "docs.stripe.com/refunds",
  "docs.stripe.com/api/refunds/object",
  "docs.stripe.com/api/refunds/create",
  "docs.stripe.com/api/refunds/update",
  "docs.stripe.com/api/refunds/list",
  "docs.stripe.com/api/refunds/retrieve",
  "docs.stripe.com/api/pagination",
  "docs.stripe.com/api/charges/object",
  "docs.stripe.com/api/payment_intents/object",
  "docs.stripe.com/api/events/object",
  "docs.stripe.com/api/accounts/retrieve",
  "docs.stripe.com/api/idempotent_requests",
  "docs.stripe.com/error-low-level",
  "docs.stripe.com/development/dashboard/request-logs",
  "docs.stripe.com/workbench/overview",
  "docs.stripe.com/get-started/account",
  "docs.stripe.com/webhooks",
];
/** Part A's own citations (fetched 2026-11-26, the Juan checklist), outside Part B1. */
const PART_A_URLS = ["docs.stripe.com/refunds", "docs.stripe.com/receipts"];

const stripeUrls = (text: string) =>
  [...text.matchAll(/docs\.stripe\.com(\/[A-Za-z0-9_\-/]*[A-Za-z0-9_])?/g)].map((m) => m[0]);

describe("runbook Part B1 exists and is where the state table says", () => {
  it("has the Part B1 section and the 0359 state row", () => {
    expect(partBStart).toBeGreaterThan(0);
    expect(flat).toContain("| Part B1 (this runbook's PR) |");
    expect(flat).toContain("0359, NOT YET APPLIED (sim first, then prod on Juan's word");
    for (let n = 1; n <= 9; n += 1) expect(() => step(n)).not.toThrow();
  });
});

describe("step 1: the two switches", () => {
  it("has all four switch rows, in the plan's order", () => {
    const rows = [
      "| unset | unset | **Main, byte for byte, on every existing path.**",
      "| 1 | unset | GETs only, and only once ON is recorded",
      "| 1 | 1 | + the panel, Check Stripe, Attach, Release.",
      "| unset | 1 | The panel reads stored state;",
    ];
    const at = rows.map((r) => partBRaw.indexOf(r));
    for (const [i, r] of rows.entries()) expect(at[i], r).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("says both unset = main byte for byte, and turning either OFF drains nothing", () => {
    expect(step(1)).toContain("Both unset = main byte for byte.");
    expect(step(1)).toContain("Turning either switch OFF drains nothing.");
  });
});

describe("step 2: applying 0359", () => {
  it("states the precondition: CATERING_REFUNDS unset in every serving deployment for longer than 15 minutes", () => {
    const s = step(2);
    expect(s).toContain("**Precondition: every old sender is retired.**");
    expect(s).toContain("`CATERING_REFUNDS` has been unset in every serving deployment for longer than 15 minutes");
    expect(s).toContain("it cannot recall a main invocation that already claimed");
    expect(s).toContain("possibly sent");
  });

  it("has the steps, the locks, the deploy order and both rollback cases", () => {
    const s = step(2);
    for (const p of ["**Read-only pre-flight.**", "**Dry run**", "**apply**", "**Verify.**", "**Stamp the header**",
      "name '0359_catering_refund_mirror'", "`catering_refund_requests` ACCESS EXCLUSIVE",
      "SHARE ROW EXCLUSIVE on `catering_payments` and `users`", "**Deploy order: safe both ways,**",
      "While the mirror and state tables are empty and no request row is armed",
      "After observation has run (rows exist): both switches off + revert the PR."]) {
      expect(s, p).toContain(p);
    }
  });
});

describe("step 3: the operator statement [Q1] [T4]", () => {
  const ON = "select public.catering_refund_observe_set(true);";
  const OFF = "select public.catering_refund_observe_set(false);";

  it("names the ON statement, run first, before the env switch, EVERY time", () => {
    const s = step(3);
    expect(s).toContain("**Turn-on, EVERY time, in this order:**");
    const a = s.indexOf("(a) CC runs the ONE operator statement, as the database owner");
    const stmt = s.indexOf(ON);
    const b = s.indexOf("(b) Then set `CATERING_REFUNDS_OBSERVE=1`.");
    expect(a).toBeGreaterThan(-1);
    expect(stmt).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(stmt);
    expect(s).toContain("It prints the new transition count and how many payments it stamped.");
  });

  it("orders the turn-off: env switch first, then the OFF statement", () => {
    const s = step(3);
    const off = s.indexOf("**Turn-off, in this order:** unset `CATERING_REFUNDS_OBSERVE`, then run");
    expect(off).toBeGreaterThan(-1);
    expect(s.indexOf(OFF)).toBeGreaterThan(off);
  });

  it("the migration's operator statement is the one the runbook names", () => {
    const sql = readFileSync("supabase/migrations/0359_catering_refund_mirror.sql", "utf8");
    expect(sql).toContain("create function public.catering_refund_observe_set(p_on boolean) returns jsonb");
  });

  it("says every payment waits 5 minutes after a turn-on, the first tick reads nothing, and to watch never_read", () => {
    const s = step(3);
    expect(s).toContain("**After any turn-on or resume, EVERY payment shows no figure for at least 5 minutes, read or never read.**");
    expect(s).toContain("The first sweep tick after a turn-on reads nothing; the next one starts reading.");
    expect(s).toContain("until `never_read = 0`");
    expect(s).toContain("**If a step is skipped.**");
    expect(s).toContain("after a recorded OFF the sweep refuses to work (`observe_not_recorded`)");
  });
});

describe("step 4: inventory sign-off [T6]", () => {
  it("names the page, both stamps, and the do-not-sign-off rule", () => {
    const s = step(4);
    expect(s).toContain("`/admin/catering/refunds`");
    expect(s).toContain("\"last claim\" AND \"last finished pass\"");
    expect(s).toContain("**A claim newer than the last finished pass means a sweep that started and did not finish: do not sign off.**");
    expect(s).toContain("on TWO loads at least 15 minutes apart, with the SAME transition count on both");
  });
});

describe("step 5: create turn-on", () => {
  it("needs B2 and B3 merged AND applied, the checklist, the sign-off and Juan's word; never a production refund as proof", () => {
    const s = step(5);
    expect(s).toContain("B2 and B3 are merged AND applied.");
    expect(s).toContain("`REFUND_PARTS_BUILT`");
    expect(s).toContain("Juan's word.");
    expect(s).toContain("**Never create a production refund as proof**");
  });
});

describe("step 6: the unconfirmed refund and its exits", () => {
  it("quotes the two fixed texts (plan 4.3 and [S11])", () => {
    const s = step(6);
    expect(s).toContain("\"Stripe has not confirmed this refund. Do not refund it again. We keep checking. If it is still not found after <releasableAt>, a MoO or the owner can resolve it.\"");
    expect(s).toContain("\"This copy of your press did not send a refund. Check the list below before you try again.\"");
  });

  it("attach: the request SUCCEEDED, any time; release: NO request or FAILED with no refund, after 24 h, naming account and mode", () => {
    const s = step(6);
    expect(s).toContain("**The request SUCCEEDED:** Attach the refund it created.");
    expect(s).toContain("Attach works at any time; there is no 24 h wait.");
    expect(s).toContain("**NO request, or a request that FAILED with no refund:** Release. Only after 24 h from the send");
    expect(s).toContain("Name the account and the mode you read; they must be the payment's own.");
  });

  it("could not tell = no in-app exit, tell CC; and the CC-only cases [T5] [P3-f]", () => {
    const s = step(6);
    expect(s).toContain("**Could not tell, or the refund the log names is not in the list:** there is no in-app exit, by design. Tell CC");
    expect(s).toContain("(`credential_changed`). Nobody can release or attach it in the app: tell CC.");
    expect(s).toContain("**An armed request whose payment stopped being eligible** has only the CC exit.");
  });

  it("names the expected cases: the arm's own second [T1], and a send that never left [P3-e]", () => {
    const s = step(6);
    expect(s).toContain("**A refund our own request created in the same second as the arm is never bound automatically.**");
    expect(s).toContain("A person attaches it");
    expect(s).toContain("Release it after 24 h with the finding \"no request\".");
  });
});

describe("step 8: the three required statements", () => {
  it("[Q6] [S12]: the accepted residual, and the lag can exceed five minutes", () => {
    const s = step(8);
    expect(s).toContain("Stripe does not document that a list or a retrieve already shows a change when its webhook arrives, so B1 waits 5 minutes after any sign of change before it shows or uses a figure.");
    expect(s).toContain("**This lag can exceed five minutes.**");
    expect(s).toContain("A change that neither an event nor a read shows yet can still be missed, inside the charge's own cap.");
  });

  it("[T3]: gaps = retention only; a delivery lost inside the ledger is a P3 residual covered by the hourly re-read", () => {
    const s = step(8);
    expect(s).toContain("\"Gaps\" in main's webhook ledger means retention only.");
    expect(s).toContain("A delivery lost INSIDE the ledger is not seen from the ledger (accepted residual, P3).");
    expect(s).toContain("every payment inside the 120-day window gets a complete read about every hour (due 45 minutes after its last one, on the 15-minute cron");
    expect(s).toContain("A create never rests on the re-read: it makes its own complete read in the same request.");
    expect(s).toContain("Beyond 120 days only an event or a staff press re-reads.");
  });

  it("the purge order: B1's rows BEFORE the payment rows", () => {
    expect(step(8)).toContain("must delete B1's rows (`catering_refund_observed`, `catering_refund_payment_state`) BEFORE the payment rows.");
  });

  it("[T2] and [T7] are stated", () => {
    const s = step(8);
    expect(s).toContain("Two copies of one press, or a press that meets a sweep read in flight, answer \"check the list\" and the payment shows no figure for 5 minutes.");
    expect(s).toContain("B1 never writes a table or column main reads for its own logic");
  });
});

describe("step 9 and every citation: only plan section 8's Stripe URLs", () => {
  it("every docs.stripe.com URL in Part B1 is one plan section 8 cites", () => {
    const urls = stripeUrls(partB);
    expect(urls.length).toBeGreaterThan(10);
    for (const u of urls) expect(PLAN_SECTION_8_URLS, u).toContain(u);
  });

  it("outside Part B1 only Part A's two citations appear", () => {
    const outside = runbook.slice(0, partBStart) + (partBEnd === -1 ? "" : runbook.slice(partBEnd));
    for (const u of stripeUrls(outside)) expect(PART_A_URLS, u).toContain(u);
  });

  it("keeps the UNVERIFIED row, read-after-write included", () => {
    const s = step(9);
    expect(s).toContain("| **UNVERIFIED, each with the side taken** |");
    expect(s).toMatch(/\*\*Read-after-write\*\* \(that a list or retrieve already shows a change when its webhook arrives\): \*\*accepted in writing by CC \[Q6\]\*\*/);
    const row = s.slice(s.indexOf("| **UNVERIFIED, each with the side taken** |"));
    expect(row).toContain("UNVERIFIED");
    expect(row.indexOf("Read-after-write")).toBeGreaterThan(-1);
  });
});

describe("the runbook never tells anyone to make a test refund, retry a refund, or change webhook subscriptions", () => {
  it("every sentence about a production / live refund as a test or proof is a prohibition", () => {
    const hits = sentences(runbook).filter((s) => /\b(production|live|real) refund\b/i.test(s) && /\b(test|proof|prove|try)\b/i.test(s));
    expect(hits.length).toBeGreaterThan(0); // the prohibition itself is there
    for (const s of hits) expect(s, s).toMatch(NEGATION);
  });

  it("every Part B1 sentence about retrying is a prohibition", () => {
    // Part A describes the merged #638 (its Retry button); Part B1 is what operators follow from 0359 on.
    for (const s of sentences(partBRaw).filter((x) => /\bretr(y|ied|ies|ying)\b/i.test(x))) expect(s, s).toMatch(NEGATION);
    for (const s of sentences(partBRaw).filter((x) => /\b(send|post|refund) it again\b/i.test(x))) expect(s, s).toMatch(NEGATION);
  });

  it("every sentence about webhook subscriptions or the Stripe account's settings is a prohibition", () => {
    const hits = sentences(runbook).filter((s) => /subscri|webhook endpoint|Stripe account change/i.test(s));
    for (const s of hits) expect(s, s).toMatch(NEGATION);
    expect(step(3)).toContain("No Stripe account change is made, before or after.");
  });
});
