/**
 * Nav PR 9, B6: the notification-read census (plan r2 4.2, 8.2; spec 8.1, 3.7 group 13; risk R5).
 *
 * Every call site of a notification read or mark in `app/**`, `components/**` and `lib/**` (outside lib/notifications.ts,
 * which defines them) applies the S1 rule, `notificationBellRoleAllowed(`, earlier in the same function. The list of
 * call sites is CLOSED: a new one fails here until it is reviewed and added.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const FUNCS = ["loadUnreadForUser", "markAllNotificationsRead", "markNotificationRead", "loadNoticeLocationCodes", "loadBellUnit"];

/** The reviewed call sites: file → the functions it calls. */
export const CALL_SITES: Readonly<Record<string, readonly string[]>> = {
  "app/api/notifications/mark-all-read/route.ts": ["markAllNotificationsRead"],
  "app/api/notifications/unread/route.ts": ["loadBellUnit"],
  "components/nav/notification-actions.ts": ["markNotificationRead"],
  "components/nav/TopBarBell.tsx": ["loadBellUnit"],
  "lib/top-bar-bell.ts": ["loadUnreadForUser", "loadNoticeLocationCodes"],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d))).map(rel).filter((f) => f !== "lib/notifications.ts");

/** Call sites (not imports, not definitions, not comments): `name(` preceded by neither `function ` nor an identifier char. */
function callsIn(src: string): Array<{ fn: string; at: number }> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length)).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  const out: Array<{ fn: string; at: number }> = [];
  for (const fn of FUNCS) {
    const re = new RegExp(`(?<![\\w.]|function )${fn}\\(`, "g");
    for (let m = re.exec(code); m; m = re.exec(code)) out.push({ fn, at: m.index });
  }
  return out;
}
/** The start of the top-level function (or arrow) that holds `at`: the last line before it that opens one at column 0. */
function enclosingStart(src: string, at: number): number {
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w*|const\s+\w+\s*(?::[^=]+)?=)/gm;
  let start = 0;
  for (let m = re.exec(src); m && m.index < at; m = re.exec(src)) start = m.index;
  return start;
}

describe("B6: every notification read or mark is behind the S1 rule", () => {
  const found: Record<string, string[]> = {};
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    const calls = callsIn(src);
    if (calls.length) found[f] = [...new Set(calls.map((c) => c.fn))].sort();
  }

  it("the list of call sites is closed", () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(CALL_SITES).map(([f, fns]) => [f, [...fns].sort()])));
  });

  it.each(Object.keys(CALL_SITES))("%s applies notificationBellRoleAllowed( before each call, in the same function", (f) => {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    for (const c of callsIn(src)) {
      const start = enclosingStart(src, c.at);
      const rule = src.indexOf("notificationBellRoleAllowed(", start);
      expect(rule, `${f}: ${c.fn} at ${c.at}`).toBeGreaterThanOrEqual(0);
      expect(rule, `${f}: ${c.fn} at ${c.at}`).toBeLessThan(c.at);
    }
  });
});
