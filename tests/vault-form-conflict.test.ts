/** Exercise the real form handlers with a minimal state runner; no DOM or server needed. */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VaultEntryForm, vaultErrorKey, type VaultEntryFormProps } from "@/components/vault/VaultEntryForm";
import type { VaultEntryView } from "@/lib/vault-shared";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = state.cursor++;
    if (!(slot in state.values)) state.values[slot] = initial;
    return [state.values[slot], (value: unknown) => { state.values[slot] = value; }];
  },
}));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const initial: VaultEntryView = {
  id: "entry", revision: 1, kind: "shared", entryType: "login", name: "Old name", username: "old",
  url: null, notes: null, locationId: null, minLevel: 4, ownerId: null, updatedAt: null, canManage: true, canRecoverPrevious: false,
};
const newer = { ...initial, revision: 2, name: "New name", username: "new", notes: "Updated notes" };
const saved = vi.fn();
const cancel = vi.fn();
const fetcher = vi.fn();
function render(over: Partial<VaultEntryFormProps> = {}) {
  state.cursor = 0;
  return VaultEntryForm({ kind: "shared", initial, shops: [], createShops: [], canCreateBoth: true, actorLevel: 9, onSaved: saved, onCancel: cancel, ...over });
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
async function submit(over: Partial<VaultEntryFormProps> = {}) {
  await render(over).props.onSubmit({ preventDefault() {} });
}
beforeEach(() => {
  state.values = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("reloads a 409, resets metadata and secret, and the next PATCH uses the new revision", async () => {
  const secret = elements(render()).find((el) => el.props["aria-label"] === "vault.form.secret")!;
  (secret.props.onChange as (e: unknown) => void)({ target: { value: "throwaway-test-secret" } });
  fetcher.mockResolvedValueOnce(Response.json({ code: "version_conflict" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ shared: [newer], personal: [] }))
    .mockResolvedValueOnce(Response.json({ entry: { ...newer, revision: 3 } }));
  await submit();
  expect(fetcher.mock.calls[1]).toEqual(["/api/vault/entries", { cache: "no-store", redirect: "manual" }]);
  expect(elements(render()).find((el) => el.props.role === "alert")?.props.children).toBe("vault.error.version_conflict");
  await submit();
  const body = JSON.parse(fetcher.mock.calls[2]![1].body);
  expect(body).toMatchObject({ expectedRevision: 2, name: "New name", username: "new", notes: "Updated notes", locationId: null });
  expect(body).not.toHaveProperty("secret");
  expect(saved).toHaveBeenCalledOnce();
  expect(vaultErrorKey("version_conflict")).toBe("vault.error.version_conflict");
});

it.each([{ shared: [] }, { shared: [{ ...newer, canManage: false }] }])("closes when the refreshed entry is no longer editable", async ({ shared }) => {
  fetcher.mockResolvedValueOnce(Response.json({ code: "version_conflict" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ shared, personal: [] }));
  await submit();
  expect(cancel).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
});

it("a failed refetch does not adopt an unverified revision or claim a successful refresh", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ code: "version_conflict" }, { status: 409 }))
    .mockRejectedValueOnce(new Error("offline"));
  await submit();
  expect(elements(render()).find((el) => el.props.role === "alert")?.props.children).toBe("vault.error.generic");
  expect(saved).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

/**
 * Audit W10 / B063. The cases above render with `createShops: []`, which hid the bug: with real shops
 * (what every level-8+ editor of a both-shop entry has) the shop field started on the FIRST shop, so
 * saving any edit silently moved the entry from "Both shops" to that one shop.
 */
const SHOP_A = { id: "11111111-1111-4111-8111-111111111111", code: "A", name: "Shop A" };
const SHOP_B = { id: "22222222-2222-4222-8222-222222222222", code: "B", name: "Shop B" };
const twoShops = { shops: [SHOP_A, SHOP_B], createShops: [SHOP_A.id, SHOP_B.id], canCreateBoth: true, actorLevel: 8 };
const shopSelect = (over: Partial<VaultEntryFormProps>) => elements(render(over)).find((el) => el.props["aria-label"] === "vault.form.shop")!;
const typeNotes = (over: Partial<VaultEntryFormProps>, value: string) => {
  const notes = elements(render(over)).find((el) => el.props["aria-label"] === "vault.form.notes")!;
  (notes.props.onChange as (e: unknown) => void)({ target: { value } });
};

it("B063: editing a both-shop entry keeps Both shops: the select shows 'both' and the PATCH sends locationId null", async () => {
  expect(shopSelect(twoShops).props.value).toBe("both");
  typeNotes(twoShops, "Rotated in November");
  fetcher.mockResolvedValueOnce(Response.json({ entry: { ...initial, revision: 2, notes: "Rotated in November" } }));
  await submit(twoShops);
  expect(fetcher.mock.calls[0]![0]).toBe("/api/vault/entries/entry");
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body).toMatchObject({ expectedRevision: 1, notes: "Rotated in November", minLevel: 4 });
  expect(body.locationId).toBeNull();
  expect(saved).toHaveBeenCalledOnce();
});

it("B063: a new password on a both-shop entry does not narrow it either", async () => {
  const secret = elements(render(twoShops)).find((el) => el.props["aria-label"] === "vault.form.secret")!;
  (secret.props.onChange as (e: unknown) => void)({ target: { value: "throwaway-test-secret" } });
  fetcher.mockResolvedValueOnce(Response.json({ entry: { ...initial, revision: 2 } }));
  await submit(twoShops);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body).locationId).toBeNull();
});

it("B063: editing a single-shop entry keeps its shop, whichever it is", async () => {
  for (const shopId of [SHOP_A.id, SHOP_B.id]) {
    state.values = [];
    fetcher.mockReset();
    const props = { ...twoShops, initial: { ...initial, locationId: shopId } };
    expect(shopSelect(props).props.value).toBe(shopId);
    fetcher.mockResolvedValueOnce(Response.json({ entry: { ...initial, locationId: shopId, revision: 2 } }));
    await submit(props);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).locationId).toBe(shopId);
  }
});

it("B063: a deliberate move still works: picking a shop on a both-shop entry sends that shop", async () => {
  (shopSelect(twoShops).props.onChange as (e: unknown) => void)({ target: { value: SHOP_B.id } });
  fetcher.mockResolvedValueOnce(Response.json({ entry: { ...initial, locationId: SHOP_B.id, revision: 2 } }));
  await submit(twoShops);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body).locationId).toBe(SHOP_B.id);
});

it("B063: a NEW shared entry still starts on the first shop the actor may author for (unchanged)", () => {
  expect(shopSelect({ ...twoShops, initial: undefined }).props.value).toBe(SHOP_A.id);
  state.values = [];
  expect(shopSelect({ shops: [SHOP_B], createShops: [SHOP_B.id], canCreateBoth: false, actorLevel: 7, initial: undefined }).props.value).toBe(SHOP_B.id);
  state.values = [];
  expect(shopSelect({ shops: [], createShops: [], canCreateBoth: true, actorLevel: 9, initial: undefined }).props.value).toBe("both");
});
