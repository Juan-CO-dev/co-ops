/**
 * Unit spine — the audit action vocabulary (lib/audit-actions.ts +
 * lib/destructive-actions.ts).
 *
 * THE GAP THIS CLOSES. `AuditInput.action` was typed `string`, and the registry
 * is a list of what IS destructive with no notion of what EXISTS. So an
 * unregistered action and a deliberately-non-destructive one were
 * indistinguishable, and a new action defaulted silently to destructive=false.
 * That is how seven product.* actions shipped unregistered (sim P2, 2026-08-21)
 * and how `section_question.update` / `item_question.update` sat unregistered
 * beside their own already-registered `create` and `disable` siblings.
 *
 * The primary enforcement is now the COMPILER — `action` is typed as the union,
 * so an unlisted spelling fails the build at the call site. These tests pin the
 * set invariants a type cannot express, the same shape as
 * tests/readiness.test.ts's KNOWN_REASONS check: bidirectional, and failing with
 * the offending NAMES printed rather than a bare count.
 */
import { describe, it, expect } from "vitest";

import { DESTRUCTIVE_ACTIONS, isDestructive } from "@/lib/destructive-actions";
import {
  AUDIT_ACTIONS,
  NON_DESTRUCTIVE_ACTIONS,
  RESERVED_ACTIONS,
  isKnownAuditAction,
  type AuditAction,
} from "@/lib/audit-actions";

const destructive = new Set<string>(DESTRUCTIVE_ACTIONS);
const nonDestructive = new Set<string>(NON_DESTRUCTIVE_ACTIONS);

describe("the vocabulary is CLOSED and every action is adjudicated exactly once", () => {
  it("no action is both destructive and non-destructive", () => {
    const both = [...destructive].filter((a) => nonDestructive.has(a));
    expect(both).toEqual([]);
  });

  it("DESTRUCTIVE_ACTIONS has no duplicates", () => {
    const seen = new Set<string>();
    const dupes = DESTRUCTIVE_ACTIONS.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
    expect(dupes).toEqual([]);
  });

  it("NON_DESTRUCTIVE_ACTIONS has no duplicates", () => {
    const seen = new Set<string>();
    const dupes = NON_DESTRUCTIVE_ACTIONS.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
    expect(dupes).toEqual([]);
  });

  it("AUDIT_ACTIONS is exactly the union of the two lists", () => {
    expect(AUDIT_ACTIONS.length).toBe(DESTRUCTIVE_ACTIONS.length + NON_DESTRUCTIVE_ACTIONS.length);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("isDestructive agrees with list membership for EVERY action in the vocabulary", () => {
    const disagreements = AUDIT_ACTIONS.filter((a) => isDestructive(a) !== destructive.has(a));
    expect(disagreements).toEqual([]);
  });

  it("isKnownAuditAction accepts the vocabulary and rejects a plausible typo", () => {
    for (const a of AUDIT_ACTIONS) expect(isKnownAuditAction(a)).toBe(true);
    expect(isKnownAuditAction("product.set_actve")).toBe(false);
    expect(isKnownAuditAction("")).toBe(false);
  });
});

describe("RESERVED_ACTIONS — registered but not emitted from TypeScript", () => {
  it("every reserved action is registered as destructive", () => {
    // Reserved means "in the registry, nothing in TS writes it yet". A name that
    // is not in the registry at all does not belong on this list.
    const notRegistered = RESERVED_ACTIONS.filter((a) => !destructive.has(a));
    expect(notRegistered).toEqual([]);
  });

  it("no reserved action is ALSO on the non-destructive list", () => {
    const contradictory = RESERVED_ACTIONS.filter((a) => nonDestructive.has(a));
    expect(contradictory).toEqual([]);
  });

  it("carries report.update, which is emitted from SQL and invisible to a JS scan", () => {
    // submit_am_prep_atomic INSERTs the audit row itself and sets destructive
    // literally, bypassing isDestructive(). Without this list that live action
    // would look like a registered name nothing writes.
    expect(RESERVED_ACTIONS).toContain("report.update");
  });
});

describe("naming law (AGENTS.md § Audit vocabulary)", () => {
  it("every action is dot-namespaced OR in the flat auth_/session_ namespace", () => {
    // "Never invent parallel action names." A flat name outside the auth family
    // is the drift this catches.
    const offenders = AUDIT_ACTIONS.filter(
      (a) => !a.includes(".") && !a.startsWith("auth_") && !a.startsWith("session_"),
    );
    expect(offenders).toEqual([]);
  });

  it("no action has whitespace, capitals, or a trailing dot", () => {
    const malformed = AUDIT_ACTIONS.filter((a) => !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(a));
    expect(malformed).toEqual([]);
  });
});

describe("the 2026-08-21 sweep — the filed gap is closed and stays closed", () => {
  // The sim filed "seven"; the live sweep found ten. Pinned by name so a
  // regression is a named failure, not a silent count drift.
  const SWEPT = [
    "product.create",
    "product.member_attach",
    "product.member_detach",
    "product.primary_set",
    "product.unit_oz_set",
    "product.set_active",
    "sku.weight_fill",
    "item.weight_fill",
    "section_question.update",
    "item_question.update",
  ] as const;

  it.each(SWEPT)("%s is registered destructive", (action) => {
    expect(isDestructive(action)).toBe(true);
  });

  it("product.resolution_flip is deliberately NOT destructive", () => {
    // The one member of the product.* family that is a SYSTEM OBSERVATION, not a
    // human act: materializeDailyDepletion writes it with actor_id null when a
    // vendor-down failover moves which member a product resolves to. Nobody
    // changed the configuration — the configuration's consequence was recorded.
    // Marking it destructive would put a nightly automated row in the answer to
    // "who changed the kitchen?".
    expect(isDestructive("product.resolution_flip")).toBe(false);
    expect(NON_DESTRUCTIVE_ACTIONS).toContain("product.resolution_flip");
  });

  it("every question lifecycle verb is registered — create, update AND disable", () => {
    // The asymmetry that hid the gap: create and disable were registered, update
    // was not, so a filter on "who changed the prep questions" returned every
    // add and removal and silently missed every edit.
    for (const stem of ["section_question", "item_question"]) {
      for (const verb of ["create", "update", "disable"]) {
        expect(isDestructive(`${stem}.${verb}`), `${stem}.${verb}`).toBe(true);
      }
    }
  });
});

describe("the type is the primary guard", () => {
  it("rejects an unlisted action at COMPILE time", () => {
    const ok: AuditAction = "product.set_active";
    // @ts-expect-error — an unlisted spelling must not be assignable. If this
    // line ever stops erroring, the vocabulary has been widened back to `string`
    // and every guarantee in this file is decorative.
    const bad: AuditAction = "product.set_actve";
    expect(ok).toBe("product.set_active");
    expect(bad).toBe("product.set_actve");
  });
});
