// Item 1 PR B (phase 1): the TOAST_LINE_PRICES switch. With it OFF every captured output, hash and
// error is byte-identical to main; with it ON the content_hash is still main's for every order
// main could capture, so an unchanged order never gets a new snapshot. Golden frozen from main.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import golden from "./fixtures/toast-legacy-hashes.json";
import corpus from "./fixtures/toast/line-price-corpus.json";
import sample from "./fixtures/toast/orders-v2-sample.json";
import paymentStates from "./fixtures/toast/order-payment-states.json";
import { normalizeToastOrder, legacyHashInput } from "@/lib/toast/capture-shared";
import { normalizeModifiedOrder } from "@/lib/toast/capture-modified-shared";
import { toastContentHash } from "@/lib/toast/content-hash";

type Entry = (typeof golden.entries)[number];
const raws: { label: string; raw: unknown; date: string }[] = [
  ...sample.map((raw) => ({ label: `sample:${raw.guid}`, raw, date: "2026-07-22" })),
  { label: "payment-states", raw: paymentStates, date: "2026-07-23" },
  ...corpus.valid.map((raw) => ({ label: `valid:${raw.guid}`, raw, date: "2026-10-08" })),
  ...corpus.malformed.map((m) => ({ label: `malformed:${m.label}`, raw: m.raw, date: "2026-10-08" })),
];
const byLabel = new Map<string, Entry>(golden.entries.map((e) => [e.label, e]));
const modifiedRaw = (raw: unknown) => ({ ...(raw as object), modifiedDate: golden.modifiedDate, businessDate: 20261008 });
const outcome = (f: () => unknown) => { try { return { ok: true as const, out: f() }; } catch (e) { return { ok: false as const, error: (e as Error).message }; } };

describe("switch OFF is byte-identical to main", () => {
  it("covers every corpus entry", () => {
    expect(raws.map((r) => r.label)).toEqual(golden.entries.map((e) => e.label));
  });
  it.each(raws)("$label: day capture output and error match main (default and explicit off)", ({ label, raw, date }) => {
    const frozen = byLabel.get(label)!.capture;
    for (const run of [() => normalizeToastOrder(raw, date), () => normalizeToastOrder(raw, date, { linePrices: false })]) {
      const got = outcome(run);
      if (frozen.ok) {
        expect(got.ok).toBe(true);
        expect(JSON.stringify(got.ok && got.out)).toBe(JSON.stringify(frozen.out));
        expect(toastContentHash(got.ok ? got.out as never : null as never)).toBe(frozen.hash);
      } else expect(got).toEqual({ ok: false, error: frozen.error });
    }
  });
  it.each(raws.filter((r) => r.date === "2026-10-08"))("$label: modified capture output and error match main", ({ label, raw }) => {
    const frozen = byLabel.get(label)!.modified!;
    const got = outcome(() => normalizeModifiedOrder(modifiedRaw(raw), golden.window));
    if (frozen.ok) {
      expect(JSON.stringify(got.ok && got.out)).toBe(JSON.stringify(frozen.out));
      expect(toastContentHash(got.ok ? got.out as never : null as never)).toBe(frozen.hash);
    } else expect(got).toEqual({ ok: false, error: frozen.error });
  });
});

describe("switch ON never changes the content_hash of an order main could capture", () => {
  it.each(raws.filter((r) => byLabel.get(r.label)!.capture.ok))("$label: day and modified hashes equal main's", ({ label, raw, date }) => {
    const on = normalizeToastOrder(raw, date, { linePrices: true });
    expect(toastContentHash(on)).toBe(byLabel.get(label)!.capture.hash);
    expect(JSON.stringify(legacyHashInput(on))).toBe(JSON.stringify(byLabel.get(label)!.capture.out));
    const modified = byLabel.get(label)!.modified;
    if (modified?.ok) {
      const m = normalizeModifiedOrder(modifiedRaw(raw), golden.window, { linePrices: true })!;
      expect(toastContentHash(m)).toBe(modified.hash);
    }
  });
  it("the ON output really carries prices (so the equality above is not vacuous)", () => {
    const on = normalizeToastOrder(corpus.valid[0], "2026-10-08", { linePrices: true });
    expect(on.order.selection_units[0]).toHaveProperty("price_v", 1);
    expect(on.checks[0]!.accounting).toHaveProperty("line_prices");
    expect(JSON.stringify(on)).not.toBe(JSON.stringify(byLabel.get("valid:lp-instore")!.capture.out));
  });
});

describe("closed list of content_hash sites", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
  const files = ["lib", "app", "scripts"].flatMap(walk);
  it("every content_hash assignment in lib/, app/ and scripts/ goes through toastContentHash", () => {
    const sites: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        // A value assignment, not a type annotation (`content_hash: string`) and not a comment.
        if (/\bcontent_hash\s*:(?!\s*string\b)/.test(line) && !/^\s*(\/\/|\*)/.test(line)) sites.push(`${file.replaceAll("\\", "/")}:${i + 1}:${/toastContentHash\(/.test(line) ? "ok" : "BAD"}`);
      });
    }
    expect(sites.filter((s) => s.endsWith("BAD"))).toEqual([]);
    // The two persisted writers (day capture, modified sweep) plus the read-only canary.
    expect(sites.map((s) => s.replace(/:\d+:ok$/, "")).sort()).toEqual(["lib/toast/capture-modified.ts", "lib/toast/capture.ts", "lib/toast/capture.ts"]);
  });
  it("no Toast capture module or script hashes JSON except the helper", () => {
    const scope = files.filter((f) => /^(lib[\\/]toast[\\/]|scripts[\\/].*toast)/.test(f));
    const direct = scope.filter((f) => /createHash\([^)]*\)\s*\.update\(\s*JSON\.stringify\(/.test(readFileSync(f, "utf8")));
    expect(direct.map((f) => f.replaceAll("\\", "/"))).toEqual(["lib/toast/content-hash.ts"]);
  });
});
