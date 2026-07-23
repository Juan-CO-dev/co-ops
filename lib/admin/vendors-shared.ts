/**
 * Vendors — CLIENT-SAFE shared surface (color palette only; no I/O, no server
 * imports). Split from vendors.ts on 2026-07-23: the `server-only` guard on
 * lib/supabase-server.ts surfaced VendorDetailClient.tsx's runtime import of
 * VENDOR_COLOR_PALETTE dragging the service-role module into the client graph
 * (PR #165 CI catch — fourth chain). Types stay importable from vendors.ts.
 */

/** Fixed, legible, on-brand-ish palette for vendor calendar colors (B2 reads
 *  these; a curated set keeps the aggregated calendar readable vs free hex). */
export const VENDOR_COLOR_PALETTE = [
  "#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED",
  "#0891B2", "#DB2777", "#65A30D", "#EA580C", "#4B5563",
] as const;
