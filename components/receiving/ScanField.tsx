"use client";

/**
 * ScanField — one scan affordance at the receiving door (V3-B §6).
 *
 * Two input paths, one answer. A Bluetooth gun in HID keyboard mode types the code at the
 * page and needs no UI at all; a phone needs a camera sheet. Both end in the same
 * `lookup(code)` and the same one callback, so `ReceivingForm` never has to know which one
 * the receiver used.
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
 *   DISARMING DISCARDS THE BUFFER (Astra r2 item 4). The buffer is reset the moment focus
 *   lands in an editable, on every intake change, and on disable — and the tick re-reads the
 *   live focus at EMISSION time rather than trusting the state it was scheduled under.
 *   The "Scanner ready" pill is the armed lamp: it appears exactly when the wedge would act.
 *
 * THE EVENT MACHINE — `scanQueue` in `lib/scan-field-shared.ts`, node-tested (Astra r3).
 * A scan becomes an EVENT the instant the label is read, and its queue position is allocated
 * there; the lookup only ever RESOLVES that entry. Only the head is ever presented, and it
 * stays the head until its whole workflow ends, so the receiver is always answering about the
 * box in their hands and one scan can never overwrite another's confirmation. This component
 * owns the machine and asks the scan-identity questions; the PARENT is the executor — it
 * steps lines, confirms twins, teaches, and calls `resolveRef.current(id)` exactly once when
 * that workflow ends.
 *
 * CAMERA PATH — on tap, and never before. `BarcodeDetector` where the browser has it
 * (Android Chrome), else `zxing-wasm/reader` DYNAMICALLY imported when the sheet opens, so
 * the door page's bundle carries no decoder for the receivers who use a gun. Frames are
 * sampled ~150 ms apart off a canvas; `dedupeCameraDecode` is what keeps a label resting on
 * the counter from racking up phantom units — a code re-arms only after it has been ABSENT
 * for two consecutive sampled frames (spec §4 counting rule, Astra follow-up 8 + r2).
 *
 * WHAT IS NOT HERE: the arithmetic and the ordering law. `lib/scan-field-shared.ts` owns what
 * a match does to the line list and how events queue; `lib/barcodes-shared.ts` owns what a
 * label means — all node-tested. This file is DOM and network, which is the part the repo has
 * no test environment for.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { ScanBurst, dedupeCameraDecode, type Level, type NormalizedCode, type ScanMatch } from "@/lib/barcodes-shared";
import {
  isEditableTarget,
  scanQueue,
  type EditableProbe,
  type ResolvedScanMatch,
  type ScanQueueState,
} from "@/lib/scan-field-shared";

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
  /** `ReceivingForm`'s stable row key — what a line pick hands back (Astra finding 4). */
  key: string;
  skuName: string;
}

/**
 * ONE SCAN, DECIDED — what the executor is asked to carry out. The event id travels with it
 * and comes back through `resolveRef` when the workflow ends; nothing else can advance the
 * queue, which is what makes the parent's single active slot provably safe (Astra r3).
 */
export interface ScanFieldEvent {
  /** Globally unique across remounts — `<intakeToken>:<seq>` (Astra r4 item 1). */
  id: string;
  token: number;
  code: string;
  action:
    /** Step this match. `line`/`sku` step straight away; a `twin` is offered first. */
    | { kind: "step"; match: ResolvedScanMatch; level: Level }
    /** The receiver named the row this unknown code belongs to: teach it, then step. */
    | { kind: "teach"; lineKey: string; level: Level }
    /** Not on this delivery — hand the code to the add-item picker. */
    | { kind: "not_on_delivery"; level: Level };
}

