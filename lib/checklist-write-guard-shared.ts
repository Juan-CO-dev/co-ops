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
