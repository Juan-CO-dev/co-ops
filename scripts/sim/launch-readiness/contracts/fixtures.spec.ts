/** Node contract, invoked by the parent runner because resets require a stopped
 * app and ownership of the lease PID. Never launch a nested runner/second lease. */
import assert from "node:assert/strict";
import { SIM_LOCATIONS } from "../../personas-shared";
import * as driver from "../../concurrency/driver.mjs";
import { loadSnapshot, loadSnapshotManifest, resolveHandle, type Recipe } from "../fixtures";
import { DEFAULT_SNAPSHOT_DIR } from "../reset";
import type { Receipt } from "../reset";

export type FixtureLifecycle = {
  restore: (fixture: string) => Promise<Receipt>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/** Manifest-named prep input only: never choose the first convenient template item. */
async function dirtyViaApp(recipe: Recipe, pin: string): Promise<string> {
  const dirty = recipe.expected.dirtying as { templateItemHandle?: string; inputs?: Record<string, unknown> } | undefined;
  if (!dirty?.templateItemHandle || !dirty.inputs) throw new Error("Fixture prep dirtying handle/inputs blocked; CC manifest required");
  const handle = recipe.handles[dirty.templateItemHandle];
  if (!handle || handle.table !== "checklist_template_items") throw new Error("Undeclared prep dirtying handle");
  const dir = process.env.LRA_SNAPSHOT_DIR ?? DEFAULT_SNAPSHOT_DIR;
  const templateItemId = resolveHandle(loadSnapshot(dir, loadSnapshotManifest(dir)), handle).id;
  const location = SIM_LOCATIONS.EM.id;
  const user = await driver.findUser(location, "key_holder", "Rosa Delgado");
  const session = new driver.Session(user, pin);
  await session.login(location);
  const created = await session.call("POST", "/api/prep/mid-day", { locationId: location, date: recipe.anchorDateEt });
  assert.equal(created.status, 200);
  const instanceId = created.json?.instanceId;
  assert.equal(typeof instanceId, "string");
  const saved = await session.call("POST", "/api/prep/mid-day/phase1", { instanceId, entries: [{ templateItemId, inputs: dirty.inputs }] });
  assert.equal(saved.status, 200);
  const { data, error } = await driver.db.from("checklist_completions").select("id").eq("instance_id", instanceId);
  assert.equal(error, null); assert.ok(data?.length > 0, "dirtying must persist a prep row");
  return instanceId;
}

export async function runFixtureContracts(recipes: Recipe[], lifecycle: FixtureLifecycle, pin: string) {
  assert.equal(recipes.length, 5);
  const results: { fixture: string; fingerprint: string; status: "pass" }[] = [];
  for (const recipe of recipes) {
    if (recipe.blocked) throw new Error("Fixture contract prerequisite blocked; inspect manifest");
    const first = await lifecycle.restore(recipe.id);
    let dirtyId: string;
    await lifecycle.start();
    try { dirtyId = await dirtyViaApp(recipe, pin); }
    finally { await lifecycle.stop(); }
    const second = await lifecycle.restore(recipe.id);
    assert.equal(second.fingerprint, first.fingerprint, "two full restores must agree");
    assert.deepEqual(second.counts, first.counts);
    await lifecycle.start();
    try {
      const { data, error } = await driver.db.from("checklist_instances").select("id").eq("id", dirtyId);
      assert.equal(error, null); assert.deepEqual(data, [], "dirty prep instance must be gone");
      const { data: children, error: childError } = await driver.db.from("checklist_completions").select("id").eq("instance_id", dirtyId);
      assert.equal(childError, null); assert.deepEqual(children, []);
      assert.equal(second.counts.catering_quotes, recipe.expected.counts.catering_quotes ?? 0);
      assert.equal(second.counts.sku_count_events, recipe.expected.counts.sku_count_events ?? 0);
      // These are deliberately hard failures, not skip/pass stand-ins. The snapshot
      // has not supplied the deficient chain or a two-member fallback oracle.
      if (recipe.id === "incomplete-pack") throw new Error("Unresolved UI contract blocked: evidenced incomplete chain and UI oracle required");
      if (recipe.id === "over-1000") throw new Error("loadLastReceivedAt contract blocked: two-member scope and app-consumer oracle required");
    } finally { await lifecycle.stop(); }
    results.push({ fixture: recipe.id, fingerprint: second.fingerprint, status: "pass" });
  }
  return results;
}