export function ScanField({
  vendorId,
  locationId,
  lineSkuIds,
  intakeToken,
  disabled,
  lines,
  skuNameFor,
  resolveRef,
  onScanEvent,
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
   * The intake generation these scans belong to. Bumped by the form on a vendor change,
   * reset, draft restore and successful submit; a lookup whose answer arrives after the
   * token moved is DROPPED, its request is aborted, and every unanswered event it queued
   * retires with it (Astra finding 4 + r2 item 1).
   */
  intakeToken: number;
  /** Submitting, or the form is otherwise closed: the listener stands down entirely. */
  disabled: boolean;
  lines: ScanFieldLine[];
  /** Names the SKU a two-level code resolved to, for the case/inner question. */
  skuNameFor: (skuId: string) => string;
  /**
   * Filled in by this component: the executor calls it with an event id when that event's
   * workflow ENDS — stepped, taught, cancelled or abandoned. A ref, not a callback prop,
   * because the direction is child → parent and the file already uses this idiom for
   * `closeCameraRef`; storing a function in the parent's state would be the alternative.
   */
  resolveRef: MutableRefObject<(id: string, token: number) => void>;
  onScanEvent: (event: ScanFieldEvent) => void;
}) {
  const { t } = useTranslation();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [keepScanning, setKeepScanning] = useState(false);
  /** True while nothing editable holds focus — i.e. while the wedge would actually act. */
  const [armed, setArmed] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeCameraRef = useRef<() => void>(() => undefined);

  /**
   * THE QUEUE LIVES IN A REF AND IS MIRRORED TO STATE FOR RENDERING. Two lookups can resolve
   * in the same tick, and a completion can arrive while one does; reading the ref means every
   * transition is applied to the CURRENT queue rather than to whatever a closure captured.
   * `commit` is the only writer, and it pumps the machine on the way out.
   */
  const queueRef = useRef<ScanQueueState>(scanQueue.empty);
  const [queueView, setQueueView] = useState<ScanQueueState>(scanQueue.empty);
  /**
   * Every lookup in flight. A lookup is a READ, so cancelling one costs nothing and closes
   * the hole a token check alone could not: changing vendors sets `prefilling`, which
   * UNMOUNTS this component, and an unmounted island's pending fetch still holds the props
   * ref it captured (Astra r2 item 1).
   */
  const abortersRef = useRef<Set<AbortController>>(new Set());

  // THE LIVE VALUES THE LONG-LIVED LOOPS READ. The keydown listener, the camera's frame loop
  // and the queue pump all outlive the render that started them and must see the CURRENT
  // props — but putting those props in a dependency array would tear the listener down and
  // rebuild it on every keystroke (the parent re-renders on each one, because it owns the
  // line state), which is how a burst in progress gets dropped.
  const keepRef = useRef(keepScanning);
  const lookupPropsRef = useRef({ vendorId, locationId, lineSkuIds, intakeToken });
  const onScanEventRef = useRef(onScanEvent);

  /**
   * Hand the head to the executor, if it is resolved and asks no question of its own.
   * `unknown` and `needs_level` heads are questions THIS component owns, so they wait for a
   * tap; a `match` head is a workflow and goes straight over. Once per id, always.
   */
  const pump = useCallback(() => {
    const token = lookupPropsRef.current.intakeToken;
    const head = scanQueue.head(queueRef.current, token);
    if (head === null || head.state !== "resolved" || head.outcome === null) return;
    if (head.outcome.kind !== "match") return;
    // Flip to `working` BEFORE handing over: the executor may finish synchronously and pump
    // again, and the machine has to have already recorded that this one went out.
    const next = scanQueue.dispatch(queueRef.current, head.id);
    queueRef.current = next;
    setQueueView(next);
    onScanEventRef.current({
      id: head.id,
      token: head.token,
      code: head.code,
      action: { kind: "step", match: head.outcome.match, level: head.outcome.match.level },
    });
  }, []);

  const commit = useCallback(
    (next: ScanQueueState) => {
      queueRef.current = next;
      setQueueView(next);
      pump();
    },
    [pump],
  );

  // The commit-phase mirror every long-lived loop reads, and the handle the executor holds.
  useEffect(() => {
    keepRef.current = keepScanning;
    lookupPropsRef.current = { vendorId, locationId, lineSkuIds, intakeToken };
    onScanEventRef.current = onScanEvent;
    // The executor's ONLY way to advance the machine: it says an event's workflow is over.
    // GENERATION-AWARE (Astra r4 item 1): a completion names the intake it was issued
    // under, so a workflow that finishes after the truck changed removes nothing here.
    resolveRef.current = (id: string, token: number) =>
      commit(scanQueue.complete(queueRef.current, id, token));
  });

  /**
   * Hand over a head whose question THIS component just answered. The event goes to
   * `working` so the sheet closes on the tap, while the event itself stays at the head of
   * the queue until the executor says its workflow ended.
   */
  const dispatchAnswer = (event: ScanFieldEvent) => {
    const next = scanQueue.dispatch(queueRef.current, event.id);
    queueRef.current = next;
    setQueueView(next);
    onScanEventRef.current(event);
  };

  /**
   * A retired generation's questions retire with it. This runs in the effect CLEANUP, which
   * is both "the token moved" and "the island unmounted" — exactly the set of moments an
   * unanswered scan stops being a question about anything.
   */
  useEffect(() => {
    const aborters = abortersRef.current;
    const generation = intakeToken;
    return () => {
      for (const c of aborters) c.abort();
      aborters.clear();
      queueRef.current = scanQueue.drop(queueRef.current, generation);
      setQueueView(queueRef.current);
    };
  }, [intakeToken]);

  // The burst machine must survive re-renders — it IS the buffered keystrokes.
  const burstRef = useRef<ScanBurst | null>(null);
  if (burstRef.current === null) {
    burstRef.current = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
  }

  /**
   * Ask the server what this label means.
   *
   * THE EVENT IS BORN HERE, BEFORE THE FETCH (Astra r3). Its queue position is arrival order,
   * so two labels read back to back are asked about in the order they were read however the
   * two responses race. A timeout is NOT an error the receiver has to read: it resolves the
   * same entry as `unknown` with one sentence saying the code could not be checked — the
   * truck is still at the door either way. A CANCELLATION removes the entry instead: that
   * intake is over and there is nothing left to ask.
   */
  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.slice(0, MAX_CODE);
      const { vendorId: v, locationId: l, lineSkuIds: ids, intakeToken: token } = lookupPropsRef.current;
      const arrival = scanQueue.arrive(queueRef.current, { code, token });
      const id = arrival.event.id;
      commit(arrival.state);

      const stillMine = () =>
        lookupPropsRef.current.vendorId === v && lookupPropsRef.current.intakeToken === token;
      const controller = new AbortController();
      abortersRef.current.add(controller);
      // A 4 s abort and a cancellation abort are the same signal and mean opposite things.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LOOKUP_TIMEOUT_MS);
      const settle = (failed: boolean) =>
        commit(scanQueue.resolve(queueRef.current, id, { kind: "unknown", failed }));
      try {
        const res = await fetch("/api/operations/receiving/scan/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vendorId: v, locationId: l, code, lineSkuIds: ids }),
          signal: controller.signal,
        });
        if (!stillMine()) return;
        if (!res.ok) {
          settle(true);
          return;
        }
        const body = (await res.json()) as LookupResponse;
        if (!stillMine()) return;
        const resolved = body.normalized?.code ?? code;
        // AMBIGUOUS IS NOT A MATCH. Two of this vendor's SKUs carrying one code is a data
        // error; auto-opening either line would file the wrong item confidently — so it asks
        // the same question an untaught code asks.
        if (body.kind === "unknown" || body.ambiguous === true) {
          commit(
            scanQueue.resolve(
              { ...queueRef.current, events: queueRef.current.events.map((e) => (e.id === id ? { ...e, code: resolved } : e)) },
              id,
              { kind: "unknown", failed: false },
            ),
          );
          return;
        }
        // A CODE TAUGHT AT BOTH LEVELS IS A QUESTION, NOT A DEFAULT (Astra finding 3).
        const outcome =
          body.levels.length > 1
            ? ({ kind: "needs_level", match: body, levels: body.levels } as const)
            : ({ kind: "match", match: body } as const);
        commit(
          scanQueue.resolve(
            { ...queueRef.current, events: queueRef.current.events.map((e) => (e.id === id ? { ...e, code: resolved } : e)) },
            id,
            outcome,
          ),
        );
      } catch {
        if (controller.signal.aborted && !timedOut) {
          // Cancelled by an intake change or an unmount: the question goes away with it.
          commit(scanQueue.complete(queueRef.current, id, token));
          return;
        }
        if (stillMine()) settle(true);
      } finally {
        clearTimeout(timer);
        abortersRef.current.delete(controller);
      }
    },
    [commit],
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

  // ── The sheet ──────────────────────────────────────────────────────────────
  const head = scanQueue.head(queueView, intakeToken);
  const waiting = scanQueue.pending(queueView, intakeToken);
  // A `working` head is the PARENT's confirm, on the page behind this sheet — not a question
  // this component still owns, so it shows nothing for it.
  const asks =
    scanQueue.isPresentable(head) && head !== null && head.outcome !== null && head.outcome.kind !== "match";
  /**
   * A LOOKING-UP HEAD ONLY SHOWS ITSELF WHEN IT IS HOLDING SOMETHING BACK. The waiting state
   * exists to explain why the receiver is not being asked about the second box yet; with
   * nothing queued behind it there is nothing to explain, and a modal that flashed on every
   * successful beep would be its own defect.
   */
  const showSheet = head !== null && (asks || (head.state === "looking_up" && waiting > 1));
  const closeHead = () => {
    if (head !== null) commit(scanQueue.complete(queueRef.current, head.id, head.token));
  };

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

      {/* ── The scan sheet: waiting · "which item is this?" · "which level?" ── */}
      {showSheet && head !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            head.outcome?.kind === "needs_level"
              ? skuNameFor(head.outcome.match.skuId)
              : head.outcome?.kind === "unknown"
                ? t("receiving.scan.unknown_title")
                : head.code
          }
          className={sheetShell}
          onClick={(e) => {
            if (e.target === e.currentTarget && asks) closeHead();
          }}
        >
          <div className={sheetBody}>
            <div className="flex flex-wrap items-center gap-2">
              {head.outcome?.kind === "needs_level" ? (
                <h3 className="text-lg font-extrabold leading-tight text-co-text">
                  {skuNameFor(head.outcome.match.skuId)}
                </h3>
              ) : head.outcome?.kind === "unknown" ? (
                <h3 className="text-lg font-extrabold leading-tight text-co-text">
                  {t("receiving.scan.unknown_title")}
                </h3>
              ) : (
                // Still looking up. The spinner IS the sentence; the code below it is what
                // the receiver needs in order to know which box this is about.
                <span
                  aria-hidden="true"
                  className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-co-border border-t-co-text"
                />
              )}
              {/* HOW MANY SCANS ARE STILL WAITING. A bare number beside the title, and only
                  when there is more than one — a count is the whole message, so it needs no
                  sentence and mints no key. */}
              {waiting > 1 ? (
                <span className="rounded-full border-2 border-co-gold-deep bg-co-warning-surface px-2 py-0.5 text-[12px] font-extrabold text-co-warning-text">
                  {waiting}
                </span>
              ) : null}
            </div>

            {/* THE CODE IS ALWAYS ON SCREEN. Astra's P1: a question with no label identifier
                let a receiver answer for the box in their hands about a different box. */}
            <p className="mt-1 break-all font-mono text-[13px] font-bold tracking-tight text-co-text-dim">
              {head.code}
            </p>

            {head.outcome?.kind === "unknown" && head.outcome.failed ? (
              <p className="mt-1 text-[12px] text-co-text-dim">{t("receiving.scan.could_not_check")}</p>
            ) : null}

            {/* Case or inner pack — the same UPC really is printed on both.
                In `needs_level` the chip IS the answer: one tap at a truck, and the match goes
                to the executor at the level the receiver named. In `unknown` it selects the
                level the following line pick will teach, and case leads because a case is
                what comes off a truck. */}
            {asks ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(head.outcome?.kind === "needs_level" ? head.outcome.levels : (["case", "inner"] as const)).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => {
                      if (head.outcome?.kind !== "needs_level") {
                        commit(scanQueue.chooseLevel(queueRef.current, head.id, l));
                        return;
                      }
                      dispatchAnswer({
                        id: head.id,
                        token: head.token,
                        code: head.code,
                        action: { kind: "step", match: head.outcome.match, level: l },
                      });
                    }}
                    aria-pressed={head.outcome?.kind === "needs_level" ? undefined : head.level === l}
                    className={
                      chip +
                      " " +
                      (head.outcome?.kind !== "needs_level" && head.level === l
                        ? "border-co-text bg-co-surface-2 text-co-text"
                        : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                    }
                  >
                    {levelLabel(l)}
                  </button>
                ))}
              </div>
            ) : null}

            {head.outcome?.kind === "unknown" ? (
              <>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {lines.map((l) => (
                    <li key={l.key}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchAnswer({
                            id: head.id,
                            token: head.token,
                            code: head.code,
                            action: { kind: "teach", lineKey: l.key, level: head.level },
                          })
                        }
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
                    onClick={() =>
                      dispatchAnswer({
                        id: head.id,
                        token: head.token,
                        code: head.code,
                        action: { kind: "not_on_delivery", level: head.level },
                      })
                    }
                    className={chip + " border-co-border bg-co-surface text-co-text hover:border-co-text"}
                  >
                    {t("receiving.scan.not_on_delivery")}
                  </button>
                  <button
                    type="button"
                    onClick={closeHead}
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
                  onClick={closeHead}
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
