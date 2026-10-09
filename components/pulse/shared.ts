/**
 * Mid-shift Pulse v2 — client-safe presentation constants shared by the cards, the floor and the
 * section pages. Status is a WORD (i18n key) with colour as reinforcement; every fill/text pair
 * follows the token law (status colours are fills/surfaces, their text roles carry the text).
 */
import type { TranslationKey } from "@/lib/i18n/types";
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { FloorStatus } from "@/lib/pulse/types";

export const SECTION_TITLE_KEY: Record<PulseSection, TranslationKey> = {
  attention: "pulse.section.attention",
  floor: "pulse.section.floor",
  people: "pulse.section.people",
  stations: "pulse.section.stations",
  sales: "pulse.section.sales",
  catering: "pulse.section.catering",
  inventory: "pulse.section.inventory",
  food_safety: "pulse.section.food_safety",
  handoff: "pulse.section.handoff",
};

export const STATUS_KEY: Record<FloorStatus, TranslationKey> = {
  covered: "pulse.status.covered",
  short: "pulse.status.short",
  closing_soon: "pulse.status.closing_soon",
  uncovered: "pulse.status.uncovered",
  closed: "pulse.status.closed",
  inactive: "pulse.status.inactive",
};

/** Chip classes: surface + its AA text role. */
export const STATUS_CHIP: Record<FloorStatus, string> = {
  covered: "bg-co-success-surface text-co-confirm-text",
  short: "bg-co-warning-surface text-co-warning-text",
  closing_soon: "bg-co-warning-surface text-co-warning-text",
  uncovered: "bg-co-danger-surface text-co-cta-text",
  closed: "bg-co-surface-2 text-co-text-dim",
  inactive: "bg-co-surface-2 text-co-text-dim",
};

/** Raw colours for SVG / three.js fills (the same brand status roles). */
export const STATUS_FILL: Record<FloorStatus, string> = {
  covered: "#28B25C",
  short: "#F59E0B",
  closing_soon: "#F59E0B",
  uncovered: "#FF3A44",
  closed: "#CBD5E1",
  inactive: "#E2E8F0",
};

export function sectionHref(section: PulseSection, locationId: string): string {
  return `/mid-shift/${section}?location=${encodeURIComponent(locationId)}`;
}

export const pulseCard = "co-card min-w-0 p-4";
export const subHeading = "mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
export const tapLink = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 text-sm font-semibold text-co-text underline underline-offset-2";
