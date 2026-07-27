/**
 * The Master List — needs-link queue, CLIENT-SAFE shared surface (pure
 * classifier + types; ZERO I/O, no server imports). Split so the hub client
 * (NeedsLinkQueue.tsx) imports the type + classifier without dragging the
 * service-role loader into the client bundle (the *-shared law).
 *
 * The item-line law (spec §2): an item-shaped line (a count line) MUST reference
 * a master-list item or SKU. Existing unlinked count lines are surfaced here for
 * in-place linking — never force-migrated.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-26-master-list-taxonomy-design.md
 */

/** The facts the pure classifier reasons over (one template item row). */
export interface NeedsLinkInput {
  /** true = a count line (item-shaped). */
  expectsCount: boolean;
  /** the linked registry item, if any. */
  itemId: string | null;
  /** the linked SKU (vendor_item), if any. */
  vendorItemId: string | null;
}

/**
 * A template item "needs link" when it is item-shaped (expects_count) yet
 * references NEITHER a registry item NOR a SKU (spec §2). Pure — the caller
 * pre-filters to active lines on active templates.
 */
export function needsLink(e: NeedsLinkInput): boolean {
  return e.expectsCount && e.itemId === null && e.vendorItemId === null;
}

/** One row rendered in the needs-link queue (a line awaiting a picker link). */
export interface NeedsLinkRow {
  /** checklist_template_items.id — the EXISTING row we link in place. */
  lineId: string;
  templateId: string;
  templateName: string;
  /** checklist_templates.type (opening/closing/prep/deep_cleaning…). */
  templateType: string;
  /** the line's current free-text label (preserved on link). */
  label: string;
  section: string | null;
  locationId: string | null;
  locationName: string | null;
}

/** A pickable target for a needs-link row (an item or a SKU). */
export interface LinkTarget {
  kind: "item" | "sku";
  id: string;
  name: string;
  /** taxonomy label for the type badge in the picker. */
  typeLabel: string;
}
