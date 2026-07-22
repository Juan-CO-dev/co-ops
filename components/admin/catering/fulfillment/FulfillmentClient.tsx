"use client";

/**
 * FulfillmentClient — admin editor for per-store delivery zones.
 *
 * Location picker → map with draggable pin + radius circle → offers-delivery /
 * offers-pickup toggles → Save (Tier-A step-up).
 *
 * ZoneMap is dynamic-imported with ssr:false because Leaflet touches
 * window/document at module-load time and cannot run during SSR / prerender.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import type { FulfillmentNodeView } from "@/lib/admin/catering/fulfillment";

// Dynamic import: ssr:false is REQUIRED — Leaflet is browser-only.
const ZoneMap = dynamic(() => import("./ZoneMap"), { ssr: false });

const DEFAULT_LAT = 38.9072;
const DEFAULT_LNG = -77.0369;
const DEFAULT_RADIUS = 5;

interface ZoneState {
  lat: number;
  lng: number;
  radiusMiles: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

function seedState(node: FulfillmentNodeView): ZoneState {
  if (node.configured && node.lat !== null && node.lng !== null) {
    return {
      lat: node.lat,
      lng: node.lng,
      // Radius is stored as integer meters, so metersToMiles round-trips to e.g. 5.000174 —
      // round to 2 dp for the input (idempotent: saving 5.00 re-derives the same meters).
      radiusMiles: node.radiusMiles != null ? Math.round(node.radiusMiles * 100) / 100 : DEFAULT_RADIUS,
      offersDelivery: node.offersDelivery,
      offersPickup: node.offersPickup,
    };
  }
  return {
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    radiusMiles: DEFAULT_RADIUS,
    offersDelivery: true,
    offersPickup: true,
  };
}

export function FulfillmentClient({
  nodes,
  actorLevel,
}: {
  nodes: FulfillmentNodeView[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [selectedId, setSelectedId] = useState<string | null>(
    nodes[0]?.locationId ?? null,
  );
  const firstNode = nodes[0];
  const [zone, setZone] = useState<ZoneState>(
    firstNode ? seedState(firstNode) : {
      lat: DEFAULT_LAT,
      lng: DEFAULT_LNG,
      radiusMiles: DEFAULT_RADIUS,
      offersDelivery: true,
      offersPickup: true,
    },
  );

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  const canManage = actorLevel >= 7;

  const handleSelectLocation = (locationId: string) => {
    const node = nodes.find((n) => n.locationId === locationId);
    if (!node) return;
    setSelectedId(locationId);
    setZone(seedState(node));
    setErrorMsg(null);
    setSavedMsg(false);
  };

  const handleCenterChange = (lat: number, lng: number) => {
    setZone((prev) => ({ ...prev, lat, lng }));
  };

  const handleSave = async () => {
    if (busy || !selectedId) return;
    setErrorMsg(null);
    setSavedMsg(false);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      "/api/admin/catering/fulfillment",
      {
        locationId: selectedId,
        lat: zone.lat,
        lng: zone.lng,
        radiusMiles: zone.radiusMiles,
        offersDelivery: zone.offersDelivery,
        offersPickup: zone.offersPickup,
      },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setSavedMsg(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  const selectedNode = nodes.find((n) => n.locationId === selectedId);

  if (nodes.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.fulfillment.empty" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {/* Location picker */}
      <div>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.fulfillment.location" as TranslationKey)}
          </span>
          <select
            className={fieldCls}
            value={selectedId ?? ""}
            disabled={busy}
            aria-label={t("admin.catering.fulfillment.select_location" as TranslationKey)}
            onChange={(e) => handleSelectLocation(e.target.value)}
          >
            {nodes.map((n) => (
              <option key={n.locationId} value={n.locationId}>
                {n.locationName}
                {" — "}
                {n.configured
                  ? t("admin.catering.fulfillment.configured" as TranslationKey)
                  : t("admin.catering.fulfillment.not_set" as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Drag hint */}
      {selectedNode && (
        <p className="text-sm text-co-text-muted">
          {t("admin.catering.fulfillment.drag_hint" as TranslationKey)}
        </p>
      )}

      {/* Map — SSR-safe via dynamic ssr:false. `isolate` contains Leaflet's internal
          z-index (controls hit z-1000) so it can't paint over app modals (step-up). */}
      <div className="isolate overflow-hidden rounded-lg">
        <ZoneMap
          mapKey={selectedId ?? "none"}
          lat={zone.lat}
          lng={zone.lng}
          radiusMiles={zone.radiusMiles}
          onCenterChange={handleCenterChange}
        />
      </div>

      {/* Radius + toggles */}
      <div className="co-card flex flex-col gap-4 p-4">
        {/* Radius input */}
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.fulfillment.radius_miles" as TranslationKey)}
          </span>
          <input
            className={fieldCls + " w-36"}
            type="number"
            min={0.1}
            step={0.1}
            value={zone.radiusMiles}
            disabled={busy}
            aria-label={t("admin.catering.fulfillment.radius_miles" as TranslationKey)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0) {
                setZone((prev) => ({ ...prev, radiusMiles: v }));
              }
            }}
          />
        </label>

        {/* Offers delivery */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-2 border-co-border accent-co-gold"
            checked={zone.offersDelivery}
            disabled={busy}
            aria-label={t("admin.catering.fulfillment.offers_delivery" as TranslationKey)}
            onChange={(e) =>
              setZone((prev) => ({ ...prev, offersDelivery: e.target.checked }))
            }
          />
          <span className="text-sm font-semibold text-co-text">
            {t("admin.catering.fulfillment.offers_delivery" as TranslationKey)}
          </span>
        </label>

        {/* Offers pickup */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-2 border-co-border accent-co-gold"
            checked={zone.offersPickup}
            disabled={busy}
            aria-label={t("admin.catering.fulfillment.offers_pickup" as TranslationKey)}
            onChange={(e) =>
              setZone((prev) => ({ ...prev, offersPickup: e.target.checked }))
            }
          />
          <span className="text-sm font-semibold text-co-text">
            {t("admin.catering.fulfillment.offers_pickup" as TranslationKey)}
          </span>
        </label>
      </div>

      {/* Save + feedback */}
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? (
          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={() => void handleSave()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-6 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? t("common.saving" as TranslationKey)
              : t("admin.catering.fulfillment.save" as TranslationKey)}
          </button>
        ) : null}

        {savedMsg && !errorMsg ? (
          <p className="text-sm font-semibold text-co-text">
            {t("admin.catering.fulfillment.saved" as TranslationKey)}
          </p>
        ) : null}

        {errorMsg ? (
          <p className="text-sm text-co-cta">{errorMsg}</p>
        ) : null}
      </div>
    </div>
  );
}
