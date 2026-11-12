import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { composeMetaNotes, mapMetaLeadFields, META_CONSENT_QUESTION_KEY, META_CONSENT_COPY, META_CONSENT_TEXT_VERSION, META_MAPPING_VERSION, META_WORK_EMAIL_KEY, parseEventDate } from "@/lib/meta-leads/intake-shared";
import { metaLeadsTenantConfig } from "@/config/tenant/meta-leads";
import { verifyMetaSignature } from "@/lib/meta-leads/signature";
import { readBoundedBytes } from "@/lib/meta-leads/request";

/** 3 PM ET on 2026-11-11 — every no-year date test is relative to this instant. */
const NOW = new Date("2026-11-11T20:00:00Z");
const map = (fieldData: unknown, disclaimer?: unknown) => mapMetaLeadFields(fieldData, disclaimer, { now: NOW });
const fields = (extra: Partial<Record<string, string>> = {}) => Object.entries({ full_name: "Sample Guest", email: "Guest@Example.org", preferred_shop: "Capitol Hill", fulfillment_method: "Pickup", ...extra }).map(([name, value]) => ({ name, values: [value] }));
/** The live form "Catering Inquiry - EN" (id 2514347029057258): the EXACT raw key list, label values. */
const LIVE_KEYS = ["fulfillment_method", "preferred_shop", "headcount", "seconds", "extras", "event_date", "notes", "email", "phone_number", "full_name", "work_email", "work_phone_number", "company_name", "job_title"] as const;
const live = (over: Partial<Record<(typeof LIVE_KEYS)[number], string>> = {}) => {
  const base: Record<(typeof LIVE_KEYS)[number], string> = { fulfillment_method: "Pickup", preferred_shop: "Capitol Hill", headcount: "21-40", seconds: "Yes", extras: "Add sides and drinks", event_date: "Nov 20", notes: "Office lunch", email: "guest@example.org", phone_number: "2025550100", full_name: "Sample Guest", work_email: "", work_phone_number: "", company_name: "Example Co", job_title: "" };
  return LIVE_KEYS.map(name => ({ name, values: [{ ...base, ...over }[name]] }));
};

describe("The live form (labels → shops)", () => {
  it("maps the exact live key list: Pickup + Capitol Hill → MEP, every label a note, nothing refused", () => {
    const result = map(live());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawKeys).toEqual([...LIVE_KEYS]);
    expect(result.intake).toMatchObject({ shopCode: "MEP", isDelivery: false, headcount: null, eventDate: "2026-11-20", company: "Example Co", contactEmail: "guest@example.org" });
    expect(result.intake.notes).toBe("Office lunch\nSizing: seconds yes · add sides and drinks\nHeadcount: 21-40");
    expect(result.noteParts).toEqual({ customer: "Office lunch", sizing: "Sizing: seconds yes · add sides and drinks", headcount: "Headcount: 21-40", extras: [], fallbacks: [] });
  });
  it("Pickup + Dupont Circle (P Street) → EM", () => {
    expect(map(live({ preferred_shop: "Dupont Circle (P Street)" }))).toMatchObject({ ok: true, intake: { shopCode: "EM", isDelivery: false } });
  });
  it.each(["capitol hill", "  CAPITOL   HILL ", "MEP", "mep"])("labels and raw codes match case-insensitively, whitespace-normalized: %j", preferred_shop => {
    expect(map(live({ preferred_shop }))).toMatchObject({ ok: true, intake: { shopCode: "MEP" } });
  });
  it("Delivery + the placeholder label = NO choice → shopCode null (the worker routes it)", () => {
    const result = map(live({ fulfillment_method: "Delivery", preferred_shop: "Our catering team picks the closest shop" }));
    expect(result).toMatchObject({ ok: true, intake: { shopCode: null, isDelivery: true } });
    if (result.ok) expect(result.intake.notes).not.toContain("Preferred shop");
  });
  it("Delivery + an unknown label still routes, and keeps the label as typed", () => {
    expect(map(live({ fulfillment_method: "Delivery", preferred_shop: "Somewhere else" }))).toMatchObject({ ok: true, intake: { shopCode: null, isDelivery: true, notes: expect.stringContaining("Preferred shop (as typed): Somewhere else") } });
  });
  it("Delivery + a real shop label keeps the customer's choice", () => {
    expect(map(live({ fulfillment_method: "Delivery", preferred_shop: "Dupont Circle (P Street)" }))).toMatchObject({ ok: true, intake: { shopCode: "EM", isDelivery: true } });
  });
  it.each(["Somewhere else", "", "Our catering team picks the closest shop"])("Pickup without a real shop choice (%j) is invalid_payload", preferred_shop => {
    expect(map(live({ preferred_shop }))).toMatchObject({ ok: false, error: "invalid_payload" });
  });
  it.each([["Pickup", false], ["pickup", false], ["Pick up", false], ["pick-up", false], ["Delivery", true], [" delivery ", true]])("fulfillment %j is tolerant", (fulfillment_method, isDelivery) => {
    expect(map(live({ fulfillment_method, preferred_shop: "Capitol Hill" }))).toMatchObject({ ok: true, intake: { isDelivery } });
  });
  it.each(["", "Ship it", "both"])("an unknown fulfillment %j is invalid_payload", fulfillment_method => {
    expect(map(live({ fulfillment_method }))).toMatchObject({ ok: false, error: "invalid_payload" });
  });
  it("the label tables are tenant DATA (config), not logic", () => {
    expect(metaLeadsTenantConfig.shopLabels.map(s => s.code).sort()).toEqual(["EM", "MEP"]);
    expect(metaLeadsTenantConfig.defaultShopCode).toBe("MEP");
    expect(metaLeadsTenantConfig.adSetShop).toEqual({});
    const other = { shopLabels: [{ label: "Downtown", code: "DT" }], deliveryPlaceholderLabels: ["Any"], adSetShop: {}, defaultShopCode: "DT" };
    expect(mapMetaLeadFields(live({ preferred_shop: "downtown" }), undefined, { now: NOW, config: other })).toMatchObject({ ok: true, intake: { shopCode: "DT" } });
    expect(mapMetaLeadFields(live({ preferred_shop: "Capitol Hill" }), undefined, { now: NOW, config: other })).toMatchObject({ ok: false });
  });
  it("bumps the mapping version", () => expect(META_MAPPING_VERSION).toBe("meta-leads-v3"));
});

