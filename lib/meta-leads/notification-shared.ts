/** Notification identities only: provider replay defense is the leadgen_id primary key. */
export interface MetaNotification { leadgenId: string; pageId: string; formId: string; createdAt: string }
const id = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseMetaNotifications(value: unknown): MetaNotification[] | null {
  if (!object(value) || value.object !== "page" || !Array.isArray(value.entry) || value.entry.length > 100) return null;
  const result: MetaNotification[] = [];
  for (const entry of value.entry) {
    if (!object(entry) || !id(entry.id) || !Array.isArray(entry.changes) || entry.changes.length > 100) return null;
    for (const change of entry.changes) {
      if (!object(change)) return null;
      if (change.field !== "leadgen") continue;
      const v = change.value;
      if (!object(v) || !id(v.leadgen_id) || !id(v.form_id) || !id(v.page_id) || v.page_id !== entry.id
        || typeof v.created_time !== "number" || !Number.isSafeInteger(v.created_time) || v.created_time < 0 || v.created_time > 253402300799) return null;
      result.push({ leadgenId: v.leadgen_id, pageId: v.page_id, formId: v.form_id, createdAt: new Date(v.created_time * 1000).toISOString() });
      if (result.length > 100) return null;
    }
  }
  return result;
}
/** Explicit Page/form allowlist. Real field keys and language must be checked before enabling. */
export function metaFormConfig(raw: string | undefined, pageId: string, formId: string): { language: "en" | "es" } | null {
  try {
    const entries: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(entries) || entries.length > 100) return null;
    const matched = entries.filter(v => object(v) && v.pageId === pageId && v.formId === formId);
    if (matched.length !== 1 || !object(matched[0]) || !["en", "es"].includes(String(matched[0].language))) return null;
    return { language: matched[0].language as "en" | "es" };
  } catch { return null; }
}
