/** Exercise the real form handlers with a minimal state runner; no DOM or server needed. */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VaultEntryForm, vaultErrorKey } from "@/components/vault/VaultEntryForm";
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
function render() {
  state.cursor = 0;
  return VaultEntryForm({ kind: "shared", initial, shops: [], createShops: [], canCreateBoth: true, actorLevel: 9, onSaved: saved, onCancel: cancel });
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
async function submit() {
  await render().props.onSubmit({ preventDefault() {} });
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
