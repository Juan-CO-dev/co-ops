/** Catalog Phase 3b — History's "Link to <shop>'s recipe ended" comes from what 0262 WROTE, for every way a link ends. */
import { beforeAll, describe, expect, it } from "vitest";
import { ID, migratedRecipeDb, runProvenanceSequences, versionRows } from "./fixtures/recipe-versions-pglite";
import { historyLinkEndedSource } from "@/lib/catalog/recipe-item-shared";

describe("History's link-ended entries, from the writer's real rows", () => {
  let ids: Awaited<ReturnType<typeof runProvenanceSequences>>;
  let byId: Map<string, { locationId: string | null; adoptedFromVersionId: string | null; adoptionEndedFromVersionId: string | null }>;
  beforeAll(async () => {
    const db = await migratedRecipeDb();
    ids = await runProvenanceSequences(db);
    byId = new Map((await versionRows(db)).map((r) => [r.id, {
      locationId: r.location_id, adoptedFromVersionId: r.adopted_from_version_id, adoptionEndedFromVersionId: r.adoption_ended_from_version_id,
    }]));
    await db.close();
  }, 60_000);
  const ended = (id: string) => historyLinkEndedSource(byId.get(id)!, byId);

  it("adopt → restore a pre-adoption version: the new row says the link to the source shop ended", () => {
    expect(ended(ids.restoredPre)).toBe(ID.source);
  });
  it("adopt → restore global history: the same", () => {
    expect(ended(ids.restoredGlobal)).toBe(ID.source);
  });
  it("adopt → restore pre-adoption → back to default: BOTH entries survive — the restore's row still says the link ended (Astra r8)", () => {
    expect(ended(ids.restoredPre)).toBe(ID.source);
    expect(ended(ids.adopted1)).toBeNull();
  });
  it("adopt → back to default: the retired row says so", () => {
    expect(ended(ids.adopted3)).toBe(ID.source);
  });
  it("adopt → edit → restore the adopted lineage: no row says the link ended", () => {
    for (const id of [ids.adopted4, ids.edited4, ids.restoredLineage, ids.adopted1, ids.pre1]) expect(ended(id)).toBeNull();
  });
});