describe("Headcount", () => {
  it("a plain integer is the number", () => expect(map(live({ headcount: "25" }))).toMatchObject({ ok: true, intake: { headcount: 25, notes: expect.not.stringContaining("Headcount") } }));
  it.each(["10-20", "21-40", "41-75", "76-150", "150+", "21 - 40", "150 +"])("a range label %j stays NULL with a Headcount note, never an invented number", headcount => {
    const result = map(live({ headcount }));
    expect(result).toMatchObject({ ok: true, intake: { headcount: null, notes: expect.stringContaining(`Headcount: ${headcount.replace(/\s+/g, "")}`) } });
    if (result.ok) expect(result.intake.notes).not.toContain("as typed");
  });
  it.each(["about 40", "1.5", "0", "99999"])("anything else (%j) is kept as typed", headcount => {
    expect(map(live({ headcount }))).toMatchObject({ ok: true, intake: { headcount: null, notes: expect.stringContaining(`Headcount (as typed): ${headcount}`) } });
  });
});

describe("Sizing (seconds / extras)", () => {
  it.each([["Yes", "yes"], ["y", "yes"], ["yeah", "yes"], ["Sure!", "yes"], ["No", "no"], ["n", "no"], ["nope", "no"], ["maybe later", "maybe later"]])("seconds %j → %j", (seconds, expected) => {
    expect(map(live({ seconds, extras: "" }))).toMatchObject({ ok: true, intake: { notes: expect.stringContaining(`Sizing: seconds ${expected}`) } });
  });
  it.each(["Just the subs", "Add sides", "Add sides and drinks", "The works: sides + drinks + desserts"])("extras %j rides in the Sizing line", extras => {
    expect(map(live({ seconds: "No", extras }))).toMatchObject({ ok: true, intake: { notes: expect.stringContaining(`Sizing: seconds no · ${extras.toLowerCase()}`) } });
  });
  it("no sizing answers → no Sizing line", () => {
    expect(map(live({ seconds: "", extras: "", notes: "" }))).toMatchObject({ ok: true, intake: { notes: "Headcount: 21-40" } });
  });
});

