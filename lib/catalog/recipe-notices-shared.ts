/**
 * GM NOTICES — PURE, client-safe (catalog Phase 3b; spec §3 "a shop's food never changes without its
 * own GM's yes", §6). Computed at READ time from the versions the server reads per request — no
 * sweeper, no stored "unread" state. A "Keep mine" / "Got it" answer is a recipe_notice_dismissals row
 * (0262) for the version SEEN, so the next change (a new version id) raises the notice again.
 *
 *   source_changed — this shop's live version was adopted from shop S's version A, and S has moved on:
 *                    S's newest version of the recipe is no longer A (S edited it), or it IS A but A is
 *                    retired (S went back to the default, or A was promoted — 3a retires a promoted source).
 *                    A dismissal names the STATE seen: `source_changed` (seen version live) or
 *                    `source_retired` (seen version retired), so a later retirement of the same version
 *                    is a new notice (Astra 3b r1#5).
 *   new_default    — this shop rides the default for a recipe whose live global version was PROMOTED
 *                    within NEW_DEFAULT_NOTICE_DAYS — unless this shop is the one it was promoted from.
 */
export const NEW_DEFAULT_NOTICE_DAYS = 30;

export type RecipeNotice =
  | {
      kind: "source_changed";
      recipeId: string;
      recipeName: string;
      sourceShopId: string;
      sourceShopName: string;
      /** S's newest version — what a dismissal records as seen. */
      seenVersionId: string;
      /** S's LIVE version to take, or null when S went back to the default (or its version became the default). */
      sourceLiveVersionId: string | null;
      /** What a "Keep mine" records: the seen version's STATE (live → source_changed, retired → source_retired). */
      dismissKind: "source_changed" | "source_retired";
      /** This shop has edited its copy since adopting it (lead decision: provenance kept, the notice continues). */
      editedSinceAdopting: boolean;
      /** The seen version was promoted to the global default (3a retires a promoted source). */
      promotedToDefault: boolean;
      at: string;
    }
  | { kind: "new_default"; recipeId: string; recipeName: string; seenVersionId: string; fromShopName: string | null; at: string };

export interface NoticeVersionRow {
  id: string;
  recipe_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  adopted_from_version_id: string | null;
  promoted_from_version_id: string | null;
  /** The version this one was made from (0262). An adopted copy's own edits keep adopted_from but move based_on. */
  based_on_version_id?: string | null;
}

export type NoticeDismissKind = "source_changed" | "source_retired" | "new_default";
export interface NoticeDismissalRow { recipe_id: string; kind: NoticeDismissKind; seen_version_id: string }

export function computeRecipeNotices(input: {
  shopId: string;
  versions: readonly NoticeVersionRow[];
  dismissals: readonly NoticeDismissalRow[];
  recipeNames: ReadonlyMap<string, string>;
  shopNames: ReadonlyMap<string, string>;
  now: string;
}): RecipeNotice[] {
  const byId = new Map(input.versions.map((v) => [v.id, v]));
  const dismissed = new Set(input.dismissals.map((d) => `${d.recipe_id}|${d.kind}|${d.seen_version_id}`));
  const newest = (recipeId: string, locationId: string): NoticeVersionRow | null => {
    let best: NoticeVersionRow | null = null;
    for (const v of input.versions) {
      if (v.recipe_id !== recipeId || v.location_id !== locationId) continue;
      if (!best || Date.parse(v.valid_from) > Date.parse(best.valid_from) || (v.valid_from === best.valid_from && v.id > best.id)) best = v;
    }
    return best;
  };
  const out: RecipeNotice[] = [];
  const mine = input.versions.filter((v) => v.location_id === input.shopId && v.active);
  const ownRecipes = new Set(mine.map((v) => v.recipe_id));
  const promotedSources = new Set(input.versions
    .filter((v) => v.location_id === null && v.promoted_from_version_id !== null)
    .map((v) => v.promoted_from_version_id as string));

  for (const v of mine) {
    if (!v.adopted_from_version_id) continue;
    const src = byId.get(v.adopted_from_version_id);
    if (!src || src.location_id === null) continue;
    const latest = newest(v.recipe_id, src.location_id);
    if (!latest) continue;
    // Still the very version this shop copied, and still live → nothing to say. The SAME version, now
    // RETIRED (S went back to the default, or it was promoted) → S has moved on all the same.
    if (latest.id === src.id && latest.active) continue;
    const dismissKind = latest.active ? "source_changed" as const : "source_retired" as const;
    if (dismissed.has(`${v.recipe_id}|${dismissKind}|${latest.id}`)) continue;
    out.push({
      kind: "source_changed", recipeId: v.recipe_id, recipeName: input.recipeNames.get(v.recipe_id) ?? v.recipe_id,
      sourceShopId: src.location_id, sourceShopName: input.shopNames.get(src.location_id) ?? src.location_id,
      seenVersionId: latest.id, sourceLiveVersionId: latest.active ? latest.id : null,
      dismissKind, promotedToDefault: !latest.active && promotedSources.has(latest.id),
      // An adopt makes based_on = the source; any later edit of the copy moves based_on to its own predecessor
      // (0262: based_on = coalesce(restored, adopted, live, …)). LEAD DECISION: editing an adopted recipe keeps
      // the link and the notice continues, with "You've changed your copy since adopting it." Known edge: a
      // RESTORE of the untouched adopted copy also moves based_on, so it reads as edited (rows carry no content
      // digest to tell the two apart) — the line is a heads-up, never a gate.
      editedSinceAdopting: (v.based_on_version_id ?? v.adopted_from_version_id) !== v.adopted_from_version_id,
      at: latest.active ? latest.valid_from : (latest.valid_to ?? latest.valid_from),
    });
  }

  const cutoff = Date.parse(input.now) - NEW_DEFAULT_NOTICE_DAYS * 86_400_000;
  for (const head of input.versions) {
    if (head.location_id !== null || !head.active || !head.promoted_from_version_id) continue;
    if (ownRecipes.has(head.recipe_id)) continue; // a shop with its own version is untouched by a promotion
    if (Date.parse(head.valid_from) < cutoff) continue;
    if (dismissed.has(`${head.recipe_id}|new_default|${head.id}`)) continue;
    const from = byId.get(head.promoted_from_version_id);
    if (from?.location_id === input.shopId) continue; // this shop made the new default (lead decision 5 returned it to it)
    out.push({
      kind: "new_default", recipeId: head.recipe_id, recipeName: input.recipeNames.get(head.recipe_id) ?? head.recipe_id,
      seenVersionId: head.id, fromShopName: from?.location_id ? (input.shopNames.get(from.location_id) ?? null) : null, at: head.valid_from,
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
