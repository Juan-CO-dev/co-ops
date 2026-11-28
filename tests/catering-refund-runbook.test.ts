/**
 * The catering refunds runbook (docs/runbooks/catering-refunds.md) is held to the files it describes: the migration
 * stamps, the closed issue / disposition vocabulary of Part B1 (0359), and the platform claims the plan marks
 * UNVERIFIED (PLAN-refund2B-r5, "Platform evidence and limits", the rows B1 relies on). Text only; no database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REFUND_DISPOSITION_ACTIONS, REFUND_ISSUE_CODES } from "@/lib/catering/refund-outcomes-shared";

const runbook = readFileSync("docs/runbooks/catering-refunds.md", "utf8").replace(/\r\n/g, "\n");
const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const header = (text: string) => text.split("\n").slice(0, 8);
const PROD_STAMP = (name: string) => new RegExp(`^-- APPLIED TO PROD (\\d{4}-\\d{2}-\\d{2}) UTC \\(schema_migrations version (\\d{14}), name '${name}'\\)$`);

/** A runbook "block": a paragraph (lines up to a blank line), with every table row its own block. */
const blocks = runbook
  .split(/\n\s*\n/)
  .flatMap((b) => (b.trimStart().startsWith("|") ? b.split("\n") : [b]))
  .map((b) => b.replace(/\s*\n\s*/g, " "));