describe("Event date (ET, tolerant)", () => {
  it.each([
    ["2026-11-20", "2026-11-20"], ["11/20", "2026-11-20"], ["11/20/26", "2026-11-20"], ["11/20/2026", "2026-11-20"], ["11-20", "2026-11-20"],
    ["Nov 20", "2026-11-20"], ["November 20", "2026-11-20"], ["Nov 20th", "2026-11-20"], ["November 20th, 2026", "2026-11-20"], ["20 Nov", "2026-11-20"], ["20th of November", "2026-11-20"],
    ["Nov. 20", "2026-11-20"], ["nov 20", "2026-11-20"], ["Dec 1", "2026-12-01"], ["1/5", "2027-01-05"], ["Jan 5", "2027-01-05"],
    ["Nov 11", "2026-11-11"], ["Nov 10", "2027-11-10"], ["Oct 3", "2027-10-03"], ["3/2", "2027-03-02"], ["20 de noviembre", "2026-11-20"], ["Feb 29", "2028-02-29"],
  ])("%j → %j (today = 2026-11-11 ET; today counts, a past date rolls to next year)", (event_date, expected) => {
    expect(map(live({ event_date }))).toMatchObject({ ok: true, intake: { eventDate: expected, notes: expect.not.stringContaining("Event date") } });
  });
  it.each(["next friday", "2026-02-30", "13/45", "Nov 31", "someday", "20/11", "2026-13-01"])("%j is kept as typed, never guessed", event_date => {
    expect(map(live({ event_date }))).toMatchObject({ ok: true, intake: { eventDate: null, notes: expect.stringContaining(`Event date (as typed): ${event_date}`) } });
  });
  it("'today' is the ET calendar day, not UTC (22:30 ET on Nov 11 is already Nov 12 UTC)", () => {
    const lateEvening = new Date("2026-11-12T03:30:00Z");
    expect(mapMetaLeadFields(live({ event_date: "Nov 11" }), undefined, { now: lateEvening })).toMatchObject({ ok: true, intake: { eventDate: "2026-11-11" } });
    expect(mapMetaLeadFields(live({ event_date: "Nov 12" }), undefined, { now: lateEvening })).toMatchObject({ ok: true, intake: { eventDate: "2026-11-12" } });
    expect(mapMetaLeadFields(live({ event_date: "Nov 10" }), undefined, { now: lateEvening })).toMatchObject({ ok: true, intake: { eventDate: "2027-11-10" } });
  });
  it("parseEventDate is date-only math on the ET day string", () => {
    expect(parseEventDate("12/31", "2026-12-31")).toBe("2026-12-31");
    expect(parseEventDate("1/1", "2026-12-31")).toBe("2027-01-01");
    expect(parseEventDate("2/29/2027", "2026-11-11")).toBeNull();
    expect(parseEventDate("2/29/28", "2026-11-11")).toBe("2028-02-29");
  });
});

