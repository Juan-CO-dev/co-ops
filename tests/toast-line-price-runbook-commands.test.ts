// Item 1 PR B fix round 1 (ITEM1B-r1 P2 #2): the runbook's canary and recovery commands must actually load
// their server modules. lib/supabase-server imports "server-only", which THROWS unless node resolves it under
// the react-server condition (vitest's alias hides this). This test reads the commands FROM THE RUNBOOK and
// executes each entry point's real import graph in a child node process, offline: no env file, no Supabase,
// no Toast credentials, so nothing can be read or written. A command without the condition must fail by
// name (`needs_react_server_condition`), never as a masked generic failure.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scriptErrorCode } from "../scripts/script-error-code";

const ROOT = path.resolve(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const runbook = readFileSync(path.join(ROOT, "docs", "runbooks", "toast-line-prices.md"), "utf8");
const commands = runbook.split(/\r?\n/).map((l) => l.replace(/^\s*`?|`?\s*(#.*)?$/g, "").trim())
  .filter((l) => /^npx tsx .*scripts\/(toast-line-price-canary|ezcater-shadow-backfill)\.ts/.test(l));

/** The documented command, run as `npx tsx` would run it, minus the env file (offline). */
function runDocumented(command: string, { dropCondition = false } = {}) {
  const args = command.replace(/^npx tsx /, "").split(/\s+/)
    .filter((a) => !a.startsWith("--env-file") && !(dropCondition && a === "--conditions=react-server"))
    .map((a) => (a === "R1" ? "2026-10-01" : a === "R2" || a === "C" ? "2026-10-02" : a === "N" ? "0" : a))
    .filter((a) => a !== "--execute"); // offline: never the write mode
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/SUPABASE|TOAST|EZCATER|STRIPE|NODE_OPTIONS|VITEST/.test(k)));
  const out = spawnSync(process.execPath, [TSX_CLI, ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 90_000 });
  return { status: out.status, stderr: out.stderr.trim() };
}

describe("runbook commands (docs/runbooks/toast-line-prices.md)", () => {
  it("documents the canary and the recovery commands, every one under the react-server condition", () => {
    expect(commands.some((c) => c.includes("toast-line-price-canary.ts"))).toBe(true);
    expect(commands.filter((c) => c.includes("ezcater-shadow-backfill.ts")).length).toBeGreaterThanOrEqual(3);
    for (const command of commands) expect(command).toMatch(/^npx tsx --conditions=react-server --env-file=\.env\.local scripts\//);
  });

  it("the canary command loads its whole server import graph and stops at the capture switch (offline)", () => {
    const canary = commands.find((c) => c.includes("toast-line-price-canary.ts") && c.includes("--date"))!;
    expect(runDocumented(canary)).toEqual({ status: 1, stderr: "capture_disabled_or_fixture" });
    // Negative control: without the condition the graph cannot load, and the CLI says so by name.
    expect(runDocumented(canary, { dropCondition: true })).toEqual({ status: 1, stderr: "needs_react_server_condition" });
  }, 120_000);

  it("the recovery command loads its whole server import graph (offline: fails only for want of credentials)", () => {
    const recovery = commands.find((c) => c.includes("ezcater-shadow-backfill.ts --links-only") && !c.includes("--execute"))!;
    const loaded = runDocumented(recovery);
    expect(loaded.status).toBe(1);
    expect(loaded.stderr).toBe("shadow_backfill_failed");
    // Negative control: its server imports are static, so without the condition it dies loading, on server-only's throw.
    const unloaded = runDocumented(recovery, { dropCondition: true });
    expect(unloaded.status).not.toBe(0);
    expect(unloaded.stderr).toContain("cannot be imported from a Client Component module");
  }, 120_000);
});

describe("scriptErrorCode", () => {
  it("passes a named code through, names a missing react-server condition, and masks anything else", () => {
    expect(scriptErrorCode(new Error("canary_page_cap"), /^canary_|^capture_/, "canary_failed")).toBe("canary_page_cap");
    expect(scriptErrorCode(new Error("This module cannot be imported from a Client Component module. It should only be used from a Server Component."), /^canary_/, "canary_failed"))
      .toBe("needs_react_server_condition");
    expect(scriptErrorCode(new Error("PGRST: secret detail"), /^canary_/, "canary_failed")).toBe("canary_failed");
    expect(scriptErrorCode("not an error", /^canary_/, "canary_failed")).toBe("canary_failed");
  });
});
