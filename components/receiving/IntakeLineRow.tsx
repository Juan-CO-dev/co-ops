"use client";

/**
 * IntakeLineRow — one line of the count-by-exception door ceremony (spec D1).
 *
 * Two visual states, both in-place (no modals, no separate screens):
 *  - COLLAPSED: SKU name + "expected N × level" + one LARGE ✓ confirm button.
 *    Tapping ✓ sets qty = expected and marks the line confirmed (green accent).
 *    Tapping anywhere else on the row expands it. Added/overage lines
 *    (expectedQty = null) have no collapsed state — they render expanded.
 *  - EXPANDED: qty stepper (− value +) at the received level, level picker
 *    (chain labels), flag chips (Short / Over / Damaged / Sub — single-toggle,
 *    auto-suggested from qty vs expected), a note input, and the per-line
 *    PhotoCapture. Only ONE flag may be active; it maps to discrepancyType.
 *
 * Disclosure state is useState-only (no effects for prop-driven resets). The
 * parent owns the line array and passes each line's value + an onChange patch.
 */
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

export type DiscrepancyFlag = "short" | "over" | "damaged" | "substitution";

/** One editable line in the door form. `expectedQty` null = an added/overage
 *  line (no pre-fill, always expanded). `confirmed` is the fast-path tap state. */
export interface IntakeLine {
  skuId: string;
  skuName: string;
  level: string;
  qty: string;
  expectedQty: number | null;
  discrepancy: DiscrepancyFlag | null;
  note: string;
  photoId: string | null;
  confirmed: boolean;
  /** Collapsed only when the operator hasn't opened it. Expected rows collapse with a
   *  ✓; offered rows (see `offered`) collapse to a tap-to-count summary; added lines
   *  are born expanded. */
  expanded: boolean;
  /** True for a no-template FALLBACK row: one of the vendor's own usage-ranked SKUs,
   *  offered with an empty qty (Juan's door refinement). Distinguishes it from a
   *  manually-ADDED overage line — both have `expectedQty == null`, but an offered row
   *  reads as "offered, not received" (omitted at submit until a qty is entered) and
   *  gets a tap-to-count collapsed state instead of the "Added" badge. */
  offered: boolean;
  /** Optional unit price string — parsed to number on submit; empty = omit. */
  unitPrice: string;
  /** Optional observed oz/each string — parsed to number on submit; empty = omit. */
  observed: string;
}

const FLAGS: readonly DiscrepancyFlag[] = ["short", "over", "damaged", "substitution"] as const;
const flagKey: Record<DiscrepancyFlag, TranslationKey> = {
  short: "receiving.flag.short",
  over: "receiving.flag.over",
  damaged: "receiving.flag.damaged",
  substitution: "receiving.flag.sub",
};

const field =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

/** The flag qty vs expected auto-suggests. Numeric-parse of the qty string;
 *  blank/NaN → no suggestion. */
function suggestFlag(qty: string, expected: number | null): DiscrepancyFlag | null {
  if (expected == null) return null;
  const v = qty.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < expected) return "short";
  if (n > expected) return "over";
  return null;
}