describe("Optional and unknown keys → notes, never identity", () => {
  it("work phone and job title are labelled note lines", () => {
    const result = map(live({ work_phone_number: "202-555-0199", job_title: "Office Manager" }));
    expect(result).toMatchObject({ ok: true, intake: { contactPhone: "+12025550100", notes: expect.stringContaining("Work phone: 202-555-0199\nJob title: Office Manager") } });
  });
  it("an unknown future key never refuses the lead: its answer becomes a bounded note line and its key stays in rawKeys", () => {
    const result = map([...live(), { name: "dietary_needs", values: ["x".repeat(300)] }, { name: "budget", values: ["500", "USD"] }]);
    expect(result).toMatchObject({ ok: true, rawKeys: expect.arrayContaining(["dietary_needs", "budget"]) });
    if (!result.ok) return;
    expect(result.intake.notes).toContain(`dietary_needs: ${"x".repeat(200)}`);
    expect(result.intake.notes).not.toContain("x".repeat(201));
    expect(result.intake.notes).toContain("budget: 500; USD");
    expect(result.noteParts.extras).toEqual([`dietary_needs: ${"x".repeat(200)}`, "budget: 500; USD"]);
  });
  it("retains unknown key names in rawKeys without their values", () => {
    const result = map(fields({ surprise: "private answer", company_name: "Company", headcount: "25", event_date: "2026-12-01" }));
    expect(result).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", shopCode: "MEP", headcount: 25 }, rawKeys: expect.arrayContaining(["surprise"]) });
    expect(JSON.stringify(result.rawKeys)).not.toContain("private answer");
  });
  it("notes order: customer → Sizing → Headcount → Routed → extras/unknowns → fallbacks, bounded at 4000", () => {
    const result = map([...live({ job_title: "Buyer", headcount: "about 40", event_date: "next friday", notes: "y".repeat(5000) }), { name: "extra_key", values: ["value"] }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withRouting = composeMetaNotes(result.noteParts, "Routed: default shop — please confirm (delivery, no shop chosen)")!;
    expect(withRouting.length).toBeLessThanOrEqual(4000);
    expect(withRouting.startsWith("Notes (as typed)")).toBe(false);
    expect(withRouting).toContain("Sizing: seconds yes · add sides and drinks\nRouted: default shop — please confirm (delivery, no shop chosen)\nJob title: Buyer\nextra_key: value\nNotes (as typed): ");
    expect(result.intake.notes).not.toContain("Routed");
  });
  it("composeMetaNotes with nothing is null", () => expect(composeMetaNotes({ customer: null, sizing: null, headcount: null, extras: [], fallbacks: [] })).toBeNull());
  describe("notes budget: the generated lines (Sizing, Headcount, Routed) are reserved FIRST", () => {
    const ROUTED = "Routed: last order at Dupont";
    const GENERATED = "Sizing: seconds yes · add sides and drinks\nHeadcount: 21-40\n" + ROUTED;
    it.each([3999, 4000])("a %i-char customer note is cut with an ellipsis and every generated line survives", length => {
      const result = map(live({ notes: "y".repeat(length) }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const notes = composeMetaNotes(result.noteParts, ROUTED)!;
      expect(notes.length).toBeLessThanOrEqual(4000);
      expect(notes.endsWith("\n" + GENERATED)).toBe(true);
      const customer = notes.slice(0, notes.length - GENERATED.length - 1);
      expect(customer.endsWith("…")).toBe(true);
      expect(customer.length).toBe(4000 - GENERATED.length - 1);
      expect(customer.slice(0, -1)).toBe("y".repeat(customer.length - 1));
    });
    it("a 5000-char customer note takes the as-typed fallback path and the generated lines still lead", () => {
      const result = map(live({ notes: "y".repeat(5000) }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const notes = composeMetaNotes(result.noteParts, ROUTED)!;
      expect(notes.startsWith(GENERATED + "\nNotes (as typed): yyyy")).toBe(true);
      expect(notes.length).toBeLessThanOrEqual(4000);
    });
    it("a flood of unknown keys cannot push the generated lines out either", () => {
      const flood = Array.from({ length: 20 }, (_, i) => ({ name: `k${i}`, values: ["z".repeat(200)] }));
      const result = map([...live({ notes: "x".repeat(600) }), ...flood]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const notes = composeMetaNotes(result.noteParts, ROUTED)!;
      expect(notes.length).toBeLessThanOrEqual(4000);
      expect(notes).toContain("x".repeat(600) + "\n" + GENERATED + "\nk0: ");
      expect(notes.split("\n").filter(l => /^k\d+: /.test(l)).length).toBeLessThan(20);
      expect(notes.endsWith("…")).toBe(true);
    });
    it("exactly full with no cut when the text fits to the byte", () => {
      const parts = { customer: "c".repeat(4000 - GENERATED.length - 1), sizing: "Sizing: seconds yes · add sides and drinks", headcount: "Headcount: 21-40", extras: [], fallbacks: [] };
      const notes = composeMetaNotes(parts, ROUTED)!;
      expect(notes.length).toBe(4000);
      expect(notes).not.toContain("…");
    });
  });
});

describe("Meta form mapping (carried from v2)", () => {
  it.each([{}, { [META_CONSENT_QUESTION_KEY]: "false" }, { [META_CONSENT_QUESTION_KEY]: "anything" }])("requires affirmative pinned optin %j", extra => {
    expect(map(fields(extra))).toMatchObject({ ok: true, consent: { optedIn: false } });
  });
  it("accepts only the pinned checked disclaimer", () => {
    expect(map(fields(), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: true }])).toMatchObject({ consent: { optedIn: true } });
    expect(map(fields(), [{ checkbox_key: "unknown", is_checked: true }])).toMatchObject({ consent: { optedIn: false } });
    expect(map(fields({ [META_CONSENT_QUESTION_KEY]: "true" }))).toMatchObject({ consent: { optedIn: true } });
    expect(map(fields({ [META_CONSENT_QUESTION_KEY]: "false" }), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: true }])).toMatchObject({ consent: { optedIn: false } });
  });
  it.each([{ preferred_shop: "" }, { fulfillment_method: "" }, { email: "guest@ezcater.com" }, { email: "noreply@example.org" }])("refuses unsafe/incomplete mapping %j", extra => {
    expect(map(fields(extra))).toMatchObject({ ok: false, error: "invalid_payload" });
  });
  it("refuses duplicate scalar identities", () => expect(map([...fields(), { name: "email", values: ["other@example.org"] }])).toMatchObject({ ok: false }));
});

describe("Double capture — the optional work email (Juan 2026-11-11)", () => {
  it("no work email: the Meta email is both the order and the marketing email, nothing secondary", () => {
    expect(map(fields())).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", marketingEmail: "guest@example.org", secondaryEmail: null } });
  });
  it("a valid work email becomes the ORDER email; the Meta email stays the marketing email and a secondary note", () => {
    expect(map(fields({ [META_WORK_EMAIL_KEY]: " Buyer@Work.example " }))).toMatchObject({
      ok: true, intake: { contactEmail: "buyer@work.example", marketingEmail: "guest@example.org", secondaryEmail: "guest@example.org", notes: null },
    });
  });
  it("the same address in both boxes (any case) is ONE address", () => {
    expect(map(fields({ [META_WORK_EMAIL_KEY]: "GUEST@EXAMPLE.ORG" }))).toMatchObject({
      ok: true, intake: { contactEmail: "guest@example.org", marketingEmail: "guest@example.org", secondaryEmail: null },
    });
  });
  it.each(["not-an-email", "someone@ezcater.com", "noreply@work.example"])("an invalid or relay work email %s is kept as typed and never becomes the identity", work => {
    expect(map(fields({ [META_WORK_EMAIL_KEY]: work }))).toMatchObject({
      ok: true, intake: { contactEmail: "guest@example.org", secondaryEmail: null, notes: `Work email (as typed): ${work}` },
    });
  });
  it("an empty work email answer is simply absent", () => {
    expect(map(fields({ [META_WORK_EMAIL_KEY]: "  " }))).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", secondaryEmail: null, notes: null } });
  });
  it("a malformed work email value is tolerated like every optional field", () => {
    expect(map([...fields(), { name: META_WORK_EMAIL_KEY, values: [1, 2] }])).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org" } });
  });
});

describe("Meta raw body authentication", () => {
  it("verifies exact non-ASCII raw bytes and rejects a whitespace mutation", () => {
    const raw = new TextEncoder().encode('{ "name": "José" }');
    const signature = `sha256=${createHmac("sha256", "stub-secret").update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, "stub-secret")).toBe(true);
    expect(verifyMetaSignature(new TextEncoder().encode('{"name":"José"}'), signature, "stub-secret")).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=123", "stub-secret")).toBe(false);
  });
  it("retains streamed bytes and enforces a bound without Content-Length", async () => {
    const bytes = new Uint8Array([0xff, 0, 32]);
    expect(await readBoundedBytes(new Response(bytes))).toEqual({ ok: true, bytes });
    expect(await readBoundedBytes(new Response(bytes), 2)).toEqual({ ok: false, status: 413 });
  });
});

it("bounds invalid optional answers without losing intake", () => {
  const result = map(fields({ company_name: "x".repeat(201), notes: "y".repeat(4001), headcount: "about 50" }));
  expect(result).toMatchObject({ ok: true, intake: { company: null, headcount: null } });
  if (result.ok) { expect(result.intake.notes).toContain("Notes (as typed): "); expect(result.intake.notes!.length).toBeLessThan(900); }
});
it.each([true, "1", "true", false, "0", "false", 1, 0, null, undefined, "yes", {}, []])("checkbox accepts only the three explicit values: %j", value => {
  expect(map(fields(), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: value }])).toMatchObject({ consent: { optedIn: value === true || value === "1" || value === "true" } });
});
it("pins the CO tenant consent copy and version (v3 names the email above)", () => {
  expect(META_CONSENT_COPY.en).toBe("Email me news and offers from Compliments Only at my email above. I can unsubscribe anytime.");
  expect(META_CONSENT_COPY.es).toBe("Quiero recibir novedades y ofertas de Compliments Only en mi correo de arriba. Puedo cancelar la suscripción cuando quiera.");
  expect(META_CONSENT_TEXT_VERSION).toBe("meta-email-marketing-v3");
  expect(map(fields())).toMatchObject({ consent: { textVersion: "meta-email-marketing-v3" } });
});

it("renders both consent languages for another tenant", async () => {
  vi.stubEnv("NEXT_PUBLIC_TENANT_NAME", "Example Deli");
  vi.resetModules();
  try {
    const { META_CONSENT_COPY: copy } = await import("@/lib/meta-leads/intake-shared");
    expect(copy.en).toContain("Example Deli"); expect(copy.es).toContain("Example Deli");
    expect(JSON.stringify(copy)).not.toContain("Compliments Only");
  } finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
it("preserves malformed optional raw values without rejecting identity", () => {
  expect(map([...fields(), { name: "headcount", values: [40] }])).toMatchObject({ ok: true, intake: { headcount: null, notes: "Headcount (as typed): 40" } });
});
