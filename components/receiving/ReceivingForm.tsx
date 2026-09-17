"use client";

/**
 * ReceivingForm — the count-by-exception door ceremony (spec D1, Task 5).
 *
 * The manager is at the door, truck idling, phone in hand. Target: a clean
 * 8-line delivery confirmed in 60-90 seconds. On vendor select we GET the
 * prefill template (the vendor's last drop) and seed one collapsed
 * IntakeLineRow per expected item — the happy path is tap-✓ down the list.
 * No template → today's blank-line behavior (one added line, expanded).
 *
 * Three visually numbered steps: 1 Count · 2 Receipt photo · 3 Submit. Submit
 * gates on receiptPhotoId OR a "Photo later" tick; the missing photo needs no
 * note tag, because receipt_url IS NULL already renders the "Photo missing"
 * badge on the receiving list and the delivery detail. The primary button files
 * a complete delivery; a quieter secondary action files an in-progress ("still
 * unloading") one. A 409 duplicate renders inline with a "View existing" link.
 *
 * House laws honored: useState-only disclosure (no effects for prop-driven
 * resets); router.refresh() does NOT reset client state, so success resets
 * explicitly; type-only server imports; no server module leaks.
 *
 * MISSING-ITEM HONESTY GATE: completing a delivery while pre-filled EXPECTED rows sat
 * unconfirmed used to be silent — and worse than silent, because the template once SEEDED
 * each row's qty at the expected value, so an item that never came off the truck was filed
 * as fully received. Two things fix that:
 *   1. The template seeds qty EMPTY and keeps expectedQty. An untouched row therefore
 *      carries NO count: readyLines drops it and it files as UNCOUNTED — a visible
 *      omission that surfaces later against the invoice — never as received-in-full.
 *      The happy path is untouched: the collapsed row still reads "expected N × level"
 *      and tapping ✓ still writes qty = expectedQty.
 *   2. The first tap on "Delivery confirmed" opens a warn notice listing every
 *      unconfirmed expected row; each offers "Received" (confirm at the expected count)
 *      or "Didn't arrive" (clear the count, and on a PO-LINKED intake claim a short). A
 *      second tap completes regardless — honesty, not a hard block — and the notice
 *      states that unanswered rows are filed as not counted.
 * Off a mere last-delivery prefill no short is claimed, because a habit is not a debt.
 * See lib/receiving-shared.ts MissingExpectedLine for why a fully-missing item cannot be
 * a delivery line at all.
 *
 * D1 Task 6 — offline-draft persistence:
 *   - Debounced (500 ms) save to localStorage key
 *     `coops.intake.draft.<locationId>` on every relevant state change.
 *   - On mount, any stored drafts render a resume banner; the operator taps
 *     Resume or Discard PER DRAFT. No auto-hydration.
 *   - "Saved on device HH:MM" pill shown after the first write.
 *   - The submitted draft is removed before router.refresh() on success —
 *     only that one; a second truck's draft survives its neighbour's submit.
 *   - localStorage access fully try/catch guarded (private-mode Safari).
 *   - Corrupt/unparseable payload = treated as absent + cleared.
 *
 * PRICE MODE (2026-08-31) — "receiving becomes the price feed":
 *   A non-null unitPrice on a delivery line is the ONE trigger that writes
 *   vendor_price_history, and it worked in prod from day one — but the box lived on the
 *   EXPANDED row while this form seeds every templated line collapsed, so the ordinary
 *   receive never asked. One line in the history of the app carries a price.
 *   The fix is ONE switch above the list, not a chip per row: prices come off ONE invoice
 *   in ONE pass, so N per-row reveals would be N taps to do a single job, and each chip
 *   would also have to fit beside the ✓ on a 360px phone. Off (the default) the list is
 *   byte-for-byte the ceremony it always was; on, every collapsed row grows a price input
 *   and the whole list becomes an invoice-entry pass. The choice PERSISTS per location
 *   (localStorage), so a manager who prices deliveries taps this once, ever — the field
 *   has to stop being something you rediscover.
 *   Prices already entered are never hidden by an off switch: the aggregate "N priced"
 *   readout sits beside the toggle whatever its state, and resuming a draft that carries
 *   prices turns the mode on explicitly.
 *
 * SCANNING AT THE DOOR (V3-B, 2026-09-16): `ScanField` sits above the list and turns a
 * scanned case label — from a Bluetooth gun in HID keyboard mode or the phone camera — into
 * the SAME `setLine(i, patch)` the ± stepper writes. Nothing about this form changes for a
 * receiver who never scans: no new required field, no new submit payload key, and the scan
 * state (which code reached which row, the two one-sentence confirms) is session-only and
 * is deliberately absent from the draft shelf — a resumed intake resumes a COUNT, not a
 * scanner session. Teaching needs the network; counting does not, so a failed teach still
 * steps the line and says so.
 *   Three laws the 2026-09-17 review hardened: a scan steps the row at the SCANNED LEVEL and
 *   never relabels a counted one (`applyScanToLines`), every request is bound to the intake
 *   generation that issued it and is dropped if that generation is gone (`intakeTokenRef`),
 *   and all three requests are bounded at 4 s so a slow teach cannot stall the count.
 *
 * The key holds a LIST (newest first, capped) rather than one draft, and the
 * writer stands down while the resume banner is up. Both are data-loss fixes:
 *   - ONE SLOT PER LOCATION meant two same-hour deliveries clobbered each
 *     other. The shelf keeps one slot per vendor (lib/receiving-shared.ts
 *     upsertIntakeDraft), so the produce drop can't erase the paper-goods
 *     count half-entered beside it.
 *   - The debounced writer used to run WHILE the banner was still asking
 *     "resume or discard?", so the first keystroke of a new intake destroyed
 *     the very draft being offered ~500 ms later. Persistence is suppressed
 *     until the operator answers the banner (resume or discard re-enables it).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import { formatTime } from "@/lib/i18n/format";
import { ActionButton, actionButtonClass } from "@/components/ActionButton";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { IntakeLineRow, type IntakeLine } from "@/components/receiving/IntakeLineRow";
import { ScanField } from "@/components/receiving/ScanField";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { ReceivingFormData, ReceivingSkuOption } from "@/lib/receiving";
import type { Level, ScanMatch } from "@/lib/barcodes-shared";
import { applyScanToLines, levelLabelFor } from "@/lib/scan-field-shared";
import type { OpenCreditRow } from "@/lib/credits";
import {
  INTAKE_DRAFT_CAP,
  pricedLineCount,
  removeIntakeDraft,
  upsertIntakeDraft,
  type IntakeDraftIdentity,
} from "@/lib/receiving-shared";

interface LineDraft extends IntakeLine {
  /** local key so React reconciles rows across add/remove without index churn. */
  key: string;
}

interface LastDeliveryTemplate {
  lines: Array<{ skuId: string; level: string | null; qty: number }>;
}

/** Extended response from the template route (VO-6: additive fields). */
interface TemplateResponse {
  template: LastDeliveryTemplate | null;
  /** "po" = pre-filled from a placed PO; "last_delivery" = prior drop; null = no data. */
  source?: "po" | "last_delivery" | null;
  /** PO id, present when source === "po". Carried into the submit payload. */
  poId?: string | null;
  /** Human-readable PO code shown in the Step-1 header, present when source === "po". */
  displayCode?: string | null;
  /** V2-D4: the vendor's open credits at this location (KH+ redelivery-closure
   *  prefill). Present on every branch; absent/[] when the vendor has none. */
  openCredits?: OpenCreditRow[];
}

let keySeq = 0;
const nextKey = () => `l${keySeq++}`;

/**
 * V3-B: every scan request — lookup, teach, forget — is bounded at 4 s (spec §7, and Astra
 * finding 4: a lookup that fell back after 4 s used to lead straight into an unbounded teach).
 * The truck does not wait, so a request that has not answered by then is over: the case is
 * counted locally and the code is simply not remembered.
 */
const SCAN_REQUEST_TIMEOUT_MS = 4_000;

