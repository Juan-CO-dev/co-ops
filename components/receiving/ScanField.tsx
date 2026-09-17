"use client";

/**
 * ScanField — one scan affordance at the receiving door (V3-B §6).
 *
 * Two input paths, one answer. A Bluetooth gun in HID keyboard mode types the code at the
 * page and needs no UI at all; a phone needs a camera sheet. Both end in the same
 * `lookup(code)` and the same three callbacks, so `ReceivingForm` never has to know which
 * one the receiver used.
 *
 * KEYBOARD PATH — always armed while a delivery is open, and LOSSLESS. There is no
 * focus-holding input to babysit: a document-level capture-phase `keydown` listener feeds
 * every keystroke to `ScanBurst`, which swallows PROVISIONALLY (the first key of a gun and
 * the first key of a person are identical) and hands the whole buffer straight back the
 * moment the burst hypothesis dies. `releaseIntoInput` re-dispatches that text into
 * whatever input is focused, at the caret, through the native value setter so React's
 * onChange actually fires — which is why a manager typing an invoice number into the box
 * above never loses a character to the scanner listener.
 *   The swallow itself is the point: without it a scan lands in whatever text field
 *   happens to be focused, and the Enter that terminates it submits the form.
 *
 * CAMERA PATH — on tap, and never before. `BarcodeDetector` where the browser has it
 * (Android Chrome), else `zxing-wasm/reader` DYNAMICALLY imported when the sheet opens, so
 * the door page's bundle carries no decoder for the receivers who use a gun. Frames are
 * sampled ~150 ms apart off a canvas; `dedupeCameraDecode(1500)` is what keeps a label
 * resting on the counter from racking up phantom units (spec §4 counting rule).
 *
 * WHAT IS NOT HERE: the arithmetic. `lib/scan-field-shared.ts` owns what a match does to
 * the line list and `lib/barcodes-shared.ts` owns what a label means — both node-tested.
 * This file is DOM and network, which is the part the repo has no test environment for.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { ScanBurst, dedupeCameraDecode, type Level, type NormalizedCode, type ScanMatch } from "@/lib/barcodes-shared";

/** The lookup route answers the lib's `ScanMatch` verbatim plus the normalised code. */
type LookupResponse = ScanMatch & { normalized?: NormalizedCode; ambiguous?: boolean };

/**
 * `BarcodeDetector` is not in TypeScript's DOM lib (Chromium-only, still unshipped in
 * Safari/Firefox), so the two members we actually touch are declared here rather than
 * pulling a whole ambient-types package in for a feature-detected branch.
 */
