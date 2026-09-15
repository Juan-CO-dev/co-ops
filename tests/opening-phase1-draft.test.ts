/**
 * Unit spine — THE PHASE 1 DRAFT (LRA-121 / STAFF-5, migration 0203).
 *
 * The draft is the only thing standing between an employee's whole opening walk and the
 * bin when the key holder opens the same instance on their own device. Two properties
 * carry that weight and both are pure, so both are pinned here:
 *
 *   1. THE ROUND TRIP. What the client builds is byte-identically what the parser
 *      accepts — the route validates with the same function the loader re-runs on
 *      read-back, so a shape the client can write but the page cannot read is
 *      structurally impossible. The client's autosave dedup also compares serialized
 *      payloads, so a build→parse that renormalized anything would make every load
 *      write once.
 *   2. REJECT-WHOLE. A malformed draft is `null`, never a partial object. A draft that
 *      half-parses hydrates a form with one silently missing field — and a blank field
 *      the operator believes they filled is precisely the LRA-121 failure wearing a
 *      different hat.
 *
 * Plus the precedence rule (completion > draft > empty), extracted as a pure function
 * exactly so the client's seed and this assertion cannot drift.
 */
import { describe, it, expect } from "vitest";

import {
  OPENING_DRAFT_ATTESTATION_REASONS,
  OPENING_DRAFT_MAX_ITEMS,
  OPENING_DRAFT_MAX_KEY_LENGTH,
  OPENING_DRAFT_MAX_SECTIONS,
  OPENING_DRAFT_MIN_LEVEL,
  OPENING_DRAFT_TEXT_MAX,
  OPENING_PHASE1_DRAFT_VERSION,
  buildOpeningPhase1Draft,
  emptyOpeningPhase1Draft,
  openingPhase1ValueSource,
  parseOpeningPhase1Draft,
  type OpeningPhase1Draft,
  type OpeningPhase1DraftItem,
} from "@/lib/opening-draft-shared";

const item = (patch: Partial<OpeningPhase1DraftItem> = {}): OpeningPhase1DraftItem => ({
  countValue: null,
  photoId: null,
  notes: null,
  ticked: false,
  openerRecount: null,
  ...patch,
});

/** The sim journey's own shape: three stations ticked, one temp at 38, one comment. */
const journeyDraft = (): OpeningPhase1Draft => ({
  version: 1,
  items: {
    "11111111-1111-4111-8111-111111111111": item({ ticked: true, countValue: 38 }),
    "22222222-2222-4222-8222-222222222222": item({
      ticked: true,
      notes: "Synthetic G1-A EM: station checked; tablet charging.",
    }),
    "33333333-3333-4333-8333-333333333333": item({ ticked: true, openerRecount: 4 }),
  },
  sections: { proteins: true, produce: false },
  openerNoPriorDataAttestation: null,
});

