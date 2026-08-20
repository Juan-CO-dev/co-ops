"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import iconPng from "leaflet/dist/images/marker-icon.png";
import icon2xPng from "leaflet/dist/images/marker-icon-2x.png";
import shadowPng from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconUrl: (iconPng as unknown as { src?: string }).src ?? (iconPng as unknown as string),
  iconRetinaUrl: (icon2xPng as unknown as { src?: string }).src ?? (icon2xPng as unknown as string),
  shadowUrl: (shadowPng as unknown as { src?: string }).src ?? (shadowPng as unknown as string),
});

export interface DeliveryRouteMapProps {
  /** Stable key ("pin") — do NOT key on coords or the map remounts every drag. */
  mapKey: string;
  lat: number;
  lng: number;
  onPinChange: (lat: number, lng: number) => void;
}

export default function DeliveryRouteMap({ mapKey, lat, lng, onPinChange }: DeliveryRouteMapProps) {
  const center: [number, number] = [lat, lng];
  return (
    <MapContainer key={mapKey} center={center} zoom={13} style={{ height: "320px", width: "100%" }}
      className="rounded-3xl border-2 border-co-border-2">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <Marker position={center} draggable
        eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onPinChange(p.lat, p.lng); } }} />
    </MapContainer>
  );
}
