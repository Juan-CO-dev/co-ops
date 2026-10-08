import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/catering/toast-sales.ts", "utf8");

describe("capture depletion materializer side effects", () => {
  it("preserves product-resolution evidence without mutating the legacy signals", () => {
    const helper = source.slice(source.indexOf("async function recordCapturedMaterializationEffects"), source.indexOf("export async function materializeCapturedDepletion"));
    expect(helper).not.toContain('from("toast_daily_sales_signals")');
    expect(helper).toContain("recordResolutionFlipsForLocation(locationId)");
    expect(helper).not.toContain("toast_sales_events");
  });

  it("runs only after atomic capture depletion publication succeeds", () => {
    const capture = source.slice(source.indexOf("export async function materializeCapturedDepletion"));
    expect(capture.indexOf('sb.rpc("replace_toast_depletion_day"')).toBeLessThan(capture.indexOf("recordCapturedMaterializationEffects("));
  });
});
