/**
 * The no-notify pin's import walker (Astra chunk G P3-6): the TRANSITIVE import closure of the scheduling code, and the
 * outbound-call scan, written over an injectable file reader so the pin can prove itself against a mutation (a fake
 * sender import, a fake outbound POST) without touching the real tree.
 *
 * Resolution: `@/x` → `x`, relative paths from the importing file; each tried as `.ts`, `.tsx`, `/index.ts`,
 * `/index.tsx`. Anything else is a PACKAGE (recorded by name). `import type` / `export type` lines are skipped (they
 * never execute). Comments are stripped first so prose may name what code may not do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export type Reader = (path: string) => string | null;

export const diskReader: Reader = (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : null);

export function listFiles(root: string, ext = /\.(ts|tsx)$/): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return ext.test(root) ? [root] : [];
  return readdirSync(root).flatMap((f) => listFiles(join(root, f), ext));
}

export const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SPEC = /(?:^|[\s;}])(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

export function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(SPEC)) out.push((m[1] ?? m[2] ?? m[3])!);
  return out;
}

function resolve(spec: string, from: string, read: Reader): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(cand) && read(normalize(cand)) !== null) return normalize(cand);
  }
  return null;
}

export interface Closure {
  /** Every project file reached (normalized relative paths), entries included. */
  files: Set<string>;
  /** Every package imported anywhere in the closure, with one importer. */
  packages: Map<string, string>;
  /** For each reached file, the file that first imported it (the chain is printable). */
  via: Map<string, string>;
}

export function importClosure(entries: readonly string[], read: Reader = diskReader): Closure {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const via = new Map<string, string>();
  const queue = entries.map((e) => normalize(e));
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (files.has(f)) continue;
    const src = read(f);
    if (src === null) continue;
    files.add(f);
    for (const spec of importSpecifiers(src)) {
      const r = resolve(spec, f, read);
      if (r === null) {
        if (!spec.startsWith("@/") && !spec.startsWith(".")) {
          const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
          if (!packages.has(pkg)) packages.set(pkg, f);
        }
        continue;
      }
      if (!files.has(r)) { if (!via.has(r)) via.set(r, f); queue.push(r); }
    }
  }
  return { files, packages, via };
}

export function chain(c: Closure, f: string): string {
  const out = [f];
  let cur = f;
  while (c.via.has(cur) && out.length < 30) { cur = c.via.get(cur)!; out.push(cur); }
  return out.reverse().join(" → ");
}

/** The modules that send: in-app notifications, email, SMS, push, outbound digests, the POS push. */
export const SINK_MODULES = [
  "lib/notifications.ts", "lib/email.ts", "lib/po-email.ts", "lib/po-sms.ts", "lib/sms-messages.ts", "lib/sim-email.ts",
  "lib/report-digests.ts", "lib/report-digests-v2.ts", "lib/report-digests-engine.ts", "lib/job-watch.ts", "lib/job-watch-run.ts",
  "lib/catering/lto-pos-push.ts",
].map((p) => normalize(p));
/** Any module path that names a sending channel is a sink too (a NEW sender cannot hide behind a new name of this shape). */
export const SINK_PATH = /(^|[\\/_-])(notif\w*|e-?mail\w*|sms\w*|push\w*|whatsapp\w*|twilio\w*|sendgrid\w*|mailer\w*)([\\/._-]|$)/i;
/** Packages that send. */
export const SINK_PACKAGES = ["resend", "twilio", "web-push", "nodemailer", "@sendgrid/mail", "firebase-admin", "postmark", "@slack/web-api", "node-pushnotifications"];

/** An outbound HTTP call in code: fetch, axios, http(s).request, or any write method literal. */
export const OUTBOUND = /\bfetch\s*\(|\baxios\b|\bhttps?\.request\s*\(|method:\s*["'](POST|PUT|PATCH|DELETE)["']|\bnew\s+XMLHttpRequest\b|\bnavigator\.sendBeacon\b/;

export function sinkViolations(c: Closure, entries: readonly string[] = []): string[] {
  const out: string[] = [];
  const entrySet = new Set(entries.map((e) => normalize(e)));
  for (const f of c.files) {
    if (SINK_MODULES.includes(f) || (SINK_PATH.test(f.replace(/\.(ts|tsx)$/, "")) && !entrySet.has(f))) out.push(`sink module reached: ${chain(c, f)}`);
  }
  for (const [pkg, from] of c.packages) if (SINK_PACKAGES.includes(pkg)) out.push(`sink package ${pkg}: ${chain(c, from)}`);
  return out.sort();
}

export function outboundViolations(files: readonly string[], read: Reader = diskReader): string[] {
  const out: string[] = [];
  for (const f of files) {
    const src = read(f);
    if (src !== null && OUTBOUND.test(stripComments(src))) out.push(f);
  }
  return out.sort();
}
