"use client";

/**
 * SkuLocationOverlay — the per-location activation + par overlay editor (VO-7;
 * migration 0174 location_sku_settings). Edit-mode-only; lives in its OWN
 * default-collapsed CollapsibleSection (D3) inside SkuBuilder's edit view.
 *
 * Per location (Both shops listed): a tri-state activation (Inherit / On / Off)
 * + a weekday/weekend par pair (blank = inherit the global vendor_items par).
 * Any non-inherit value upserts the (location, sku) row; a revert-to-all-inherit
 * nulls the three fields (never a delete — append-only, enforced server-side).
 *
 * Tri-state → wire values: Inherit → null, On → true, Off → false. Blank par →
 * null. Each location saves independently via PUT .../location-settings; its own
 * Tier-A step-up (the parent's requestStepUp — passed as `onSave`). Presentational
 * + local form state; the PARENT owns the fetch + step-up + router.refresh.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { postJson, resolveErrorKey } from "./shared";
import type { SkuFormLocationOption } from "./SkuBuilder";

/** A location's current overlay (camelCase; matches lib/admin/skus LocationSkuSetting). */
export interface LocationSkuOverlayView {
  locationId: string;
  activeOverride: boolean | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  /**
   * THE MACHINE'S STANDING NUMBER (Dynamic Pars, Task 4.9) — CONTEXT, NEVER AN INPUT.
   *
   * `resolvePar` is human ?? auto ?? global, so when the human field beside it is blank
   * THIS is the number governing the shelf, and an editor that hid it would be lying by
   * omission. It is rendered as read-only text: the auto lane belongs to the engine, and
   * the route's payload structurally cannot carry an auto value (lib/admin/skus.ts —
   * `parWriteColumns({ kind: "admin" })` returns NULL for every auto column, for every
   * input). Typing a human number here nulls it, which is the intended way to overrule
   * the machine. All null before migration 0183.
   */
  autoWeekdayPar?: number | null;
  autoWeekendPar?: number | null;
  autoWeekdayAppliedAt?: string | null;
  autoWeekendAppliedAt?: string | null;
}

/** The three overlay fields as ONE comparable value — the wire's `expected` object
 *  (mirrors lib/admin/skus.ts's OverlayBaseline; declared here so this client island does
 *  not import a server module). */
export interface LocationSkuOverlayBaseline {
  activeOverride: boolean | null;
  weekdayPar: number | null;
  weekendPar: number | null;
}

type ActiveState = "inherit" | "on" | "off";

