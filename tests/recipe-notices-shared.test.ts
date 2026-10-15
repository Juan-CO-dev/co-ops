/** Catalog Phase 3b — the GM notices (pure): source changed / gone, new default; dismissals; no sweeper. */
import { describe, expect, it } from "vitest";
import { computeRecipeNotices, NEW_DEFAULT_NOTICE_DAYS, type NoticeVersionRow } from "@/lib/catalog/recipe-notices-shared";

const HERE = "shop-here";
const SRC = "shop-src";
const v = (id: string, recipe: string, loc: string | null, from: string, to: string | null, over: Partial<NoticeVersionRow> = {}): NoticeVersionRow => ({
  id, recipe_id: recipe, location_id: loc, valid_from: from, valid_to: to, active: to === null,
  adopted_from_version_id: null, promoted_from_version_id: null, ...over,
});
const names = { recipeNames: new Map([["r1", "Italian"], ["r2", "Slaw"]]), shopNames: new Map([[SRC, "P Street"], [HERE, "Capitol Hill"]]) };
const NOW = "2026-10-15T15:00:00Z";

describe("source changed", () => {
  const base = [
    v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
    v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
    v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
  ];
  it("P Street moved on from the version this shop copied → take the update", () => {
    expect(computeRecipeNotices({ shopId: HERE, versions: base, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "source_changed", recipeId: "r1", recipeName: "Italian", sourceShopId: SRC, sourceShopName: "P Street", seenVersionId: "b",
        sourceLiveVersionId: "b", dismissKind: "source_changed", promotedToDefault: false, editedSinceAdopting: false, at: "2026-10-10T00:00:00Z" },
    ]);
  });
  it("dismissed for THAT version → quiet; a later change raises it again", () => {
    const dismissed = [{ recipe_id: "r1", kind: "source_changed" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: base, dismissals: dismissed, now: NOW, ...names })).toEqual([]);
    const later = [...base.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-14T00:00:00Z" } : x)), v("c", "r1", SRC, "2026-10-14T00:00:00Z", null)];
    expect(computeRecipeNotices({ shopId: HERE, versions: later, dismissals: dismissed, now: NOW, ...names }).map((n) => n.seenVersionId)).toEqual(["c"]);
  });
  it("P Street went back to the default → the notice says so (no live source to take)", () => {
    const gone = base.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-12T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: HERE, versions: gone, dismissals: [], now: NOW, ...names })[0]).toMatchObject({ sourceLiveVersionId: null, seenVersionId: "b", dismissKind: "source_retired", at: "2026-10-12T00:00:00Z" });
  });
  it("still on the version it copied → nothing", () => {
    const same = [v("a", "r1", SRC, "2026-10-01T00:00:00Z", null), v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" })];
    expect(computeRecipeNotices({ shopId: HERE, versions: same, dismissals: [], now: NOW, ...names })).toEqual([]);
  });
  it("THE VERSION IT COPIED was retired with no newer save (S went back to the default) → a heads-up (Astra 3b r1#5)", () => {
    const back = [v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"), v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" })];
    expect(computeRecipeNotices({ shopId: HERE, versions: back, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "source_changed", recipeId: "r1", recipeName: "Italian", sourceShopId: SRC, sourceShopName: "P Street", seenVersionId: "a",
        sourceLiveVersionId: null, dismissKind: "source_retired", promotedToDefault: false, editedSinceAdopting: false, at: "2026-10-11T00:00:00Z" },
    ]);
  });
  it("the version it copied was PROMOTED (and so retired) → 'it is the default now'", () => {
    const promotedSrc = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"),
      v("g", "r1", null, "2026-10-11T00:00:00Z", null, { promoted_from_version_id: "a" }),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: promotedSrc, dismissals: [], now: NOW, ...names })[0])
      .toMatchObject({ kind: "source_changed", seenVersionId: "a", sourceLiveVersionId: null, dismissKind: "source_retired", promotedToDefault: true });
  });
  it("PROVENANCE FOLLOWS THE CONTENT: adopt → restore an adopted-lineage version → source update → the notice fires", () => {
    const restoredLineage = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-08T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      // restored from "copy": 0262 copies the restored version's pointer
      v("restored", "r1", HERE, "2026-10-08T00:00:00Z", null, { adopted_from_version_id: "a", based_on_version_id: "copy" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: restoredLineage, dismissals: [], now: NOW, ...names }))
      .toEqual([expect.objectContaining({ kind: "source_changed", seenVersionId: "b" })]);
  });
  it("adopt → restore a PRE-adoption version (no pointer) → source update → no notice: the link ended, as intended", () => {
    const restoredPre = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("pre", "r1", HERE, "2026-09-20T00:00:00Z", "2026-10-05T00:00:00Z"),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-08T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      v("restored", "r1", HERE, "2026-10-08T00:00:00Z", null, { adopted_from_version_id: null, based_on_version_id: "pre" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: restoredPre, dismissals: [], now: NOW, ...names })).toEqual([]);
  });
  it("adopt → LOCAL EDIT → source update: the notice continues and says the copy was changed (lead decision, Astra 3a r5#1)", () => {
    const edited = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-12T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-12T00:00:00Z", null),
      v("copy", "r1", HERE, "2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z", { adopted_from_version_id: "a", based_on_version_id: "a" }),
      // HERE adjusted one ingredient on 10-07: provenance kept (0262), based_on moved to its own predecessor
      v("mine2", "r1", HERE, "2026-10-07T00:00:00Z", null, { adopted_from_version_id: "a", based_on_version_id: "copy" }),
    ];
    const [n] = computeRecipeNotices({ shopId: HERE, versions: edited, dismissals: [], now: NOW, ...names });
    expect(n).toMatchObject({ kind: "source_changed", seenVersionId: "b", editedSinceAdopting: true, dismissKind: "source_changed" });
    // still dismissible per state seen
    expect(computeRecipeNotices({ shopId: HERE, versions: edited, dismissals: [{ recipe_id: "r1", kind: "source_changed", seen_version_id: "b" }], now: NOW, ...names })).toEqual([]);
  });
  it("dismissing 'S updated to B' does not silence 'S then went back to the default' (same version, new state)", () => {
    const updated = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
    ];
    const keptB = [{ recipe_id: "r1", kind: "source_changed" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: updated, dismissals: keptB, now: NOW, ...names })).toEqual([]);
    const thenBack = updated.map((x) => (x.id === "b" ? { ...x, active: false, valid_to: "2026-10-13T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: HERE, versions: thenBack, dismissals: keptB, now: NOW, ...names })[0])
      .toMatchObject({ seenVersionId: "b", dismissKind: "source_retired" });
    const keptBoth = [...keptB, { recipe_id: "r1", kind: "source_retired" as const, seen_version_id: "b" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: thenBack, dismissals: keptBoth, now: NOW, ...names })).toEqual([]);
  });
});

