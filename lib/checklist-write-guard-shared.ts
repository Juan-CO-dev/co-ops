import { SHOP_TASK_ALL_LOCATIONS_LEVEL } from "./locations";

/** R7 policy floor only. Existing assignment, PIN, item validation and hard gates
 * remain additional app requirements; these predicates do not replace them. */
export interface ChecklistWriteAuthority {
  readonly userId: string;
  readonly level: number;
  readonly active: boolean;
  readonly locations: readonly string[];
}

export interface ChecklistWriteTarget {
  locationId: string;
  status: string;
  templateType: string;
  itemMinRoleLevel: number;
  itemActive: boolean;
  itemMatchesTemplate: boolean;
  reportReferenceType: string | null;
  refTrackItemCompletion: boolean;
  referencesTemplateItemId: string | null;
}

/**
 * Audit W05B (Juan 2026-11-15: "we routinely do tasks at the shops depending on what's needed and
 * who is available"): the shop rule of every checklist task writer — getOrCreateInstance's create
 * branch, completeItem, submitBatch, confirmInstance — and of the closing page's write UI. An ACTIVE
 * actor who is an active member of the shop (`locations` holds active memberships only), or level 8+
 * (MoO, owner, CGS) at any shop with no membership row. Below level 8 the membership stays required.
 * The correction writers (requireCorrectionShop) and tagActualCompleter apply the same rule; SQL
 * repeats it under the instance lock (checklist_actor_level, 0318).
 */
export function worksShopTasks(actor: ChecklistWriteAuthority, locationId: string): boolean {
  return actor.active && (actor.locations.includes(locationId) || actor.level >= SHOP_TASK_ALL_LOCATIONS_LEVEL);
}

/** The R7 parity model of the pre-0277 PostgREST policies (tests only); not the writer gate. */
function member(actor: ChecklistWriteAuthority | null, target: ChecklistWriteTarget): actor is ChecklistWriteAuthority {
  return actor !== null && actor.active && actor.locations.includes(target.locationId);
}

export function canWriteChecklistCompletion(actor: ChecklistWriteAuthority | null, target: ChecklistWriteTarget): boolean {
  if (!member(actor, target) || target.status !== "open") return false;
  // The old broad policy remains an OR alternative. Inactive/report-reference
  // items are excluded by existing app validation, NOT by that RLS policy.
  const original = actor.level >= target.itemMinRoleLevel;
  const closing = actor.level >= 2 && target.templateType === "closing"
    && target.itemMatchesTemplate && target.itemActive
    && actor.level >= target.itemMinRoleLevel && target.reportReferenceType === null
    && !(target.refTrackItemCompletion && target.referencesTemplateItemId !== null);
  return original || closing;
}

export function canSubmitChecklistBatch(actor: ChecklistWriteAuthority | null, target: ChecklistWriteTarget): boolean {
  return member(actor, target) && target.status === "open";
}

export function canConfirmChecklistInstance(actor: ChecklistWriteAuthority | null, target: ChecklistWriteTarget): boolean {
  return member(actor, target) && target.status === "open" && actor.level >= 3;
}

export function canCreateChecklistInstance(actor: ChecklistWriteAuthority | null, target: ChecklistWriteTarget): boolean {
  return member(actor, target)
    && actor.level >= (["opening", "prep"].includes(target.templateType) ? 4 : 3);
}
