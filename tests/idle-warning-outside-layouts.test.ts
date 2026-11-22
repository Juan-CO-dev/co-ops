/**
 * Nav spec r5 §9: /ordering and /training sit outside both layouts that mount the idle-logout guard
 * (app/(authed)/layout.tsx, app/admin/layout.tsx), so on a shared shop tablet left on the ordering walk nothing
 * warned and nothing revoked the session. Each page now mounts IdleTimeoutWarning itself, exactly as the layouts
 * do: the server's idle limit, the signed-in user, and the session id the page was served for — in EVERY render
 * branch, inside the TranslationProvider the warning reads its strings from.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const MOUNT = "<IdleTimeoutWarning idleMinutes={sessionIdleMinutes()} userId={auth.user.id} sessionId={auth.session.id} />";

describe("the idle-logout warning covers the pages outside both layouts", () => {
  it("the two layouts mount it with exactly this shape (the pages copy it, not a new prop path)", () => {
    for (const layout of ["app/(authed)/layout.tsx", "app/admin/layout.tsx"]) expect(read(layout)).toContain(MOUNT);
  });

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