describe("parseOpeningPhase1Draft — the round trip", () => {
  it("accepts a full draft unchanged", () => {
    const draft = journeyDraft();
    expect(parseOpeningPhase1Draft(draft)).toEqual(draft);
  });

  it("round-trips what buildOpeningPhase1Draft produces, byte for byte", () => {
    const built = buildOpeningPhase1Draft(
      Object.entries(journeyDraft().items),
      Object.entries(journeyDraft().sections),
    );
    const parsed = parseOpeningPhase1Draft(built);
    expect(parsed).toEqual(built);
    // The client's autosave dedup compares serialized payloads; a renormalization on
    // either side would make every page load write a "changed" draft.
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(built));
  });

  it("survives a JSON round trip (the jsonb column, and the sendBeacon body)", () => {
    const draft = journeyDraft();
    expect(parseOpeningPhase1Draft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it("accepts an empty draft — a fresh, untouched opening", () => {
    expect(parseOpeningPhase1Draft(emptyOpeningPhase1Draft())).toEqual({
      version: OPENING_PHASE1_DRAFT_VERSION,
      items: {},
      sections: {},
      openerNoPriorDataAttestation: null,
    });
  });
});

describe("parseOpeningPhase1Draft — the no-prior-data attestation", () => {
  it.each(["planned_closure", "missed_or_unknown"] as const)(
    "round-trips %s",
    (reason) => {
      const draft = { ...journeyDraft(), openerNoPriorDataAttestation: reason };
      expect(parseOpeningPhase1Draft(draft)).toEqual(draft);
      // And through the jsonb column / the sendBeacon body.
      expect(parseOpeningPhase1Draft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    },
  );

  it("reads an explicit null as null", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: {},
      sections: {},
      openerNoPriorDataAttestation: null,
    });
    expect(parsed?.openerNoPriorDataAttestation).toBeNull();
  });

  it("reads an ABSENT field as null — a pre-field draft still parses (additive to v1)", () => {
    const parsed = parseOpeningPhase1Draft({ version: 1, items: {}, sections: {} });
    expect(parsed).not.toBeNull();
    expect(parsed?.openerNoPriorDataAttestation).toBeNull();
  });

  it.each([
    ["an out-of-vocabulary reason", "forgot_to_ask"],
    ["a near-miss spelling", "planned-closure"],
    ["the empty string", ""],
    ["a number", 1],
    ["a boolean", true],
    ["an object", { reason: "planned_closure" }],
    ["an array of reasons", ["planned_closure"]],
  ])(
    "rejects the whole draft on %s — never coerces it to null",
    (_label, attestation) => {
      // Coercing would quietly erase a statement about the prior night that the opener
      // believes they made. Rejecting whole shows an empty prompt they can answer again.
      expect(
        parseOpeningPhase1Draft({
          version: 1,
          items: {},
          sections: {},
          openerNoPriorDataAttestation: attestation,
        }),
      ).toBeNull();
    },
  );

  it("pins the runtime vocabulary to exactly the two legal reasons", () => {
    expect([...OPENING_DRAFT_ATTESTATION_REASONS].sort()).toEqual([
      "missed_or_unknown",
      "planned_closure",
    ]);
  });
});

describe("parseOpeningPhase1Draft — rejects malformed input WHOLE", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "{}"],
    ["a number", 7],
    ["an array", [] as unknown],
    ["no version", { items: {}, sections: {} }],
    ["a future version", { version: 2, items: {}, sections: {} }],
    ["a stringified version", { version: "1", items: {}, sections: {} }],
    ["items missing", { version: 1, sections: {} }],
    ["sections missing", { version: 1, items: {} }],
    ["items as an array", { version: 1, items: [], sections: {} }],
    ["sections as an array", { version: 1, items: {}, sections: [] }],
  ])("rejects %s", (_label, raw) => {
    expect(parseOpeningPhase1Draft(raw)).toBeNull();
  });

  it.each([
    ["a non-object item", "nope"],
    ["countValue as a string", item({ countValue: "38" as unknown as number })],
    ["countValue NaN", item({ countValue: Number.NaN })],
    ["countValue Infinity", item({ countValue: Number.POSITIVE_INFINITY })],
    ["openerRecount as a string", item({ openerRecount: "4" as unknown as number })],
    ["notes as a number", item({ notes: 7 as unknown as string })],
    ["photoId as an object", item({ photoId: {} as unknown as string })],
    ["ticked missing", { countValue: null, photoId: null, notes: null, openerRecount: null }],
    ["ticked as a string", item({ ticked: "true" as unknown as boolean })],
  ])("rejects the whole draft when one item has %s", (_label, bad) => {
    const draft = journeyDraft() as unknown as { items: Record<string, unknown> };
    draft.items["44444444-4444-4444-8444-444444444444"] = bad;
    expect(parseOpeningPhase1Draft(draft)).toBeNull();
  });

  it("rejects a non-boolean section value", () => {
    const draft = journeyDraft() as unknown as { sections: Record<string, unknown> };
    draft.sections.fridges = "true";
    expect(parseOpeningPhase1Draft(draft)).toBeNull();
  });

  it("rejects an over-long key rather than truncating one", () => {
    const draft = journeyDraft() as unknown as { items: Record<string, unknown> };
    draft.items["x".repeat(OPENING_DRAFT_MAX_KEY_LENGTH + 1)] = item();
    expect(parseOpeningPhase1Draft(draft)).toBeNull();
  });

  it("rejects a draft over the item cap", () => {
    const items: Record<string, OpeningPhase1DraftItem> = {};
    for (let i = 0; i <= OPENING_DRAFT_MAX_ITEMS; i += 1) items[`item-${i}`] = item();
    expect(parseOpeningPhase1Draft({ version: 1, items, sections: {} })).toBeNull();
  });

  it("rejects a draft over the section cap", () => {
    const sections: Record<string, boolean> = {};
    for (let i = 0; i <= OPENING_DRAFT_MAX_SECTIONS; i += 1) sections[`section-${i}`] = true;
    expect(parseOpeningPhase1Draft({ version: 1, items: {}, sections })).toBeNull();
  });
});

