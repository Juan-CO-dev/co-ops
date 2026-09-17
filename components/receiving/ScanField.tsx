"use client";

/**
 * ScanField — one scan affordance at the receiving door (V3-B §6).
 *
 * Two input paths, one answer. A Bluetooth gun in HID keyboard mode types the code at the
 * page and needs no UI at all; a phone needs a camera sheet. Both end in the same
 * `lookup(code)` and the same three callbacks, so `ReceivingForm` never has to know which
 * one the receiver used.
 *
 * KEYBOARD PATH — ARMED ONLY WHEN NOTHING EDITABLE HAS FOCUS (Astra finding 1, redesign).
 * v1 buffered and provisionally swallowed EVERY keystroke on the page and re-dispatched the
 * buffer into the focused field when the burst hypothesis died. That moved a character into
 * the NEXT input when the operator tabbed inside the 300 ms window, could not place a caret
 * in a number input, and discarded a select's typeahead — ordinary typing damaged for people
 * who never scanned anything, which is precisely what "scanning is optional" forbids.
 *   The listener now stands down COMPLETELY while `document.activeElement` is editable. A gun
 *   fired into a focused text box types into it like the keyboard it claims to be: honest and
 *   lossless, with nothing to re-dispatch and nothing to undo. With focus on the body, a
 *   button or a div, keystrokes feed `ScanBurst` and are swallowed only once a burst is
 *   CONFIRMED (two characters ≤ 35 ms apart); the first character of a candidate burst is let
 *   through, because outside an editable it lands nowhere. Autorepeat, chorded keys and IME
 *   composition never reach the machine at all.
 *   DISARMING DISCARDS THE BUFFER (Astra r2 item 4). Standing down mid-burst used to leave
 *   six buffered characters for the 50 ms tick to fire as a truncated scan while the rest of
 *   the code typed itself into the field the caret had just moved to. The buffer is reset the
 *   moment focus lands in an editable, on every intake change, and on disable — and the tick
 *   re-reads the live focus at EMISSION time rather than trusting the state it was scheduled
 *   under, because 50 ms is long enough for a caret to move.
 *   The "Scanner ready" pill is the armed lamp: it appears exactly when the wedge would act.
 *
 * CAMERA PATH — on tap, and never before. `BarcodeDetector` where the browser has it
 * (Android Chrome), else `zxing-wasm/reader` DYNAMICALLY imported when the sheet opens, so
 * the door page's bundle carries no decoder for the receivers who use a gun. Frames are
 * sampled ~150 ms apart off a canvas; `dedupeCameraDecode` is what keeps a label resting on
 * the counter from racking up phantom units — a code re-arms only after it has been ABSENT
 * for two consecutive sampled frames (spec §4 counting rule, Astra follow-up 8 + r2).
 *
 * WHAT IS NOT HERE: the arithmetic. `lib/scan-field-shared.ts` owns what a match does to
 * the line list and `lib/barcodes-shared.ts` owns what a label means — both node-tested.
 * This file is DOM and network, which is the part the repo has no test environment for.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { ScanBurst, dedupeCameraDecode, type Level, type NormalizedCode, type ScanMatch } from "@/lib/barcodes-shared";
import { isEditableTarget, type EditableProbe } from "@/lib/scan-field-shared";

/** The lookup route answers the lib's `ScanMatch` verbatim plus the normalised code. */
type LookupResponse = ScanMatch & { normalized?: NormalizedCode; ambiguous?: boolean };
/** Every match that names a SKU — i.e. everything but `unknown`. */
type ResolvedMatch = Exclude<ScanMatch, { kind: "unknown" }>;

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
/** How long an unsighted code stays in the dedupe map. NOT an acceptance rule (follow-up 8). */
const DEDUPE_EVICT_MS = 1_500;
/**
 * A decoder that has thrown on this many frames in a row is broken, not looking at a bad
 * label — say so and stop, rather than presenting a live preview that can never succeed
 * (Astra follow-up 9).
 */
const MAX_DECODE_FAILURES = 5;