/** The runbook with its prose line wrapping undone (wrapped at 120 columns); list items and table rows stay lines. */
const flat = runbook.replace(/[ \t]*\n[ \t]*(?=\S)(?![|#-]|\d+\. )/g, " ");
const blockWith = (phrase: string) => blocks.filter((b) => b.toLowerCase().includes(phrase.toLowerCase()));

describe("the runbook's migration stamps are the files'", () => {
  it("runbook_matches_0358_stamp: the runbook's 0358 prod stamp equals the `-- APPLIED TO PROD` line in 0358's header", () => {
    const lines = header(migration("0358_catering_refund_roles"));
    expect(lines[1]).toContain("NOT YET APPLIED -- GATE CC/JUAN"); // the gate line stays; the stamp goes under it
    const stamps = lines.map((l) => l.match(PROD_STAMP("0358_catering_refund_roles"))).filter((m): m is RegExpMatchArray => m !== null);
    expect(stamps).toHaveLength(1);
    const [, date, version] = stamps[0]!;
    const inRunbook = [...runbook.matchAll(/0358, APPLIED TO PROD (\d{4}-\d{2}-\d{2}) UTC \(version (\d{14})\)/g)];
    expect(inRunbook).toHaveLength(1);
    expect([inRunbook[0]![1], inRunbook[0]![2]]).toEqual([date, version]);
    expect([date, version]).toEqual(["2026-11-27", "20261127204650"]); // plan B1.6: the corrected Part A stamp
    // The stale claim is gone.
    expect(runbook).not.toMatch(/NOT YET APPLIED TO PROD \(see "Applying 0358"\)/);
    expect(flat).toContain("Done 2026-11-27 UTC: `schema_migrations` version 20261127204650");
  });

  it("runbook_matches_0358_stamp: the runbook names 0359 NOT YET APPLIED exactly while the migration header still carries only its gate line", () => {
    const lines = header(migration("0359_catering_refund_reconciler"));
    expect(lines[1]).toContain("NOT YET APPLIED -- GATE CC/JUAN");
    const prodStamped = lines.some((l) => PROD_STAMP("0359_catering_refund_reconciler").test(l));
    expect(prodStamped).toBe(false); // when this flips, stamp the runbook's table in the same PR
    expect(runbook).toContain("| 0359, NOT YET APPLIED (sim first, then prod on Juan's word; see \"Part B1 — money (0359)\") |");
    expect(runbook).toContain("## Part B1 — money (0359)");
    // The stamp the runbook tells CC to write is the house form the 0358 test pins.
    expect(runbook).toContain("`-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0359_catering_refund_reconciler')`");
  });
});

describe("Part B1's closed vocabulary is all in the runbook", () => {
  it("every issue code and every disposition action appears (in backticks), with a row per issue code in the exits table", () => {
    for (const c of REFUND_ISSUE_CODES) {
      expect(runbook, c).toContain(`\`${c}\``);
      expect(runbook.split("\n").filter((l) => l.startsWith(`| \`${c}\` |`)), c).toHaveLength(1);
    }
    for (const a of REFUND_DISPOSITION_ACTIONS) expect(runbook, a).toContain(`\`${a}\``);
    expect(flat).toContain("**Direct SQL repair is never the procedure.**");
    expect(flat).toContain("an active MoO with an active");
    expect(flat).toContain("**with a fresh password** (Tier B, 120 seconds)");
  });

  it("the activation order, the stop and the dark ship are stated as the plan and addendum define them", () => {
    expect(flat).toContain("**It ships DARK and opens NO epoch.**");
    expect(flat).toContain("**B1 alone CANNOT be activated.**");
    expect(runbook).toContain("`scratchpad/refund-0359/`");
    // The order: open recovery OFF and read it back, THEN the switch.
    const open = flat.indexOf("**Open recovery with the switch OFF, and read it back.**");
    const sw = flat.indexOf("**Only then set `CATERING_REFUNDS=1`.**");
    const promote = flat.indexOf("**One promotion, with the acknowledged counts.**");
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(sw);
    expect(sw).toBeLessThan(promote);
    expect(flat).toContain("**cumulative-gap list** `cumulative_gaps` (addendum Opus P3-c)");
    // Drain before off; A2's classes; break glass only on Juan's word; A3 (i).
    expect(runbook).toContain("### The stop: drain BEFORE off");
    for (const c of ["`outstanding_events`", "`admitted_senders`", "`out_of_scope`", "`pending_whole_refunds`", "`payment_not_found`"]) expect(runbook, c).toContain(c);
    expect(flat).toContain("**ONLY on Juan's explicit word**");
    expect(runbook).toContain("select public.catering_refund_adopt_contract_upgrade(");
    expect(runbook.match(/\*\*[Nn]eeds Juan's word\.?\*\*/g)!.length).toBeGreaterThanOrEqual(5);
    expect(flat).toContain("**Only while no epoch was ever opened**");
  });
});

describe("platform claims: quoted with their URL, or marked UNVERIFIED", () => {
  /** Every UNVERIFIED item of the plan's B1 platform rows and of its closing UNVERIFIED list. */
  const UNVERIFIED = [
    "a blanket inference of nonexecution from HTTP 4xx",
    "cross-key idempotency retention after a same-account key rotation",
    "a 404 proving that an object belongs to a different account",
    "this installation's cap",
    "this installation's schedule entitlement, runtime limit and on-time execution",
    "list/read-after-write latency",
    "atomicity across provider GETs",
    "universal status finality",
    "exhaustive refund-ID prefixes",
    "availability of expanded refunds in this endpoint's charge payload",
    "whether every pending creation emits `charge.refunded`",
    "behavior of cumulative flags after every failure",
    "a universal provider timestamp for first success",
  ];

  it("every UNVERIFIED item of the plan's B1 platform rows appears, marked UNVERIFIED where it is stated", () => {
    for (const item of UNVERIFIED) {
      const where = blockWith(item);
      expect(where.length, item).toBeGreaterThan(0);
      for (const b of where) expect(b, item).toContain("UNVERIFIED");
    }
  });

  it("every quoted B1 platform row carries its official URL", () => {
    for (const url of [
      "https://docs.stripe.com/api/refunds/list", "https://docs.stripe.com/api/refunds/retrieve", "https://docs.stripe.com/api/pagination",
      "https://docs.stripe.com/api/refunds/object", "https://docs.stripe.com/api/payment_intents/object", "https://docs.stripe.com/api/charges/object",
      "https://docs.stripe.com/error-low-level", "https://docs.stripe.com/api/idempotent_requests", "https://docs.stripe.com/api/refunds/create",
      "https://docs.stripe.com/webhooks", "https://docs.stripe.com/api/events/types", "https://docs.stripe.com/refunds#refund-events",
      "https://supabase.com/docs/reference/python/select", "https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs",
    ]) expect(runbook, url).toContain(url);
    // Each row of the B1 platform table quotes something or says UNVERIFIED.
    const table = runbook.slice(runbook.indexOf("### Platform evidence and limits"), runbook.indexOf("### Rollback of the schema"));
    const rows = table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Behavior") && !l.startsWith("|---"));
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(r.includes("\"") || r.includes("**UNVERIFIED:**"), r).toBe(true);
  });
});