describe("parseOpeningPhase1Draft — normalization", () => {
  it("drops unknown keys instead of rejecting (a newer client must not brick an older one)", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: { a: { ...item({ ticked: true }), futureField: "whatever" } },
      sections: {},
      futureTopLevel: 42,
    });
    expect(parsed).toEqual({
      version: 1,
      items: { a: item({ ticked: true }) },
      sections: {},
      openerNoPriorDataAttestation: null,
    });
    expect(parsed && "futureTopLevel" in parsed).toBe(false);
  });

  it("trims a note and collapses a whitespace-only note to null", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: {
        a: { ...item(), notes: "  walk-in door seal loose  " },
        b: { ...item(), notes: "   " },
      },
      sections: {},
    });
    expect(parsed?.items.a?.notes).toBe("walk-in door seal loose");
    expect(parsed?.items.b?.notes).toBeNull();
  });

  it("caps a note at OPENING_DRAFT_TEXT_MAX rather than rejecting the draft", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: { a: { ...item(), notes: "n".repeat(OPENING_DRAFT_TEXT_MAX + 500) } },
      sections: {},
    });
    expect(parsed?.items.a?.notes).toHaveLength(OPENING_DRAFT_TEXT_MAX);
  });

  it("treats an absent nullable field as null, not as malformed", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: { a: { ticked: true } },
      sections: {},
    });
    expect(parsed?.items.a).toEqual(item({ ticked: true }));
  });

  it("keeps a legitimate zero — a 0°F reading is a measurement, not an absence", () => {
    const parsed = parseOpeningPhase1Draft({
      version: 1,
      items: { a: { ...item(), countValue: 0, openerRecount: 0 } },
      sections: {},
    });
    expect(parsed?.items.a?.countValue).toBe(0);
    expect(parsed?.items.a?.openerRecount).toBe(0);
  });

  it("keeps a false section verify distinct from an absent one", () => {
    const parsed = parseOpeningPhase1Draft({ version: 1, items: {}, sections: { proteins: false } });
    expect(parsed?.sections.proteins).toBe(false);
    expect(parsed?.sections.produce).toBeUndefined();
  });
});