const sheetShell =
  "fixed inset-0 z-50 flex items-end justify-center bg-co-text/40 sm:items-center sm:px-4";
const sheetBody =
  "max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-2 border-co-border bg-co-surface p-5 shadow-xl sm:rounded-2xl";
const chip =
  "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition";

export interface ScanFieldLine {
  /** `ReceivingForm`'s stable row key — what `onUnknownPick` hands back (Astra finding 4). */
  key: string;
  skuName: string;
}

let eventSeq = 0;

/**
 * ONE SCAN THE RECEIVER STILL OWES AN ANSWER TO.
 *
 * The sheet asks two questions and they share one shell:
 *   `unknown` — nobody has taught this code: which line is it, or is it not on this delivery?
 *   `level`   — the code IS known and is taught at BOTH levels, so the case/inner question
 *               has to be asked before anything is stepped or taught (Astra finding 3).
 *
 * THEY QUEUE (Astra r2 item 3). A single pending slot meant two beeps on a both-level code
 * overwrote each other and one Case/Inner tap counted ONE unit for TWO cases — a silent
 * undercount, the exact failure the counting rule exists to prevent. The sheet shows the
 * head, every answer consumes exactly one event and steps exactly one unit, and an event
 * carries the intake generation it was scanned under so a vendor switch retires it instead
 * of asking about a truck that has gone.
 */
interface ScanEvent {
  id: number;
  token: number;
  code: string;
  kind: "unknown" | "level";
  /** The sheet is up because the lookup never answered, not because the code is new. */
  failed: boolean;
  /** The level the toggle currently shows (`unknown` only — a `level` chip IS the answer). */
  level: Level;
  match: ResolvedMatch | null;
  levels: Level[];
}