interface BarcodeDetectorLike {
  detect(source: ImageData): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** The five symbologies a food-service case label actually carries (spec §6). */
const NATIVE_FORMATS = ["ean_13", "upc_a", "code_128", "itf", "qr_code"];
const ZXING_FORMATS = ["EAN-13", "UPC-A", "Code128", "ITF", "QRCode"] as const;

/** The route caps `code` at 128 chars; a decoder that hands back a novel is truncated, not refused. */
const MAX_CODE = 128;
/** A lookup that has not answered in 4 s is treated as unknown — the truck does not wait (spec §7). */
const LOOKUP_TIMEOUT_MS = 4_000;
/** Decoding every animation frame burns the phone's battery for no extra codes. */
const FRAME_INTERVAL_MS = 150;
/** Longest edge of the sampled canvas. Beyond this the decoders get slower, not better. */
const SAMPLE_MAX_EDGE = 720;

const sheetShell =
  "fixed inset-0 z-50 flex items-end justify-center bg-co-text/40 sm:items-center sm:px-4";
const sheetBody =
  "max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-2 border-co-border bg-co-surface p-5 shadow-xl sm:rounded-2xl";
const chip =
  "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition";

/**
 * Put text a burst gave back into the focused field, at the caret, as if it had been typed.
 *
 * React reads `input` events off its own synthetic listener and ignores a plain
 * `el.value = x`, so the assignment goes through the PROTOTYPE's value setter (the one
 * React's value tracker does not intercept) and the event is dispatched by hand. Anything
 * that is not a text box — a number input, a select, the body — silently drops the release:
 * there is nowhere for the characters to go, and the alternative (inventing a destination)
 * would be worse than losing a keystroke the operator can retype.
 */
function releaseIntoInput(text: string): void {
  if (text === "") return;
  const el = document.activeElement;
  const isInput = el instanceof HTMLInputElement;
  const isArea = el instanceof HTMLTextAreaElement;
  if (!isInput && !isArea) return;
  // A number/date/email input throws on selectionStart — those fields take the text at the
  // end rather than at a caret we are not allowed to read.
  let start = el.value.length;
  let end = start;
  try {
    start = el.selectionStart ?? start;
    end = el.selectionEnd ?? start;
  } catch {
    start = el.value.length;
    end = start;
  }
  const proto = isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return;
  setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  try {
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
  } catch {
    // Same class of input as above — no caret to place.
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export interface ScanFieldLine {
  /** Index into `ReceivingForm`'s `lines` — what `onUnknownPick` hands back. */
  index: number;
  skuName: string;
}

export function ScanField({
  vendorId,
  locationId,
  lineSkuIds,
  disabled,
  lines,
  onMatch,
  onUnknownPick,
  onNotOnDelivery,
}: {
  vendorId: string;
  locationId: string;
  lineSkuIds: string[];
  /**
   * The invoice number typed so far. Part of the door's scan contract because the TEACH
   * audit row carries it (there is no delivery id yet), but ScanField never writes — the
   * form owns every POST that is not the read-only lookup, so the value is read there.
   * Declared, deliberately not destructured.
   */
  invoiceNumber: string | null;
  /** Submitting, or the form is otherwise closed: the listener stands down entirely. */
  disabled: boolean;
  lines: ScanFieldLine[];
  onMatch: (m: ScanMatch & { code: string }) => void;
  onUnknownPick: (code: string, lineIndex: number | null, level: Level) => void;
  onNotOnDelivery: (code: string, level: Level) => void;
}) {
  const { t } = useTranslation();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [keepScanning, setKeepScanning] = useState(false);
  /** The unknown-code sheet: the code it is asking about, or null when it is closed. */
  const [askingAbout, setAskingAbout] = useState<string | null>(null);
  /** True when the sheet is up because the lookup never answered, not because the code is new. */
  const [lookupFailed, setLookupFailed] = useState(false);
  const [level, setLevel] = useState<Level>("case");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeCameraRef = useRef<() => void>(() => undefined);

  // The burst machine must survive re-renders — it IS the buffered keystrokes.
  const burstRef = useRef<ScanBurst | null>(null);
  if (burstRef.current === null) {
    burstRef.current = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
  }

  // THE LIVE VALUES THE TWO LONG-LIVED LOOPS READ. The keydown listener and the camera's
  // frame loop both outlive the render that started them, and both must see the CURRENT
  // props — but putting those props in their dependency arrays would tear the listener down
  // and rebuild it on every keystroke (the parent form re-renders on each one, because it
  // owns the line state), which is how a burst in progress gets dropped. A ref updated in a
  // commit-phase effect gives the loops today's values without restarting them.
  const keepRef = useRef(keepScanning);
  const lookupPropsRef = useRef({ vendorId, locationId, lineSkuIds });
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    keepRef.current = keepScanning;
    lookupPropsRef.current = { vendorId, locationId, lineSkuIds };
    onMatchRef.current = onMatch;
  });

  const openUnknown = useCallback((code: string, failed: boolean) => {
    setAskingAbout(code);
    setLookupFailed(failed);
    setLevel("case");
    closeCameraRef.current();
  }, []);

  /**
   * Ask the server what this label means. A timeout or a network error is NOT an error the
   * receiver has to read: it opens the same picker an unknown code opens, with one sentence
   * saying the code could not be checked. The truck is still at the door either way.
   */
  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.slice(0, MAX_CODE);
      const { vendorId: v, locationId: l, lineSkuIds: ids } = lookupPropsRef.current;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
      try {
        const res = await fetch("/api/operations/receiving/scan/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vendorId: v, locationId: l, code, lineSkuIds: ids }),
          signal: controller.signal,
        });
        if (!res.ok) {
          openUnknown(code, true);
          return;
        }
        const body = (await res.json()) as LookupResponse;
        const resolved = body.normalized?.code ?? code;
        // AMBIGUOUS IS NOT A MATCH. Two of this vendor's SKUs carrying one code is a data
        // error; auto-opening either line would file the wrong item confidently.
        if (body.kind === "unknown" || body.ambiguous === true) {
          openUnknown(resolved, false);
          return;
        }
        onMatchRef.current({ ...body, code: resolved });
      } catch {
        openUnknown(code, true);
      } finally {
        clearTimeout(timer);
      }
    },
    [openUnknown],
  );

  // ── Keyboard-wedge path ────────────────────────────────────────────────────
  useEffect(() => {
    if (disabled) return;
    const burst = burstRef.current;
    if (!burst) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // A chorded key is a shortcut, never part of a code.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const verdict = burst.key(e.key, performance.now());
      if (verdict === "pass") return;
      if (verdict === "swallow") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ("scan" in verdict) {
        // The terminating Enter belongs to the scanner, not to the form's submit button.
        e.preventDefault();
        e.stopPropagation();
        void lookup(verdict.scan);
        return;
      }
      // A release. Enter is never part of one and must reach the form (the buffer it
      // flushed was a person typing); any OTHER key that triggered a release has already
      // been buffered into the fresh hypothesis, so it must still be swallowed.
      if (e.key !== "Enter") {
        e.preventDefault();
        e.stopPropagation();
      }
      releaseIntoInput(verdict.release);
    };

    document.addEventListener("keydown", onKeyDown, true);
    // A burst that ends in silence rather than Enter still has to land — and a short buffer
    // that just stalled has to come back. Both arrive through tick().
    const timer = setInterval(() => {
      const verdict = burst.tick(performance.now());
      if (verdict === null) return;
      if ("scan" in verdict) void lookup(verdict.scan);
      else releaseIntoInput(verdict.release);
    }, 50);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      clearInterval(timer);
    };
  }, [disabled, lookup]);

  // ── Camera path ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraOpen) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const dedupe = dedupeCameraDecode(1_500);
    /** Codes currently held in frame — the other half of the "away and back = two" rule. */
    const inFrame = new Set<string>();

    const stop = () => {
      stopped = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        if (!stopped) setCameraError(true);
        return;
      }
      if (stopped) {
        stop();
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay refusals still leave a decodable stream on some browsers; press on.
      }

      let decode: (image: ImageData) => Promise<string[]>;
      try {
        const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (Ctor) {
          const detector = new Ctor({ formats: NATIVE_FORMATS });
          decode = async (image) => (await detector.detect(image)).map((r) => r.rawValue);
        } else {
          // Only now — the decoder is ~1 MB of wasm and most receivers never open this sheet.
          const { readBarcodes } = await import("zxing-wasm/reader");
          decode = async (image) =>
            (await readBarcodes(image, { formats: [...ZXING_FORMATS] }))
              .filter((r) => r.isValid)
              .map((r) => r.text);
        }
      } catch {
        if (!stopped) setCameraError(true);
        stop();
        return;
      }
      if (stopped) {
        stop();
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        if (!stopped) setCameraError(true);
        stop();
        return;
      }

      let lastSample = 0;
      let busy = false;
      const loop = (now: number) => {
        if (stopped) return;
        frame = requestAnimationFrame(loop);
        if (busy || now - lastSample < FRAME_INTERVAL_MS) return;
        lastSample = now;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) return;
        const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        busy = true;
        void decode(image)
          .then((codes) => {
            if (stopped) return;
            const at = performance.now();
            // A code that has LEFT the frame is released, so presenting it again counts.
            for (const held of [...inFrame]) {
              if (!codes.includes(held)) {
                dedupe.frameWithout(held, at);
                inFrame.delete(held);
              }
            }
            for (const code of codes) {
              const fresh = dedupe.decode(code, at);
              inFrame.add(code);
              if (!fresh) continue;
              void lookup(code);
              if (!keepRef.current) {
                setCameraOpen(false);
                return;
              }
            }
          })
          .catch(() => {
            // One unreadable frame is not an error — the next one is 150 ms away.
          })
          .finally(() => {
            busy = false;
          });
      };
      frame = requestAnimationFrame(loop);
    })();

    closeCameraRef.current = () => setCameraOpen(false);
    return () => {
      closeCameraRef.current = () => undefined;
      stop();
    };
  }, [cameraOpen, lookup]);

  const openCamera = () => {
    setCameraError(false);
    setCameraOpen(true);
  };

  const levelLabel = (l: Level) => t(l === "case" ? "receiving.scan.level_case" : "receiving.scan.level_inner");

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={openCamera}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-white px-4 text-sm font-semibold text-co-text disabled:opacity-60"
      >
        {t("receiving.scan.button")}
      </button>
      {/* The wedge needs no UI — but a receiver holding a gun deserves to know it is live. */}
      {!disabled ? (
        <span className="rounded-full border border-co-border bg-co-surface-2 px-2 py-0.5 text-[11px] font-bold text-co-text-dim">
          {t("receiving.scan.ready")}
        </span>
      ) : null}

      {/* ── Camera sheet ───────────────────────────────────────────────────── */}
      {cameraOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("receiving.scan.button")}
          className={sheetShell}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCameraOpen(false);
          }}
        >
          <div className={sheetBody}>
            {cameraError ? (
              <p className="text-sm font-semibold text-co-text">{t("receiving.scan.camera_unavailable")}</p>
            ) : (
              // A live camera preview carries no caption track and is not a control — the
              // label is what a screen reader has to say about it, since the picture itself
              // says nothing to someone who cannot see it.
              <video
                ref={videoRef}
                playsInline
                muted
                aria-label={t("receiving.scan.button")}
                className="aspect-[4/3] w-full rounded-lg bg-co-text/80 object-cover"
              />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setKeepScanning((k) => !k)}
                aria-pressed={keepScanning}
                className={
                  chip +
                  " " +
                  (keepScanning
                    ? "border-co-text bg-co-surface-2 text-co-text"
                    : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                }
              >
                {t("receiving.scan.keep")}
              </button>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className={chip + " border-co-border bg-co-surface text-co-text hover:border-co-text"}
              >
                {t("receiving.scan.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Unknown / ambiguous code sheet ─────────────────────────────────── */}
      {askingAbout !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("receiving.scan.unknown_title")}
          className={sheetShell}
          onClick={(e) => {
            if (e.target === e.currentTarget) setAskingAbout(null);
          }}
        >
          <div className={sheetBody}>
            <h3 className="text-lg font-extrabold leading-tight text-co-text">
              {t("receiving.scan.unknown_title")}
            </h3>
            {lookupFailed ? (
              <p className="mt-1 text-[12px] text-co-text-dim">{t("receiving.scan.could_not_check")}</p>
            ) : null}

            {/* Case or inner pack — the same UPC really is printed on both. Case is the
                default because a case is what comes off a truck. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {(["case", "inner"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  aria-pressed={level === l}
                  className={
                    chip +
                    " " +
                    (level === l
                      ? "border-co-text bg-co-surface-2 text-co-text"
                      : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                  }
                >
                  {levelLabel(l)}
                </button>
              ))}
            </div>

            <ul className="mt-3 flex flex-col gap-1.5">
              {lines.map((l) => (
                <li key={l.index}>
                  <button
                    type="button"
                    onClick={() => {
                      const code = askingAbout;
                      setAskingAbout(null);
                      onUnknownPick(code, l.index, level);
                    }}
                    className="inline-flex min-h-[44px] w-full items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-left text-sm font-semibold text-co-text hover:border-co-text"
                  >
                    {l.skuName}
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const code = askingAbout;
                  setAskingAbout(null);
                  onNotOnDelivery(code, level);
                }}
                className={chip + " border-co-border bg-co-surface text-co-text hover:border-co-text"}
              >
                {t("receiving.scan.not_on_delivery")}
              </button>
              <button
                type="button"
                onClick={() => setAskingAbout(null)}
                className={chip + " border-co-border bg-co-surface text-co-text-dim hover:border-co-text"}
              >
                {t("receiving.scan.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
