/**
 * M2 (nav PR 9, plan r2 8.2; was tests/idle-warning-outside-layouts.test.ts): the idle-logout warning, which nav PR 9
 * moves INSIDE the top bar's frame (components/nav/NavFrame.tsx), covers every signed-in page tree.
 *
 * Nav spec r5 §9: /ordering and /training sit outside both layouts, so on a shared shop tablet left on the ordering walk
 * nothing warned and nothing revoked the session. Each page mounts the warning itself, exactly as the frame does: the
 * server's idle limit, the signed-in user, and the session id the page was served for — in EVERY render branch, inside
 * the TranslationProvider the warning reads its strings from. (Step 10 moves those pages onto NavFrame too.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const MOUNT = "<IdleTimeoutWarning idleMinutes={sessionIdleMinutes()} userId={auth.user.id} sessionId={auth.session.id} />";

describe("the frame carries the warning; both layouts render the frame around the page", () => {
  it("NavFrame mounts it exactly once, with exactly this shape", () => {
    const frame = read("components/nav/NavFrame.tsx");
    expect(frame).toContain(MOUNT);
    expect(frame.split("<IdleTimeoutWarning")).toHaveLength(2);
  });
  it.each(["app/(authed)/layout.tsx", "app/admin/layout.tsx"])("%s renders <NavFrame> around {children} and no second warning", (layout) => {
    const src = read(layout);
    expect(src).toContain('import { NavFrame } from "@/components/nav/NavFrame";');
    expect(src).toMatch(/<NavFrame auth={auth}/);
    expect(src.indexOf("<NavFrame")).toBeLessThan(src.indexOf("{children}"));
    expect(src.indexOf("{children}")).toBeLessThan(src.indexOf("</NavFrame>"));
    expect(src).not.toContain("<IdleTimeoutWarning");
  });
});

describe("the idle-logout warning covers the pages outside both layouts", () => {

  it.each([
    ["app/ordering/page.tsx", "/ordering"],
    ["app/training/page.tsx", "/training"],
  ])("%s mounts it with the served session id in every render branch", (file, route) => {
    const src = read(file);
    expect(src).toContain('import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";');
    expect(src).toMatch(/import \{[^}]*\bsessionIdleMinutes\b[^}]*\} from "@\/lib\/session";/);
    // `auth` is this page's own session read, for its own path.
    expect(src).toContain(`const auth = await requireSessionFromHeaders("${route}");`);
    // Every <TranslationProvider> the page returns opens with the warning, so no branch renders without it.
    const providers = [...src.matchAll(/<TranslationProvider initialLanguage=\{\w+\}>/g)];
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const returns = [...src.matchAll(/return \(\s*(?:\/\/[^\n]*\n\s*)*<TranslationProvider/g)];
    expect(returns).toHaveLength(providers.length);
    for (const p of providers) {
      const after = src.slice(p.index! + p[0].length, p.index! + p[0].length + 400);
      expect(after).toContain(MOUNT);
    }
    expect(src.split(MOUNT)).toHaveLength(providers.length + 1);
  });
});
