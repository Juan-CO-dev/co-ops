/**
 * B5 · Catering fix batch (guide testing round 1, issues #32–#40).
 * Pure helpers are unit-tested; UI/route wiring is pinned by source shape.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewQueueScope } from "@/lib/catering/ezcater-reconciliation-shared";
import {
  appendLines,
  isUntouchedBlankLine,
  leadOptionLabel,
  mapQuoteParties,
  prefillFromLead,
  shouldLinkLead,
  type DraftLineLike,
  type QuoteLeadOption,
} from "@/lib/catering/quotes-shared";
import { leadEditPatch, type LeadEditable } from "@/lib/catering/pipeline-shared";
import { sourceCountKey } from "@/lib/catering/insights-shared";
import { customerLeadsFilter } from "@/lib/catering/customers";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const src = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const enKeys = en as Record<string, string>;
const esKeys = es as Record<string, string>;

describe("#32 ezCater review queue scope (candidates is jsonb)", () => {
  it("a house lead filters candidates by a JSON array literal with cs", () => {
    expect(reviewQueueScope(null, "lead-1")).toEqual({ kind: "candidate", column: "candidates", op: "cs", value: '["lead-1"]' });
  });
  it("an ezCater lead reads its order snapshot", () => {
    expect(reviewQueueScope({ id: "o", snapshot_id: "s" }, "lead-1")).toEqual({ kind: "order", orderId: "o", snapshotId: "s" });
  });
  it("the loader no longer sends a Postgres array literal to the jsonb column, and logs the read error", () => {
    const loader = src("lib/catering/ezcater-reconciliation.ts");
    expect(loader).not.toMatch(/\.contains\(\s*"candidates"\s*,\s*\[/);
    expect(loader).toContain("reviewQueueScope(");
    expect(loader).toMatch(/console\.error\(`\[ezcater-reconciliation\] review read failed/);
  });
});

describe("#33 no W4b developer text on Prep Demand", () => {
  it("the sub_note key is gone from en and es, and the client never mentions W4b", () => {
    expect(enKeys["admin.catering.prep_demand.sub_note"]).toBeUndefined();
    expect(esKeys["admin.catering.prep_demand.sub_note"]).toBeUndefined();
    const client = src("components/admin/catering/prep-demand/PrepDemandClient.tsx");
    expect(client).not.toContain("prep_demand.sub_note");
    // No visible copy may carry the W-era label (comments in code may).
    const visible = [enKeys, esKeys].flatMap((m) => Object.entries(m).filter(([k]) => k.startsWith("admin.catering.prep_demand.")).map(([, v]) => v));
    expect(visible.filter((v) => /W4[ab]?/.test(v))).toEqual([]);
  });
});

describe("#34 quote save links the lead; customer page lists quotes", () => {
  it("shouldLinkLead links only a customer-less lead named by a quote with a customer", () => {
    expect(shouldLinkLead({ pipelineId: "l", customerId: "c", leadCustomerId: null })).toBe(true);
    expect(shouldLinkLead({ pipelineId: "l", customerId: "c", leadCustomerId: undefined })).toBe(true);
    expect(shouldLinkLead({ pipelineId: "l", customerId: "c", leadCustomerId: "other" })).toBe(false);
    expect(shouldLinkLead({ pipelineId: "l", customerId: "c", leadCustomerId: "c" })).toBe(false);
    expect(shouldLinkLead({ pipelineId: null, customerId: "c", leadCustomerId: null })).toBe(false);
    expect(shouldLinkLead({ pipelineId: "l", customerId: null, leadCustomerId: null })).toBe(false);
  });
  it("the writer is null-only, rowcount-checked, audited, and runs on create and revise", () => {
    const quotes = src("lib/catering/quotes.ts");
    const fn = quotes.slice(quotes.indexOf("async function linkLeadToCustomer"), quotes.indexOf("/** Create a draft quote (v1)"));
    expect(fn).toMatch(/\.update\(\{ customer_id: customer\.id[^}]*\}, \{ count: "exact" \}\)/);
    expect(fn).toContain('.is("customer_id", null)');
    expect(fn).toContain("if (uErr)");
    expect(fn).toContain('action: "catering.pipeline.edit"');
    expect(fn).toContain("lockLocationContext(locActor(actor), lead.location_id)");
    expect(fn).toContain("if (!customer.active) return;");
    expect(quotes).toContain('context: "quote_create"');
    expect(quotes).toContain('context: "quote_revise"');
  });
  it("customer leads = linked leads, plus customer-less leads one of its quotes names", () => {
    expect(customerLeadsFilter("c1", [])).toBe("customer_id.eq.c1");
    expect(customerLeadsFilter("c1", ["l1", "l2", "l1"])).toBe("customer_id.eq.c1,and(id.in.(l1,l2),customer_id.is.null)");
  });
  it("the customer detail route returns quotes and the client renders them in en and es", () => {
    expect(src("app/api/catering/customers/[id]/route.ts")).toContain("quotes: detail.quotes");
    const client = src("components/catering/customers/CustomersClient.tsx");
    expect(client).toContain('t("catering.customers.history.quotes")');
    expect(client).toContain("detail.quotes.map");
    expect(enKeys["catering.customers.history.quotes"]).toBe("Quotes");
    expect(esKeys["catering.customers.history.quotes"]).toBe("Cotizaciones");
    for (const s of ["draft", "submitted", "sent", "accepted", "declined", "expired"]) {
      expect(enKeys[`catering.quotes.status.${s}`]).toBeTruthy();
      expect(esKeys[`catering.quotes.status.${s}`]).toBeTruthy();
    }
  });
});

describe("#35 saved quote shows client and lead", () => {
  it("mapQuoteParties is a whitelist: no phone, address or notes ever ride along", () => {
    const parties = mapQuoteParties(
      { id: "c", name: "Ana", company: "Acme", email: "ana@example.com", phone: "555", notes: "x" } as never,
      { id: "l", contact_name: "Ana", company: "Acme", event_date: "2026-10-20", contact_phone: "555", delivery_address: "1 Main" } as never,
    );
    expect(parties).toEqual({
      client: { id: "c", name: "Ana", company: "Acme", email: "ana@example.com" },
      lead: { id: "l", contactName: "Ana", company: "Acme", eventDate: "2026-10-20" },
      clientHidden: false,
    });
    expect(mapQuoteParties(null, null)).toEqual({ client: null, lead: null, clientHidden: false });
    // option b: a hidden client is flagged, never shown; a shown client is never "hidden"
    expect(mapQuoteParties(null, null, true)).toEqual({ client: null, lead: null, clientHidden: true });
  });
  it("the GET route reads the parties after the loadQuote gate and the panel renders them", () => {
    const route = src("app/api/catering/quotes/[id]/route.ts");
    expect(route.indexOf("loadQuoteParties(ctx, detail.quote)")).toBeGreaterThan(route.indexOf("if (!detail) return jsonError(404"));
    // The refusal a cross-shop client gets on create/revise is a known, translated code.
    expect(src("components/catering/quotes/shared.ts")).toContain('"invalid_customer"');
    expect(enKeys["catering.quotes.error.invalid_customer"]).toBeTruthy();
    expect(esKeys["catering.quotes.error.invalid_customer"]).toBeTruthy();
    expect(route).toContain("client: parties.client, lead: parties.lead, clientHidden: parties.clientHidden");
    const client = src("components/catering/quotes/QuotesClient.tsx");
    expect(client).toContain('t("catering.quotes.client")');
    expect(client).toContain('t("catering.quotes.lead")');
    for (const k of ["catering.quotes.client", "catering.quotes.lead"]) {
      expect(enKeys[k]).toBeTruthy();
      expect(esKeys[k]).toBeTruthy();
    }
  });
});

describe("#36 a lead can be edited", () => {
  const lead: LeadEditable = { contactName: "Ana", company: "Acme", eventDate: "2026-10-20", headcount: 20, followUpDate: null, notes: "hi\r\n--- ezCater order (auto) ---\nx\n--- end ezCater ---" };
  const form = { contactName: "Ana", company: "Acme", eventDate: "2026-10-20", headcount: "20", followUpDate: "", notes: "hi\n--- ezCater order (auto) ---\nx\n--- end ezCater ---" };
  it("an untouched form sends nothing (and never rewrites the machine notes block)", () => {
    expect(leadEditPatch(lead, form)).toEqual({ ok: true, patch: {} });
  });
  it("sends only the changed fields, clearing empty text to null", () => {
    expect(leadEditPatch(lead, { ...form, company: " ", headcount: "25", followUpDate: "2026-10-15", notes: "new note" })).toEqual({
      ok: true,
      patch: { company: null, headcount: 25, followUpDate: "2026-10-15", notes: "new note" },
    });
    expect(leadEditPatch(lead, { ...form, headcount: "" })).toEqual({ ok: true, patch: { headcount: null } });
  });
  it("refuses an empty contact name and a bad headcount", () => {
    expect(leadEditPatch(lead, { ...form, contactName: "  " })).toEqual({ ok: false, field: "contactName" });
    expect(leadEditPatch(lead, { ...form, headcount: "2.5" })).toEqual({ ok: false, field: "headcount" });
    expect(leadEditPatch(lead, { ...form, headcount: "-1" })).toEqual({ ok: false, field: "headcount" });
  });
  it("the board has the gated disclosure; phone joined in D-48, still no email field (no lead email column)", () => {
    const client = src("components/catering/pipeline/PipelineClient.tsx");
    expect(client).toContain("{canWrite && <EditLeadDetails lead={lead} />}");
    const form = client.slice(client.indexOf("function EditLeadDetails"), client.indexOf("// ── Add-lead form"));
    expect(form).toContain("aria-expanded={open}");
    expect(form).toContain("leadEditPatch(lead,");
    expect(form).toContain('name="contactPhone" type="tel"');
    expect(form).not.toMatch(/name="(contactEmail|email)"/);
    for (const k of ["catering.pipeline.edit_details", "catering.pipeline.save", "catering.pipeline.saving"]) {
      expect(enKeys[k]).toBeTruthy();
      expect(esKeys[k]).toBeTruthy();
    }
  });
});

describe("#37 no empty starter line under a package", () => {
  const line = (over: Partial<DraftLineLike> & { key: string }): DraftLineLike & { key: string } => ({
    description: "", unitPrice: "", itemId: null, menuItemId: null, packageId: null, ...over,
  });
  it("drops untouched blank lines before appending", () => {
    const blank = line({ key: "b" });
    const pkg = [line({ key: "p1", description: "Box lunch", unitPrice: "12", packageId: "pkg" })];
    expect(appendLines([blank], pkg).map((l) => l.key)).toEqual(["p1"]);
  });
  it("keeps a line the manager typed in", () => {
    const typed = line({ key: "t", description: "Cookies" });
    const priced = line({ key: "pr", unitPrice: "5" });
    expect(appendLines([typed, priced], [line({ key: "n", description: "Chips" })]).map((l) => l.key)).toEqual(["t", "pr", "n"]);
    expect(isUntouchedBlankLine(line({ key: "x", itemId: "i" }))).toBe(false);
  });
  it("appending nothing changes nothing", () => {
    const blank = line({ key: "b" });
    expect(appendLines([blank], [])).toEqual([blank]);
  });
  it("the builder uses it for packages and menu items", () => {
    const client = src("components/catering/quotes/QuotesClient.tsx");
    expect(client).toContain("setLines((prev) => appendLines(prev, newLines));");
    expect(client).toContain("setLines((prev) => appendLines(prev, [line]));");
  });
});

describe("#38 the lead prefills the quote", () => {
  const lead: QuoteLeadOption = { id: "l", contactName: "Ana", company: "Acme", eventDate: "2026-10-20", headcount: 20, locationId: "shop-b", locationName: "P Street" };
  const empty = { contactName: "", contactCompany: "", eventDate: "", headcount: "", locationId: "shop-a" };
  it("fills empty fields and moves to the lead's shop", () => {
    expect(prefillFromLead(empty, lead, ["shop-a", "shop-b"])).toEqual({
      contactName: "Ana", contactCompany: "Acme", eventDate: "2026-10-20", headcount: "20", locationId: "shop-b",
    });
  });
  it("never overwrites a typed value", () => {
    const typed = { contactName: "Bo", contactCompany: "Beta", eventDate: "2026-11-01", headcount: "8", locationId: "shop-a" };
    expect(prefillFromLead(typed, lead, ["shop-a", "shop-b"])).toEqual({ ...typed, locationId: "shop-b" });
  });
  it("keeps the shop when the lead's shop is not offered, and nulls stay empty", () => {
    const bare: QuoteLeadOption = { ...lead, company: null, eventDate: null, headcount: null, locationId: "elsewhere" };
    expect(prefillFromLead(empty, bare, ["shop-a"])).toEqual({ ...empty, contactName: "Ana" });
  });
});

describe("#39 lead dropdown labels", () => {
  it("contact · company · date · shop, skipping blanks", () => {
    const fmt = (d: string) => `D(${d})`;
    expect(leadOptionLabel({ id: "l", contactName: "Ana", company: "Acme", eventDate: "2026-10-20", headcount: null, locationId: "x", locationName: "P Street" }, fmt))
      .toBe("Ana · Acme · D(2026-10-20) · P Street");
    expect(leadOptionLabel({ id: "l", contactName: "Ana", company: null, eventDate: null, headcount: null, locationId: null, locationName: null }, fmt)).toBe("Ana");
  });
  it("the builder renders it and the page passes the shop name", () => {
    expect(src("components/catering/quotes/QuotesClient.tsx")).toContain("leadOptionLabel(l, (d) => formatDateLabel(d, language))");
    expect(src("app/(authed)/catering/quotes/page.tsx")).toContain("locationName: l.locationName");
  });
});

describe("#40 catering copy", () => {
  it("source count uses _one/_other in en and es", () => {
    expect(sourceCountKey(1)).toBe("catering.insights.source_count_one");
    expect(sourceCountKey(0)).toBe("catering.insights.source_count_other");
    expect(sourceCountKey(3)).toBe("catering.insights.source_count_other");
    expect(enKeys["catering.insights.source_count_one"]).toBe("1 source");
    expect(enKeys["catering.insights.source_count_other"]).toBe("{n} sources");
    expect(esKeys["catering.insights.source_count_one"]).toBe("1 origen");
    expect(esKeys["catering.insights.source_count_other"]).toBe("{n} orígenes");
    expect(enKeys["catering.insights.source_count"]).toBeUndefined();
    expect(esKeys["catering.insights.source_count"]).toBeUndefined();
  });
  it("hub says completed; the setup sub-line no longer promises pricing to a GM", () => {
    expect(enKeys["catering.hub.pipeline_desc"]).toBe("Leads from inquiry to completed.");
    expect(esKeys["catering.hub.pipeline_desc"]).toContain("completado");
    expect(enKeys["admin.catering.subtitle"]).not.toMatch(/pricing/i);
    expect(esKeys["admin.catering.subtitle"]).not.toMatch(/precios/i);
  });
});