export function IntakeLineRow({
  line,
  levels,
  busy,
  onChange,
  onRemove,
  locationId,
}: {
  line: IntakeLine;
  levels: string[];
  busy: boolean;
  onChange: (patch: Partial<IntakeLine>) => void;
  onRemove: (() => void) | null;
  locationId: string;
}) {
  const { t } = useTranslation();
  const expectedLabel = line.level.trim() || t("receiving.door.level_generic");
  const suggested = suggestFlag(line.qty, line.expectedQty);

  // Collapsed fast path: a line the operator hasn't opened (or confirmed).
  //   - EXPECTED (expectedQty != null): the template pre-fill — big ✓ accepts the
  //     expected qty (the 60-90s happy path).
  //   - OFFERED (expectedQty == null && !expanded): Juan's no-template fallback —
  //     the vendor's own usage-ranked SKUs, offered with an EMPTY qty. There is no
  //     expected number to ✓ into, so these have NO confirm button; tapping the body
  //     opens the stepper (expand-on-tap only). A qty entered while expanded, then
  //     collapsed, shows as the received count. `hasQty` distinguishes a still-empty
  //     offer from one the operator has started filling.
  //   (An ADDED overage line is expectedQty == null && expanded → never collapsed.)
  const isOffered = line.offered;
  // Collapsed only for EXPECTED (template) or OFFERED (fallback) rows — a manually-added
  // overage line has no expected number and is born expanded, so it never collapses.
  const collapsed = !line.expanded && (line.expectedQty != null || isOffered);
  const hasQty = line.qty.trim() !== "" && Number(line.qty) > 0;

  const confirm = () => {
    // Tap ✓ → accept the expected qty exactly, mark confirmed, stays collapsed.
    onChange({
      qty: line.expectedQty != null ? String(line.expectedQty) : line.qty,
      confirmed: true,
      discrepancy: null,
    });
  };

  const stepBy = (delta: number) => {
    const cur = Number(line.qty.trim() === "" ? "0" : line.qty);
    const base = Number.isFinite(cur) ? cur : 0;
    const next = Math.max(0, base + delta);
    // Editing the qty breaks the "confirmed exact" state; re-evaluate the flag.
    onChange({ qty: String(next), confirmed: false });
  };

  const toggleFlag = (flag: DiscrepancyFlag) => {
    onChange({ discrepancy: line.discrepancy === flag ? null : flag });
  };

  if (collapsed) {
    return (
      <div
        className={
          "rounded-lg border-2 p-3 transition " +
          (line.confirmed
            ? "border-co-success bg-co-success-surface"
            : "border-co-border-2 bg-co-surface")
        }
      >
        <div className="flex items-center gap-3">
          {/* Tap the body (not the ✓) to open the line for editing. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ expanded: true })}
            className="min-h-[44px] flex-1 text-left"
            aria-label={t("receiving.door.expand_aria", { sku: line.skuName })}
          >
            <span className="block text-base font-bold text-co-text">{line.skuName}</span>
            <span className="block text-[13px] text-co-text-dim">
              {isOffered
                ? // Offered fallback row: no expected number. Show the entered qty once
                  // the operator has typed one, otherwise a "—" hint to tap-to-count.
                  hasQty
                  ? t("receiving.door.offered_counted", { qty: line.qty, level: expectedLabel })
                  : t("receiving.door.offered_line", { level: expectedLabel })
                : t("receiving.door.expected_line", {
                    qty: line.expectedQty ?? 0,
                    level: expectedLabel,
                  })}
            </span>
          </button>
          {/* EXPECTED rows get the LARGE confirm target (tap-✓ down the list). OFFERED
              rows have no expected qty to accept → tap the body to open the stepper. */}
          {isOffered ? (
            <span
              aria-hidden="true"
              className="inline-flex h-12 min-h-[44px] w-14 items-center justify-center rounded-lg border-2 border-dashed border-co-border-2 text-xl font-bold text-co-text-muted"
            >
              —
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              aria-pressed={line.confirmed}
              aria-label={t("receiving.door.confirm_aria", { sku: line.skuName })}
              className={
                "inline-flex h-12 min-h-[44px] w-14 items-center justify-center rounded-lg border-2 text-xl font-bold transition " +
                (line.confirmed
                  ? "border-co-success bg-co-success text-white"
                  : "border-co-gold-deep bg-co-gold text-co-text hover:bg-co-gold-deep")
              }
            >
              ✓
            </button>
          )}
        </div>
      </div>
    );
  }

  // Expanded editor.
  return (
    <div
      className={
        "rounded-lg border-2 p-3 " +
        (line.confirmed ? "border-co-success bg-co-success-surface" : "border-co-border-2 bg-co-surface")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-base font-bold text-co-text">
            {line.skuName || t("receiving.door.added_item")}
          </span>
          {line.expectedQty != null ? (
            <span className="block text-[12px] text-co-text-dim">
              {t("receiving.door.expected_line", { qty: line.expectedQty, level: expectedLabel })}
            </span>
          ) : isOffered ? (
            <span className="block text-[12px] font-semibold text-co-gold-text">
              {t("receiving.door.offered_badge")}
            </span>
          ) : (
            <span className="block text-[12px] font-semibold text-co-gold-text">
              {t("receiving.door.added_badge")}
            </span>
          )}
        </div>
        {/* Expected + offered rows both collapse back to their summary; a manually-added
            overage line has no collapsed state (it is born expanded). */}
        {line.expectedQty != null || isOffered ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ expanded: false })}
            className="min-h-[44px] shrink-0 px-2 text-xs font-bold text-co-text-dim hover:text-co-text"
            aria-label={t("receiving.door.collapse_aria", { sku: line.skuName })}
          >
            {t("receiving.door.collapse")}
          </button>
        ) : null}
      </div>

      {/* Qty stepper — steppers primary (big −/+ targets), direct input allowed. */}
      <div className="mt-3">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {t("receiving.door.qty_label", { level: expectedLabel })}
        </span>
        <div className="mt-1 flex items-stretch gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => stepBy(-1)}
            aria-label={t("receiving.door.decrement")}
            className="inline-flex h-12 w-12 min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-2xl font-bold text-co-text hover:border-co-text disabled:opacity-60"
          >
            −
          </button>
          <input
            className={`${field} text-center text-xl font-bold`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={line.qty}
            disabled={busy}
            onChange={(e) => onChange({ qty: e.target.value, confirmed: false })}
            aria-label={t("receiving.door.qty_label", { level: expectedLabel })}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => stepBy(1)}
            aria-label={t("receiving.door.increment")}
            className="inline-flex h-12 w-12 min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-2xl font-bold text-co-text hover:border-co-text disabled:opacity-60"
          >
            +
          </button>
        </div>
      </div>

      {/* Level picker — same chain labels as the rest of receiving. */}
      {levels.length > 0 ? (
        <label className="mt-3 block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("receiving.form.level")}
          </span>
          <select
            className={`mt-1 ${field}`}
            value={line.level}
            disabled={busy}
            onChange={(e) => onChange({ level: e.target.value })}
            aria-label={t("receiving.form.level")}
          >
            <option value="">{t("receiving.form.pick_level")}</option>
            {levels.map((lv) => (
              <option key={lv} value={lv}>
                {lv}
              </option>
            ))}
          </select>
        </label>
      ) : line.skuId ? (
        <p className="mt-3 text-[11px] italic text-co-text-muted">{t("receiving.form.level_legacy")}</p>
      ) : null}

      {/* Flag chips — single-toggle; the suggested one is visually pre-selected
          (one tap accepts). Auto-suggest reads qty vs expected. */}
      <div className="mt-3">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {t("receiving.door.flags_label")}
        </span>
        <div className="mt-1 flex flex-wrap gap-2">
          {FLAGS.map((flag) => {
            const active = line.discrepancy === flag;
            const isSuggested = !line.discrepancy && suggested === flag;
            return (
              <button
                key={flag}
                type="button"
                disabled={busy}
                onClick={() => toggleFlag(flag)}
                aria-pressed={active}
                className={
                  "inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition " +
                  (active
                    ? "border-co-danger bg-co-danger-surface text-co-text"
                    : isSuggested
                      ? "border-co-danger border-dashed bg-co-danger-surface text-co-text"
                      : "border-co-border bg-co-surface text-co-text-dim hover:border-co-text")
                }
              >
                {t(flagKey[flag])}
                {isSuggested ? <span className="ml-1 text-[11px] font-semibold text-co-danger">•</span> : null}
              </button>
            );
          })}
        </div>
        {!line.discrepancy && suggested ? (
          <p className="mt-1 text-[11px] text-co-text-dim">
            {t("receiving.door.suggest_hint", { flag: t(flagKey[suggested]) })}
          </p>
        ) : null}
      </div>

      {/* Optional unit price + observed oz/each — expanded only; collapsed path untouched. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("receiving.form.price")}
          </span>
          <input
            className={`mt-1 ${field}`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={line.unitPrice}
            disabled={busy}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
            aria-label={t("receiving.form.price")}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("receiving.form.observed")}
          </span>
          <input
            className={`mt-1 ${field}`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={line.observed}
            disabled={busy}
            onChange={(e) => onChange({ observed: e.target.value })}
            aria-label={t("receiving.form.observed")}
          />
        </label>
      </div>

      {/* Small note + per-line photo. */}
      <input
        className={`mt-3 ${field}`}
        value={line.note}
        disabled={busy}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder={t("receiving.form.line_note")}
        aria-label={t("receiving.form.line_note")}
      />
      <PhotoCapture
        className="mt-2"
        locationId={locationId}
        label={t("receiving.form.photo_capture")}
        initialPhotoId={line.photoId}
        onUploaded={(pid) => onChange({ photoId: pid })}
      />

      {onRemove ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="mt-2 text-xs font-bold text-co-cta-text"
        >
          {t("receiving.form.remove_line")}
        </button>
      ) : null}
    </div>
  );
}
