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
 *
 * Astra chunk G P3-6 — the full guarantee, not selected names:
 *  7. the TRANSITIVE import closure of every scheduling entry (lib, schedule routes, the cron, the pages, the board, the
 *     reconciliation) reaches no sending module — in-app notifications, email, SMS, push, the digests, the POS push — and
 *     no sending package (resend, twilio, web-push, nodemailer, …); a module whose PATH names a channel counts as one;
 *  8. no outbound HTTP (fetch, axios, http.request, a write-method literal) in app/api/schedule/**, the draft cron or
 *     lib/scheduling/**; in the wider closure only the reviewed same-origin callers;
 *  9. the pin proves itself: a fake sender import (direct and transitive, from a route, the lib and the cron) and a fake
 *     outbound POST in a schedule route each turn it RED.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diskReader, importClosure, importSpecifiers, listFiles, outboundViolations, sinkViolations, type Reader } from "./fixtures/schedule/no-notify-closure";

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

const OUTBOUND_SCOPE = [...files("app/api/schedule"), ...files("app/api/cron/schedule-draft"), ...files("lib/scheduling")];
/** Reviewed: client components posting to our OWN /api routes, and a local helper named `fetch` (pagination). */
const OUTBOUND_REVIEWED = [
  join("components", "admin", "vendors", "shared.ts"), join("components", "auth", "PasswordModal.tsx"), join("lib", "sales-reports.ts"),
].sort();

describe("Astra chunk G P3-6 — the no-notify pin covers sinks, transitive imports and outbound calls", () => {
  it("7. the transitive import closure reaches no notification / email / SMS / push sink, no sending package", () => {
    const c = importClosure(SCHEDULING);
    expect(c.files.size).toBeGreaterThan(SCHEDULING.length); // it really walked past the entries
    expect(c.files.has(join("lib", "session.ts"))).toBe(true);
    expect(sinkViolations(c, SCHEDULING)).toEqual([]);
  });

  it("8. no outbound HTTP in the schedule routes, the draft cron or lib/scheduling; the wider closure only the reviewed same-origin callers", () => {
    expect(OUTBOUND_SCOPE.length).toBeGreaterThan(40);
    expect(OUTBOUND_SCOPE.some((f) => f.startsWith(join("app", "api", "schedule")))).toBe(true);
    expect(OUTBOUND_SCOPE.some((f) => f.startsWith(join("app", "api", "cron", "schedule-draft")))).toBe(true);
    expect(outboundViolations(OUTBOUND_SCOPE)).toEqual([]);
    expect(outboundViolations([...importClosure(SCHEDULING).files])).toEqual(OUTBOUND_REVIEWED);
  });

  describe("9. mutations turn the pin red", () => {
    const route = OUTBOUND_SCOPE.find((f) => f.startsWith(join("app", "api", "schedule")) && f.endsWith("route.ts"))!;
    const cron = OUTBOUND_SCOPE.find((f) => f.startsWith(join("app", "api", "cron", "schedule-draft")))!;
    const libFile = join("lib", "scheduling", "board.ts");
    const overlay = (over: Record<string, string>): Reader => (p) => over[p] ?? diskReader(p);
    const withLine = (f: string, line: string) => ({ [f]: `${line}\n${diskReader(f)!}` });

    it("a fake sender imported DIRECTLY from a route, the lib and the cron → red, each sink class", () => {
      for (const target of [route, libFile, cron]) {
        for (const line of [
          'import { enqueueNotification } from "@/lib/notifications";',
          'import { sendEmail } from "@/lib/email";',
          'import { sendPoSms } from "@/lib/po-sms";',
          'import { Resend } from "resend";',
          'import webpush from "web-push";',
          'import twilio from "twilio";',
        ]) {
          const c = importClosure(SCHEDULING, overlay(withLine(target, line)));
          expect(sinkViolations(c, SCHEDULING).length, `${target} + ${line}`).toBeGreaterThan(0);
        }
      }
    });

    it("Astra chunk H P3-5: discovery is SYNTAX-aware — compact, spaced dynamic, re-export and require forms are all found (and red)", () => {
      expect(importSpecifiers('import{sendPoSms}from"@/lib/po-sms";')).toEqual(["@/lib/po-sms"]);
      expect(importSpecifiers('const sender = import ("@/lib/po-sms");')).toEqual(["@/lib/po-sms"]);
      expect(importSpecifiers('const s = import ( "@/lib/po-sms" );')).toEqual(["@/lib/po-sms"]);
      expect(importSpecifiers('export { sendEmail } from "@/lib/email";\nexport * from "./x";')).toEqual(["@/lib/email", "./x"]);
      expect(importSpecifiers('const t = require ( "twilio" );')).toEqual(["twilio"]);
      expect(importSpecifiers('import type { X } from "@/lib/email";\n// import { y } from "@/lib/email";\nconst s = "import(\\"@/lib/email\\")";')).toEqual([]);
      for (const target of [route, libFile, cron]) {
        for (const line of ['import{sendPoSms}from"@/lib/po-sms";', 'const sender = import ("@/lib/po-sms");']) {
          const c = importClosure(SCHEDULING, overlay(withLine(target, line)));
          expect(sinkViolations(c, SCHEDULING).length, `${target} + ${line}`).toBeGreaterThan(0);
        }
      }
    });

    it("a fake sender reached TRANSITIVELY (route → innocent helper → sender) → red, with the chain", () => {
      const helper = join("lib", "zz-innocent-helper.ts");
      const sender = join("lib", "zz-shift-alerts.ts");
      const over = {
        ...withLine(route, 'import { helper } from "@/lib/zz-innocent-helper";'),
        [helper]: 'import { alertShift } from "./zz-shift-alerts";\nexport const helper = () => alertShift();\n',
        [sender]: 'import { sendEmail } from "@/lib/email";\nexport const alertShift = () => sendEmail();\n',
      };
      const v = sinkViolations(importClosure(SCHEDULING, overlay(over)), SCHEDULING);
      expect(v.some((x) => x.includes("lib" + (route.includes("\\") ? "\\" : "/") + "email.ts") && x.includes("zz-innocent-helper"))).toBe(true);
      // A NEW sender module named for its channel is caught by its path even before it imports a known sink.
      const named = { ...withLine(libFile, 'import { x } from "@/lib/shift-sms";'), [join("lib", "shift-sms.ts")]: "export const x = 1;\n" };
      expect(sinkViolations(importClosure(SCHEDULING, overlay(named)), SCHEDULING).length).toBeGreaterThan(0);
    });

    it("a fake outbound POST in a schedule route, the cron or the lib → red", () => {
      for (const target of [route, cron, libFile]) {
        for (const line of [
          'void fetch("https://hooks.example.invalid/x", { method: "POST" });',
          'export const opts = { method: "POST" };',
        ]) {
          expect(outboundViolations(OUTBOUND_SCOPE, overlay(withLine(target, line))), `${target} + ${line}`).toContain(target);
        }
      }
      // A comment that merely names fetch stays green (prose is allowed).
      expect(outboundViolations(OUTBOUND_SCOPE, overlay(withLine(route, "// never fetch( anything here")))).toEqual([]);
    });
  });
});
