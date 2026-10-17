import { expect, it } from "vitest";
import { createSandwichCostController, createSandwichAttempt, sandwichRecoveryHref, postSandwichJson } from "@/lib/catalog/sandwich-job-shared";
import type { NewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
const draft = { locationId: null, name: " Ham & cheese ", nameEs: null, menuPrice: 12, section: null, directions: null, directionsEs: null, inputs: [] } satisfies NewSandwichRequest;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
it("immediately clears cost on draft/scope changes and ignores older successes and refusals", async () => {
  const c = createSandwichCostController<number>(); const first = deferred<number>();
  const old = c.run(() => first.promise); expect(c.getState()).toEqual({ status: "pending", value: null });
  c.invalidate(); expect(c.getState()).toEqual({ status: "pending", value: null });
  await c.run(async () => 2); first.resolve(1); await old; expect(c.getState()).toEqual({ status: "ready", value: 2 });
  const fail = deferred<number>(); const stale = c.run(() => fail.promise.then(() => { throw Error(); }));
  await c.run(async () => 3); fail.resolve(0); await stale; expect(c.getState()).toEqual({ status: "ready", value: 3 });
  await c.run(async () => { throw Error(); }); expect(c.getState()).toEqual({ status: "failed", value: null });
});
it("freezes one correlation key and submitted fields across retry; explicit reset invalidates late results", () => {
  let n = 0; const c = createSandwichAttempt(() => `key-${++n}`);
  const a = c.begin(draft, "shop"); draft.name = "later edit";
  expect(c.begin({ ...draft, name: "other" }, "shop")).toEqual(a);
  expect(a.request.name).toBe("Ham & cheese"); expect(c.isCurrent(a)).toBe(true);
  c.reset(); expect(c.isCurrent(a)).toBe(false); expect(c.begin(draft, "shop").key).toBe("key-2");
});
it("encodes the submitted name in the explicit catalog view", () => {
  expect(sandwichRecoveryHref("Ham & cheese")).toBe("/admin/items?view=catalog&q=Ham%20%26%20cheese");
});
it("distinguishes uncertain transport/JSON/server failures from named refusals", async () => {
  const call = (response: unknown) => postSandwichJson("/test", {}, (async () => response) as typeof fetch);
  expect(await call({ ok: false, status: 409, json: async () => ({ code: "name_taken" }) })).toEqual({ kind: "refused", code: "name_taken" });
  expect(await call({ ok: true, status: 201, json: async () => { throw Error(); } })).toEqual({ kind: "uncertain" });
  expect(await call({ ok: false, status: 500 })).toEqual({ kind: "uncertain" });
  expect(await postSandwichJson("/test", {}, (async () => { throw Error(); }) as typeof fetch)).toEqual({ kind: "uncertain" });
});
