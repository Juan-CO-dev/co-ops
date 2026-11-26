/**
 * Catering delivery D2 — i18n: every visible string and ARIA label of the delivery screens exists in en AND es, and
 * every code of the CLOSED DeliveryError vocabulary (plus the three client outcomes) has its own message in both.
 * Also: every key a delivery component asks for exists (a missing key would render the raw key at 6 AM), placeholders
 * match across languages, and no courier's name is a literal in code or copy (couriers are the shop's own data).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { DELIVERY_ERROR_CODES, DELIVERY_SQL_REFUSALS } from "@/lib/delivery/errors";
import { DELIVERY_CLIENT_CODES, DELIVERY_MESSAGE_CODES, deliveryErrorKey } from "@/lib/delivery/panel-shared";
import { DELIVERY_COST_COMPONENTS, DELIVERY_STATES, DELIVERY_STATUSES } from "@/lib/delivery/types-shared";
import { ECONOMICS_GAPS, type FeeGap } from "@/lib/delivery/economics-shared";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const PREFIXES = ["catering.delivery.", "delivery.error.", "admin.catering.delivery."];
const mine = (dict: Record<string, string>) => Object.keys(dict).filter((key) => PREFIXES.some((p) => key.startsWith(p)) || key === "admin.catering.hub.delivery").sort();
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("every DeliveryError code has its own en + es message", () => {
  it("the vocabulary is the closed one: every SQL refusal, not installed, busy (try again), generic, and the three client outcomes", () => {
    expect(DELIVERY_MESSAGE_CODES).toEqual([...DELIVERY_SQL_REFUSALS, "delivery_unavailable", "delivery_busy", "generic", "network", "step_up_required", "step_up_stale"]);
    expect(DELIVERY_ERROR_CODES.length + DELIVERY_CLIENT_CODES.length).toBe(DELIVERY_MESSAGE_CODES.length);
  });
  it.each([...DELIVERY_MESSAGE_CODES])("%s", (code) => {
    const key = `delivery.error.${code}`;
    expect(deliveryErrorKey(code)).toBe(key);
    expect((EN[key] ?? "").length, `en ${key}`).toBeGreaterThan(5);
    expect((ES[key] ?? "").length, `es ${key}`).toBeGreaterThan(5);
    expect(ES[key], `es ${key} is not a copy of en`).not.toBe(EN[key]);
  });
  it("no message is left for a code that no longer exists", () => {
    expect(Object.keys(EN).filter((key) => key.startsWith("delivery.error.")).sort()).toEqual(DELIVERY_MESSAGE_CODES.map((c) => `delivery.error.${c}`).sort());
  });
});

describe("en and es carry the same delivery keys, with the same placeholders", () => {
  it("the same key set (over 150 keys)", () => {
    expect(mine(EN).length).toBeGreaterThan(150);
    expect(mine(ES)).toEqual(mine(EN));
  });
  it("every value is non-empty and its placeholders match", () => {
    for (const key of mine(EN)) {
      expect(EN[key]!.trim().length, key).toBeGreaterThan(0);
      expect(ES[key]!.trim().length, key).toBeGreaterThan(0);
      expect([key, holes(ES[key]!)]).toEqual([key, holes(EN[key]!)]);
    }
  });
  it("every state, status and cost component has a label", () => {
    for (const s of DELIVERY_STATES) expect(EN[`catering.delivery.state.${s}`], s).toBeTruthy();
    for (const s of DELIVERY_STATUSES) expect(EN[`catering.delivery.status.${s}`], s).toBeTruthy();
    for (const c of DELIVERY_COST_COMPONENTS) expect(EN[`catering.delivery.component.${c}`], c).toBeTruthy();
  });
  it("Spanish is tú-form: no usted imperative slipped in", () => {
    for (const key of mine(ES)) expect([key, /\b(Ingrese|Confirme|Revise|Intente|Registre|Escriba|Toque|Elija|Recargue|Cancele)\b/.test(ES[key]!)]).toEqual([key, false]);
  });
  it("the 'recorded only' sentence is word for word", () => {
    expect(EN["admin.catering.delivery.share.unverified"]).toBe(
      "Recorded only. The payroll and legal treatment of the driver's share is not verified — the driver works for the courier, not for us. Confirm with payroll before paying anything from this figure.");
    expect(ES["admin.catering.delivery.share.unverified"]).toMatch(/^Solo se registra\..*no está verificado.*Confirma con nómina antes de pagar/);
  });
});

function files(root: string): string[] {
  return statSync(root).isFile() ? [root] : readdirSync(root).flatMap((f) => files(join(root, f)));
}
const SCREENS: Array<[string, string]> = [
  ["components/catering/pipeline/DeliveryPanel.tsx", "catering.delivery."],
  ["components/catering/pipeline/DeliveryMovedList.tsx", "catering.delivery."],
  ["components/admin/catering/DeliverySettings.tsx", "admin.catering.delivery."],
];

describe("every key a delivery screen asks for exists", () => {
  it.each(SCREENS)("%s", (file, prefix) => {
    const src = readFileSync(file, "utf8");
    const literal = [...src.matchAll(/\bk\("([^"]+)"/g)].map((m) => m[1]!);
    // Ternaries inside k(...): both arms are keys.
    const arms = [...src.matchAll(/\bk\(([^()]*\?[^()]*)\)/g)].flatMap((m) => [...m[1]!.slice(m[1]!.indexOf("?")).matchAll(/"([a-z_.]+)"/g)].map((x) => x[1]!));
    const keys = [...new Set([...literal, ...arms])];
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) {
      expect(EN[`${prefix}${key}`], `${file}: ${prefix}${key} (en)`).toBeTruthy();
      expect(ES[`${prefix}${key}`], `${file}: ${prefix}${key} (es)`).toBeTruthy();
    }
    // The only computed keys are the closed vocabularies checked above (state.*, status.*, component.*, record.blocked.*).
    for (const m of src.matchAll(/\bk\(`([^`$]*)\$\{/g)) expect(["state.", "status.", "component.", "record.blocked.", "money.fee_gap."]).toContain(m[1]);
    expect(EN["catering.delivery.record.blocked.quote_ambiguous"]).toBeTruthy();
  });
  it("the settings page and the hub tile", () => {
    const page = readFileSync("app/admin/catering/delivery/page.tsx", "utf8");
    for (const m of page.matchAll(/\bt\("([^"]+)"\)/g)) {
      expect(EN[`admin.catering.delivery.${m[1]}`], m[1]).toBeTruthy();
      expect(ES[`admin.catering.delivery.${m[1]}`], m[1]).toBeTruthy();
    }
    expect([EN["admin.catering.hub.delivery"], ES["admin.catering.hub.delivery"]]).toEqual(["Delivery", "Entrega"]);
  });
  it("no key is left unused (every delivery key is asked for by a screen, the error resolver or a vocabulary)", () => {
    const sources = [...SCREENS.map(([f]) => f), "app/admin/catering/delivery/page.tsx", "app/admin/catering/page.tsx", "lib/nav/destinations.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const computed = [/^catering\.delivery\.(state|status|component)\./, /^catering\.delivery\.record\.blocked\./, /^catering\.delivery\.money\.fee_gap\./, /^delivery\.error\./];
    const unused = mine(EN).filter((key) => !computed.some((re) => re.test(key)) && !sources.includes(`"${key.replace(/^(catering\.delivery\.|admin\.catering\.delivery\.)/, "")}"`) && !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });
});

describe("D4: the economics copy, en + es", () => {
  const FEE_GAPS: FeeGap[] = ["ezcater_fee_unknown", "order_rejected", "quote_ambiguous", "fee_not_on_quote"];
  const section = Object.keys(EN).filter((key) => key.startsWith("reports.sales.delivery.")).sort();
  it("every named gap has its own line: on the panel (fee side), and on the report (the excluded count and the row)", () => {
    expect(ECONOMICS_GAPS).toEqual([...FEE_GAPS, "cost_not_recorded", "cost_partial"]);
    for (const gap of FEE_GAPS) for (const dict of [EN, ES]) expect(dict[`catering.delivery.money.fee_gap.${gap}`], gap).toBeTruthy();
    expect(Object.keys(EN).filter((key) => key.startsWith("catering.delivery.money.fee_gap.")).sort()).toEqual(FEE_GAPS.map((g) => `catering.delivery.money.fee_gap.${g}`).sort());
    for (const family of ["excluded", "gap"]) {
      for (const gap of ECONOMICS_GAPS) for (const dict of [EN, ES]) expect(dict[`reports.sales.delivery.${family}.${gap}`], `${family}.${gap}`).toBeTruthy();
    }
    expect(section.filter((key) => /\.(excluded|gap)\.[a-z_]+$/.test(key) && !/\.excluded\.(heading|note)$/.test(key)).sort())
      .toEqual(["excluded", "gap"].flatMap((family) => ECONOMICS_GAPS.map((g) => `reports.sales.delivery.${family}.${g}`)).sort());
  });
  it("the report section: the same keys in both languages, same placeholders, Spanish in tú-form, no courier's name", () => {
    expect(section.length).toBeGreaterThan(40);
    expect(Object.keys(ES).filter((key) => key.startsWith("reports.sales.delivery.")).sort()).toEqual(section);
    for (const key of section) {
      expect(ES[key]!.trim().length, key).toBeGreaterThan(0);
      expect([key, holes(ES[key]!)]).toEqual([key, holes(EN[key]!)]);
      expect([key, /\b(Ingrese|Confirme|Revise|Intente|Registre|Escriba|Toque|Elija|Recargue|Cancele|Recalcule)\b/.test(ES[key]!)]).toEqual([key, false]);
      for (const dict of [EN, ES]) expect([key, /deliver\s?that|dlivrd|doordash|uber\b/i.test(dict[key]!)]).toEqual([key, false]);
    }
    const same = section.filter((key) => ES[key] === EN[key]);
    expect(same).toEqual(["reports.sales.delivery.order.ezcater"]); // a brand name
  });
  it("every key the report section asks for exists, and none is left unused", () => {
    const src = readFileSync("components/reports-hub/DeliveryEconomicsSection.tsx", "utf8");
    const literal = [...new Set([...src.matchAll(/\bk\("([^"]+)"/g)].map((m) => m[1]!))];
    expect(literal.length).toBeGreaterThan(30);
    for (const key of literal) for (const dict of [EN, ES]) expect(dict[`reports.sales.delivery.${key}`], key).toBeTruthy();
    // The only computed families are the closed gap vocabulary.
    expect([...new Set([...src.matchAll(/\bk\(`([^`$]*)\$\{/g)].map((m) => m[1]))].sort()).toEqual(["excluded.", "gap."]);
    const unused = section.map((key) => key.replace("reports.sales.delivery.", "")).filter((key) => !literal.includes(key) && !/^(excluded|gap)\.[a-z_]+$/.test(key));
    expect(unused).toEqual([]);
    for (const key of ["excluded.heading", "excluded.note"]) expect(literal).toContain(key);
  });
  it("the 'recorded only' sentence on the panel and the report is THE one sentence (one key, word for word)", () => {
    for (const file of ["components/reports-hub/DeliveryEconomicsSection.tsx", "components/catering/pipeline/DeliveryPanel.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain('t("admin.catering.delivery.share.unverified")');
    }
    expect(Object.keys(EN).filter((key) => /Recorded only\./.test(EN[key]!))).toEqual(["admin.catering.delivery.share.unverified"]);
  });
  it("the coverage line and the correction's two buttons read exactly as specified", () => {
    expect(EN["reports.sales.delivery.coverage"]).toBe("{n} of {m} delivery orders have both a fee and a full cost.");
    expect(EN["catering.delivery.gratuity.recompute"]).toBe("Recalculate from the current quote");
    expect(EN["catering.delivery.gratuity.void"]).toBe("Remove — this delivery didn't happen");
    expect([ES["catering.delivery.gratuity.recompute"], ES["catering.delivery.gratuity.void"]]).toEqual(["Recalcular con la cotización actual", "Quitar — esta entrega no ocurrió"]);
    // Ruled 2026-11-23: after a void the same act reads as restoring.
    expect([EN["catering.delivery.gratuity.restore"], ES["catering.delivery.gratuity.restore"]]).toEqual(["Put the split back from the current quote", "Restablecer el reparto con la cotización actual"]);
  });
  it("a missing gratuity source has its own words, and 'no gratuity' is said only of an ACCEPTED quote (review DELIV4-r1)", () => {
    expect(EN["catering.delivery.gratuity.source_unknown"]).toBe("Delivered. No accepted quote yet — gratuity not known.");
    expect(EN["reports.sales.delivery.gratuity.source_unknown"]).toBe("Delivered with no accepted quote — gratuity not known: {n}");
    for (const key of ["catering.delivery.gratuity.none_on_quote", "reports.sales.delivery.gratuity.no_gratuity"]) {
      expect(EN[key], key).toMatch(/accepted quote/);
      expect(ES[key], key).toMatch(/cotización aceptada/);
    }
    for (const key of ["catering.delivery.gratuity.source_unknown", "reports.sales.delivery.gratuity.source_unknown"]) expect(ES[key], key).toMatch(/no se sabe la propina/);
  });
});

describe("tenant vocabulary: no courier's name in code or copy", () => {
  it("couriers are the shop's own data (delivery_settings.manual_providers), never a literal", () => {
    const code = [...files("lib/delivery"), ...files("app/api/catering/pipeline/[id]/delivery"), ...files("app/api/admin/catering/delivery"), ...files("app/admin/catering/delivery"),
      ...SCREENS.map(([f]) => f), "components/catering/pipeline/delivery-format.ts"];
    expect(code.length).toBeGreaterThan(20);
    for (const f of code) expect([f, /deliver\s?that|dlivrd|doordash|uber|relay|shipday|burq|nash\b/i.test(readFileSync(f, "utf8"))]).toEqual([f, false]);
    for (const key of mine(EN)) for (const dict of [EN, ES]) expect([key, /deliver\s?that|dlivrd|doordash|uber\b/i.test(dict[key]!)]).toEqual([key, false]);
  });
});
