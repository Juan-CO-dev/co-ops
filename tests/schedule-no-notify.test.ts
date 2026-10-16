/**
 * Scheduling Phase 2, Task 28 — THE NO-NOTIFY PIN and the plan's GREP PROOFS, as tests (so they hold after merge, not
 * just on the day they were run):
 *  1. nothing under lib/scheduling/**, app/api/schedule/**, the draft cron, components/schedule/** or the reconciliation
 *     imports or calls the notification or email modules, or names JOBS_REGISTRY;
 *  2. no shop-code literal ('EM' / 'MEP') in that code — shops are ids and names;
 *  3. the pure (*-shared.ts) scheduling modules read no clock and no randomness (a Date built from a parameter is math);
 *  4. no `toLocale*` in lib/scheduling or components/schedule (dates go through lib/i18n/format);
 *  5. no position-name literal in scheduling LOGIC (only fixture data names positions);
 *  6. no 7shifts write: nothing in lib/scheduling posts, puts, patches or deletes to 7shifts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(root: string, ext = /\.(ts|tsx)$/): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return ext.test(root) ? [root] : [];
  return readdirSync(root).flatMap((f) => files(join(root, f), ext));
}
const SCHEDULING = [
  ...files("lib/scheduling"), ...files("app/api/schedule"), ...files("app/api/cron/schedule-draft"), ...files("app/(authed)/schedule"),
  ...files("components/schedule"), ...files("app/admin/people-reconcile"), ...files("components/admin/people-reconcile"),
];
/** Strip comments so prose may mention what code may not do. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Scheduling Phase 2 — the no-notify pin and the grep proofs", () => {
  it("covers the code (not vacuous)", () => {
    expect(SCHEDULING.length).toBeGreaterThan(60);
    expect(SCHEDULING).toContain(join("lib", "scheduling", "reconcile.ts"));
  });

  it("1. no notification, no email, not in JOBS_REGISTRY", () => {
    for (const f of SCHEDULING) {
      const src = code(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/@\/lib\/notifications|@\/lib\/email|enqueueNotification|sendEmail\(|JOBS_REGISTRY/);
    }
  });

  it("2. no shop-code literal", () => {
    for (const f of SCHEDULING) expect(code(readFileSync(f, "utf8")), f).not.toMatch(/["'`](EM|MEP)["'`]/);
  });

  it("3. the pure scheduling modules read no clock and no randomness", () => {
    const shared = SCHEDULING.filter((f) => f.startsWith(join("lib", "scheduling")) && /-shared\.ts$/.test(f));
    expect(shared.length).toBeGreaterThan(20);
    // A Date built FROM a parameter (time-shared isYmd / addDays, inputs-shared memberSinceDate) is pure date math; a clock
    // read is new Date() with no argument, Date.now() or randomness.
    for (const f of shared) expect(code(readFileSync(f, "utf8")), f).not.toMatch(/Math\.random|Date\.now\(|new Date\(\s*\)/);
  });

  it("4. no toLocale* in lib/scheduling or components/schedule", () => {
    for (const f of SCHEDULING.filter((x) => x.startsWith(join("lib", "scheduling")) || x.startsWith(join("components", "schedule")))) {
      expect(code(readFileSync(f, "utf8")), f).not.toMatch(/toLocale/);
    }
  });

  it("5. no position-name literal in scheduling logic", () => {
    for (const f of files("lib/scheduling")) expect(code(readFileSync(f, "utf8")), f).not.toMatch(/Walk-ins|Expeditor|Prep\/Dishwasher|["']Register["']/);
  });

  it("6. no 7shifts write from scheduling", () => {
    for (const f of files("lib/scheduling")) expect(code(readFileSync(f, "utf8")), f).not.toMatch(/sevenshifts[^\n]*\.(post|put|patch|delete)\(|method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });
});
