import assert from "node:assert/strict";
import * as driver from "../../concurrency/driver.mjs";
import { SIM_LOCATIONS, personaByEmail, type LocationCode } from "../../personas-shared";

// Imported by the leased Node runner and the UI journey; never initializes a DB client.
export type Item = { id: string; label: string; station: string; expects_count: boolean; prep_meta: { openingPhase2?: boolean; section?: string } | null; translations?: { es?: { label?: string; station?: string } } };
export type Snapshot = { template_item_id: string; closer_count: number | null; closing_instance_id: string | null; par_value: number | null };
export type Completion = { id: string; template_item_id: string; completed_by: string; completed_at: string; count_value: number | null; notes: string | null; count_provenance: string | null; superseded_at: string | null; revoked_at: string | null; prep_data: { phase1?: Record<string, unknown>; phase2?: Record<string, unknown> } | null };
type Instance = { id: string; template_id: string; status: string; opener_no_prior_data_reason: string | null };

export async function sessionFor(alias: string, code: LocationCode, pins: Record<string, string | undefined> = process.env) {
  const persona = personaByEmail(`${alias}@sim.co-ops`);
  const pin = pins[`SIM_PIN_${alias.toUpperCase()}`];
  assert(pin && /^\d{4}$/.test(pin), `Missing SIM_PIN_${alias.toUpperCase()}`);
  const user = await driver.findUser(SIM_LOCATIONS[code].id, persona.role, persona.name);
  return new driver.Session(user, pin).login(SIM_LOCATIONS[code].id);
}

export async function readRows<T>(table: string, columns: string, filters: Record<string, string>, order = "id"): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = driver.db.from(table).select(columns);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.order(order).range(offset, offset + 499);
    assert(!error && Array.isArray(data), "opening.oracle-read");
    rows.push(...data as T[]);
    if (data.length < 500) return rows;
  }
}

/** Caller first opens the real page (Session GET or browser); this helper only reads. */
export async function openingState(code: LocationCode) {
  const templates = await readRows<{ id: string }>("checklist_templates", "id", { location_id: SIM_LOCATIONS[code].id, type: "opening" });
  const ids = new Set(templates.map(row => row.id));
  const instances = (await readRows<Instance>("checklist_instances", "id,template_id,status,opener_no_prior_data_reason", { location_id: SIM_LOCATIONS[code].id, date: driver.todayEt() })).filter(row => ids.has(row.template_id));
  assert.equal(instances.length, 1, "opening.instance-own-shop");
  const instance = instances[0]!;
  const items = await readRows<Item>("checklist_template_items", "id,label,station,expects_count,prep_meta,translations", { template_id: instance.template_id, active: "true" });
  const snapshots = await readRows<Snapshot>("opening_closer_count_snapshots", "template_item_id,closer_count,closing_instance_id,par_value", { opening_instance_id: instance.id }, "template_item_id");
  return { instance, items, snapshots };
}