describe("new default", () => {
  const promoted = [
    v("p", "r2", SRC, "2026-10-01T00:00:00Z", null),
    v("g", "r2", null, "2026-10-12T00:00:00Z", null, { promoted_from_version_id: "p" }),
  ];
  it("a shop riding the default hears about a promotion within the window", () => {
    expect(computeRecipeNotices({ shopId: HERE, versions: promoted, dismissals: [], now: NOW, ...names })).toEqual([
      { kind: "new_default", recipeId: "r2", recipeName: "Slaw", seenVersionId: "g", fromShopName: "P Street", at: "2026-10-12T00:00:00Z" },
    ]);
  });
  it("the source shop (its own promotion, even though it now rides the default) and an old promotion are quiet", () => {
    expect(computeRecipeNotices({ shopId: SRC, versions: promoted, dismissals: [], now: NOW, ...names })).toEqual([]);
    const sourceReturned = promoted.map((x) => (x.id === "p" ? { ...x, active: false, valid_to: "2026-10-12T00:00:00Z" } : x));
    expect(computeRecipeNotices({ shopId: SRC, versions: sourceReturned, dismissals: [], now: NOW, ...names })).toEqual([]);
    const late = new Date(Date.parse("2026-10-12T00:00:00Z") + (NEW_DEFAULT_NOTICE_DAYS + 1) * 86_400_000).toISOString();
    expect(computeRecipeNotices({ shopId: HERE, versions: promoted, dismissals: [], now: late, ...names })).toEqual([]);
  });
});

describe("lead decisions on the notices (GO 2026-10-15)", () => {
  it("a GM who never adopted hears nothing about another shop's edits", () => {
    const vs = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: vs, dismissals: [], now: NOW, ...names })).toEqual([]);
  });
  it("a new_default dismissal is per version: a later promotion raises it again", () => {
    const first = [v("p", "r2", SRC, "2026-10-01T00:00:00Z", null), v("g", "r2", null, "2026-10-12T00:00:00Z", null, { promoted_from_version_id: "p" })];
    const seen = [{ recipe_id: "r2", kind: "new_default" as const, seen_version_id: "g" }];
    expect(computeRecipeNotices({ shopId: HERE, versions: first, dismissals: seen, now: NOW, ...names })).toEqual([]);
    const second = [
      ...first.map((x) => (x.id === "g" ? { ...x, active: false, valid_to: "2026-10-14T00:00:00Z" } : x)),
      v("p2", "r2", SRC, "2026-10-13T00:00:00Z", null),
      v("g2", "r2", null, "2026-10-14T00:00:00Z", null, { promoted_from_version_id: "p2" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: second, dismissals: seen, now: NOW, ...names }).map((n) => n.seenVersionId)).toEqual(["g2"]);
  });
  it("newest first across recipes", () => {
    const vs = [
      v("a", "r1", SRC, "2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"),
      v("b", "r1", SRC, "2026-10-10T00:00:00Z", null),
      v("mine", "r1", HERE, "2026-10-05T00:00:00Z", null, { adopted_from_version_id: "a" }),
      v("p", "r2", SRC, "2026-10-01T00:00:00Z", null),
      v("g", "r2", null, "2026-10-12T00:00:00Z", null, { promoted_from_version_id: "p" }),
    ];
    expect(computeRecipeNotices({ shopId: HERE, versions: vs, dismissals: [], now: NOW, ...names }).map((n) => n.recipeId)).toEqual(["r2", "r1"]);
  });
});
