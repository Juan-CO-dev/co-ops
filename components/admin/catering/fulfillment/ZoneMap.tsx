"use client";

/**
 * ZoneMap — Leaflet map for one store's delivery zone.
 *
 * SSR SAFETY: This file MUST be imported only via next/dynamic with ssr:false.
 * Leaflet touches window/document at module-load time; importing it in a Server
 * Component or during SSR will crash the build / prerender.
 *
 * Leaflet default-marker icon fix: Next.js processes image imports and turns them
 * into objects with a `.src` property. Leaflet's bundler path-resolution for its
 * default icons breaks under webpack/Turbopack. We fix it by overriding the
 * default icon with explicit imports at module scope.
 */

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle } from "react-leaflet";

// --- Fix Leaflet's default marker icon under Next.js bundlers -----------------
// Next static-imports images to { src, height, width } objects; `as unknown` lets
// us handle both the object shape (Next) and the raw string (plain bundlers).
import iconPng from "leaflet/dist/images/marker-icon.png";
import icon2xPng from "leaflet/dist/images/marker-icon-2x.png";
import shadowPng from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconUrl:
    (iconPng as unknown as { src?: string }).src ??
    (iconPng as unknown as string),
  iconRetinaUrl:
    (icon2xPng as unknown as { src?: string }).src ??
    (icon2xPng as unknown as string),
  shadowUrl:
    (shadowPng as unknown as { src?: string }).src ??
    (shadowPng as unknown as string),
});
// ------------------------------------------------------------------------------

import { milesToMeters } from "@/lib/geo";

export interface ZoneMapProps {
  /** Stable key (the selected location id) — remounts the map to re-center only when the
   *  store CHANGES, NOT on every pin drag (dragging updates lat/lng via props, no remount). */
  mapKey: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  onCenterChange: (lat: number, lng: number) => void;
}

export default function ZoneMap({ mapKey, lat, lng, radiusMiles, onCenterChange }: ZoneMapProps) {
  const center: [number, number] = [lat, lng];
  const radiusMeters = milesToMeters(radiusMiles);

  return (
    <MapContainer
      key={mapKey}
      center={center}
      zoom={12}
      style={{ height: "360px", width: "100%" }}
      className="rounded-lg border-2 border-co-border"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Marker
        position={center}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const latlng = (e.target as L.Marker).getLatLng();
            onCenterChange(latlng.lat, latlng.lng);
          },
        }}
      />
      <Circle center={center} radius={radiusMeters} />
    </MapContainer>
  );
}
