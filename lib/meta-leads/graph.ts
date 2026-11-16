import "server-only";
import { createHmac } from "node:crypto";
import { META_GRAPH_API_VERSION } from "@/lib/landing/meta-version-shared";
import { readBoundedBytes } from "./request";

export type MetaGraphError = "configuration" | "graph_auth" | "graph_rate_limit" | "graph_timeout" | "graph_unavailable" | "graph_not_found" | "invalid_payload";
/** `adset_id` is a documented Lead-node field (Marketing API Lead reference); the worker's delivery routing rule (b) maps it through the tenant ad-set table. */
export interface MetaGraphLead { id: string; form_id?: string; ad_id?: string; adset_id?: string; created_time?: string; field_data: unknown[]; custom_disclaimer_responses?: unknown }
/** Item 1 (P2-5): ad ids are attribution, not identity — kept only as 1–30 digits, otherwise LEFT OUT (never a refusal). */
const adRef = (value: unknown): string | undefined => typeof value === "string" && /^\d{1,30}$/.test(value) ? value : undefined;
export async function fetchMetaLead(expected: { leadgenId: string; formId?: string | null },
  dependencies: { pageToken: string; appSecret: string; send?: typeof fetch }): Promise<{ ok: true; lead: MetaGraphLead } | { ok: false; error: MetaGraphError }> {
  const fail = (error: MetaGraphError): { ok: false; error: MetaGraphError } => ({ ok: false, error });
  if (!/^\d{1,30}$/.test(expected.leadgenId) || !dependencies.pageToken || !dependencies.appSecret) return fail("configuration");
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${expected.leadgenId}`);
  url.searchParams.set("fields", "id,created_time,form_id,ad_id,adset_id,field_data,custom_disclaimer_responses");
  url.searchParams.set("appsecret_proof", createHmac("sha256", dependencies.appSecret).update(dependencies.pageToken).digest("hex"));
  try {
    const response = await (dependencies.send ?? fetch)(url, {
      headers: { Authorization: `Bearer ${dependencies.pageToken}` }, signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store",
    });
    if (!response.ok) {
      // Graph commonly returns HTTP 400 for expired tokens and quota errors.
      // Consume only a bounded body and emit the closed code, never provider text.
      const errorBody = await readBoundedBytes(response);
      if (errorBody.ok) {
        try {
          const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(errorBody.bytes)) as { error?: { code?: unknown } };
          const code = payload?.error?.code;
          if (code === 190 || code === 102 || code === 10 || code === 200) return fail("graph_auth");
          if (code === 4 || code === 17 || code === 32 || code === 613) return fail("graph_rate_limit");
          if (code === 100) return fail("graph_not_found");
        } catch { /* Provider text is intentionally discarded. */ }
      }
      return fail(response.status === 401 || response.status === 403 ? "graph_auth" : response.status === 429 ? "graph_rate_limit" : response.status === 404 ? "graph_not_found" : "graph_unavailable");
    }
    const body = await readBoundedBytes(response);
    if (!body.ok) return fail("invalid_payload");
    let lead: unknown;
    try { lead = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); } catch { return fail("invalid_payload"); }
    if (!lead || typeof lead !== "object" || Array.isArray(lead)) return fail("invalid_payload");
    const value = lead as Record<string, unknown>;
    // Identity stays strict (lead id, form, field_data, created_time). The ad ids are normalized below.
    if (value.id !== expected.leadgenId || !Array.isArray(value.field_data)
      || (expected.formId && value.form_id !== expected.formId)
      || (value.form_id !== undefined && typeof value.form_id !== "string")
      || (value.created_time !== undefined && (typeof value.created_time !== "string" || value.created_time.length > 40 || !Number.isFinite(Date.parse(value.created_time))))) return fail("invalid_payload");
    const adId = adRef(value.ad_id), adsetId = adRef(value.adset_id);
    return { ok: true, lead: { id: expected.leadgenId, field_data: value.field_data,
      ...(typeof value.form_id === "string" ? { form_id: value.form_id } : {}), ...(adId ? { ad_id: adId } : {}), ...(adsetId ? { adset_id: adsetId } : {}),
      ...(typeof value.created_time === "string" ? { created_time: value.created_time } : {}), custom_disclaimer_responses: value.custom_disclaimer_responses } };
  } catch (error) { return fail(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "graph_timeout" : "graph_unavailable"); }
}
