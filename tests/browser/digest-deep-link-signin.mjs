/**
 * Digests round 3, PR 1b (plan A7): a digest deep link survives the sign-in and lands on the right part of the page.
 *
 *   signed out → open a digest link with a fragment
 *   → the app redirects to sign-in (`/?next=<path+query>`, the proxy's rule, proxy.ts) and the BROWSER keeps the
 *     fragment on the redirect (it never reaches the server)
 *   → sign in: the login page's own rule re-attaches the fragment to the sanitized `next`
 *     (safeNextPath + withReturnFragment + ownsReturnLink + loginLandingPath, exactly as app/page.tsx calls them)
 *   → the right page, the named section OPEN and IN VIEW.
 *
 * No app server and no credentials: a tiny local HTTP server (127.0.0.1, a free port) serves a two-page fake origin
 * and answers a signed-out request with the proxy's 307, so the browser's own redirect handling is what is tested. The
 * sign-in page is a stub
 * button that runs the login page's real return-link functions; the destination is the REAL PrepDemandClient
 * (bundled with esbuild, hydrated in Chromium with the real Tailwind stylesheet) with five need dates, so every day
 * section starts CLOSED (defaultOpen is only for fewer than 4) — the link must open it (CollapsibleSection's reveal)
 * and scroll it into view. The ?tab= rule is the page's own (isPrepDemandTab). Viewport 375 x 812 (phone), en + es.
 *
 * Not covered here: the real sign-in navigates with the App Router (router.push); this stub does a full navigation.
 * The reveal runs after mount either way (and on hashchange; tests/collapsible-section-reveal.test.ts).
 *
 * Run: node tests/browser/digest-deep-link-signin.mjs [<@playwright/test path>]
 * Not in CI (like the other tests/browser/*.mjs); run by hand.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "@playwright/test");

const root = process.cwd();
const DAYS = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"];
const TARGET_DAY = "2026-11-29";

const bundled = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { PrepDemandClient } from "./components/admin/catering/prep-demand/PrepDemandClient";
    import { TranslationProvider } from "./lib/i18n/provider";
    import { isPrepDemandTab } from "./lib/catering/prep-demand-shared";
    import { safeNextPath, withReturnFragment } from "./lib/nav-redirect";
    import { ownsReturnLink } from "./lib/nav-sign-in-return";
    import { loginLandingPath } from "./lib/shop-context-shared";

    const lang = document.documentElement.lang === "es" ? "es" : "en";
    const params = new URLSearchParams(location.search);
    if (location.pathname === "/") {
      // The sign-in page: on success, app/page.tsx navigateToDashboard's own rule.
      const button = document.getElementById("sign-in");
      button.addEventListener("click", () => {
        document.cookie = "co_session=1; path=/";
        const next = ownsReturnLink(params.get("for"), "u-gm") ? params.get("next") : null;
        location.assign(loginLandingPath(withReturnFragment(safeNextPath(next), window.location.hash), null));
      });
    } else {
      const days = ${JSON.stringify(DAYS)}.map((needDate) => ({ needDate, lines: [{ key: "k-" + needDate, refKind: "item", name: "Chicken salad " + needDate,
        qty: 2, portion: null, overPar: false, parValue: null, wholeEquivDemand: 2, leads: [] }] }));
      const tab = params.get("tab");
      createRoot(document.getElementById("app")).render(
        <TranslationProvider initialLanguage={lang}>
          <main className="mx-auto w-full min-w-0 max-w-2xl px-4 py-6">
            {/* Content above the days, so "in view" means the page really scrolled. */}
            <div style={{ height: "1400px" }} className="co-card p-4">Above the fold</div>
            <PrepDemandClient days={days} locations={[{ id: "a", name: "Shop A" }]} locationId="a" from="2026-11-26" to="2026-12-10"
              lang={lang} skuDemand={{ rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }} surplus={[]} canPull={false}
              initialTab={isPrepDemandTab(tab) ? tab : "prep"} />
            <div style={{ height: "1400px" }}>Below</div>
          </main>
        </TranslationProvider>);
    }
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "app-files", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next/navigation", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ push() {}, refresh() {} }); export const useSearchParams = () => new URLSearchParams(location.search);", loader: "js" }));
    builder.onResolve({ filter: /^@\// }, args => {
      const base = path.join(root, args.path.slice(2));
      const require = createRequire(path.join(root, "resolver.cjs"));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.json`]) {
        try { return { path: require.resolve(candidate) }; } catch { /* next extension */ }
      }
      throw new Error(`Cannot resolve ${args.path}`);
    });
  } }],
});
const script = bundled.outputFiles[0].text;
const css = (await postcss([tailwind({ base: root })]).process(await readFile("app/globals.css", "utf8"), { from: path.join(root, "app/globals.css") })).css;

let language = "en";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const signedIn = (req.headers.cookie ?? "").includes("co_session=1");
  if (url.pathname === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(script); }
  if (url.pathname === "/favicon.ico") { res.writeHead(404); return res.end(); }
  if (url.pathname !== "/" && !signedIn) {
    // proxy.ts: url.pathname = '/'; url.search = ''; next = pathname + search; a 307 (the fragment never reaches the server).
    const to = new URLSearchParams({ next: url.pathname + url.search });
    res.writeHead(307, { location: `/?${to}` });
    return res.end();
  }
  const body = url.pathname === "/"
    ? `<button id="sign-in" class="min-h-[44px]">Sign in</button>`
    : `<div id="app"></div>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}<script src="/app.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

async function run(browser, lang) {
  language = lang;
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const link = `${ORIGIN}/admin/catering/prep-demand?location=a&tab=prep#prep-day-${TARGET_DAY}`;
  await page.goto(link);
  // Signed out: the sign-in page, with the destination in `next` and the fragment kept by the browser.
  const atLogin = new URL(page.url());
  assert.equal(atLogin.pathname, "/", `${lang}: not sent to sign in (${page.url()})`);
  assert.equal(atLogin.searchParams.get("next"), "/admin/catering/prep-demand?location=a&tab=prep", `${lang}: next`);
  assert.equal(atLogin.hash, `#prep-day-${TARGET_DAY}`, `${lang}: the browser dropped the fragment on the redirect`);

  await page.click("#sign-in");
  await page.waitForURL(`**/admin/catering/prep-demand?location=a&tab=prep#prep-day-${TARGET_DAY}`);
  await page.waitForSelector(`#prep-day-${TARGET_DAY} button[aria-expanded="true"]`, { timeout: 5000 });
  await page.waitForTimeout(300);
  const g = await page.evaluate((target) => {
    const sec = document.getElementById(`prep-day-${target}`);
    const r = sec.getBoundingClientRect();
    return {
      url: location.pathname + location.search + location.hash,
      open: sec.querySelector("button").getAttribute("aria-expanded"),
      panel: !!sec.querySelector("[id^='prep-demand-day-']"),
      top: r.top, bottom: r.bottom, vh: window.innerHeight, scrollY: window.scrollY,
      others: [...document.querySelectorAll("section[id^='prep-day-']")].filter((s) => s !== sec).map((s) => s.querySelector("button").getAttribute("aria-expanded")),
      tab: document.querySelector("[role=tab][aria-selected=true]")?.textContent,
    };
  }, TARGET_DAY);
  assert.equal(g.open, "true", `${lang}: the linked section is not open`);
  assert.ok(g.panel, `${lang}: the linked section's panel is not rendered`);
  assert.ok(g.top >= -1 && g.top < g.vh, `${lang}: the linked section is not in view (${JSON.stringify(g)})`);
  assert.ok(g.scrollY > 1000, `${lang}: the page did not scroll (${g.scrollY})`);
  assert.deepEqual(g.others, ["false", "false", "false", "false"], `${lang}: another day opened`);
  assert.deepEqual(errors, [], `${lang}: page errors`);
  console.log(`${lang}: signed out -> ${atLogin.pathname}?next=${atLogin.searchParams.get("next")}${atLogin.hash} -> sign in -> ${g.url}; section open, top=${Math.round(g.top)}px of ${g.vh}, scrollY=${Math.round(g.scrollY)}, tab="${g.tab}"`);
  await context.close();
}

const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  for (const language of ["en", "es"]) await run(browser, language);
  console.log("PASS digest deep link through sign-in");
} finally { await browser.close(); server.close(); }
