/**
 * PhotoCapture — what the component actually sends and shows (audit W10 / B065).
 *
 * Runs the real component handlers with a minimal hook runner (no DOM, no server), the way
 * tests/vault-form-conflict.test.ts does. The shrink itself (decode / canvas) is browser work and is
 * stubbed here; its rules are pinned in tests/photos-client.test.ts.
 *
 * Before the fix a 6 MB photo passed the 8 MB client check and was posted whole; the hosting
 * platform refused it with a non-JSON 413 and staff saw "upload failed" on every retry.
 */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = state.cursor++;
    if (!(slot in state.values)) state.values[slot] = initial;
    return [state.values[slot], (value: unknown) => { state.values[slot] = value; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock("@/lib/i18n/provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const prepare = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/photos-client", async (original) => ({
  ...await original<typeof import("@/lib/photos-client")>(),
  prepareUpload: (file: File) => prepare.fn(file),
}));

import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { PhotoTooLargeError } from "@/lib/photos-client";
import { MAX_UPLOAD_BYTES } from "@/lib/photos-shared";

const MB = 1_000_000;
const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const PHOTO = "7a2e3d4f-0000-4000-8000-000000000001";
const uploaded = vi.fn();
const fetcher = vi.fn();

function render() {
  state.cursor = 0;
  return PhotoCapture({ locationId: SHOP, onUploaded: uploaded });
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
const errorText = () => elements(render()).find((el) => el.type === "p")?.props.children as string | undefined;
const busy = () => state.values[1] as boolean;
/** Pick a file through the real <input>'s onChange, then wait until the handler has settled. */
async function pick(file: File) {
  const input = elements(render()).find((el) => el.props["aria-label"] === "photo.capture.aria_input")!;
  (input.props.onChange as (e: unknown) => void)({ target: { files: [file], value: "C:\\fakepath\\photo.jpg" } });
  await vi.waitFor(() => { if (busy() || (!errorText() && !uploaded.mock.calls.length)) throw new Error("not settled"); });
}
const photo = (bytes: number, name = "IMG_0042.JPG", type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });
const sentFile = (call = 0) => ((fetcher.mock.calls[call]![1] as RequestInit).body as FormData).get("file") as File;

beforeEach(() => {
  state.values = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("a 6 MB pick posts the PREPARED (shrunk) photo, never the original, and reports the photo id", async () => {
  const small = new Blob([new Uint8Array(1 * MB)], { type: "image/jpeg" });
  prepare.fn.mockResolvedValueOnce({ blob: small, name: "IMG_0042.jpg", resized: true });
  fetcher.mockResolvedValueOnce(Response.json({ photoId: PHOTO }));
  const original = photo(6 * MB);
  await pick(original);
  expect(prepare.fn).toHaveBeenCalledExactlyOnceWith(original);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe("/api/photos");
  const sent = sentFile();
  expect(sent.size).toBe(1 * MB);
  expect(sent.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
  expect(sent.type).toBe("image/jpeg");
  expect(sent.name).toBe("IMG_0042.jpg");
  expect(((fetcher.mock.calls[0]![1] as RequestInit).body as FormData).get("locationId")).toBe(SHOP);
  expect(uploaded).toHaveBeenCalledExactlyOnceWith(PHOTO);
  expect(errorText()).toBeUndefined();
});

it("the upload has a deadline: the request carries an abort signal", async () => {
  prepare.fn.mockImplementationOnce(async (file: File) => ({ blob: file, name: file.name, resized: false }));
  fetcher.mockResolvedValueOnce(Response.json({ photoId: PHOTO }));
  await pick(photo(900_000));
  expect((fetcher.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  expect((fetcher.mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
});

it("the hosting platform's 413 with a non-JSON body shows the too-large message, not 'upload failed'", async () => {
  prepare.fn.mockImplementationOnce(async (file: File) => ({ blob: file, name: file.name, resized: false }));
  fetcher.mockResolvedValueOnce(new Response("Request Entity Too Large", { status: 413 }));
  await pick(photo(3 * MB));
  expect(errorText()).toBe("photo.capture.error.too_large");
  expect(uploaded).not.toHaveBeenCalled();
});

it("a photo that cannot be made small enough shows the too-large message and is never posted", async () => {
  prepare.fn.mockRejectedValueOnce(new PhotoTooLargeError());
  await pick(photo(6 * MB, "IMG_2.HEIC", "image/heic"));
  expect(errorText()).toBe("photo.capture.error.too_large");
  expect(fetcher).not.toHaveBeenCalled();
  expect(uploaded).not.toHaveBeenCalled();
});

it("an unsupported type is refused before any shrink or request", async () => {
  await pick(photo(1000, "clip.gif", "image/gif"));
  expect(errorText()).toBe("photo.capture.error.unsupported_type");
  expect(prepare.fn).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("a server refusal or a network failure shows 'upload failed' and frees the button", async () => {
  prepare.fn.mockImplementation(async (file: File) => ({ blob: file, name: file.name, resized: false }));
  fetcher.mockResolvedValueOnce(Response.json({ code: "internal_error" }, { status: 500 }));
  await pick(photo(900_000));
  expect(errorText()).toBe("photo.capture.error.upload_failed");
  expect(busy()).toBe(false);
  fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await pick(photo(900_000));
  expect(errorText()).toBe("photo.capture.error.upload_failed");
  expect(busy()).toBe(false);
  expect(uploaded).not.toHaveBeenCalled();
});
