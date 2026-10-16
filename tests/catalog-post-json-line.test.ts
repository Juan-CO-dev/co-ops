/** Catalog Phase 3b (lead decision (b)) — a refused recipe LINE travels from the route to the page: which line and why. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "@/components/admin/vendors/shared";

const answer = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
afterEach(() => { vi.unstubAllGlobals(); });

describe("postJson carries the refused line", () => {
  it("a refusal naming a line returns its position, name and reason with the code", async () => {
    answer(400, { code: "invalid_component_product", line: { position: 3, name: "Mayo", reason: "invalid_component_product" } });
    expect(await postJson("/x", {})).toEqual({ ok: false, code: "invalid_component_product", line: { position: 3, name: "Mayo", reason: "invalid_component_product" } });
  });
  it("a refusal without a line (or a malformed one) is the plain code, exactly as before", async () => {
    answer(409, { code: "preview_stale" });
    expect(await postJson("/x", {})).toEqual({ ok: false, code: "preview_stale" });
    answer(400, { code: "invalid_lines", line: { position: "3", name: "Mayo" } });
    expect(await postJson("/x", {})).toEqual({ ok: false, code: "invalid_lines" });
  });
  it("success is unchanged", async () => {
    answer(200, { preview: { token: "t" } });
    expect(await postJson("/x", {})).toEqual({ ok: true, data: { preview: { token: "t" } } });
  });
});

describe("postJson carries a promote's saved Spanish name (CC note 2 #3)", () => {
  it("a promote refused AFTER its Spanish name saved returns the record with the code", async () => {
    answer(409, { code: "version_changed", spanishNameSaved: { settingId: "s2", locationId: "l1" }, notice: "catalog.menu.promote.es_saved_not_promoted" });
    expect(await postJson("/x", {})).toEqual({ ok: false, code: "version_changed", spanishNameSaved: { settingId: "s2", locationId: "l1" } });
  });
  it("a malformed record is dropped — the plain code, as before", async () => {
    answer(409, { code: "version_changed", spanishNameSaved: { settingId: 3 } });
    expect(await postJson("/x", {})).toEqual({ ok: false, code: "version_changed" });
  });
});
