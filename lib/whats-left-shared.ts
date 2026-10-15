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

/** Opening Phase 1 counts each entered reading and the station verify action separately. */
export function openingPhase1StationWork(
  station: string,
  items: readonly { id: string; label: string; required: boolean; minRoleLevel: number; readingRequired: boolean; readingEntered: boolean }[],
  verified: boolean,
  verifyLabel: string,
): { template: WhatsLeftTemplateItem[]; state: Record<string, boolean>; progress: { id: string; done: number; total: number } } {
  const template: WhatsLeftTemplateItem[] = [];
  const state: Record<string, boolean> = {};
  for (const item of items) {
    if (!item.required || !item.readingRequired) continue;
    template.push({ id: item.id, sectionId: station, label: item.label, required: true,
      minRoleLevel: item.minRoleLevel, targetField: "primary" });
    state[item.id] = item.readingEntered;
  }
  const verifyId = `station:${station}`;
  template.push({ id: verifyId, sectionId: station, label: verifyLabel,
    required: true, minRoleLevel: Math.max(...items.map((item) => item.minRoleLevel)), targetField: "primary" });
  state[verifyId] = verified;
  return { template, state, progress: { id: station, done: Object.values(state).filter(Boolean).length, total: template.length } };
}
