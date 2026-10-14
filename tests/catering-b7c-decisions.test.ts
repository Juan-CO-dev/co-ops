/**
 * B7c · Catering owner decisions (Juan, 2026-10-13): D-45 … D-49.
 * Pure helpers are unit-tested here; lib/route behaviour lives in
 * tests/catering-b7c-behaviour.test.ts (in-memory Supabase fake).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEAD_PHONE_MAX,
  leadContactLabel,
  leadEditPatch,
  normalizeLeadPhone,
  showQuoteNotAccepted,
  stageMoveNeedsConfirm,
  LEGAL_TRANSITIONS,
  PIPELINE_STAGES,
} from "@/lib/catering/pipeline-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  expandPackageLines,
  packageHeadcountMultiplier,
  type ExpandablePackage,
} from "@/lib/catering/quotes-shared";

const src = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const enKeys = en as Record<string, string>;
const esKeys = es as Record<string, string>;
const bothLanguages = (key: string) => {
  expect(enKeys[key], `en ${key}`).toBeTruthy();
  expect(esKeys[key], `es ${key}`).toBeTruthy();
  expect(esKeys[key]).not.toBe(enKeys[key]);
};

// ── D-45 · per-head package Qty defaults to the headcount ───────────────────────────────
const lightLunch: ExpandablePackage = {
  id: "pkg-ll",
  labelEn: "Light Lunch",
  pricingMode: "per_head",
  priceCents: 1200,
  items: [{ itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }],
};
const platter16: ExpandablePackage = {
  id: "pkg-16",
  labelEn: "16 pc platter",
  pricingMode: "per_platter",
  priceCents: 11500,
  items: [{ itemId: null, menuItemId: null, label: "Choose your subs", quantity: 16, unitPriceCents: 0 }],
};

describe("D-45 · per-head package Qty = headcount", () => {
  it("the multiplier is the headcount only for a per-head package with a whole headcount > 0", () => {
    expect(packageHeadcountMultiplier("per_head", "20")).toBe(20);
    expect(packageHeadcountMultiplier("per_head", " 7 ")).toBe(7);
    expect(packageHeadcountMultiplier("per_head", "")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "0")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "2.5")).toBe(1);
    expect(packageHeadcountMultiplier("per_head", "abc")).toBe(1);
    expect(packageHeadcountMultiplier("per_platter", "20")).toBe(1);
    expect(packageHeadcountMultiplier("fixed", "20")).toBe(1);
  });

  it("Light Lunch for 20 drops in at Qty 20 (the priced line and the pick line)", () => {
    const lines = expandPackageLines(lightLunch, "20");
    expect(lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["Light Lunch", "20", "12"],
      ["Choose your sub", "20", ""],
    ]);
  });

  it("under a priced package header, the pick lines say they are picks (0251: package tag, no reference)", () => {
    for (const pkg of [lightLunch, platter16]) {
      const [whole, ...picks] = expandPackageLines(pkg, "20");
      expect(whole).toMatchObject({ packageId: pkg.id, itemId: null, menuItemId: null, lineKind: "package_header", componentsListed: true });
      for (const p of picks) {
        expect(p).toMatchObject({ packageId: pkg.id, itemId: null, menuItemId: null, unitPrice: "", lineKind: "package_pick", componentsListed: null });
      }
    }
  });

  it("concrete components keep their reference and the package tag, priced or not (review)", () => {
    const fixed: ExpandablePackage = {
      id: "pkg-fix", labelEn: "Snack pack", pricingMode: "fixed", priceCents: 1500,
      items: [{ itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 }],
    };
    expect(expandPackageLines(fixed, "")).toEqual([
      { description: "Snack pack", quantity: "1", unitPrice: "15", itemId: null, menuItemId: null, packageId: "pkg-fix", lineKind: "package_header", componentsListed: true },
      { description: "Chips", quantity: "1", unitPrice: "", itemId: "i-chips", menuItemId: null, packageId: "pkg-fix", lineKind: "package_component", componentsListed: null },
    ]);
  });

  it("a priced composition with a pick slot gets a $0 header to reserve the slot through", () => {
    const mixed: ExpandablePackage = {
      id: "pkg-mix", labelEn: "Mix", pricingMode: "per_head", priceCents: 0,
      items: [
        { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 200 },
        { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 },
      ],
    };
    expect(expandPackageLines(mixed, "4").map((l) => [l.description, l.quantity, l.unitPrice, l.itemId, l.packageId, l.lineKind])).toEqual([
      ["Mix", "4", "0", null, "pkg-mix", "package_header"],
      ["Chips", "4", "2", "i-chips", "pkg-mix", "package_component"],
      ["Choose your sub", "4", "", null, "pkg-mix", "package_pick"],
    ]);
  });

  it("with no headcount yet, a per-head package still drops in at Qty 1", () => {
    expect(expandPackageLines(lightLunch, "").map((l) => l.quantity)).toEqual(["1", "1"]);
  });

  it("a fixed-count platter keeps its own count whatever the headcount", () => {
    const lines = expandPackageLines(platter16, "20");
    expect(lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["16 pc platter", "1", "115"],
      ["Choose your subs", "16", ""],
    ]);
  });

  it("a per-head package with priced composition scales every line per person", () => {
    const boxed: ExpandablePackage = {
      id: "pkg-box",
      labelEn: "Boxed",
      pricingMode: "per_head",
      priceCents: 1500,
      items: [
        { itemId: null, menuItemId: "m-sub", label: "Sub", quantity: 1, unitPriceCents: 1000 },
        { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 0.5, unitPriceCents: 200 },
      ],
    };
    expect(expandPackageLines(boxed, "12").map((l) => [l.description, l.quantity, l.unitPrice, l.packageId])).toEqual([
      ["Sub", "12", "10", "pkg-box"],
      ["Chips", "6", "2", "pkg-box"],
    ]);
  });

  it("a per-head package with no composition is one priced line at the headcount", () => {
    const bare: ExpandablePackage = { id: "p", labelEn: "Bare", pricingMode: "per_head", priceCents: 900, items: [] };
    expect(expandPackageLines(bare, "15")).toEqual([
      { description: "Bare", quantity: "15", unitPrice: "9", itemId: null, menuItemId: null, packageId: "p", lineKind: "package_header", componentsListed: false },
    ]);
  });
});

// ── D-46 · "quote not accepted" chip ────────────────────────────────────────────────────
describe("D-46 · quote-not-accepted chip", () => {
  it("shows only on a Confirmed lead whose current quote is a draft or sent", () => {
    for (const stage of PIPELINE_STAGES) {
      for (const status of ["draft", "sent", "accepted", "declined", null, undefined]) {
        expect(showQuoteNotAccepted(stage, status), `${stage}/${String(status)}`)
          .toBe(stage === "confirmed" && (status === "draft" || status === "sent"));
      }
    }
  });
  it("the board card and the search card both render it, in en and es", () => {
    const client = src("components/catering/pipeline/PipelineClient.tsx");
    expect(client).toContain("showQuoteNotAccepted(lead.stage, lead.quoteStatus) && <QuoteNotAcceptedChip />");
    expect(client).toContain("showQuoteNotAccepted(r.stage, r.quoteStatus) && <QuoteNotAcceptedChip />");
    bothLanguages("catering.pipeline.quote_not_accepted");
    bothLanguages("catering.pipeline.quote_not_accepted_hint");
  });
});

// ── D-47 · Prep Demand lines name their lead ────────────────────────────────────────────
describe("D-47 · lead label on Prep Demand", () => {
  it("is contact · company, or just the contact when there is no company", () => {
    expect(leadContactLabel({ contactName: "Ana Diaz", company: "Acme" })).toBe("Ana Diaz · Acme");
    expect(leadContactLabel({ contactName: " Bob ", company: null })).toBe("Bob");
    expect(leadContactLabel({ contactName: "Bob", company: "  " })).toBe("Bob");
  });
  it("every Prep Demand line kind renders the leads, and a pick line shows its count", () => {
    const client = src("components/admin/catering/prep-demand/PrepDemandClient.tsx");
    expect(client.match(/<LeadsFor line=\{line\} t=\{t\} \/>/g)).toHaveLength(3);
    const choice = client.slice(client.indexOf("function ChoiceLine("), client.indexOf("function MenuItemLine("));
    expect(choice).toContain("{r1(line.qty)}");
    bothLanguages("admin.catering.prep_demand.for_leads");
    bothLanguages("admin.catering.prep_demand.lead_hidden");
    expect(esKeys["admin.catering.prep_demand.lead_qty"]).toBeTruthy();
  });
});

// ── D-48 · phone on Add lead and Edit details ───────────────────────────────────────────
describe("D-48 · lead phone", () => {
  it("normalizeLeadPhone trims, blanks to null, refuses over the cap", () => {
    expect(normalizeLeadPhone(" (202) 555-0100 ")).toEqual({ ok: true, value: "(202) 555-0100" });
    expect(normalizeLeadPhone("  ")).toEqual({ ok: true, value: null });
    expect(normalizeLeadPhone(null)).toEqual({ ok: true, value: null });
    expect(normalizeLeadPhone("9".repeat(LEAD_PHONE_MAX))).toEqual({ ok: true, value: "9".repeat(LEAD_PHONE_MAX) });
    expect(normalizeLeadPhone("9".repeat(LEAD_PHONE_MAX + 1))).toEqual({ ok: false });
  });
  it("the edit form sends the phone only when it changed", () => {
    const lead = { contactName: "Ana", company: null, eventDate: null, headcount: null, followUpDate: null, notes: null, contactPhone: "555-0100" };
    const form = { contactName: "Ana", company: "", eventDate: "", headcount: "", followUpDate: "", notes: "", contactPhone: " 555-0100 " };
    expect(leadEditPatch(lead, form)).toEqual({ ok: true, patch: {} });
    expect(leadEditPatch(lead, { ...form, contactPhone: "555-0199" })).toEqual({ ok: true, patch: { contactPhone: "555-0199" } });
    expect(leadEditPatch(lead, { ...form, contactPhone: "" })).toEqual({ ok: true, patch: { contactPhone: null } });
    expect(leadEditPatch(lead, { ...form, contactPhone: "9".repeat(LEAD_PHONE_MAX + 1) })).toEqual({ ok: false, field: "contactPhone" });
    // a form without the phone box never touches the phone (B5 callers)
    const { contactPhone: _omit, ...noPhone } = form;
    void _omit;
    expect(leadEditPatch(lead, noPhone)).toEqual({ ok: true, patch: {} });
  });
  it("Add lead and Edit details both carry a phone box, in en and es; the email box is on Add lead only (B7c round 2)", () => {
    const client = src("components/catering/pipeline/PipelineClient.tsx");
    expect(client.match(/name="contactPhone" type="tel"/g)).toHaveLength(2);
    expect(client).toContain('contactPhone: str("contactPhone")');
    expect(client).toContain('contactPhone: raw("contactPhone")');
    // A lead has no email column: the one email box (Add lead) resolves the lead's customer.
    expect(client.match(/name="contactEmail"/g)).toHaveLength(1);
    bothLanguages("catering.pipeline.field.phone");
    expect(src("app/api/catering/pipeline/[id]/route.ts")).toMatch(/"contactPhone",/);
  });
});

// ── D-49 · confirm before Completed or Lost ─────────────────────────────────────────────
describe("D-49 · final-stage confirm", () => {
  it("asks only for Completed and Lost — every other move stays one tap", () => {
    expect(PIPELINE_STAGES.filter(stageMoveNeedsConfirm)).toEqual(["completed", "lost"]);
    // and those two really are final (the reason for asking)
    expect(LEGAL_TRANSITIONS.completed).toEqual([]);
    expect(LEGAL_TRANSITIONS.lost).toEqual([]);
  });
  it("the stage buttons route final moves through the confirm; only its Yes moves the lead", () => {
    const client = src("components/catering/pipeline/PipelineClient.tsx");
    const detail = client.slice(client.indexOf("function LeadDetail("), client.indexOf("// ── Edit a lead in place"));
    expect(detail).toContain("onClick={() => (stageMoveNeedsConfirm(s) ? setConfirming(s) : void moveTo(s))}");
    expect(detail).toContain("onClick={() => void moveTo(confirming)}");
    expect(detail).toContain("onClick={() => setConfirming(null)}");
    // moveTo is called from exactly those two places
    expect(detail.match(/void moveTo\(/g)).toHaveLength(2);
    for (const k of ["catering.pipeline.confirm_final.title", "catering.pipeline.confirm_final.body", "catering.pipeline.confirm_final.yes"]) {
      bothLanguages(k);
      if (k !== "catering.pipeline.confirm_final.body") {
        expect(enKeys[k]).toContain("{stage}");
        expect(esKeys[k]).toContain("{stage}");
      }
    }
  });
});
