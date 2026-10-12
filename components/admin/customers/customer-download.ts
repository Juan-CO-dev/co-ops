import type { CustomerListParams } from "@/lib/customers/list-params-shared";
import { STEP_UP_CODES } from "./customer-post";

type ExportPayload = { kind: "marketing_email" | "meta_audience" } | { kind: "marketing_segment"; params: CustomerListParams };

export async function downloadCustomerExport(payload: ExportPayload, requestStepUp: (tier: "B") => Promise<"ok" | "cancelled">): Promise<{ ok: true; count: number } | { ok: false; code?: string } | null> {
  if (await requestStepUp("B") !== "ok") return null;
  const post = () => fetch("/api/admin/customers/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  let response = await post();
  if (!response.ok) {
    const body = await response.clone().json().catch(() => ({})) as { code?: string };
    if (STEP_UP_CODES.has(body.code ?? "") && await requestStepUp("B") === "ok") response = await post();
  }
  if (!response.ok || response.redirected) {
    const body = await response.json().catch(() => ({})) as { code?: string };
    return { ok: false, code: body.code };
  }
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "export.csv";
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  } finally { URL.revokeObjectURL(url); }
  return { ok: true, count: Number(response.headers.get("x-row-count") ?? 0) };
}
