import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { VendorMailPane, releaseRefusedVendorMailRequest } from "@/app/(authed)/operations/vendor-mail/VendorMailPane";
import { TranslationProvider } from "@/lib/i18n/provider";
import { adminSectionsFor } from "@/lib/admin/sections";
import { vendorMailRoleAllowed, VENDOR_MAIL_STATUSES, VENDOR_MAIL_CONTENT_STATES } from "@/lib/vendor-mail-shared";
import { ROLES } from "@/lib/roles";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { listVendorMail } from "@/lib/vendor-mail";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: Awaited<ReturnType<typeof listVendorMail>> = {
  messages: [{ id: "message", reference_code: "VM-42", revision: 1, received_at: "2026-11-01T15:00:00Z", from_address: "supplier@example.test", subject: "Invoice <script>bad()</script>", location_id: "shop", vendor_id: "vendor", content_state: "fetched", status: "failed", last_error: "PROVIDER_SECRET_DIAGNOSTIC", email_receipt_id: "receipt", handled_by: null, handled_at: null, handled_reason: null, archive_state: "incomplete", archive_error: "storage", attachment_count: 2, parse_state: "failed", failure_code: "api_error", linked_po_id: null, linked_delivery_id: null, attribution_conflict: false, stale: true }],
  reconciliation: { kind: "local_breakdown", scope: "authorized_shop_and_date_filters", total: 1, stale_count: 1, content_states: { pending: 0, fetched: 1, failed: 0, blocked_config: 0, skipped: 0 }, provider_comparison: "not_performed" },
};
for (const language of ["en", "es"] as const) {
  it(`renders safe identity, failures, all filters and local scope in ${language}`, () => {
    const dict = language === "en" ? en : es;
    const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(VendorMailPane, {
      initial, options: { shops: [{ id: "shop", name: "My shop" }], vendors: [{ id: "vendor", name: "My vendor" }], staff: [] }, filters: { location: "all", vendor: "", status: "", from: "", to: "", search: "", stale: false }, forwardEnabled: false, level: 7,
    }) }));
    expect(html).toContain("VM-42"); expect(html).toContain("My shop"); expect(html).toContain("My vendor");
    for (const key of ["stale", "archive_incomplete", "scope", "breakdown", "failure.api_error"] as const) expect(html).toContain(dict[`vendorMail.${key}`]);
    for (const name of ["location", "vendor", "status", "from", "to", "search", "stale"]) expect(html).toContain(`name="${name}"`);
    expect(html).not.toContain("PROVIDER_SECRET_DIAGNOSTIC"); expect(html).not.toContain("<script>");
    expect(html).not.toContain("vendorMail."); expect(html).not.toContain('value="unassigned"');
    expect(html).toContain("min-h-[44px]"); expect(html).toContain("items-center");
  });
}
it("hub gate agrees with the role contract, not just level", () => {
  for (const [role, info] of Object.entries(ROLES)) expect(adminSectionsFor(info.level, role as keyof typeof ROLES).some(section => section.id === "vendor-mail"), role).toBe(vendorMailRoleAllowed(role));
});
it("every vendor-mail key and interpolation ships in both languages", () => {
  const a = en as Record<string, string>, b = es as Record<string, string>;
  const keys = Object.keys(a).filter(key => key.startsWith("vendorMail."));
  expect(keys.length).toBeGreaterThan(100);
  for (const key of keys) { expect(b[key], key).toBeTruthy(); expect(b[key]?.match(/\{\w+\}/g) ?? [], key).toEqual(a[key]?.match(/\{\w+\}/g) ?? []); }
  for (const status of VENDOR_MAIL_STATUSES) expect(a[`vendorMail.status.${status}`]).toBeTruthy();
  for (const state of VENDOR_MAIL_CONTENT_STATES) expect(a[`vendorMail.content.${state}`]).toBeTruthy();
});
it("drawer uses counted disclosures, safe downloads, retained drafts and original PO route", () => {
  const source = readFileSync("app/(authed)/operations/vendor-mail/VendorMailPane.tsx", "utf8");
  expect(source).not.toMatch(/<details|dangerouslySetInnerHTML|last_error|archive_error|localStorage/);
  expect(source).toContain("<CollapsibleSection"); expect(source).toContain("count={t(");
  expect(source).toContain("opener.current?.focus()"); expect(source).toContain("drafts.current.get(id)");
  expect(source).toContain("/attachments/${assetId}"); expect(source).toContain("/ordering?po=");
  expect(source).toContain("forwardEnabled ?"); expect(source).toContain("level >= 8 && <button");
  expect(source).toContain("staffRecipient?.email"); expect(source).toContain("historyExtra(event)");
});

it("a confirmed stale routine refusal releases only that intent; uncertain and Forward retries keep their original key", () => {
  const request = { requestId: "original-id", revision: 2 };
  const requests = new Map([["assign", request], ["forward", request], ["other", request]]);
  releaseRefusedVendorMailRequest(requests, "assign", "assign", "internal_error");
  expect(requests.get("assign")).toBe(request);
  releaseRefusedVendorMailRequest(requests, "forward", "forward", "stale_revision");
  expect(requests.get("forward")).toBe(request);
  releaseRefusedVendorMailRequest(requests, "assign", "assign", "stale_revision");
  expect(requests.has("assign")).toBe(false);
  expect(requests.get("other")).toBe(request);
  const source = readFileSync("app/(authed)/operations/vendor-mail/VendorMailPane.tsx", "utf8");
  expect(source).toContain("if (!response.ok) { releaseRefusedVendorMailRequest(requests.current, identity, action, data.code)");
  expect(source).toContain("expected_revision: request.revision, request_id: request.requestId");
});