/** A blank added/overage line — always expanded, no expected qty. */
const addedLine = (): LineDraft => ({
  key: nextKey(),
  skuId: "",
  skuName: "",
  level: "",
  qty: "",
  expectedQty: null,
  discrepancy: null,
  note: "",
  photoId: null,
  confirmed: false,
  expanded: true,
  unitPrice: "",
  observed: "",
  offered: false,
});

/**
 * An OFFERED fallback row (Juan's no-template refinement): one of the selected
 * vendor's own usage-ranked SKUs, presented collapsed with an EMPTY qty. It has no
 * expected number to ✓ into — tapping it opens the stepper. Rows still empty at
 * submit are omitted (offered, not received). `offered: true` distinguishes it from
 * a manually-added overage line for the collapsed/expanded rendering.
 */
const offeredLine = (sku: ReceivingSkuOption): LineDraft => ({
  key: nextKey(),
  skuId: sku.id,
  skuName: sku.name,
  level: "",
  qty: "",
  expectedQty: null,
  discrepancy: null,
  note: "",
  photoId: null,
  confirmed: false,
  expanded: false,
  unitPrice: "",
  observed: "",
  offered: true,
});

/** Usage-first ordering: SKUs with real trailing-30-day depletion first (desc oz),
 *  then alphabetical. Used for BOTH the offered-row fallback and the Add-item picker. */
function byUsageThenName(a: ReceivingSkuOption, b: ReceivingSkuOption): number {
  const ar = a.usageRank ?? -1;
  const br = b.usageRank ?? -1;
  if (ar !== br) return br - ar; // higher usage first; nulls (-1) sink to the bottom.
  return a.name.localeCompare(b.name);
}

// ── Draft persistence (D1 Task 6) ─────────────────────────────────────────

/** Shape persisted to localStorage. `savedAt` is an ISO timestamp; `startedAt` marks
 *  when the intake session began and, with vendorId, identifies the draft on the shelf. */
interface IntakeDraft extends IntakeDraftIdentity {
  date: string;
  invoiceNumber: string;
  invoiceTotal: string;
  notes: string;
  photoLater: boolean;
  receiptPhotoId: string | null;
  lines: LineDraft[];
  savedAt: string;
}

function draftKey(locationId: string): string {
  return `coops.intake.draft.${locationId}`;
}

/** Minimal shape guard — one bad entry must not poison the whole shelf. */
function isIntakeDraft(v: unknown): v is IntakeDraft {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.vendorId === "string" &&
    typeof d.savedAt === "string" &&
    typeof d.startedAt === "string" &&
    Array.isArray(d.lines)
  );
}

/** The location's draft shelf, newest first. Anything unreadable is discarded — a
 *  corrupt payload must never stand between the operator and a working door form. */
function readDrafts(locationId: string): IntakeDraft[] {
  try {
    const raw = localStorage.getItem(draftKey(locationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      // Not a shelf — corrupt, or the pre-launch single-draft shape. Drop it.
      clearDrafts(locationId);
      return [];
    }
    return parsed.filter(isIntakeDraft).slice(0, INTAKE_DRAFT_CAP);
  } catch {
    clearDrafts(locationId);
    return [];
  }
}

function writeShelf(locationId: string, shelf: IntakeDraft[]): void {
  try {
    if (shelf.length === 0) localStorage.removeItem(draftKey(locationId));
    else localStorage.setItem(draftKey(locationId), JSON.stringify(shelf));
  } catch {
    // Private-mode Safari or storage full — silently ignore.
  }
}

/** Save this intake, replacing this vendor's slot rather than adding a duplicate. */
function writeDraft(locationId: string, draft: IntakeDraft): void {
  writeShelf(locationId, upsertIntakeDraft(readDrafts(locationId), draft));
}

/** Remove exactly one draft (submitted or discarded) — never the whole shelf. */
function removeDraft(locationId: string, vendorId: string, startedAt: string): void {
  writeShelf(locationId, removeIntakeDraft(readDrafts(locationId), vendorId, startedAt));
}

function clearDrafts(locationId: string): void {
  try {
    localStorage.removeItem(draftKey(locationId));
  } catch {
    // Private-mode Safari — silently ignore.
  }
}

// ── Price-mode preference ─────────────────────────────────────────────────────
// A PREFERENCE, not draft state: it says how this shop's manager works, so it lives in
// its own key and is deliberately absent from the draft payload (resuming a draft must
// not re-decide how the list renders) and from resetForm (a successful submit must not
// make the operator re-find the switch). Same guarded-localStorage idiom as the shelf —
// private-mode Safari and a full quota both fall back to "off", never to a crash.

function priceModeKey(locationId: string): string {
  return `coops.intake.prices.${locationId}`;
}

function readPriceMode(locationId: string): boolean {
  try {
    return localStorage.getItem(priceModeKey(locationId)) === "1";
  } catch {
    return false;
  }
}

function writePriceMode(locationId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(priceModeKey(locationId), "1");
    else localStorage.removeItem(priceModeKey(locationId));
  } catch {
    // Private-mode Safari or storage full — the switch still works for this session.
  }
}

const field =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const stepHeadClass = "flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-text";
const stepNumClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-co-gold-deep bg-co-gold text-[13px] font-bold text-co-text";