export function ScanField({
  vendorId,
  locationId,
  lineSkuIds,
  intakeToken,
  disabled,
  lines,
  skuNameFor,
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
  /**
   * The intake generation this scan belongs to. Bumped by the form on a vendor change,
   * reset, draft restore and successful submit; a lookup whose answer arrives after the
   * token moved is DROPPED, its request is aborted, and every unanswered sheet it opened
   * retires with it (Astra finding 4 + r2 item 1).
   */
  intakeToken: number;
  /** Submitting, or the form is otherwise closed: the listener stands down entirely. */
  disabled: boolean;
  lines: ScanFieldLine[];
  /** Names the SKU a two-level code resolved to, for the case/inner question. */
  skuNameFor: (skuId: string) => string;
  /** The token rides with every answer: the PARENT re-checks it before it touches a line. */
  onMatch: (m: ScanMatch & { code: string; token: number }) => void;
  onUnknownPick: (code: string, lineKey: string | null, level: Level, token: number) => void;
  onNotOnDelivery: (code: string, level: Level, token: number) => void;
}) {
  const { t } = useTranslation();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [keepScanning, setKeepScanning] = useState(false);
  /** Scans still awaiting an answer, oldest first. The sheet shows the head. */
  const [queue, setQueue] = useState<ScanEvent[]>([]);
  /** True while nothing editable holds focus — i.e. while the wedge would actually act. */
  const [armed, setArmed] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeCameraRef = useRef<() => void>(() => undefined);

  /**
   * Every lookup in flight. A lookup is a READ, so cancelling one costs nothing and closes
   * the hole a token check alone could not: changing vendors sets `prefilling`, which
   * UNMOUNTS this component, and an unmounted island's pending fetch still holds the props
   * ref it captured — so its own freshness check passed and the retained parent callback
   * appended the previous vendor's SKU to the new intake (Astra r2 item 1). The cleanup
   * runs on BOTH an intake change and unmount, which is exactly the set of moments an
   * answer stops being wanted.
   */
  const abortersRef = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const aborters = abortersRef.current;
    return () => {
      for (const c of aborters) c.abort();
      aborters.clear();
    };
  }, [intakeToken]);

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
  const lookupPropsRef = useRef({ vendorId, locationId, lineSkuIds, intakeToken });
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    keepRef.current = keepScanning;
    lookupPropsRef.current = { vendorId, locationId, lineSkuIds, intakeToken };
    onMatchRef.current = onMatch;
  });

  /**
   * Park one unanswered scan. Entries from retired generations are swept here rather than in
   * an effect: filtering on the way in (and on the way out, below) keeps the queue honest
   * with no cascading render and no `setState` in an effect body.
   */
  const enqueue = useCallback((event: Omit<ScanEvent, "id">) => {
    setQueue((q) => [...q.filter((e) => e.token === event.token), { ...event, id: eventSeq++ }]);
    closeCameraRef.current();
  }, []);

  const enqueueUnknown = useCallback(
    (code: string, failed: boolean, token: number) =>
      enqueue({ token, code, kind: "unknown", failed, level: "case", match: null, levels: [] }),
    [enqueue],
  );

  /**
   * Ask the server what this label means. A timeout or a network error is NOT an error the
   * receiver has to read: it opens the same picker an unknown code opens, with one sentence
   * saying the code could not be checked. The truck is still at the door either way.
   *
   * THE REQUEST IS BOUND TO ITS INTAKE. The vendor and the generation token are captured
   * before the fetch, re-checked after it, aborted when the generation ends, and carried on
   * the resulting event so the PARENT can refuse it one more time before it touches a line.
   */
  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.slice(0, MAX_CODE);
      const { vendorId: v, locationId: l, lineSkuIds: ids, intakeToken: token } = lookupPropsRef.current;
      const stillMine = () =>
        lookupPropsRef.current.vendorId === v && lookupPropsRef.current.intakeToken === token;
      const controller = new AbortController();
      abortersRef.current.add(controller);
      // A 4 s abort and a cancellation abort are the same signal and mean opposite things:
      // one opens the unknown sheet, the other must leave no trace at all.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LOOKUP_TIMEOUT_MS);
      try {
        const res = await fetch("/api/operations/receiving/scan/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vendorId: v, locationId: l, code, lineSkuIds: ids }),
          signal: controller.signal,
        });
        if (!stillMine()) return;
        if (!res.ok) {
          enqueueUnknown(code, true, token);
          return;
        }
        const body = (await res.json()) as LookupResponse;
        if (!stillMine()) return;
        const resolved = body.normalized?.code ?? code;
        // AMBIGUOUS IS NOT A MATCH. Two of this vendor's SKUs carrying one code is a data
        // error; auto-opening either line would file the wrong item confidently.
        if (body.kind === "unknown" || body.ambiguous === true) {
          enqueueUnknown(resolved, false, token);
          return;
        }
        // A CODE TAUGHT AT BOTH LEVELS IS A QUESTION, NOT A DEFAULT (Astra finding 3). v1
        // read only `level`, whose default is case, so scanning an inner pack whose UPC is
        // shared with the case silently added a CASE. Ask before stepping or teaching.
        const levels = body.levels;
        if (levels.length > 1) {
          enqueue({ token, code: resolved, kind: "level", failed: false, level: levels[0] ?? "case", match: body, levels });
          return;
        }
        onMatchRef.current({ ...body, code: resolved, token });
      } catch {
        if (controller.signal.aborted && !timedOut) return; // cancelled: this intake is over
        if (stillMine()) enqueueUnknown(code, true, token);
      } finally {
        clearTimeout(timer);
        abortersRef.current.delete(controller);
      }
    },
    [enqueue, enqueueUnknown],
  );

  // ── Keyboard-wedge path ────────────────────────────────────────────────────

  /** The live answer, read from the DOM rather than from state that may be a tick behind. */
  const isArmedNow = () => !isEditableTarget(document.activeElement as unknown as EditableProbe | null);

  /**
   * The armed lamp. Focus events are the external system this effect subscribes to; the
   * initial read is scheduled rather than run inline both because a synchronous setState in
   * an effect body is a cascading render (react-hooks/set-state-in-effect) and because
   * `focusout` fires BEFORE the new element takes focus — reading `activeElement` a tick
   * later is what makes a field-to-field tab not flash the pill on.
   */
  useEffect(() => {
    if (disabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      timer = null;
      const nowArmed = isArmedNow();
      // STANDING DOWN THROWS THE BUFFER AWAY (r2 item 4): a half-typed burst must never
      // survive into a field, and the characters were never taken from anyone.
      if (!nowArmed) burstRef.current?.reset();
      setArmed(nowArmed);
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(sync, 0);
    };
    schedule();
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, [disabled]);

  /** A new intake is a new truck: whatever was half-scanned at the old one is not a code. */
  useEffect(() => {
    burstRef.current?.reset();
  }, [intakeToken]);

  useEffect(() => {
    if (disabled) return;
    const burst = burstRef.current;
    if (!burst) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // A chorded key is a shortcut, autorepeat is a held key, and a composition keystroke
      // belongs to the IME — none of them is ever part of a scanned code.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      // THE ONE RULE (finding 1): never touch a keystroke aimed at something editable. No
      // buffering, no swallowing, no re-dispatch — the gun just types into the field.
      if (isEditableTarget(e.target as unknown as EditableProbe | null) || !isArmedNow()) {
        burst.reset();
        return;
      }

      const verdict = burst.key(e.key, performance.now());
      if (verdict === "pass") return;
      if (typeof verdict === "object" && "scan" in verdict) {
        // The terminating Enter belongs to the scanner, not to the form's submit button.
        e.preventDefault();
        e.stopPropagation();
        void lookup(verdict.scan);
        return;
      }
      // "swallow", or a release whose characters have nowhere to go (nothing editable is
      // focused — that is the whole premise of being armed). Swallow the key only while the
      // burst is CONFIRMED: the first character of a candidate is harmless outside a field,
      // and letting it through is what makes a mistaken swallow impossible.
      if (burst.confirmed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    // A burst that ends in silence rather than Enter still has to land. A release arriving
    // here is a short buffer that stalled; with nothing editable focused there is nowhere to
    // put it and nothing was taken from anyone, so it is simply dropped.
    const timer = setInterval(() => {
      // ARMED IS RE-READ AT EMISSION TIME, NOT AT SCHEDULING TIME (r2 item 4). 50 ms is
      // ample for a caret to land in a field mid-burst, and the half of the code already
      // buffered would otherwise fire as a truncated scan while the rest typed itself in.
      if (!isArmedNow()) {
        burst.reset();
        return;
      }
      const verdict = burst.tick(performance.now());
      if (verdict !== null && "scan" in verdict) void lookup(verdict.scan);
    }, 50);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      clearInterval(timer);
      burst.reset(); // disabled (submitting) discards the buffer too
    };
  }, [disabled, lookup]);

  // ── Camera path ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraOpen) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const dedupe = dedupeCameraDecode(DEDUPE_EVICT_MS);
    /** Codes the dedupe still considers held — the other half of the "away and back = two" rule. */
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

    /** A failure nobody can work around: say so, and let go of the camera. */
    const fail = () => {
      if (!stopped) setCameraError(true);
      stop();
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

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        fail();
        return;
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
        // WARM THE DECODER BEFORE THE LOOP (Astra follow-up 9). zxing initialises its wasm
        // on the FIRST decode, not on import, so an initialisation failure used to land in
        // the per-frame catch and be swallowed 6–7 times a second: a live preview that could
        // never succeed and never said why. One 1×1 decode here moves that failure into the
        // branch that stops the tracks and shows "camera not available".
        await decode(ctx.createImageData(1, 1));
      } catch {
        fail();
        return;
      }
      if (stopped) {
        stop();
        return;
      }

      let lastSample = 0;
      let busy = false;
      let failures = 0;
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
            failures = 0;
            const at = performance.now();
            // A code that has LEFT the frame is released, so presenting it again counts —
            // and is now the ONLY thing that re-arms it (follow-up 8). `frameWithout` says
            // whether THIS absence was enough; a single blank decode is not, so the code
            // stays held and keeps being reported until the dedupe releases it (r2).
            for (const held of [...inFrame]) {
              if (!codes.includes(held) && dedupe.frameWithout(held, at)) inFrame.delete(held);
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
            // One unreadable frame is not an error — the next one is 150 ms away. A RUN of
            // them is a broken decoder, and pretending otherwise is the silent failure.
            failures += 1;
            if (failures >= MAX_DECODE_FAILURES) fail();
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

  // Only this generation's events can be asked about; the rest are swept on the next write.
  const live = queue.filter((e) => e.token === intakeToken);
  const head = live[0] ?? null;
  /** Exactly one event leaves the queue per answer — one scan, one unit (spec §4). */
  const consumeHead = () => setQueue((q) => q.filter((e) => e.token === intakeToken).slice(1));
  const setHeadLevel = (l: Level) =>
    setQueue((q) => q.map((e) => (head !== null && e.id === head.id ? { ...e, level: l } : e)));

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
      {/* The wedge needs no UI — but a receiver holding a gun deserves to know it is live,
          and equally deserves to know when it is NOT: while the caret sits in a text field
          the gun types into that field like any keyboard, and the pill goes away to say so. */}
      {!disabled && armed ? (
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

      {/* ── The sheet: "which item is this?" or "which level?" ──────────────── */}
      {head !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={head.kind === "level" && head.match ? skuNameFor(head.match.skuId) : t("receiving.scan.unknown_title")}
          className={sheetShell}
          onClick={(e) => {
            if (e.target === e.currentTarget) consumeHead();
          }}
        >
          <div className={sheetBody}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold leading-tight text-co-text">
                {head.kind === "level" && head.match ? skuNameFor(head.match.skuId) : t("receiving.scan.unknown_title")}
              </h3>
              {/* HOW MANY SCANS ARE STILL WAITING. A bare number beside the title, and only
                  when there is more than one — a count is the whole message, so it needs no
                  sentence and mints no key. */}
              {live.length > 1 ? (
                <span className="rounded-full border-2 border-co-gold-deep bg-co-warning-surface px-2 py-0.5 text-[12px] font-extrabold text-co-warning-text">
                  {live.length}
                </span>
              ) : null}
            </div>
            {head.kind === "unknown" && head.failed ? (
              <p className="mt-1 text-[12px] text-co-text-dim">{t("receiving.scan.could_not_check")}</p>
            ) : null}

            {/* Case or inner pack — the same UPC really is printed on both.
                In `level` mode the chip IS the answer: one tap at a truck, and the match is
                dispatched at the level the receiver named. In `unknown` mode it selects the
                level the following line pick will teach, and case leads because a case is
                what comes off a truck. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {(head.kind === "level" ? head.levels : (["case", "inner"] as const)).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    if (head.kind !== "level" || head.match === null) {
                      setHeadLevel(l);
                      return;
                    }
                    const { match, code, token } = head;
                    consumeHead();
                    onMatch({ ...match, level: l, code, token });
                  }}
                  aria-pressed={head.kind === "level" ? undefined : head.level === l}
                  className={
                    chip +
                    " " +
                    (head.kind !== "level" && head.level === l
                      ? "border-co-text bg-co-surface-2 text-co-text"
                      : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                  }
                >
                  {levelLabel(l)}
                </button>
              ))}
            </div>

            {head.kind === "unknown" ? (
              <>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {lines.map((l) => (
                    <li key={l.key}>
                      <button
                        type="button"
                        onClick={() => {
                          const { code, level, token } = head;
                          consumeHead();
                          onUnknownPick(code, l.key, level, token);
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
                      const { code, level, token } = head;
                      consumeHead();
                      onNotOnDelivery(code, level, token);
                    }}
                    className={chip + " border-co-border bg-co-surface text-co-text hover:border-co-text"}
                  >
                    {t("receiving.scan.not_on_delivery")}
                  </button>
                  <button
                    type="button"
                    onClick={consumeHead}
                    className={chip + " border-co-border bg-co-surface text-co-text-dim hover:border-co-text"}
                  >
                    {t("receiving.scan.close")}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={consumeHead}
                  className={chip + " border-co-border bg-co-surface text-co-text-dim hover:border-co-text"}
                >
                  {t("receiving.scan.close")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