export function completions(instanceId: string) {
  return readRows<Completion>("checklist_completions", "id,template_item_id,completed_by,completed_at,count_value,notes,count_provenance,superseded_at,revoked_at,prep_data", { instance_id: instanceId });
}
export function live(rows: Completion[]) { return rows.filter(row => row.superseded_at === null && row.revoked_at === null); }
export function phase1Body(state: Awaited<ReturnType<typeof openingState>>) {
  const spotIds = new Set(state.snapshots.map(row => row.template_item_id));
  const commentItem = state.items.find(item => !item.prep_meta?.openingPhase2);
  return {
    instanceId: state.instance.id, openerNoPriorDataAttestation: "missed_or_unknown", sectionVerifications: [],
    entries: state.items.filter(item => spotIds.has(item.id) || !item.prep_meta?.openingPhase2).map(item => ({ templateItemId: item.id, phase: "phase1", countValue: item.expects_count ? 38 : null, photoId: null,
      notes: item.id === commentItem?.id ? "G1-A verified station" : null,
      spotCheckStatus: spotIds.has(item.id) ? "flagged_recount" : null,
      openerRecount: spotIds.has(item.id) ? 2 : null,
      // Deliberately false client hints: the persisted values must come from recount + snapshot.
      groundTruthCount: spotIds.has(item.id) ? 999999 : null, prepNeed: spotIds.has(item.id) ? 999999 : null,
    })),
  };
}
export function phase2Body(instanceId: string, itemId: string, value: number, need: number | null) {
  return { instanceId, entry: { templateItemId: itemId, openerPrepped: value,
    overPar: need !== null && value > need ? { reasonCategory: "other", directedBy: null, freeText: "G1-A contract prep" } : null,
    underPar: need !== null && value < need ? { reasonCategory: "other", freeText: "G1-A contract prep" } : null,
  } };
}
export function checkHeads(rows: Completion[]) {
  const keys = new Set<string>();
  for (const row of live(rows)) {
    // Exact 0196 expression: coalesce(prep_data ? 'phase2', false), including null JSON.
    const key = `${row.template_item_id}:${row.prep_data !== null && Object.hasOwn(row.prep_data, "phase2")}`;
    assert(!keys.has(key), "opening.phase2.live-head-uniqueness"); keys.add(key);
  }
}
export function assertSaved(rows: Completion[], itemId: string, value: number, actorId: string) {
  checkHeads(rows);
  const heads = live(rows).filter(row => row.template_item_id === itemId);
  const phase1 = heads.filter(row => row.prep_data?.phase1);
  const phase2 = heads.filter(row => row.prep_data?.phase2);
  assert.equal(phase1.length, 1, "opening.phase2.phase1-preserved");
  assert.equal(phase2.length, 1, "opening.phase2.saved-provenance");
  const row = phase2[0]!;
  assert.equal(row.prep_data!.phase2!.opener_prepped, value, "opening.phase2.saved-provenance");
  assert.equal(row.completed_by, actorId, "opening.phase2.saved-provenance");
  assert.equal(row.prep_data!.phase2!.saved_by, actorId, "opening.phase2.saved-provenance");
  assert(Number.isFinite(Date.parse(row.completed_at)), "opening.phase2.saved-provenance");
  assert.equal(Date.parse(String(row.prep_data!.phase2!.saved_at)), Date.parse(row.completed_at), "opening.phase2.saved-provenance");
  assert.equal(row.count_provenance, phase1[0]!.count_provenance, "opening.phase2.saved-provenance");
  for (const field of ["closer_count", "spot_check_status", "opener_recount", "ground_truth_count", "prep_need"]) {
    assert.equal(row.prep_data!.phase2![field], phase1[0]!.prep_data!.phase1![field], "opening.phase2.saved-provenance");
  }
  return row;
}

