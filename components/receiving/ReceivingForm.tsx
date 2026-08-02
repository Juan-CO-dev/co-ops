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
 * gates on receiptPhotoId OR a "Photo later" tick (which appends
 * "[PHOTO PENDING]" to the header note). The primary button files a complete
 * delivery; a quieter secondary action files an in-progress ("still unloading")
 * one. A 409 duplicate renders inline with a "View existing" deep link.
 *
 * House laws honored: useState-only disclosure (no effects for prop-driven
 * resets); router.refresh() does NOT reset client state, so success resets
 * explicitly; type-only server imports; no server module leaks.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { IntakeLineRow, type IntakeLine } from "@/components/receiving/IntakeLineRow";
import type { ReceivingFormData, ReceivingSkuOption } from "@/lib/receiving";

interface LineDraft extends IntakeLine {
  /** local key so React reconciles rows across add/remove without index churn. */
  key: string;
}

interface LastDeliveryTemplate {
  lines: Array<{ skuId: string; level: string | null; qty: number }>;
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
});

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
  const { t } = useTranslation();
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

  const skuById = new Map<string, ReceivingSkuOption>(formData.skus.map((s) => [s.id, s]));
  const vendorSkus = formData.skus.filter((s) => s.vendorId === vendorId || s.vendorId === null);
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
  };

  // On vendor select: reset the line list, then fetch the prefill template and
  // seed collapsed expected rows from it. No template → one blank added line.
  const onVendorChange = async (nextVendorId: string) => {
    setVendorId(nextVendorId);
    setErr(null);
    setDupId(null);
    setLines([addedLine()]);
    if (!nextVendorId) return;
    setPrefilling(true);
    try {
      const res = await fetch(
        `/api/operations/receiving/template?locationId=${encodeURIComponent(locationId)}&vendorId=${encodeURIComponent(nextVendorId)}`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) return; // no template / error → keep the blank added line
      const body = (await res.json()) as { template: LastDeliveryTemplate | null };
      const tpl = body?.template;
      if (!tpl || tpl.lines.length === 0) return;
      const seeded: LineDraft[] = tpl.lines.map((tl) => ({
        key: nextKey(),
        skuId: tl.skuId,
        skuName: skuById.get(tl.skuId)?.name ?? t("receiving.door.unknown_sku"),
        level: tl.level ?? "",
        qty: String(tl.qty),
        expectedQty: tl.qty,
        discrepancy: null,
        note: "",
        photoId: null,
        confirmed: false,
        expanded: false,
        unitPrice: "",
        observed: "",
      }));
      setLines(seeded);
    } catch {
      // Network hiccup → silently fall back to the blank line (already set).
    } finally {
      setPrefilling(false);
    }
  };

  const submit = async (deliveryStatus: "complete" | "in_progress") => {
    if (!canSubmit) return;
    setErr(null);
    setDupId(null);
    setBusy(true);
    const headerNote = notes.trim();
    const finalNote = photoLater ? `${headerNote}${headerNote ? " " : ""}[PHOTO PENDING]` : headerNote;
    const payload = {
      vendorId,
      locationId,
      deliveryDate: date,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceTotal: num(invoiceTotal),
      notes: finalNote || null,
      deliveryStatus,
      // FORK 1: store the canonical /api/photos/{id} URL in receipt_url (TEXT).
      receiptUrl: receiptPhotoId ? `/api/photos/${receiptPhotoId}` : null,
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
    setBusy(false);
    if (res.ok) {
      resetForm();
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string; error?: string };
    if (res.status === 409 && j?.code === "duplicate_delivery") {
      // The message carries "(delivery <id>)" — parse it for a deep link.
      const text = j.message ?? j.error ?? "";
      const m = /\(delivery ([^)]+)\)/.exec(text);
      if (m && m[1]) setDupId(m[1].trim());
      setErr(text || t("receiving.error.duplicate_delivery"));
      return;
    }
    setErr(t(("receiving.error." + (j?.code ?? "generic")) as never));
  };

  return (
    <div className="pb-24">
      {/* ── STEP 1 · Count the delivery ─────────────────────────────────── */}
      <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
        <div className={stepHeadClass}>
          <span className={stepNumClass}>1</span>
          <span>{t("receiving.door.step1")}</span>
        </div>

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
              onClick={() => void submit("complete")}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
            >
              {t("receiving.door.submit_complete")}
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