export function ReceivingForm({
  formData,
  locationId,
  today,
}: {
  formData: ReceivingFormData;
  locationId: string;
  today: string;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState(today);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptPhotoId, setReceiptPhotoId] = useState<string | null>(null);
  const [photoLater, setPhotoLater] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([addedLine()]);
  const [prefilling, setPrefilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);

  // Draft persistence state (D1 Task 6).
  // `pendingDrafts` = drafts found on mount, awaiting a per-draft Resume/Discard.
  // `savedAt` = ISO timestamp of the last successful localStorage write this
  // session — drives the "Saved on device HH:MM" indicator.
  // `startedAtRef` = this intake session's identity half (with vendorId). Set on the
  // first save, adopted from a resumed draft, cleared by resetForm — a ref, not state,
  // because it must never trigger a render or re-arm the debounce.
  const [pendingDrafts, setPendingDrafts] = useState<IntakeDraft[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const isFirstRender = useRef(true);
  // V3-B: the scan handlers are asynchronous (teach, THEN step), so a `lines` captured in
  // their closure is whatever it was when the POST left. This ref is the committed truth at
  // the moment each patch is computed — the write itself still goes through a functional
  // updater, so nothing here can clobber an edit made while the network was out.
  const linesRef = useRef(lines);

  // PO context — set when the template route returns source "po".
  // Cleared on vendor change or form reset. poId is carried into the submit
  // payload; displayCode is shown in the Step-1 header banner.
  const [linkedPoId, setLinkedPoId] = useState<string | null>(null);
  const [linkedPoCode, setLinkedPoCode] = useState<string | null>(null);

  // V2-D4 redelivery closure — the vendor's open credits (loaded with the template)
  // and the set the manager checks as "this truck makes up these shorts". Checked ids
  // ride the submit payload as makeUpCreditIds. State-only (useState), reset on vendor
  // change / form reset — no effects for prop resets (house law).
  const [openCredits, setOpenCredits] = useState<OpenCreditRow[]>([]);
  const [checkedCreditIds, setCheckedCreditIds] = useState<Set<string>>(new Set());
  // Success/advisory state for the last submit's closure result.
  const [closedCount, setClosedCount] = useState<number>(0);
  const [closureError, setClosureError] = useState<boolean>(false);

  // Missing-item honesty gate. `armComplete` = the interrupt has been shown once, so the
  // next tap on the primary button completes. `notArrived` is keyed by LINE KEY (not skuId
  // — the same SKU can legitimately sit on two rows) and marks the rows the operator said
  // never came off the truck; on a PO-linked intake those ride the payload as shorts.
  // "Received" needs no entry here — it patches the line itself (confirmed + qty), which
  // is what removes it from the unconfirmed set.
  const [armComplete, setArmComplete] = useState(false);
  const [notArrived, setNotArrived] = useState<Record<string, true>>({});

  // ── V3-B · scanning at the door ────────────────────────────────────────────
  // Everything here is INERT until a scan happens: a receiver who never taps Scan and
  // never picks up a gun sees no new control, no new required field, and submits the same
  // payload as before.
  //   `scannedCodes` remembers, per LINE KEY, which code reached that row this session —
  //     the only thing that can offer "Forget this code" on the right row (the same SKU
  //     may legitimately sit on two rows, so the key, never the skuId).
  //   `twinPending` / `levelPending` are the two one-sentence confirms. Both are INLINE
  //     state in the form's own notice idiom — never window.confirm, which is unstyled,
  //     untranslated, and unusable one-handed at a truck.
  //   `pendingTeach` is a "Not on this delivery" scan waiting for the Add-item picker: the
  //     next pick teaches the code onto whatever SKU the receiver chooses.
  const [scannedCodes, setScannedCodes] = useState<Record<string, { code: string; level: Level }>>({});
  const [twinPending, setTwinPending] = useState<{ skuId: string; level: Level; code: string } | null>(null);
  const [levelPending, setLevelPending] = useState<{
    code: string;
    skuId: string;
    level: Level;
    storedLevel: Level;
  } | null>(null);
  const [pendingTeach, setPendingTeach] = useState<{ code: string; level: Level } | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  // THE INTAKE GENERATION (Astra finding 4). Scanning is the only part of this form that
  // dispatches a request and then writes to the line list AFTER it answers, so it is the only
  // part that can mutate an intake that no longer exists: a teach begun on Baldor's truck used
  // to land its step after the receiver switched to Leonard, reinserting a Baldor SKU into
  // Leonard's delivery. Every lookup/teach/forget captures this counter and the vendor it was
  // issued for, and an answer whose token has moved is DROPPED with no effect.
  //   The ref is the truth (an in-flight response must see the bump the instant it happens,
  //   not one commit later); the state exists only to hand ScanField the same number.
  const intakeTokenRef = useRef(0);
  const [intakeToken, setIntakeToken] = useState(0);
  const vendorIdRef = useRef(vendorId);
  const bumpIntakeToken = () => {
    intakeTokenRef.current += 1;
    setIntakeToken(intakeTokenRef.current);
  };

  // Price mode — the one switch that puts a price input on every collapsed row.
  // Starts false so the FIRST render is always the plain ceremony (localStorage is not
  // readable during SSR); the mount effect below adopts the stored preference.
  const [priceMode, setPriceMode] = useState(false);

  // On mount: read the shelf and offer a per-draft Resume/Discard, and adopt this
  // location's stored price-mode preference. Both are the same locationId-scoped
  // localStorage read, so they share one effect rather than racing as two.
  useEffect(() => {
    const drafts = readDrafts(locationId);
    if (drafts.length > 0) setPendingDrafts(drafts);
    setPriceMode(readPriceMode(locationId));
  }, [locationId]);

  // Commit-phase mirror of `lines` for the scan handlers (see the ref's own note), and of
  // the vendor, which is the other half of every scan request's binding.
  useEffect(() => {
    linesRef.current = lines;
    vendorIdRef.current = vendorId;
  }, [lines, vendorId]);

  // The scan answer is a TOAST, not a state: it describes something that already happened
  // to the count, so it retires itself rather than waiting to be dismissed. Keyed on the
  // string so a second identical answer (two unknown codes taught in a row) re-arms.
  useEffect(() => {
    if (scanNotice === null) return;
    const timer = setTimeout(() => setScanNotice(null), 5_000);
    return () => clearTimeout(timer);
  }, [scanNotice]);

  // Debounced draft save. Fires 500 ms after the last state change.
  // Skipped when the form is pristine (no vendor + no edited lines).
  useEffect(() => {
    // Skip the very first render (initial mount with default state).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // While the resume banner is up, the stored drafts are NOT ours to overwrite: the
    // operator hasn't said which one (if any) this session continues. Answering the
    // banner — resume or discard — re-enables persistence.
    if (pendingDrafts.length > 0) return;
    // Pristine guard: no vendor and the single line is blank.
    const isPristine =
      vendorId === "" &&
      lines.length === 1 &&
      lines[0] !== undefined &&
      lines[0].skuId === "" &&
      lines[0].qty === "";
    if (isPristine) return;

    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const now = new Date().toISOString();
      // First save of this intake stamps its startedAt; every later save reuses it, so
      // the shelf slot stays the same one instead of multiplying every 500 ms.
      const startedAt = startedAtRef.current ?? now;
      startedAtRef.current = startedAt;
      writeDraft(locationId, {
        vendorId,
        startedAt,
        date,
        invoiceNumber,
        invoiceTotal,
        notes,
        photoLater,
        receiptPhotoId,
        lines,
        savedAt: now,
      });
      setSavedAt(now);
    }, 500);

    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [vendorId, date, invoiceNumber, invoiceTotal, notes, photoLater, receiptPhotoId, lines, locationId, pendingDrafts]);

  const skuById = new Map<string, ReceivingSkuOption>(formData.skus.map((s) => [s.id, s]));
  // Picker + fallback are ALWAYS scoped to the selected vendor's OWN SKUs (never the
  // cross-vendor catalog, never null-vendor SKUs), usage-ranked then name (Juan's
  // door refinement). Empty until a vendor is picked.
  const vendorSkus = vendorId
    ? formData.skus.filter((s) => s.vendorId === vendorId).sort(byUsageThenName)
    : [];
  const levelsFor = (skuId: string): string[] => (skuId ? (skuById.get(skuId)?.chainLabels ?? []) : []);

  const setLine = (i: number, patch: Partial<IntakeLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const num = (s: string): number | null => {
    const v = s.trim();
    return v === "" ? null : Number(v);
  };

  // A line is "ready" for submission if it names a SKU and has a positive qty.
  const readyLines = lines.filter((l) => l.skuId !== "" && l.qty.trim() !== "" && Number(l.qty) > 0);

  // A line the operator TYPED INTO but never attached to an item (the blank "New item" card
  // with a qty, a price or a note) used to fall out of readyLines and vanish on submit with
  // no warning (guide-walk sim, 2026-09-08: qty 12 · $3.25 · a note — gone). Block the
  // submit and say so; an untouched blank card still costs nothing.
  const orphanLines = lines.filter(
    (l) => l.skuId === "" && (l.qty.trim() !== "" || l.note.trim() !== "" || l.unitPrice.trim() !== ""),
  );

  const canSubmit =
    vendorId !== "" && date !== "" && readyLines.length > 0 && orphanLines.length === 0 && (receiptPhotoId !== null || photoLater) && !busy;

  // How many lines carry a price the server will accept. Rendered beside the toggle in
  // BOTH states — it is what keeps an entered price from ever being invisible while the
  // strip is hidden (and, once the mode is on, the running tally of the invoice pass).
  // Deliberately NOT part of canSubmit: a price is optional at the door, and an intake
  // that files no price is a complete, correct delivery.
  const pricedCount = pricedLineCount(lines);

  /** Flip price mode and remember it for this location. The write rides the tap (not a
   *  render effect) so nothing persists unless the operator actually chose it. */
  const togglePriceMode = () => {
    const next = !priceMode;
    setPriceMode(next);
    writePriceMode(locationId, next);
  };

  // ── V3-B · scan → the same patch the stepper writes ────────────────────────

  /** The scan surface only ever needs the SKUs on screen, deduped and capped as the route caps them. */
  const lineSkuIds = [...new Set(lines.map((l) => l.skuId).filter((id) => id !== ""))].slice(0, 200);
  // Keyed by the ROW, never by its index: a removed or reordered line between the sheet
  // opening and the receiver tapping would otherwise step a different item (finding 4).
  const scanLines = lines.flatMap((l) => (l.skuId === "" ? [] : [{ key: l.key, skuName: l.skuName }]));
  const skuNameFor = (skuId: string) => skuById.get(skuId)?.name ?? t("receiving.door.unknown_sku");

  /**
   * ONE SCAN = ONE UNIT on the matched line. A SKU that is not on the delivery yet joins it
   * through the SAME `offeredLine` row the no-template fallback builds, so a scanned
   * addition is indistinguishable from an offered one — and, like every offered row, it
   * files nothing if the count never lands on it.
   */
  const applyScan = (skuId: string, level: Level, code: string | null, lineKey: string | null = null) => {
    const sku = skuById.get(skuId);
    if (!sku) return; // a SKU this location does not carry — nothing to step
    const label = levelLabelFor(sku.chainLabels, level);
    // ONE row object, used by both passes below, so the key the scan remembers is the key
    // the list actually gets — the updater is what writes state (never a stale `lines`
    // closure, which a teach round-trip would otherwise hand us), and the preview is only
    // read for that key.
    const fresh = offeredLine(sku);
    let preview = applyScanToLines(linesRef.current, { skuId }, label, fresh, lineKey);
    // THE PICKED ROW IS ALREADY COUNTED AT ANOTHER LEVEL. Nothing is relabelled and nothing
    // is asked twice: the scanned level gets its own row, exactly as an automatic match of a
    // SKU present only at another level does (Astra finding 2). The DECISION is taken once,
    // here, and both passes then use it — the functional updater must make the same choice
    // the preview did, or the key the code is remembered against is not the key the list got.
    const effectiveKey = preview.conflict === "level" ? null : lineKey;
    if (preview.conflict === "level") preview = applyScanToLines(linesRef.current, { skuId }, label, fresh, null);
    if (preview.index < 0) return;
    setLines((ls) => {
      const next = applyScanToLines(ls, { skuId }, label, fresh, effectiveKey);
      return next.index < 0 ? ls : next.lines;
    });
    const key = preview.lines[preview.index]?.key;
    if (key !== undefined && code !== null) {
      setScannedCodes((m) => ({ ...m, [key]: { code, level } }));
    }
  };

  /**
   * Is the answer that just arrived still about the intake that asked the question?
   * (Astra finding 4.) Captured before every scan request, re-checked after it: a teach or a
   * forget that resolves once the receiver has switched vendors, reset the form, restored a
   * draft or filed the delivery describes an intake that is over, and writes nothing.
   */
  const stillThisIntake = (token: number, boundVendor: string) =>
    intakeTokenRef.current === token && vendorIdRef.current === boundVendor;

  /** A scan request must not outlive the truck — the same 4 s the lookup gets (spec §7). */
  const scanFetch = async (url: string, body: unknown): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Teach the code, THEN step the line — and step it either way. Teaching needs the
   * network; counting does not, and a receiver whose Wi-Fi dropped at the door still has a
   * truck to count (spec §7). The only branch that does NOT step is the 409: that one is
   * still a question, and the answer re-enters here with the confirm.
   */
  const teachThenStep = async (
    code: string,
    skuId: string,
    level: Level,
    confirmLevelChange: boolean,
    lineKey: string | null = null,
  ) => {
    const token = intakeTokenRef.current;
    const boundVendor = vendorId;
    let outcome: "created" | "known" | "failed" = "failed";
    try {
      const res = await scanFetch("/api/operations/receiving/scan/teach", {
        vendorId,
        locationId,
        code,
        skuId,
        level,
        invoiceNumber: invoiceNumber || null,
        ...(confirmLevelChange ? { confirmLevelChange: true } : {}),
      });
      if (!stillThisIntake(token, boundVendor)) return;
      if (res.status === 409 && !confirmLevelChange) {
        const j = (await res.json().catch(() => ({}))) as { code?: string; storedLevel?: Level };
        if (j.code === "level_differs") {
          setLevelPending({ code, skuId, level, storedLevel: j.storedLevel === "inner" ? "inner" : "case" });
          return;
        }
      }
      if (res.status === 201) outcome = "created";
      else if (res.ok) outcome = "known";
    } catch {
      // A refused, dropped or TIMED-OUT teach (the 4 s abort above) is not a refusal to
      // count: the case is on the truck either way, so the line still steps and the notice
      // says only that the code was not remembered.
      outcome = "failed";
    }
    if (!stillThisIntake(token, boundVendor)) return;
    applyScan(skuId, level, code, lineKey);
    setScanNotice(
      outcome === "created"
        ? t("receiving.scan.taught")
        : outcome === "failed"
          ? t("receiving.scan.not_remembered")
          : null,
    );
  };

  const onScanMatch = (m: ScanMatch & { code: string }) => {
    setScanNotice(null);
    if (m.kind === "unknown") return;
    // A twin is an OFFER, never an assumption: the code was taught on another vendor's
    // version of the same product, and only the receiver can say the box in their hands is
    // this vendor's. Accepting teaches it here too, so the question is asked once.
    if (m.kind === "twin") {
      setTwinPending({ skuId: m.skuId, level: m.level, code: m.code });
      return;
    }
    applyScan(m.skuId, m.level, m.code);
  };

  const onScanUnknownPick = (code: string, lineKey: string | null, level: Level) => {
    setScanNotice(null);
    const line = lineKey === null ? undefined : linesRef.current.find((l) => l.key === lineKey);
    if (!line || line.skuId === "") return;
    void teachThenStep(code, line.skuId, level, false, line.key);
  };

  /** "Not on this delivery" hands the code to the Add-item picker; the next pick teaches it. */
  const onScanNotOnDelivery = (code: string, level: Level) => {
    setScanNotice(null);
    setPendingTeach({ code, level });
  };

  const forgetScannedCode = async (key: string) => {
    const remembered = scannedCodes[key];
    const line = linesRef.current.find((l) => l.key === key);
    if (!remembered || !line || line.skuId === "") return;
    const token = intakeTokenRef.current;
    const boundVendor = vendorId;
    try {
      const res = await scanFetch("/api/operations/receiving/scan/forget", {
        vendorId,
        locationId,
        code: remembered.code,
        skuId: line.skuId,
        level: remembered.level,
      });
      if (!res.ok) return; // the code is still taught — leave the button where it is
    } catch {
      return; // refused, dropped or timed out: same answer, the button stays
    }
    // The delivery this code was scanned onto is over — its row and its button are gone.
    if (!stillThisIntake(token, boundVendor)) return;
    setScannedCodes((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    setScanNotice(t("receiving.scan.forgotten"));
  };

  /** Clear every scan-session artefact. Shared by resetForm and the vendor switch — a code
   *  taught against one vendor's truck must never be offered for forgetting on the next. */
  const clearScanState = () => {
    setScannedCodes({});
    setTwinPending(null);
    setLevelPending(null);
    setPendingTeach(null);
    setScanNotice(null);
    // A new intake generation: every request still in flight against the old one is now
    // answering a question nobody is asking (Astra finding 4).
    bumpIntakeToken();
  };

  // ── Missing-item honesty gate ──────────────────────────────────────────────
  // UNCONFIRMED EXPECTED ROWS. Only PRE-FILLED rows can be missed (expectedQty != null —
  // they came from the PO or the last-delivery template; offered/added rows carry no
  // expectation). A row counts as unconfirmed when the operator never tapped ✓
  // (`confirmed` false), raised no flag, AND entered no count that departs from the
  // expectation. That covers both silent shapes:
  //   • qty EMPTY (the seeded state — the template deliberately seeds no count) or zeroed
  //     → readyLines drops it, so NOTHING is recorded for an item the vendor was expected
  //     to bring. Silent unless this notice names it.
  //   • qty sitting exactly ON the expectation without a ✓ → indistinguishable from an
  //     untouched row, so it is surfaced rather than assumed.
  // A row whose qty was EDITED to a different number is a deliberate count (the flag
  // auto-suggest already nudges it), and a flagged row is an acknowledged exception —
  // neither is silent, so neither is listed.
  const unconfirmedExpected = lines.filter((l) => {
    if (l.skuId === "" || l.expectedQty == null || l.confirmed || l.discrepancy !== null) return false;
    const q = l.qty.trim();
    if (q === "" || Number(q) === 0) return true; // emptied/zeroed → would be dropped
    return Number(q) === l.expectedQty; // untouched at the seeded value → would be fabricated
  });
  // Credits may ONLY be filed against a real order (the server enforces this too —
  // 400 missing_requires_po). Off a last-delivery prefill the notice still fires, but it
  // is a hint, not a claim: "they usually bring this" is not a debt the vendor owes.
  const canFileShorts = linkedPoId !== null;
  const shortCount = unconfirmedExpected.filter((l) => notArrived[l.key] === true).length;
  // The notice only stands between the operator and COMPLETE. "Save partial" means the
  // truck is still unloading, so an unconfirmed expected item is expected — no interrupt.
  const showMissingNotice = unconfirmedExpected.length > 0 && armComplete;

  /** "Received" — the operator confirms this row arrived as expected. Reuses the exact
   *  collapsed-✓ semantics (qty = expected, confirmed, no flag), so the row leaves the
   *  unconfirmed set on the next render and the notice shrinks live. */
  const markArrived = (i: number, key: string, expected: number) => {
    setNotArrived((m) => {
      if (m[key] !== true) return m;
      const next = { ...m };
      delete next[key];
      return next;
    });
    setLine(i, { qty: String(expected), confirmed: true, discrepancy: null });
  };

  /** "Didn't arrive" — nothing came off the truck for this row. The quantity is cleared
   *  (so no fabricated count is filed) and, on a PO-linked intake, the row is marked for
   *  a line-less short credit in the submit payload. */
  const markNotArrived = (i: number, key: string) => {
    setNotArrived((m) => ({ ...m, [key]: true }));
    setLine(i, { qty: "", confirmed: false, discrepancy: null });
  };

  const resetForm = () => {
    setVendorId("");
    setDate(today);
    setInvoiceNumber("");
    setInvoiceTotal("");
    setNotes("");
    setReceiptPhotoId(null);
    setPhotoLater(false);
    setLines([addedLine()]);
    setErr(null);
    setDupId(null);
    // Clear any pending banner too, and end this draft's identity — the next intake
    // is a new session and gets its own shelf slot.
    setPendingDrafts([]);
    setSavedAt(null);
    startedAtRef.current = null;
    setLinkedPoId(null);
    setLinkedPoCode(null);
    setOpenCredits([]);
    setCheckedCreditIds(new Set());
    setArmComplete(false);
    setNotArrived({});
    clearScanState();
    // NOTE: closedCount / closureError are the success-state notice — NOT cleared here.
    // resetForm runs on a successful submit; the notice must survive to be shown.
  };

  /** Continue one shelved intake. The banner closes ENTIRELY — the operator has said
   *  which intake this session is, so persistence must resume (a still-open banner would
   *  keep the writer suppressed and lose everything typed from here on). The other
   *  drafts stay on the shelf and are offered again next mount. Adopting `startedAt`
   *  keeps the resumed draft in its own slot rather than opening a second one. */
  const resumeDraft = (draft: IntakeDraft) => {
    setVendorId(draft.vendorId);
    setDate(draft.date);
    setInvoiceNumber(draft.invoiceNumber);
    setInvoiceTotal(draft.invoiceTotal);
    setNotes(draft.notes);
    setPhotoLater(draft.photoLater);
    setReceiptPhotoId(draft.receiptPhotoId);
    setLines(draft.lines.length > 0 ? draft.lines : [addedLine()]);
    startedAtRef.current = draft.startedAt;
    // A restored draft is a NEW intake generation: the codes the previous session scanned
    // belong to rows that are gone, and any request still in flight is stale (finding 4).
    clearScanState();
    setPendingDrafts([]);
    setSavedAt(draft.savedAt);
    // A draft that already carries prices opens WITH the strip visible — resuming must
    // never hand back an intake whose typed prices are behind a switch. One-way on
    // purpose: a price-less draft leaves the stored preference alone.
    if (pricedLineCount(draft.lines) > 0) setPriceMode(true);
  };

  /** Throw ONE draft away — the others on the shelf are untouched. */
  const discardDraft = (draft: IntakeDraft) => {
    removeDraft(locationId, draft.vendorId, draft.startedAt);
    setPendingDrafts((ds) => removeIntakeDraft(ds, draft.vendorId, draft.startedAt));
  };

  // The selected vendor's OWN usage-ranked SKUs having real depletion (usageRank set),
  // most-consumed first. Computed from an explicit vendorId (state hasn't flushed yet
  // inside onVendorChange). Drives the no-template offered-row fallback.
  const usageRankedFor = (vId: string): ReceivingSkuOption[] =>
    formData.skus
      .filter((s) => s.vendorId === vId && s.usageRank != null)
      .sort(byUsageThenName);

  // On vendor select: reset the line list, then fetch the prefill template.
  //   template present  → seed collapsed EXPECTED rows (the last-delivery happy path).
  //   no template       → POPULATE offered rows from the vendor's usage-ranked SKUs
  //                       (Juan's refinement); if the vendor has none (e.g. packaging
  //                       vendors), keep today's single blank added line.
  const onVendorChange = async (nextVendorId: string) => {
    setVendorId(nextVendorId);
    setErr(null);
    setDupId(null);
    setLines([addedLine()]);
    // Clear any prior PO linkage when the vendor changes.
    setLinkedPoId(null);
    setLinkedPoCode(null);
    // Clear any prior credit prefill + the last-submit closure notice.
    setOpenCredits([]);
    setCheckedCreditIds(new Set());
    setClosedCount(0);
    setClosureError(false);
    // A new vendor means a new expected list — never carry a stale arm or disposition.
    setArmComplete(false);
    setNotArrived({});
    clearScanState();
    if (!nextVendorId) return;
    setPrefilling(true);
    // Fallback we drop to whenever there's no usable template: the vendor's usage-ranked
    // SKUs as empty offered rows, else the single blank added line.
    const fallbackLines = (): LineDraft[] => {
      const ranked = usageRankedFor(nextVendorId);
      return ranked.length > 0 ? ranked.map(offeredLine) : [addedLine()];
    };
    try {
      const res = await fetch(
        `/api/operations/receiving/template?locationId=${encodeURIComponent(locationId)}&vendorId=${encodeURIComponent(nextVendorId)}`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) { setLines(fallbackLines()); return; } // no template / error → offered fallback
      const body = (await res.json()) as TemplateResponse;
      // V2-D4: capture the vendor's open credits regardless of the template branch —
      // "Makes up a short?" shows even when there's no prefill template.
      setOpenCredits(Array.isArray(body.openCredits) ? body.openCredits : []);
      const tpl = body?.template;
      if (!tpl || tpl.lines.length === 0) { setLines(fallbackLines()); return; }

      // When the template came from a placed PO, capture the PO context so the
      // form can show the banner and include purchaseOrderId in the submit payload.
      if (body.source === "po" && body.poId) {
        setLinkedPoId(body.poId);
        setLinkedPoCode(body.displayCode ?? null);
      }

      // Seed the EXPECTATION, never the COUNT. qty starts EMPTY so an untouched row
      // holds no number the operator did not put there: it falls out of readyLines and
      // files as uncounted rather than as fully received (the door's worst silent
      // failure). expectedQty is what makes the row collapsed-with-a-✓, what the ✓
      // writes into qty, and what the honesty gate measures against — so the tap-✓
      // happy path is byte-for-byte the same as before.
      const seeded: LineDraft[] = tpl.lines.map((tl) => ({
        key: nextKey(),
        skuId: tl.skuId,
        skuName: skuById.get(tl.skuId)?.name ?? t("receiving.door.unknown_sku"),
        level: tl.level ?? "",
        qty: "",
        expectedQty: tl.qty,
        discrepancy: null,
        note: "",
        photoId: null,
        confirmed: false,
        expanded: false,
        unitPrice: "",
        observed: "",
        offered: false,
      }));
      setLines(seeded);
    } catch {
      // Network hiccup → offered fallback (empty rows, still faster than scrolling).
      setLines(fallbackLines());
    } finally {
      setPrefilling(false);
    }
  };

  const submit = async (deliveryStatus: "complete" | "in_progress") => {
    if (!canSubmit) return;
    setErr(null);
    setDupId(null);
    setBusy(true);
    // The note is the operator's words and nothing else. "Photo later" used to append a
    // "[PHOTO PENDING]" tag here — an untranslated machine string wedged into free text,
    // duplicating state the data already carries: receipt_url IS NULL drives the
    // "Photo missing" badge on both the receiving list and the delivery detail.
    const headerNote = notes.trim();
    const payload = {
      vendorId,
      locationId,
      deliveryDate: date,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceTotal: num(invoiceTotal),
      notes: headerNote || null,
      deliveryStatus,
      // FORK 1: store the canonical /api/photos/{id} URL in receipt_url (TEXT).
      receiptUrl: receiptPhotoId ? `/api/photos/${receiptPhotoId}` : null,
      // VO-6: carry the linked PO id so recordDelivery can validate + link it.
      purchaseOrderId: linkedPoId ?? null,
      // V2-D4: the open credits this truck makes up (checked in "Makes up a short?").
      // Filtered to ids still present in openCredits so a stale check can't leak.
      makeUpCreditIds: openCredits.filter((c) => checkedCreditIds.has(c.id)).map((c) => c.id),
      // Ordered items the operator said never came off the truck. ONLY on a complete,
      // PO-linked intake: a partial delivery hasn't finished arriving, and without a PO
      // there is no order to be short against (the server re-checks both).
      missingLines:
        deliveryStatus === "complete" && canFileShorts
          ? unconfirmedExpected.flatMap((l) =>
              notArrived[l.key] === true && l.expectedQty != null && l.expectedQty > 0
                ? [{ skuId: l.skuId, expectedQty: l.expectedQty, unitPrice: num(l.unitPrice) }]
                : [],
            )
          : [],
      lines: readyLines.map((l) => ({
        skuId: l.skuId,
        qtyReceived: Number(l.qty),
        receivedLevelLabel: l.level.trim() || null,
        notes: l.note.trim() || null,
        photoUrl: l.photoId ? `/api/photos/${l.photoId}` : null,
        expectedQty: l.expectedQty,
        discrepancyType: l.discrepancy,
        unitPrice: num(l.unitPrice),
        observedOzPerEach: num(l.observed),
      })),
    };
    const res = await fetch("/api/operations/receiving", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // V2-D4: read the closure result BEFORE resetForm so we can show the
      // "N short(s) closed" / advisory notice. resetForm intentionally preserves
      // closedCount/closureError; router.refresh() does NOT reset client useState.
      const ok = (await res.json().catch(() => ({}))) as {
        resolvedCredits?: string[];
        creditClosureError?: boolean;
      };
      setBusy(false);
      // Remove THIS draft BEFORE router.refresh() so it can't be resumed after a
      // successful submit (D1 Task 6 law: clear on success) — and only this one, by
      // its (vendor, startedAt) identity. A second truck's half-counted draft is not
      // this delivery's to delete. Runs before resetForm, which clears both halves.
      if (startedAtRef.current !== null) removeDraft(locationId, vendorId, startedAtRef.current);
      resetForm();
      setClosedCount(Array.isArray(ok.resolvedCredits) ? ok.resolvedCredits.length : 0);
      setClosureError(ok.creditClosureError === true);
      router.refresh();
      return;
    }
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string; error?: string };
    if (res.status === 409 && j?.code === "duplicate_delivery") {
      // The message carries "(delivery <id>)" — parse it for a deep link.
      const text = j.message ?? j.error ?? "";
      const m = /\(delivery ([^)]+)\)/.exec(text);
      if (m && m[1]) setDupId(m[1].trim());
      setErr(text || t("receiving.error.duplicate_delivery"));
      return;
    }
    // VO-6: PO linkage errors — clear the PO context so the form can resubmit
    // without an invalid PO id (operator can re-pick the vendor to refresh).
    if (res.status === 409 && (j?.code === "po_mismatch" || j?.code === "po_not_placed" || j?.code === "po_already_received")) {
      setLinkedPoId(null);
      setLinkedPoCode(null);
      setErr(t(("receiving.error." + j.code) as never));
      return;
    }
    setErr(t(("receiving.error." + (j?.code ?? "generic")) as never));
  };

  /**
   * The COMPLETE path, gated by the honesty interrupt. First tap with untouched expected
   * rows arms the notice and returns; the operator dispositions each item (or not) and
   * taps again to file. The notice is never a hard block — it is the hint the door was
   * missing. The set is recomputed every render, so counting a listed item makes it drop
   * off (and, once the list empties, the notice closes and the button reverts on its own).
   */
  const completeWithGate = () => {
    if (!canSubmit) return;
    if (unconfirmedExpected.length > 0 && !armComplete) {
      setArmComplete(true);
      return;
    }
    void submit("complete");
  };

  return (
    <div className="pb-24">
      {/* ── Draft resume banner (D1 Task 6) ──────────────────────────────
          One row per shelved draft: WHICH vendor and when, then Resume/Discard for
          that draft alone. A time alone can't tell two same-hour trucks apart, so the
          vendor name leads whenever it resolves (a draft saved before the vendor was
          picked falls back to the time-only string). One draft renders as the single
          row this has always been — same container, same buttons. */}
      {pendingDrafts.length > 0 ? (
        <div
          role="status"
          className="mb-3 flex flex-col gap-2 rounded-xl border-2 border-co-gold-deep bg-co-warning-surface px-4 py-3"
        >
          {pendingDrafts.map((d) => {
            const vendor = formData.vendors.find((v) => v.id === d.vendorId)?.name ?? null;
            const time = formatTime(d.savedAt, language);
            return (
              <div key={`${d.vendorId}:${d.startedAt}`} className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-co-text">
                  {vendor
                    ? t("receiving.door.draft_resume_banner_vendor", { time, vendor })
                    : t("receiving.door.draft_resume_banner", { time })}
                </span>
                <div className="flex shrink-0 gap-2">
                  <ActionButton
                    variant="secondary"
                    onClick={() => discardDraft(d)}
                    aria-label={
                      vendor
                        ? t("receiving.door.draft_discard_aria_vendor", { time, vendor })
                        : t("receiving.door.draft_discard_aria", { time })
                    }
                  >
                    {t("receiving.door.draft_discard")}
                  </ActionButton>
                  <ActionButton
                    onClick={() => resumeDraft(d)}
                    aria-label={
                      vendor
                        ? t("receiving.door.draft_resume_aria_vendor", { time, vendor })
                        : t("receiving.door.draft_resume_aria", { time })
                    }
                  >
                    {t("receiving.door.draft_resume")}
                  </ActionButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── STEP 1 · Count the delivery ─────────────────────────────────── */}
      <section className="rounded-2xl border-2 border-co-border bg-co-surface p-4">
        <div className={stepHeadClass}>
          <span className={stepNumClass}>1</span>
          <span>{t("receiving.door.step1")}</span>
          {/* Saved indicator — shows after first draft write this session. */}
          {savedAt ? (
            <span className="ml-auto rounded-full border border-co-border bg-co-surface-2 px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal text-co-text-dim">
              {t("receiving.door.draft_saved", { time: formatTime(savedAt, language) })}
            </span>
          ) : null}
        </div>

        {/* VO-6: PO context banner — shown when template source is "po". */}
        {linkedPoCode ? (
          <div
            role="status"
            className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-warning-surface px-3 py-2 text-sm font-bold text-co-text"
          >
            {t("receiving.door.receiving_against_po", { code: linkedPoCode })}
          </div>
        ) : null}

        <label className="mt-3 block">
          <span className="text-sm font-bold text-co-text">{t("receiving.form.vendor")}</span>
          <select
            className={`mt-1 ${field}`}
            value={vendorId}
            disabled={busy}
            onChange={(e) => void onVendorChange(e.target.value)}
            aria-label={t("receiving.form.vendor")}
          >
            <option value="">{t("receiving.form.pick_vendor")}</option>
            {formData.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("receiving.form.date")}</span>
            <input
              className={`mt-1 ${field}`}
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("receiving.form.date")}
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_number")}</span>
            <input
              className={`mt-1 ${field}`}
              value={invoiceNumber}
              disabled={busy}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder={t("receiving.door.invoice_hint")}
              aria-label={t("receiving.form.invoice_number")}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-sm font-bold text-co-text">{t("receiving.form.invoice_total")}</span>
          <input
            className={`mt-1 ${field}`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={invoiceTotal}
            disabled={busy}
            onChange={(e) => setInvoiceTotal(e.target.value)}
            aria-label={t("receiving.form.invoice_total")}
          />
        </label>

        {/* The exception list. Collapsed expected rows → tap ✓ to confirm. */}
        <div className="mt-4">
          {vendorId === "" ? (
            <p className="rounded-lg border-2 border-dashed border-co-border-2 px-3 py-4 text-center text-[13px] text-co-text-dim">
              {t("receiving.door.pick_vendor_prompt")}
            </p>
          ) : prefilling ? (
            <p className="rounded-lg border-2 border-co-border-2 px-3 py-4 text-center text-[13px] text-co-text-dim">
              {t("receiving.door.prefilling")}
            </p>
          ) : (
            <>
              {/* ── V3-B · SCAN AT THE DOOR ────────────────────────────────────
                  Above the list because a scan acts ON the list, and because the wedge
                  listener has to be mounted before the first trigger — the receiver with a
                  gun never taps anything. `disabled` while submitting: past the submit the
                  lines are gone, and a stray beep must not step a row that is being filed. */}
              <ScanField
                vendorId={vendorId}
                locationId={locationId}
                lineSkuIds={lineSkuIds}
                intakeToken={intakeToken}
                invoiceNumber={invoiceNumber.trim() || null}
                disabled={busy}
                lines={scanLines}
                skuNameFor={skuNameFor}
                onMatch={onScanMatch}
                onUnknownPick={onScanUnknownPick}
                onNotOnDelivery={onScanNotOnDelivery}
              />

              {/* The scan's one-line answer: taught, not remembered, forgotten. Advisory
                  tone (role="status"), never an error — every one of them describes
                  something that already happened to the count. */}
              {scanNotice ? (
                <p
                  role="status"
                  className="mb-2.5 rounded-lg border-2 border-co-border-2 bg-co-surface-2 px-3 py-2 text-[12px] font-semibold text-co-text"
                >
                  {scanNotice}
                </p>
              ) : null}

              {/* TWIN OFFER — the code was taught on another vendor's version of this
                  product. The sentence IS the button: one tap accepts and teaches it here
                  too, so the question is asked once per code and never again. */}
              {twinPending ? (
                <div
                  role="status"
                  className="mb-2.5 rounded-lg border-2 border-co-gold-deep bg-co-warning-surface px-3 py-3"
                >
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const twin = twinPending;
                        setTwinPending(null);
                        void teachThenStep(twin.code, twin.skuId, twin.level, false);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-text bg-co-surface px-4 text-sm font-bold text-co-text"
                    >
                      {t("receiving.scan.twin_confirm", {
                        sku: skuById.get(twinPending.skuId)?.name ?? t("receiving.door.unknown_sku"),
                      })}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setTwinPending(null)}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text-dim hover:border-co-text"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* LEVEL CONFIRM — the same UPC really is printed on the case and on the
                  inner pack, so this ADDS the second level; nothing is ever rewritten. */}
              {levelPending ? (
                <div
                  role="status"
                  className="mb-2.5 rounded-lg border-2 border-co-gold-deep bg-co-warning-surface px-3 py-3"
                >
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const pending = levelPending;
                        setLevelPending(null);
                        void teachThenStep(pending.code, pending.skuId, pending.level, true);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-text bg-co-surface px-4 text-sm font-bold text-co-text"
                    >
                      {t("receiving.scan.level_confirm", {
                        stored: t(
                          levelPending.storedLevel === "case"
                            ? "receiving.scan.level_case"
                            : "receiving.scan.level_inner",
                        ),
                        level: t(
                          levelPending.level === "case"
                            ? "receiving.scan.level_case"
                            : "receiving.scan.level_inner",
                        ),
                      })}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const pending = levelPending;
                        setLevelPending(null);
                        // Declining teaches nothing — but the case still came off the truck,
                        // so the count lands anyway.
                        applyScan(pending.skuId, pending.level, null);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text-dim hover:border-co-text"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* PRICE MODE — one switch for the whole list, sitting where the operator
                  already is when the invoice comes out of the box. Same chip spelling as
                  the flag chips inside each row (44px floor + items-center, rounded-full,
                  aria-pressed); active reads as a pressed control (co-surface-2 + ink
                  edge) rather than a status colour, because this is a mode, not an
                  alert. */}
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={togglePriceMode}
                  aria-pressed={priceMode}
                  className={
                    "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition " +
                    (priceMode
                      ? "border-co-text bg-co-surface-2 text-co-text"
                      : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                  }
                >
                  {t("receiving.door.prices_toggle")}
                </button>
                {pricedCount > 0 ? (
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-confirm-text">
                    {t("receiving.door.prices_counted", { n: pricedCount })}
                  </span>
                ) : null}
              </div>
              {priceMode ? (
                <p className="mb-2.5 text-[12px] text-co-text-dim">{t("receiving.door.prices_help")}</p>
              ) : null}

              <div className="flex flex-col gap-2.5">
                {lines.map((l, i) => (
                  <IntakeLineRow
                    key={l.key}
                    line={l}
                    levels={levelsFor(l.skuId)}
                    busy={busy}
                    locationId={locationId}
                    showPrice={priceMode}
                    onChange={(patch) => setLine(i, patch)}
                    onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((_, j) => j !== i)) : null}
                    onForgetCode={
                      scannedCodes[l.key] !== undefined ? () => void forgetScannedCode(l.key) : null
                    }
                  />
                ))}
              </div>
            </>
          )}

          {/* Overages / substitutions: the "Add item" affordance opens a fresh
              expanded line whose SKU is chosen from the vendor's SKU picker. */}
          {vendorId !== "" && !prefilling ? (
            <div className="mt-3">
              {/* A scan of something that is not on this delivery lands HERE — the picker
                  the door already has, with the code waiting for whatever the receiver
                  chooses. No second search box, no new screen. */}
              {pendingTeach ? (
                <p role="status" className="mb-2 text-[12px] font-semibold text-co-gold-text">
                  {t("receiving.scan.unknown_title")}
                </p>
              ) : null}
              <AddItemPicker
                options={vendorSkus}
                busy={busy}
                pickLabel={t("receiving.form.pick_sku")}
                addLabel={t("receiving.form.add_line")}
                onAdd={(sku) => {
                  const pending = pendingTeach;
                  if (pending !== null) {
                    setPendingTeach(null);
                    void teachThenStep(pending.code, sku.id, pending.level, false);
                    return;
                  }
                  setLines((ls) => [
                    ...ls,
                    { ...addedLine(), skuId: sku.id, skuName: sku.name, level: "" },
                  ]);
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* ── STEP 2 · Receipt photo ──────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border-2 border-co-border bg-co-surface p-4">
        <div className={stepHeadClass}>
          <span className={stepNumClass}>2</span>
          <span>{t("receiving.door.step2")}</span>
        </div>
        <p className="mt-2 text-[12px] text-co-text-dim">{t("receiving.door.receipt_help")}</p>
        <div className="mt-3 rounded-lg border-2 border-co-border-2 bg-co-surface-2 p-4">
          <PhotoCapture
            locationId={locationId}
            label={t("receiving.door.receipt_capture_big")}
            initialPhotoId={receiptPhotoId}
            onUploaded={(pid) => {
              setReceiptPhotoId(pid);
              setPhotoLater(false);
            }}
          />
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-[13px] text-co-text">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={photoLater}
            disabled={busy || receiptPhotoId !== null}
            onChange={(e) => setPhotoLater(e.target.checked)}
            aria-label={t("receiving.door.photo_later")}
          />
          {t("receiving.door.photo_later")}
        </label>
      </section>

      {/* Notes travel with the delivery header (step 2/3 boundary). */}
      <section className="mt-4 rounded-2xl border-2 border-co-border bg-co-surface p-4">
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("receiving.form.notes")}</span>
          <textarea
            className={`mt-1 ${field} min-h-[72px] py-2`}
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("receiving.form.notes_hint")}
            aria-label={t("receiving.form.notes")}
          />
        </label>
      </section>

      {/* ── V2-D4 · "Makes up a short?" (default-collapsed, D-doctrine) ─────
          Shown only when the selected vendor has open credits. Each row is a
          checkbox: item · qty · reason · age · origin PO/delivery code. Checked
          ids ride the submit payload as makeUpCreditIds → resolved_redelivered. */}
      {vendorId !== "" && !prefilling && openCredits.length > 0 ? (
        <div className="mt-4">
          <CollapsibleSection
            idBase="receiving-make-up-short"
            title={t("receiving.makeup.title")}
            count={t("receiving.makeup.count", { n: openCredits.length })}
          >
            <p className="mb-2 text-[12px] text-co-text-dim">{t("receiving.makeup.help")}</p>
            <ul className="flex flex-col gap-1.5">
              {openCredits.map((c) => {
                const checked = checkedCreditIds.has(c.id);
                const itemLabel = c.skuName ?? t("receiving.makeup.unknown_item");
                const reasonLabel = t(("receiving.makeup.reason." + c.reason) as never);
                const origin = c.originPoCode
                  ? t("receiving.makeup.origin_po", { code: c.originPoCode })
                  : c.originDeliveryId
                    ? t("receiving.makeup.origin_delivery")
                    : null;
                return (
                  <li key={c.id}>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setCheckedCreditIds((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          });
                        }}
                        aria-label={t("receiving.makeup.check_aria", { item: itemLabel })}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-co-text">{itemLabel}</span>
                        <span className="block text-[11px] text-co-text-dim">
                          {c.qty != null ? `${t("receiving.makeup.qty", { n: c.qty })} · ` : ""}
                          {reasonLabel}
                          {` · ${t("receiving.makeup.age_days", { n: c.ageDays })}`}
                          {origin ? ` · ${origin}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>
        </div>
      ) : null}

      {/* V2-D4 success / advisory notice for the last submit's credit closure. */}
      {closedCount > 0 ? (
        <div
          role="status"
          className="mt-4 rounded-lg border-2 border-co-gold-deep bg-co-warning-surface px-3 py-3 text-sm font-bold text-co-text"
        >
          {t("receiving.makeup.closed_notice", { n: closedCount })}
        </div>
      ) : null}
      {closureError ? (
        <div
          role="status"
          className="mt-4 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-3 text-sm text-co-text"
        >
          {t("receiving.makeup.closure_error")}
        </div>
      ) : null}

      {/* ── MISSING-ITEM HONESTY NOTICE ───────────────────────────────────────
          Stands once between the operator and "Delivery confirmed" when pre-filled
          expected rows were never confirmed. Warn tone (same idiom as the closure
          advisory above), role="status" — advisory, not an error. Both dispositions
          render on every source; only the SHORT CLAIM is PO-gated (canFileShorts). */}
      {showMissingNotice ? (
        <div
          role="status"
          className="mt-4 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-3"
        >
          <p className="text-sm font-bold text-co-text">{t("receiving.missing.title")}</p>
          <p className="mt-1 text-[12px] text-co-text-dim">
            {canFileShorts && linkedPoCode
              ? t("receiving.missing.help_po", { n: unconfirmedExpected.length, code: linkedPoCode })
              : t("receiving.missing.help_plain", { n: unconfirmedExpected.length })}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {unconfirmedExpected.map((l) => {
              // The row's own index in `lines` — the patch helpers address lines by index
              // (setLine), and the unconfirmed list is a filtered view of the same array.
              const i = lines.indexOf(l);
              const missed = notArrived[l.key] === true;
              const levelLabel = l.level.trim() || t("receiving.door.level_generic");
              return (
                <li
                  key={l.key}
                  className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2"
                >
                  <span className="block text-sm font-semibold text-co-text">{l.skuName}</span>
                  <span className="block text-[11px] text-co-text-dim">
                    {t("receiving.door.expected_line", { qty: l.expectedQty ?? 0, level: levelLabel })}
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => markArrived(i, l.key, l.expectedQty ?? 0)}
                      aria-label={t("receiving.missing.received_aria", { sku: l.skuName })}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text-dim transition hover:border-co-text"
                    >
                      {t("receiving.missing.received")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => markNotArrived(i, l.key)}
                      aria-pressed={missed}
                      aria-label={t("receiving.missing.not_arrived_aria", { sku: l.skuName })}
                      className={
                        "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition " +
                        (missed
                          ? "border-co-danger bg-co-danger-surface text-co-text"
                          : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                      }
                    >
                      {t("receiving.missing.not_arrived")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* What the next tap will actually do — stated, never implied. */}
          {canFileShorts && shortCount > 0 ? (
            <p className="mt-2 text-[12px] font-semibold text-co-text">
              {t("receiving.missing.summary_claim", { n: shortCount })}
            </p>
          ) : null}
          {/* Only true while a row is still unanswered. A "Didn't arrive" row has been
              dispositioned (and on a PO-linked intake claims a short), so it isn't what
              this line warns about. An unanswered row files as NOT COUNTED — the seed no
              longer supplies a quantity, so there is nothing to file it at. */}
          {unconfirmedExpected.some((l) => notArrived[l.key] !== true) ? (
            <p className="mt-1 text-[12px] text-co-text-dim">
              {t("receiving.missing.summary_unanswered")}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Inline error / duplicate banner (never an alert()). */}
      {err ? (
        <div
          className={
            "mt-4 rounded-lg border-2 px-3 py-3 text-sm " +
            (dupId
              ? "border-co-warning bg-co-warning-surface text-co-text"
              : "border-co-danger bg-co-danger-surface text-co-text")
          }
          role="alert"
        >
          <p>{err}</p>
          {dupId ? (
            <Link
              href={`/operations/receiving/${dupId}`}
              className="mt-1 inline-flex min-h-[44px] items-center font-bold text-co-cta-text underline"
            >
              {t("receiving.door.view_existing")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ── STEP 3 · Submit (sticky at the bottom of the viewport) ───────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-co-border bg-co-bg/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {orphanLines.length > 0 ? (
            <p role="alert" className="rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-xs font-semibold text-co-warning-text">
              {t("receiving.orphan_lines", { n: orphanLines.length })}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <span className={stepNumClass}>3</span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={completeWithGate}
              className={actionButtonClass("primary", "default", "flex-1")}
            >
              {showMissingNotice
                ? t("receiving.door.submit_complete_anyway")
                : t("receiving.door.submit_complete")}
            </button>
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit("in_progress")}
            className={actionButtonClass("secondary")}
          >
            {t("receiving.door.submit_partial")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * AddItemPicker — a self-contained SKU picker for overages/substitutions. Its
 * own useState so choosing a SKU doesn't churn the parent until "Add" fires.
 */
function AddItemPicker({
  options,
  busy,
  pickLabel,
  addLabel,
  onAdd,
}: {
  options: ReceivingSkuOption[];
  busy: boolean;
  pickLabel: string;
  addLabel: string;
  onAdd: (sku: ReceivingSkuOption) => void;
}) {
  const [skuId, setSkuId] = useState("");
  const skuById = new Map(options.map((s) => [s.id, s]));
  const add = () => {
    const sku = skuById.get(skuId);
    if (!sku) return;
    onAdd(sku);
    setSkuId("");
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border-2 p-3 sm:flex-row">
      <select
        className="min-h-[44px] flex-1 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60"
        value={skuId}
        disabled={busy}
        onChange={(e) => setSkuId(e.target.value)}
        aria-label={pickLabel}
      >
        <option value="">{pickLabel}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || skuId === ""}
        onClick={add}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text disabled:opacity-50"
      >
        {addLabel}
      </button>
    </div>
  );
}
