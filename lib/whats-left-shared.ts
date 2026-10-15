/** Client-safe projection of required, unentered work in template order. */
export interface WhatsLeftTemplateItem {
  id: string;
  sectionId: string;
  label: string;
  required: boolean;
  minRoleLevel: number;
  targetField: string;
}
export interface WhatsLeftEntry {
  itemId: string;
  sectionId: string;
  label: string;
  targetField: string;
}
export interface WhatsLeftResult {
  left: WhatsLeftEntry[];
  needsHigherRole: WhatsLeftEntry[];
}

export function whatsLeft(
  template: readonly WhatsLeftTemplateItem[],
  state: Readonly<Record<string, boolean>>,
  role: number,
): WhatsLeftResult {
  const result: WhatsLeftResult = { left: [], needsHigherRole: [] };
  for (const item of template) {
    if (!item.required || state[item.id] === true) continue;
    const entry = { itemId: item.id, sectionId: item.sectionId, label: item.label, targetField: item.targetField };
    (item.minRoleLevel > role ? result.needsHigherRole : result.left).push(entry);
  }
  return result;
}
