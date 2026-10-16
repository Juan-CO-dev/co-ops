import { describe, expect, it } from "vitest";
import { createJobPreviewController, initialSetupState, jobErrorKey, newItemJobHref, newSandwichJobHref, sandwichCostSummary, setupReducer, swapVendorJobHref } from "@/lib/catalog/jobs-shared";
import type { MenuCostRollup, MenuCostStatus } from "@/lib/menu-costing-shared";

describe("job contracts", () => {
  it("distinguishes omitted, global and explicit shop links", () => {
    expect(newItemJobHref()).toBe("/admin/catalog/new/item");
    expect(newItemJobHref(null)).toBe("/admin/catalog/new/item?location=global");
    expect(newSandwichJobHref("a&b")).toBe("/admin/catalog/new/sandwich?location=a%26b");
    expect(swapVendorJobHref("a/b", "shop")).toBe("/admin/catalog/sku/a%2Fb/swap?location=shop");
  });
  it("never turns HTTP success into completed partial setup, preserving saved days", () => {
    const state = setupReducer(initialSetupState(), { kind: "result", result: { step: "order_days", ok: false, detail: { outcomes: [
      { orderDow: 1, leadDays: 2, ok: true, pairId: "saved" },
      { orderDow: 3, leadDays: 1, ok: false, status: 500, code: "generic", messageKey: "catalog.error.generic", refreshRequired: true },
    ] } } });
    expect(state.order_days.status).toBe("unconfirmed");
    expect(state.order_days.days[1]).toMatchObject({ ok: true, pairId: "saved" });
    const retry = setupReducer(state, { kind: "result", result: { step: "order_days", ok: true, detail: { outcomes: [{ orderDow: 3, leadDays: 1, ok: true, pairId: "retry" }] } } });
    expect(retry.order_days.status).toBe("saved");
    expect(Object.keys(retry.order_days.days)).toEqual(["1", "3"]);
    expect(state.order_days.days[3]?.ok).toBe(false);
  });
  it("keeps unconfirmed guide saves and prior successful steps visible", () => {
    const saved = setupReducer(initialSetupState(), { kind: "result", result: { step: "par", ok: true, detail: {} } });
    const next = setupReducer(saved, { kind: "result", result: { step: "guide_line", ok: false, detail: { lineSaved: null, refreshRequired: true } } });
    expect(next.par.status).toBe("saved");
    expect(next.guide_line.status).toBe("unconfirmed");
    expect(setupReducer(next, { kind: "failed", step: "barcode", code: "needs_vendor", uncertain: false }).barcode.status).toBe("incomplete");
  });
  it("maps only closed refusal codes", () => {
    expect(jobErrorKey("ownership_changed")).toBe("catalog.error.ownership_changed");
    expect(jobErrorKey("line_changed")).toBe("catalog.error.line_changed");
    for (const code of ["__proto__", "constructor", "SQL secret", "catalog.error.forbidden"]) expect(jobErrorKey(code)).toBe("catalog.error.generic");
  });
  it.each<MenuCostStatus>(["costed", "partial", "unpriced", "inconsistent", "unweighed", "unresolved", "no_recipe"])("only complete %s cost yields margins", status => {
    const rollup: MenuCostRollup = { status, cost: 4, pricedCost: 4, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [], inconsistentItemIds: [], unweighedItemIds: [], retiredProductIds: [] };
    const summary = sandwichCostSummary(rollup, 10);
    expect(summary.foodCostPct).toBe(status === "costed" ? 40 : null);
    expect(summary.marginDollars).toBe(status === "costed" ? 6 : null);
    expect(summary.cost).toBe(status === "costed" ? 4 : null);
    expect(sandwichCostSummary(rollup, 0).foodCostPct).toBeNull();
  });
  it("invalidates old success and refusal immediately on draft/scope changes", async () => {
    const controller = createJobPreviewController<number>();
    await controller.run(async () => 1);
    expect(controller.getState()).toEqual({ status: "ready", value: 1 });
    let finish!: (n: number) => void;
    const pending = controller.run(() => new Promise<number>(resolve => { finish = resolve; }));
    expect(controller.getState()).toEqual({ status: "pending", value: null });
    controller.invalidate();
    finish(2); await pending;
    expect(controller.getState()).toEqual({ status: "idle", value: null });
    let reject!: (error: Error) => void;
    const older = controller.run(() => new Promise<number>((_, fail) => { reject = fail; }));
    await controller.run(async () => 3);
    reject(new Error("old")); await older;
    expect(controller.getState()).toEqual({ status: "ready", value: 3 });
    await controller.run(async () => { throw new Error("private SQL"); });
    expect(controller.getState()).toEqual({ status: "failed", value: null });
  });
});