function toActiveState(v: boolean | null): ActiveState {
  if (v === null) return "inherit";
  return v ? "on" : "off";
}
function fromActiveState(s: ActiveState): boolean | null {
  if (s === "inherit") return null;
  return s === "on";
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function SkuLocationOverlay({
  skuId,
  locations,
  overlays,
}: {
  skuId: string;
  /** Active locations (both shops). */
  locations: SkuFormLocationOption[];
  /** This SKU's existing overlay rows (empty when none). */
  overlays: LocationSkuOverlayView[];
}) {
  const { t } = useTranslation();

  return (
    <CollapsibleSection
      idBase={`sku-location-overlay-${skuId}`}
      title={t("admin.skus.location_overlay.title")}
      count={t("admin.skus.location_overlay.count", { n: String(locations.length) })}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-co-text-muted">{t("admin.skus.location_overlay.intro")}</p>
        {locations.map((loc) => (
          <LocationRow
            key={loc.id}
            skuId={skuId}
            location={loc}
            overlay={overlays.find((o) => o.locationId === loc.id) ?? null}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

/**
 * THE MACHINE'S STANDING NUMBER FOR ONE SLOT — read-only, and only when one exists
 * (Dynamic Pars, Task 4.9).
 *
 * Not an input, not a placeholder, not a "restore" affordance: text. `resolvePar` is
 * human ?? auto ?? global, so when the field beside it is blank THIS is the number
 * governing the shelf, and an editor that hid it would be lying by omission. Silent when
 * the machine has no opinion — which is every slot in v1, and every slot before migration
 * 0183. Typing a human number nulls it (parWriteColumns, kind "admin"), which is the
 * intended way to overrule the machine; there is no affordance here that writes it.
 */
function AutoParNote({ value, appliedAt }: { value: number | null; appliedAt: string | null }) {
  const { t, language } = useTranslation();
  if (value == null) return null;
  return (
    <span
      className="mt-1 block text-[11px] text-co-text-muted"
      aria-label={t("admin.skus.auto_par_readonly_aria", { n: value })}
    >
      {appliedAt != null
        ? t("admin.skus.auto_par_readonly", {
            n: value,
            day: formatDateLabel(appliedAt.slice(0, 10), language),
          })
        : t("admin.skus.auto_par_readonly_undated", { n: value })}
    </span>
  );
}

function LocationRow({
  skuId,
  location,
  overlay,
}: {
  skuId: string;
  location: SkuFormLocationOption;
  overlay: LocationSkuOverlayView | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [active, setActive] = useState<ActiveState>(toActiveState(overlay?.activeOverride ?? null));
  const [weekdayPar, setWeekdayPar] = useState(overlay?.weekdayPar != null ? String(overlay.weekdayPar) : "");
  const [weekendPar, setWeekendPar] = useState(overlay?.weekendPar != null ? String(overlay.weekendPar) : "");
  /**
   * WHAT THIS ROW LOOKED LIKE WHEN IT LOADED — sent as `expected` on every save.
   *
   * This form posts BOTH day-class pars at once; /ordering's accept patches exactly ONE of
   * them. So a weekend par can legitimately move while this tab is open, and the fields
   * above would post the number from page load straight over it. The server compares this
   * baseline to the live row and refuses with `overlay_changed` instead of clobbering a slot
   * the operator never saw.
   *
   * Re-baselined after a successful save rather than re-read from props: `router.refresh()`
   * re-renders the server component but does NOT reset client state, so a props-derived
   * baseline would stay frozen at the first load and every subsequent save would 409.
   */
  const [baseline, setBaseline] = useState<LocationSkuOverlayBaseline>({
    activeOverride: overlay?.activeOverride ?? null,
    weekdayPar: overlay?.weekdayPar ?? null,
    weekendPar: overlay?.weekendPar ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parseNum = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    // A non-finite value already reached the server as `null` (JSON.stringify(NaN) is
    // "null"), so this changes nothing on the wire — it stops the BASELINE from holding a
    // NaN the row never stored, which would 409 every subsequent save until a reload.
    return Number.isFinite(n) ? n : null;
  };

  const save = async () => {
    if (busy) return;
    setErrorMsg(null);
    setSaved(false);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const sent: LocationSkuOverlayBaseline = {
      activeOverride: fromActiveState(active),
      weekdayPar: parseNum(weekdayPar),
      weekendPar: parseNum(weekendPar),
    };
    const result = await postJson(
      `/api/admin/skus/${skuId}/location-settings`,
      { locationId: location.id, ...sent, expected: baseline },
      "PUT",
    );
    setBusy(false);
    if (result.ok) {
      // The server stores these values verbatim (normalizePar validates, it never rounds),
      // so what was sent IS the new truth — and the next save's baseline.
      setBaseline(sent);
      setSaved(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const activeLabel = (s: ActiveState) => t(`admin.skus.location_overlay.active.${s}` as TranslationKey);

  return (
    <div className="rounded-lg border-2 border-co-border p-3">
      <div className="text-sm font-bold text-co-text">{location.name}</div>
      <div className="mt-2 flex flex-col gap-2">
        <label className="block">
          <span className="text-xs font-bold text-co-text-muted">{t("admin.skus.location_overlay.activation")}</span>
          <select
            className={fieldCls}
            value={active}
            disabled={busy}
            aria-label={t("admin.skus.location_overlay.activation")}
            onChange={(e) => {
              setSaved(false);
              setActive(e.target.value as ActiveState);
            }}
          >
            {(["inherit", "on", "off"] as const).map((s) => (
              <option key={s} value={s}>{activeLabel(s)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-co-text-muted">{t("admin.skus.location_overlay.weekday_par")}</span>
            <input
              className={fieldCls}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={weekdayPar}
              disabled={busy}
              placeholder={t("admin.skus.location_overlay.inherit_ph")}
              aria-label={t("admin.skus.location_overlay.weekday_par")}
              onChange={(e) => {
                setSaved(false);
                setWeekdayPar(e.target.value);
              }}
            />
            <AutoParNote
              value={overlay?.autoWeekdayPar ?? null}
              appliedAt={overlay?.autoWeekdayAppliedAt ?? null}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-co-text-muted">{t("admin.skus.location_overlay.weekend_par")}</span>
            <input
              className={fieldCls}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={weekendPar}
              disabled={busy}
              placeholder={t("admin.skus.location_overlay.inherit_ph")}
              aria-label={t("admin.skus.location_overlay.weekend_par")}
              onChange={(e) => {
                setSaved(false);
                setWeekendPar(e.target.value);
              }}
            />
            <AutoParNote
              value={overlay?.autoWeekendPar ?? null}
              appliedAt={overlay?.autoWeekendAppliedAt ?? null}
            />
          </label>
        </div>
        {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
        {saved ? <p className="text-sm text-co-gold-text">{t("admin.skus.saved")}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.skus.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
