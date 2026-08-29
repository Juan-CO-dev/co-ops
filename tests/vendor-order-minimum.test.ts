/**
 * Unit spine — the vendor order minimum (migration 0184, AUTHORED / NOT APPLIED).
 *
 * The whole feature is DB-coupled — a nullable text column, two probe-gated selects, one
 * probe-gated write — so there is no pure core to exercise. What must NOT break is the
 * PRE-APPLY CONTRACT: while 0184 is unapplied the column must never be NAMED in a select,
 * because PostgREST rejects the entire select when one named column is missing, and the two
 * readers are `/admin/vendors[/id]` and the 6 AM par-pass SUBMIT. A regression here is not a
 * missing field; it is a 500 on the walk, in the window between this PR and the gate.
 *
 * That guarantee is an ABSENCE — the column is not in a string — and no test over the
 * modules' exports can observe an absence, so it is asserted at the source. Same posture,
 * and same reason, as tests/dynamic-pars-walker.test.ts § "loadWalkerData's row rules".
 *
 * The i18n block is an ordinary key-parity assertion (tests/readiness.test.ts idiom): the
 * translate-from-day-one law says en AND es land in the same PR, including every ARIA-
 * reachable string.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("the 0184 probe gates every reader — the column is never named unconditionally", () => {
  it("the probe caches only TRUE and re-probes while false, so the surface self-lights", () => {
    const src = read("lib", "vendor-schema-probes.ts");
    // Caching a FALSE would strand a warm serverless process on a stale answer forever;
    // the migration would land and the surface would stay dark until a redeploy.
    expect(src).toContain("if (orderMinimumReady) return true");
    expect(src).toContain("return false");
    expect(src).toContain('.select("order_minimum").limit(1)');
    // Warned once per process, not once per request.
    expect(src).toContain("orderMinimumPendingLogged");
  });

  it("lib/admin/vendors.ts builds its select list through the probe, never a literal", () => {
    const src = read("lib", "admin", "vendors.ts");
    // The one literal column list must not carry the pending column...
    const cols = src.slice(src.indexOf("const VENDOR_COLS ="), src.indexOf("\n", src.indexOf("const VENDOR_COLS =")));
    expect(cols).not.toContain("order_minimum");
    // ...and both reads must go through the gated builder rather than the literal.
    expect(src).toContain("vendorOrderMinimumReady(sb)) ? `${VENDOR_COLS}, order_minimum` : VENDOR_COLS");
    expect(src.match(/\.select\(await vendorCols\(\)\)/g)?.length).toBe(2);
    expect(src).not.toContain(".select(VENDOR_COLS)");
  });

  it("the par-pass draft-order read is gated too — this one is on the SUBMIT path", () => {
    const src = read("lib", "ordering.ts");
    const at = src.indexOf("async function buildDraftOrders");
    const body = src.slice(at, src.indexOf("\n}", src.indexOf("orders.sort", at)));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("const minimumReady = await vendorOrderMinimumReady(sb)");
    expect(body).toContain('minimumReady ? "id, name, order_minimum" : "id, name"');
    // The probe's answer must reach the select — never a bare literal naming the column.
    expect(body).toContain(".select(vendorSelect)");
  });

  it("the WRITE refuses loudly rather than dropping the field or 500ing the whole save", () => {
    const src = read("lib", "admin", "vendors.ts");
    const at = src.indexOf("export async function updateVendorCore");
    const body = src.slice(at, src.indexOf("await audit(", at));
    // Silently dropping the key would report success on a write that never happened;
    // passing it through blind would 500 the core save's OTHER three fields with it.
    expect(body).toContain("order_minimum_schema_pending");
    expect(body).toContain("503");
    // …and the refusal must be checked BEFORE the column reaches the update patch.
    expect(body.indexOf("order_minimum_schema_pending")).toBeLessThan(body.indexOf("update.order_minimum ="));
  });

  it("the client omits the field entirely pre-apply — it never sends an explicit null", () => {
    const src = read("components", "admin", "vendors", "VendorDetailClient.tsx");
    // Sending `orderMinimum: null` would ask the server to CLEAR a column that does not
    // exist, turning a dormant field into a failed save of three working ones.
    expect(src).toContain("...(vendor.orderMinimumAvailable ? { orderMinimum: orderMinimum.trim() || null } : {})");
    expect(src).toContain("admin.vendors.order_minimum.schema_pending");
  });
});

describe("the advisory stays advisory", () => {
  it("nothing compares an order against the minimum — no arithmetic, anywhere", () => {
    // The migration's premise: the known minimums are dollars for some vendors and cases
    // for others, so there is no honest comparison to make. The moment something computes
    // on this value, the text column is the wrong shape and that is a design decision, not
    // a patch — this assertion is where that conversation starts.
    for (const src of [read("lib", "ordering.ts"), read("components", "ordering", "ParPassWalker.tsx")]) {
      expect(src).not.toMatch(/orderMinimum\s*[<>]/);
      expect(src).not.toMatch(/(below|under|meets|short)[A-Za-z]*Minimum/i);
      expect(src).not.toMatch(/parseFloat\([^)]*[Mm]inimum/);
    }
  });

  it("it is NOT in the transmitted body — the vendor knows their own minimum", () => {
    const src = read("components", "ordering", "ParPassWalker.tsx");
    const at = src.indexOf("const bodyText = useMemo");
    const body = src.slice(at, src.indexOf("}, [order, shopLabel, dateLabel, t]);", at));
    expect(at).toBeGreaterThan(-1);
    expect(body).not.toContain("orderMinimum");
  });
});

describe("i18n — en + es in the same PR, per the translate-from-day-one law", () => {
  const KEYS = [
    "admin.vendors.field.order_minimum",
    "admin.vendors.order_minimum.placeholder",
    "admin.vendors.order_minimum.hint",
    "admin.vendors.order_minimum.schema_pending",
    "admin.vendors.error.order_minimum_schema_pending",
    "admin.vendors.error.invalid_order_minimum",
    "ordering.done.order_minimum",
  ] as const;

  const enKeys = en as Record<string, string>;
  const esKeys = es as Record<string, string>;

  it("every new key exists in BOTH locales", () => {
    for (const key of KEYS) {
      expect(enKeys[key], `${key} missing from en.json`).toBeTruthy();
      expect(esKeys[key], `${key} missing from es.json`).toBeTruthy();
    }
  });

  it("the two strings that interpolate keep their placeholder in both locales", () => {
    // A dropped placeholder renders the label with no value — the one failure mode that
    // survives a translation pass unnoticed.
    expect(enKeys["ordering.done.order_minimum"]).toContain("{value}");
    expect(esKeys["ordering.done.order_minimum"]).toContain("{value}");
  });

  it("the Spanish is actually translated, not the English string copied through", () => {
    for (const key of KEYS) {
      expect(esKeys[key], `${key} was not translated`).not.toBe(enKeys[key]);
    }
  });

  it("the error codes the lib can emit are resolvable to a message", () => {
    // resolveErrorKey falls back to `generic` for any code not in its set, which turns a
    // precise 503 into "something went wrong".
    const shared = read("components", "admin", "vendors", "shared.ts");
    expect(shared).toContain('"order_minimum_schema_pending"');
    expect(shared).toContain('"invalid_order_minimum"');
  });
});
