import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { VendorMailPane, releaseRefusedVendorMailRequest } from "@/app/(authed)/operations/vendor-mail/VendorMailPane";
import { TranslationProvider } from "@/lib/i18n/provider";
import { adminSectionsFor } from "@/lib/admin/sections";
import { vendorMailForwardAcknowledged, vendorMailHasUnknownForward, vendorMailRoleAllowed, VENDOR_MAIL_STATUSES, VENDOR_MAIL_CONTENT_STATES } from "@/lib/vendor-mail-shared";
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

it("a confirmed stale refusal releases routine and Forward intents; uncertain retries retain identity", () => {
  const request = { requestId: "original-id", revision: 2 };
  const requests = new Map([["assign", request], ["forward", request], ["other", request]]);
  releaseRefusedVendorMailRequest(requests, "assign", "assign", "internal_error");
  expect(requests.get("assign")).toBe(request);
  releaseRefusedVendorMailRequest(requests, "forward", "forward", "stale_revision");
  expect(requests.has("forward")).toBe(false);
  releaseRefusedVendorMailRequest(requests, "assign", "assign", "stale_revision");
  expect(requests.has("assign")).toBe(false);
  expect(requests.get("other")).toBe(request);
  const source = readFileSync("app/(authed)/operations/vendor-mail/VendorMailPane.tsx", "utf8");
  expect(source).toContain("if (!response.ok) { releaseRefusedVendorMailRequest(requests.current, identity, action, data.code)");
  expect(source).toContain("expected_revision: request.revision, request_id: request.requestId");
});

it("a single ambiguous receiving candidate displays invoice identity and the pick prompt", async () => {
  const { VendorClaimPanel } = await import("@/components/receiving/VendorClaimPanel");
  const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(VendorClaimPanel, {
    deliveryId: "B", locationId: "shop", actorLevel: 4, receipt: null, countedSummary: [], matchState: "unmatched",
    invoiceCandidates: [{ id: "r1", subject: "Invoice subject", fromAddress: "vendor@company.test", receivedAt: "2026-11-11T12:00:00Z", invoiceNumber: "INV-42", totalCents: 12345 }],
  }) }));
  for (const value of [en["receiving.claim.pick_invoice"], "INV-42", "123.45", "Invoice subject", "vendor@company.test"]) expect(html).toContain(value);
});

it("unknown Forward stays blocked until its exact claim is acknowledged; history stays intact", () => {
  const unknown = { event_type: "forward_result", data: { outcome: "unknown", claim_request_id: "claim-1" } };
  const ack = { event_type: "baseline", data: { forward_acknowledged_claim_request_id: "claim-1", allow_new_forward: true } };
  expect(vendorMailHasUnknownForward([unknown])).toBe(true);
  expect(vendorMailHasUnknownForward([unknown, { ...ack, data: { ...ack.data, allow_new_forward: false } }])).toBe(true);
  expect(vendorMailHasUnknownForward([unknown, ack])).toBe(false);
  expect(vendorMailForwardAcknowledged([ack], "claim-1")).toBe(true);
  expect(vendorMailForwardAcknowledged([ack], "other")).toBe(false);
  expect(vendorMailHasUnknownForward([unknown, ack, { ...unknown, data: { ...unknown.data, claim_request_id: "other" } }])).toBe(true);
  const source = readFileSync("app/(authed)/operations/vendor-mail/VendorMailPane.tsx", "utf8");
  expect(source).toContain('{unresolvedForward && <p role="alert" className="text-red-700">{t("vendorMail.forward.unknown")}</p>}');
});
