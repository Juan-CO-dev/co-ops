import type { ModifierEffect } from "@/lib/toast/modifiers-shared";

export const EZCATER_CUSTOMIZATION_MAX_EFFECTS = 8;

/** Base mappings accept three entity kinds; SKUs belong to customization effects. */
export function isBaseMappingTarget(target: { kind: string; location_id: string | null }, locationId: string): boolean {
  return target.kind === "item" || target.kind === "menu_item" ||
    (target.kind === "package" && (target.location_id === null || target.location_id === locationId));
}

export interface EzcaterCustomizationDecision {
  decision: "approve" | "ignore";
  effects: ModifierEffect[];
  pickMenuItemId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCustomizationDecision(value: unknown): EzcaterCustomizationDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.decision !== "approve" && input.decision !== "ignore") return null;
  if (!Array.isArray(input.effects) || input.effects.length > EZCATER_CUSTOMIZATION_MAX_EFFECTS) return null;
  const pickMenuItemId = input.pickMenuItemId === null ? null : input.pickMenuItemId;
  if (pickMenuItemId !== null && (typeof pickMenuItemId !== "string" || !UUID.test(pickMenuItemId))) return null;
  const effects: ModifierEffect[] = [];
  for (const raw of input.effects) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const effect = raw as Record<string, unknown>;
    if (!(["item", "sku", "menu_item"] as unknown[]).includes(effect.targetKind) ||
        typeof effect.targetId !== "string" || !UUID.test(effect.targetId) ||
        !(["deplete", "remove"] as unknown[]).includes(effect.disposition) ||
        typeof effect.parentOnly !== "boolean") return null;
    const portionQty = effect.portionQty === null ? null : effect.portionQty;
    const portionUnit = effect.portionUnit === null ? null : effect.portionUnit;
    if (portionQty !== null && (typeof portionQty !== "number" || !Number.isFinite(portionQty) || portionQty <= 0 || portionQty > 10_000)) return null;
    if (portionUnit !== null && (typeof portionUnit !== "string" || !portionUnit.trim() || portionUnit.trim().length > 32)) return null;
    if ((portionQty === null) !== (portionUnit === null)) return null;
    if (effect.targetKind === "sku" && portionUnit !== null && !["oz", "each"].includes(portionUnit.trim())) return null;
    if (effect.targetKind === "menu_item" && portionUnit !== null && portionUnit.trim() !== "whole_sub") return null;
    if (effect.disposition === "deplete" && portionQty === null) return null;
    if (effect.disposition === "remove" && portionQty === null && effect.parentOnly !== true) return null;
    effects.push({
      targetKind: effect.targetKind as ModifierEffect["targetKind"], targetId: effect.targetId,
      disposition: effect.disposition as ModifierEffect["disposition"], portionQty,
      portionUnit: portionUnit?.trim() ?? null, parentOnly: effect.parentOnly,
    });
  }
  if (input.decision === "ignore") return effects.length === 0 && pickMenuItemId === null
    ? { decision: "ignore", effects: [], pickMenuItemId: null } : null;
  if ((effects.length === 0) === (pickMenuItemId === null)) return null;
  return { decision: "approve", effects, pickMenuItemId };
}
