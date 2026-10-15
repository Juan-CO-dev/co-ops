/** Catalog Phase 3a — provenance follows the content, and its END is RECORDED by the writer (Astra r7), in PGlite. */
import { beforeAll, describe, expect, it } from "vitest";
import { migratedRecipeDb, runProvenanceSequences, versionRows, type WrittenVersion } from "./fixtures/recipe-versions-pglite";

describe("the real 0262 writers record where an adoption link ends", () => {
  let ids: Awaited<ReturnType<typeof runProvenanceSequences>>;
  let rows: Map<string, WrittenVersion>;
  beforeAll(async () => {
    const db = await migratedRecipeDb();
    ids = await runProvenanceSequences(db);
    rows = new Map((await versionRows(db)).map((r) => [r.id, r]));
  }, 60_000);
  const row = (id: string) => rows.get(id)!;

  it("adopt → restore a pre-adoption version: the link ends, recorded on the new row as the REPLACED version", () => {
    expect(row(ids.restoredPre).adopted_from_version_id).toBeNull();
    expect(row(ids.restoredPre).adoption_ended_from_version_id).toBe(ids.adopted1);
    expect(row(ids.restoredPre).based_on_version_id).toBe(ids.pre1); // why History must NOT infer from based_on
  });
  it("adopt → restore global history: the link ends, recorded the same way", () => {
    expect(row(ids.restoredGlobal).adopted_from_version_id).toBeNull();
    expect(row(ids.restoredGlobal).adoption_ended_from_version_id).toBe(ids.adopted2);
  });
  it("adopt → restore pre-adoption → back to default: the restore's end record SURVIVES the later retirement (Astra r8)", () => {
    expect(row(ids.restoredPre).active).toBe(false);                               // sequence (5) retired it
    expect(row(ids.restoredPre).adoption_ended_from_version_id).toBe(ids.adopted1); // not nulled, not overwritten
    expect(row(ids.adopted1).adoption_ended_from_version_id).toBeNull();           // and no second, false entry
  });
  it("adopt → back to default: the retired version records that its closing ended the link", () => {
    expect(row(ids.adopted3).active).toBe(false);
    expect(row(ids.adopted3).adoption_ended_from_version_id).toBe(ids.adopted3);
  });
  it("adopt → edit → restore the adopted lineage: the link is kept and nothing ends", () => {
    expect(row(ids.edited4).adopted_from_version_id).toBe(ids.vSource);
    expect(row(ids.restoredLineage).adopted_from_version_id).toBe(ids.vSource);
    expect(row(ids.restoredLineage).adoption_ended_from_version_id).toBeNull();
    expect(row(ids.edited4).adoption_ended_from_version_id).toBeNull();
  });
});