describe("buildOpeningPhase1Draft", () => {
  it("normalizes the way the parser does, so build → parse is a fixed point", () => {
    const built = buildOpeningPhase1Draft(
      [
        ["a", item({ notes: "  trimmed  ", ticked: true })],
        ["b", item({ notes: "   ", countValue: Number.NaN })],
      ],
      [["proteins", true]],
    );
    expect(built.items.a?.notes).toBe("trimmed");
    expect(built.items.b?.notes).toBeNull();
    expect(built.items.b?.countValue).toBeNull();
    expect(parseOpeningPhase1Draft(built)).toEqual(built);
  });

  it("drops entries past the caps instead of failing — an autosave never blocks the walk", () => {
    const entries: Array<readonly [string, OpeningPhase1DraftItem]> = [];
    for (let i = 0; i < OPENING_DRAFT_MAX_ITEMS + 25; i += 1) entries.push([`item-${i}`, item()]);
    const built = buildOpeningPhase1Draft(entries, []);
    expect(Object.keys(built.items)).toHaveLength(OPENING_DRAFT_MAX_ITEMS);
    expect(parseOpeningPhase1Draft(built)).toEqual(built);
  });

  it("writes the attestation through, and defaults it to null when omitted", () => {
    expect(
      buildOpeningPhase1Draft([], [], "missed_or_unknown").openerNoPriorDataAttestation,
    ).toBe("missed_or_unknown");
    expect(buildOpeningPhase1Draft([], [], null).openerNoPriorDataAttestation).toBeNull();
    expect(buildOpeningPhase1Draft([], []).openerNoPriorDataAttestation).toBeNull();
  });

  it("refuses to EMIT an out-of-vocabulary attestation the parser would then reject", () => {
    // Guards the nastiest failure mode: a builder that can produce a payload the parser
    // rejects on read-back would silently disable autosave for that whole morning.
    const built = buildOpeningPhase1Draft(
      [["a", item({ ticked: true })]],
      [],
      "forgot_to_ask" as never,
    );
    expect(built.openerNoPriorDataAttestation).toBeNull();
    expect(parseOpeningPhase1Draft(built)).toEqual(built);
  });

  it("drops an unusable key rather than emitting one the parser would reject", () => {
    const built = buildOpeningPhase1Draft(
      [
        ["", item()],
        ["x".repeat(OPENING_DRAFT_MAX_KEY_LENGTH + 1), item()],
        ["good", item({ ticked: true })],
      ],
      [],
    );
    expect(Object.keys(built.items)).toEqual(["good"]);
    expect(parseOpeningPhase1Draft(built)).toEqual(built);
  });
});

describe("openingPhase1ValueSource — completion beats draft beats empty", () => {
  it("prefers a submitted completion over a draft", () => {
    expect(openingPhase1ValueSource(true, true)).toBe("completion");
  });

  it("prefers a draft over an empty form", () => {
    expect(openingPhase1ValueSource(false, true)).toBe("draft");
  });

  it("falls to empty when there is neither", () => {
    expect(openingPhase1ValueSource(false, false)).toBe("empty");
  });

  it("still prefers the completion when no draft exists", () => {
    expect(openingPhase1ValueSource(true, false)).toBe("completion");
  });

  /**
   * The attestation seed runs the SAME function — `checklist_instances
   * .opener_no_prior_data_reason` is only ever written by the submit RPC, so its presence
   * means Phase 1 landed and any draft attestation beside it is stale by definition.
   * This is the client's seed expressed as data, so the rule cannot drift from the code.
   */
  it.each([
    ["persisted beats drafted", "planned_closure", "missed_or_unknown", "planned_closure"],
    ["drafted fills an empty column", null, "missed_or_unknown", "missed_or_unknown"],
    ["neither leaves the prompt unselected", null, null, null],
    ["persisted stands alone", "missed_or_unknown", null, "missed_or_unknown"],
  ] as const)("attestation precedence: %s", (_label, persisted, drafted, expected) => {
    const source = openingPhase1ValueSource(persisted !== null, drafted !== null);
    const resolved =
      source === "completion" ? persisted : source === "draft" ? drafted : null;
    expect(resolved).toBe(expected);
  });
});

describe("OPENING_DRAFT_MIN_LEVEL", () => {
  it("is the opening PAGE's floor (3), not the submit floor (4)", () => {
    // The level-3 employee is the actor whose lost work LRA-121 is about. Flooring the
    // draft at OPENING_BASE_LEVEL would rebuild the defect inside its own fix, so this
    // number is pinned rather than left to drift with a future role-gate sweep.
    expect(OPENING_DRAFT_MIN_LEVEL).toBe(3);
  });
});