export async function runOpeningContracts(pins: Record<string, string | undefined>) {
  const results: { id: string; assertionIds: string[]; status: "passed" | "failed"; failedAssertionIds: string[]; race: { status: number; acknowledged: boolean }[] }[] = [];
  for (const code of ["EM", "MEP"] as const) {
    const result = { id: `opening-contract-${code}`, assertionIds: [] as string[], status: "passed" as "passed" | "failed", failedAssertionIds: [] as string[], race: [] as { status: number; acknowledged: boolean }[] };
    results.push(result);
    let current = "opening.cold-baseline";
    const mark = (id: string) => { current = id; if (!result.assertionIds.includes(id)) result.assertionIds.push(id); };
    try {
      mark(current);
      const alias = code === "EM" ? "rosa" : "angel";
      const kh = await sessionFor(alias, code, pins);
      const page = await kh.call("GET", `/operations/opening?location=${SIM_LOCATIONS[code].id}`);
      assert.equal(page.status, 200, current);
      const state = await openingState(code), instanceId = state.instance.id;
      assert.equal(state.instance.status, "open", current);
      const prepItems = state.items.filter(item => item.prep_meta?.openingPhase2);
      assert(prepItems.length >= 3, current);
      assert.equal(state.snapshots.length, prepItems.length, current);
      assert(state.snapshots.every(row => row.closer_count === null && row.closing_instance_id === null), current);
      const body = phase1Body(state);
      mark("opening.phase1.employee-submit-denied");
      const employee = await sessionFor(code === "EM" ? "maya" : "luis", code, pins);
      let before = await completions(instanceId);
      assert.equal((await employee.call("POST", "/api/opening/submit/phase1", body)).status, 403, current);
      assert.deepEqual(await completions(instanceId), before, current);
      mark("opening.cross-shop-denied");
      const outsider = await sessionFor(code === "EM" ? "angel" : "rosa", code === "EM" ? "MEP" : "EM", pins);
      assert.equal((await outsider.call("POST", "/api/opening/submit/phase1", body)).status, 403, current);
      assert.deepEqual(await completions(instanceId), before, current);
      mark("opening.phase1.status-transition");
      assert.equal((await kh.call("POST", "/api/opening/submit/phase1", body)).status, 200, current);
      assert.equal((await openingState(code)).instance.status, "phase1_complete", current);
      const phase1Rows = live(await completions(instanceId));
      assert.equal(phase1Rows.length, state.items.length, current);
      for (const item of state.items) assert(phase1Rows.some(row => row.template_item_id === item.id && row.completed_by === kh.user.id), current);
      mark("opening.phase1.plain-live-head-uniqueness");
      const plain = phase1Rows.filter(row => row.prep_data === null);
      assert(plain.length > 0, current); // Actual station/temp rows, not a vacuous synthetic list.
      checkHeads(plain);
      mark("opening.cold-baseline");
      assert.equal((await openingState(code)).instance.opener_no_prior_data_reason, "missed_or_unknown", current);
      for (const item of prepItems) {
        const row = phase1Rows.find(row => row.template_item_id === item.id)!;
        const snapshot = state.snapshots.find(row => row.template_item_id === item.id)!;
        assert.equal(row.prep_data?.phase1?.closer_count, null, current);
        assert.equal(row.prep_data?.phase1?.ground_truth_count, 2, current);
        assert.equal(row.prep_data?.phase1?.prep_need, snapshot.par_value === null ? null : Math.max(0, snapshot.par_value - 2), current);
        assert.equal(row.count_provenance, "reconstructed_morning", current);
      }
      mark("opening.phase2.finalize-incomplete");
      before = await completions(instanceId);
      const refusal = await kh.call("POST", "/api/opening/submit/phase2", { instanceId });
      assert.equal(refusal.status, 422, current); assert.equal(refusal.code, "phase2_incomplete", current);
      assert.equal((await openingState(code)).instance.status, "phase1_complete", current);
      assert.deepEqual(await completions(instanceId), before, current);
      const need = (id: string) => phase1Rows.find(row => row.template_item_id === id)!.prep_data!.phase1!.prep_need as number | null;
      mark("opening.phase2.saved-provenance");
      for (const item of prepItems.slice(0, 3)) {
        assert.equal((await kh.call("POST", "/api/opening/prep/item", phase2Body(instanceId, item.id, 3, need(item.id)))).status, 200, current);
        assertSaved(await completions(instanceId), item.id, 3, kh.user.id);
      }
      mark("opening.phase2.phase1-preserved");
      const first = prepItems[0]!;
      const original = assertSaved(await completions(instanceId), first.id, 3, kh.user.id);
      assert.equal((await kh.call("POST", "/api/opening/prep/item", phase2Body(instanceId, first.id, 4, need(first.id)))).status, 200, current);
      let rows = await completions(instanceId);
      assert(rows.find(row => row.id === original.id)?.superseded_at, current);
      assertSaved(rows, first.id, 4, kh.user.id);
      assert.deepEqual(live(rows).filter(row => !row.prep_data?.phase2), phase1Rows, current);
      mark("opening.phase2.concurrent-save");
      const second = await sessionFor(alias, code, pins);
      const race = await Promise.all([kh, second].map((session, index) => session.call("POST", "/api/opening/prep/item", phase2Body(instanceId, first.id, 11 + index, need(first.id)))));
      result.race = race.map(response => ({ status: response.status, acknowledged: response.status === 200 }));
      rows = await completions(instanceId);
      if (process.env.LRA_DEBUG) {
        const mine = rows.filter(row => row.template_item_id === first.id && row.prep_data?.phase2);
        console.error(`[lra debug] ${current} race responses: ${JSON.stringify(race.map(r => ({ status: r.status, completionId: (r.json as { completionId?: string } | undefined)?.completionId })))}`);
        console.error(`[lra debug] ${current} phase2 rows for item ${first.id}: ${JSON.stringify(mine.map(row => ({ id: row.id, live: !row.superseded_at && !row.revoked_at, supersededAt: row.superseded_at, prepped: row.prep_data?.phase2?.opener_prepped })))}`);
      }
      try {
        assert(race.every(response => response.status === 200 || response.status === 409), current);
        assert(race.some(response => response.status === 200), current);
        checkHeads(rows);
        assert.equal(live(rows).filter(row => row.template_item_id === first.id && row.prep_data?.phase1).length, 1, current);
        race.forEach((response, index) => { if (response.status === 200) assert(rows.some(row => row.id === response.json?.completionId && row.template_item_id === first.id && row.prep_data?.phase2?.opener_prepped === 11 + index && row.completed_by === kh.user.id), current); });
      } catch { result.status = "failed"; result.failedAssertionIds.push(current); }
      mark("opening.phase2.status-transition");
      // LRA_DEBUG: print each response (status + code/message) to stderr before asserting — never into evidence.
      const dbg = (label: string, r: { status: number; code?: string; json?: unknown }) => { if (process.env.LRA_DEBUG) console.error(`[lra debug] ${current} ${label}: ${r.status} ${r.code ?? ""} ${JSON.stringify(r.json ?? "").slice(0, 300)}`); };
      for (const item of prepItems.slice(3)) { const r = await kh.call("POST", "/api/opening/prep/item", phase2Body(instanceId, item.id, 3, need(item.id))); if (r.status !== 200) dbg(`prep/item ${item.id}`, r); assert.equal(r.status, 200, current); }
      const fin = await kh.call("POST", "/api/opening/submit/phase2", { instanceId }); dbg("submit/phase2", fin);
      assert.equal(fin.status, 200, current);
      const after = (await openingState(code)).instance.status; if (after !== "phase2_complete") dbg("status after finalize", { status: 0, json: after });
      assert.equal(after, "phase2_complete", current);
      const submissions = await readRows<{ submitted_by: string; submitted_at: string; completion_ids: string[]; is_final_confirmation: boolean }>("checklist_submissions", "submitted_by,submitted_at,completion_ids,is_final_confirmation", { instance_id: instanceId });
      const savedIds = live(await completions(instanceId)).filter(row => row.prep_data?.phase2).map(row => row.id).sort();
      const finalSubmission = submissions.find(row => JSON.stringify([...row.completion_ids].sort()) === JSON.stringify(savedIds));
      assert(finalSubmission && finalSubmission.submitted_by === kh.user.id && Number.isFinite(Date.parse(finalSubmission.submitted_at)) && finalSubmission.is_final_confirmation === false, current);
      mark("opening.phase2.live-head-uniqueness");
      rows = await completions(instanceId); checkHeads(rows);
      assert.equal(live(rows).filter(row => row.prep_data?.phase2).length, prepItems.length, current);
      assert.deepEqual(live(rows).filter(row => !row.prep_data?.phase2), phase1Rows, current);
    } catch (error) {
      result.status = "failed";
      // Only fixed assertion IDs leave this module, never driver errors or session material.
      const id = error instanceof Error ? error.message.match(/opening\.[a-z0-9.-]+/)?.[0] ?? current : current;
      if (!result.assertionIds.includes(id)) result.assertionIds.push(id);
      if (!result.failedAssertionIds.includes(id)) result.failedAssertionIds.push(id);
    }
  }
  return results;
}
