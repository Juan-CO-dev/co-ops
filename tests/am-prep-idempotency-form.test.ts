// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmPrepForm, type AmPrepFormProps } from "@/components/prep/AmPrepForm";
const controls = vi.hoisted(() => ({ submit: undefined as undefined | (() => Promise<void>), change: undefined as undefined | ((id: string, field: "yesNo", value: string) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ language: "en", t: (k: string) => k }) }));
vi.mock("@/components/prep/useAmPrepDraftAutosave", () => ({ useAmPrepDraftAutosave: () => ({ status: "idle", flushNow: vi.fn() }) }));
vi.mock("@/components/ActionButton", () => ({ ActionButton: (props: { onClick: () => Promise<void> }) => { controls.submit = props.onClick; return null; } }));
vi.mock("@/components/prep/sections/MiscSection", () => ({ MiscSection: (props: { onChange: typeof controls.change }) => { controls.change = props.onChange; return null; } }));
const props: AmPrepFormProps = {
  instance: { id: "instance", status: "open", date: "2026-11-04" } as AmPrepFormProps["instance"],
  templateItems: [{ id: "item", displayOrder: 1, label: "Test", required: true, minRoleLevel: 0, prepMeta: { section: "misc", columns: ["yes_no"] } } as AmPrepFormProps["templateItems"][number]],
  sections: [{ slug: "misc", shape: "yes_no", displayOrder: 1 } as AmPrepFormProps["sections"][number]],
  initialValues: { item: { yesNo: true } }, authors: {}, actor: { userId: "actor", name: "Actor" }, mode: "edit", originalSubmissionId: "head",
};
function submit() { if (!controls.submit) throw new Error("no submit"); return controls.submit(); }
const posted = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string) as { clientRequestId: string; entries: unknown[] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { controls.submit = undefined; controls.change = undefined; });
describe("AM prep form frozen request lifecycle", () => {
  it("submits an RFC 4122 v4 key without randomUUID on HTTP LAN hosts", async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xff);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    render(createElement(AmPrepForm, props));
    await act(async () => { await submit(); });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
    expect(posted(fetcher)[0]?.clientRequestId).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    await act(async () => { await submit(); });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(posted(fetcher)[1]).toEqual(posted(fetcher)[0]);
  });
  it("a same-frame double click sends one request", async () => {
    let finish!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => { finish = r; })); vi.stubGlobal("fetch", fetcher);
    render(createElement(AmPrepForm, props));
    await act(async () => { const a = submit(); const b = submit(); expect(fetcher).toHaveBeenCalledOnce(); finish(new Response("{}", { status: 500 })); await Promise.all([a,b]); });
  });
  it("network retries reuse frozen key/body; changed inputs rotate the key", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    render(createElement(AmPrepForm, props));
    await act(async () => { await submit(); });
    await act(async () => { await submit(); });
    expect(posted(fetcher)[0]).toEqual(posted(fetcher)[1]);
    await act(async () => { if (!controls.change) throw new Error("missing input"); controls.change("item", "yesNo", "false"); });
    await act(async () => { await submit(); });
    expect(posted(fetcher)[2]?.clientRequestId).not.toBe(posted(fetcher)[0]?.clientRequestId);
    expect(posted(fetcher)[2]?.entries).not.toEqual(posted(fetcher)[0]?.entries);
  });
  it("acknowledged success clears the key and reopening creates a new one", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ instance: { ...props.instance, status: "confirmed" }, editCount: 1 }), { status: 200 })); vi.stubGlobal("fetch", fetcher);
    const view = render(createElement(AmPrepForm, props));
    const firstHandler = controls.submit!;
    await act(async () => { await firstHandler(); });
    // A retained handler represents another attempt after acknowledgment; the key was cleared.
    fetcher.mockRejectedValue(new Error("offline"));
    await act(async () => { await firstHandler(); });
    expect(posted(fetcher)[1]?.clientRequestId).not.toBe(posted(fetcher)[0]?.clientRequestId);
    view.unmount(); render(createElement(AmPrepForm, props));
    await act(async () => { await submit(); });
    expect(posted(fetcher)[2]?.clientRequestId).not.toBe(posted(fetcher)[1]?.clientRequestId);
  });
});
