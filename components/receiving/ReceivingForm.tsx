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
 *   - On mount, if a draft exists: renders a resume banner; user taps Resume
 *     or Discard. No auto-hydration.
 *   - "Saved on device HH:MM" pill shown after the first write.
 *   - Draft cleared before router.refresh() on success.
 *   - localStorage access fully try/catch guarded (private-mode Safari).
 *   - Corrupt/unparseable draft = treated as absent + cleared.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import { formatTime } from "@/lib/i18n/format";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { IntakeLineRow, type IntakeLine } from "@/components/receiving/IntakeLineRow";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { ReceivingFormData, ReceivingSkuOption } from "@/lib/receiving";
import type { OpenCreditRow } from "@/lib/credits";

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

/** Shape persisted to localStorage. `savedAt` is an ISO timestamp. */
interface IntakeDraft {
  vendorId: string;
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

function readDraft(locationId: string): IntakeDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(locationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Minimal shape guard — if any required field is missing, treat as corrupt.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).vendorId !== "string" ||
      typeof (parsed as Record<string, unknown>).savedAt !== "string"
    ) {
      clearDraft(locationId);
      return null;
    }
    return parsed as IntakeDraft;
  } catch {
    clearDraft(locationId);
    return null;
  }
}

function writeDraft(locationId: string, draft: IntakeDraft): void {
  try {
    localStorage.setItem(draftKey(locationId), JSON.stringify(draft));
  } catch {
    // Private-mode Safari or storage full — silently ignore.
  }
}

function clearDraft(locationId: string): void {
  try {
    localStorage.removeItem(draftKey(locationId));
  } catch {
    // Private-mode Safari — silently ignore.
  }
}

const field =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const stepHeadClass = "flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep";
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
  // `pendingDraft` = a draft found on mount awaiting Resume/Discard decision.
  // `savedAt` = ISO timestamp of the last successful localStorage write this
  // session — drives the "Saved on device HH:MM" indicator.
  const [pendingDraft, setPendingDraft] = useState<IntakeDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

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

  // On mount: check for a saved draft and offer Resume/Discard.
  useEffect(() => {
    const draft = readDraft(locationId);
    if (draft) setPendingDraft(draft);
  }, [locationId]);

  // Debounced draft save. Fires 500 ms after the last state change.
  // Skipped when the form is pristine (no vendor + no edited lines).
  useEffect(() => {
    // Skip the very first render (initial mount with default state).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
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
      writeDraft(locationId, {
        vendorId,
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
  }, [vendorId, date, invoiceNumber, invoiceTotal, notes, photoLater, receiptPhotoId, lines, locationId]);

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
  const canSubmit =
    vendorId !== "" && date !== "" && readyLines.length > 0 && (receiptPhotoId !== null || photoLater) && !busy;

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
    // Clear any pending banner too.
    setPendingDraft(null);
    setSavedAt(null);
    setLinkedPoId(null);
    setLinkedPoCode(null);
    setOpenCredits([]);
    setCheckedCreditIds(new Set());
    setArmComplete(false);
    setNotArrived({});
    // NOTE: closedCount / closureError are the success-state notice — NOT cleared here.
    // resetForm runs on a successful submit; the notice must survive to be shown.
  };

  const resumeDraft = (draft: IntakeDraft) => {
    setVendorId(draft.vendorId);
    setDate(draft.date);
    setInvoiceNumber(draft.invoiceNumber);
    setInvoiceTotal(draft.invoiceTotal);
    setNotes(draft.notes);
    setPhotoLater(draft.photoLater);
    setReceiptPhotoId(draft.receiptPhotoId);
    setLines(draft.lines.length > 0 ? draft.lines : [addedLine()]);
    setPendingDraft(null);
    setSavedAt(draft.savedAt);
  };

  const discardDraft = () => {
    clearDraft(locationId);
    setPendingDraft(null);
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
      // Clear the draft BEFORE router.refresh() so it can't be resumed
      // after a successful submit (D1 Task 6 law: clear on success).
      clearDraft(locationId);
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
      {/* ── Draft resume banner (D1 Task 6) ────────────────────────────── */}
      {pendingDraft ? (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border-2 border-co-gold-deep bg-co-gold/20 px-4 py-3"
        >
          <span className="text-sm font-bold text-co-text">
            {t("receiving.door.draft_resume_banner", {
              time: formatTime(pendingDraft.savedAt, language),
            })}
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={discardDraft}
              aria-label={t("receiving.door.draft_discard_aria", {
                time: formatTime(pendingDraft.savedAt, language),
              })}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text-dim hover:border-co-text"
            >
              {t("receiving.door.draft_discard")}
            </button>
            <button
              type="button"
              onClick={() => resumeDraft(pendingDraft)}
              aria-label={t("receiving.door.draft_resume_aria", {
                time: formatTime(pendingDraft.savedAt, language),
              })}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-sm font-bold text-co-text hover:bg-co-gold-deep"
            >
              {t("receiving.door.draft_resume")}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── STEP 1 · Count the delivery ─────────────────────────────────── */}
      <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
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
            className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-gold/20 px-3 py-2 text-sm font-bold text-co-text"
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
            <div className="flex flex-col gap-2.5">
              {lines.map((l, i) => (
                <IntakeLineRow
                  key={l.key}
                  line={l}
                  levels={levelsFor(l.skuId)}
                  busy={busy}
                  locationId={locationId}
                  onChange={(patch) => setLine(i, patch)}
                  onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((_, j) => j !== i)) : null}
                />
              ))}
            </div>
          )}

          {/* Overages / substitutions: the "Add item" affordance opens a fresh
              expanded line whose SKU is chosen from the vendor's SKU picker. */}
          {vendorId !== "" && !prefilling ? (
            <div className="mt-3">
              <AddItemPicker
                options={vendorSkus}
                busy={busy}
                pickLabel={t("receiving.form.pick_sku")}
                addLabel={t("receiving.form.add_line")}
                onAdd={(sku) =>
                  setLines((ls) => [
                    ...ls,
                    { ...addedLine(), skuId: sku.id, skuName: sku.name, level: "" },
                  ])
                }
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* ── STEP 2 · Receipt photo ──────────────────────────────────────── */}
      <section className="mt-4 rounded-xl border-2 border-co-border bg-co-surface p-4">
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
      <section className="mt-4 rounded-xl border-2 border-co-border bg-co-surface p-4">
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
          className="mt-4 rounded-lg border-2 border-co-gold-deep bg-co-gold/20 px-3 py-3 text-sm font-bold text-co-text"
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
              className="mt-1 inline-flex min-h-[44px] items-center font-bold text-co-cta underline"
            >
              {t("receiving.door.view_existing")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ── STEP 3 · Submit (sticky at the bottom of the viewport) ───────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-co-border bg-co-bg/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={stepNumClass}>3</span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={completeWithGate}
              className={
                "inline-flex min-h-[48px] flex-1 items-center justify-center rounded-lg border-2 border-co-gold-deep px-4 text-sm font-bold uppercase tracking-[0.1em] disabled:opacity-50 " +
                (showMissingNotice ? "bg-co-gold-deep text-white" : "bg-co-gold text-co-text")
              }
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
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text-dim hover:border-co-text disabled:opacity-50"
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
