/**
 * Nav PR 4 (plan r2, 7.8): the Back office at 375 px with the real Tailwind stylesheet, in en and es. No app server
 * and no credentials: BackOfficeHub is bundled with esbuild and rendered from fixture view models
 * (tests/fixtures/back-office-hub.ts), then opened in Playwright's Chromium with page.setContent.
 *
 * Asserts, per fixture and language: no horizontal scroll; every row link at least 48 px tall; every disclosure
 * button and job link at least 44 px tall; the jobs row wraps inside the width. Closed groups' rows are not in the
 * default render, so each group's rows are also rendered alone (GroupRows) and checked the same way.
 *
 * Run: node tests/browser/back-office-hub-ui.mjs [<@playwright/test path>] [<screenshot dir>]
 * Screenshots: <dir>/<fixture>-<lang>.png (default tmp/back-office/, git-ignored).
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "@playwright/test");
const shotDir = process.argv[3] || "tmp/back-office";

const root = process.cwd();
const bundled = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { BackOfficeHub, GroupRows } from "./components/admin/back-office/BackOfficeHub";
    import { TranslationProvider } from "./lib/i18n/provider";
    import { FIXTURES } from "./tests/fixtures/back-office-hub";
    export const names = Object.keys(FIXTURES);
    const wrap = (language, node) => renderToStaticMarkup(<TranslationProvider initialLanguage={language}><main className="mx-auto w-full min-w-0 max-w-2xl px-4 py-6">{node}</main></TranslationProvider>);
    export function render(name, language) { return wrap(language, <BackOfficeHub view={FIXTURES[name](language)} />); }
    export function renderRows(name, language) {
      const v = FIXTURES[name](language);
      return wrap(language, <>{[...v.office.groups, v.office.system].map((g) => <section key={g.id} className="co-card p-4"><GroupRows rows={g.rows} checks={v.checks} lang={language} /></section>)}</>);
    }
  ` },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "sandbox-files", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const request = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : args.path;
      if (["util", "stream", "crypto", "async_hooks"].includes(request) || request.startsWith("node:")) return { path: request, external: true };
      // The retry panel and the step-up hooks are client islands never rendered closed; stub the server-only chain.
      if (request === "server-only") return { path: "server-only", namespace: "stub" };
      const require = createRequire(path.join(args.resolveDir || root, "fixture-resolver.cjs"));
      for (const candidate of [request, `${request}.ts`, `${request}.tsx`]) {
        try { return { path: require.resolve(candidate), namespace: "local" }; } catch { /* Try TS extensions. */ }
      }
      throw new Error(`Cannot resolve fixture import ${request}`);
    });
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "", loader: "js" }));
    builder.onLoad({ filter: /.*/, namespace: "local" }, async args => ({ contents: await readFile(args.path, "utf8"),
      loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : args.path.endsWith(".json") ? "json" : "js", resolveDir: path.dirname(args.path) }));
  } }],
});
await mkdir("tmp", { recursive: true });
await mkdir(shotDir, { recursive: true });
const renderPath = path.join(root, "tmp/back-office-browser-render.cjs");
await writeFile(renderPath, bundled.outputFiles[0].text);
const { names, render, renderRows } = createRequire(import.meta.url)(renderPath);
const css = await postcss([tailwind({ base: root })]).process(await readFile("app/globals.css", "utf8"), { from: path.join(root, "app/globals.css") });
const doc = (language, body) => `<!doctype html><html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body>${body}</body></html>`;
const measure = () => ({
  scroll: document.documentElement.scrollWidth,
  rows: [...document.querySelectorAll("[data-backoffice-row]")].map(e => ({ id: e.getAttribute("data-backoffice-row"), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })),
  buttons: [...document.querySelectorAll("button")].map(b => ({ t: b.textContent.slice(0, 30), h: b.getBoundingClientRect().height })),
  jobs: [...document.querySelectorAll("[data-backoffice-job]")].map(a => { const r = a.getBoundingClientRect(); return { t: a.textContent, h: r.height, right: r.right, top: r.top }; }),
  links: [...document.querySelectorAll("a:not([data-backoffice-row])")].map(a => ({ t: a.textContent.slice(0, 30), h: a.getBoundingClientRect().height })),
});

const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  for (const name of names) for (const language of ["en", "es"]) {
    await page.setContent(doc(language, render(name, language)));
    const g = await page.evaluate(measure);
    const tag = `${name} ${language}`;
    assert.equal(g.scroll, 375, `${tag}: page overflow`);
    for (const r of g.rows) assert.ok(r.h >= 48, `${tag}: short row ${JSON.stringify(r)}`);
    for (const b of g.buttons) assert.ok(b.h >= 44, `${tag}: short disclosure ${JSON.stringify(b)}`);
    for (const j of g.jobs) assert.ok(j.h >= 44 && j.right <= 375 - 16 + 0.5, `${tag}: job ${JSON.stringify(j)}`);
    for (const l of g.links) assert.ok(l.h >= 44, `${tag}: short link ${JSON.stringify(l)}`);
    const wraps = new Set(g.jobs.map(j => Math.round(j.top))).size;
    await page.screenshot({ path: path.join(shotDir, `${name}-${language}.png`), fullPage: true });

    await page.setContent(doc(language, renderRows(name, language)));
    const all = await page.evaluate(measure);
    assert.equal(all.scroll, 375, `${tag}: rows overflow`);
    for (const r of all.rows) assert.ok(r.h >= 48, `${tag}: short row ${JSON.stringify(r)}`);
    console.log(`${tag}: 375px, scroll=${g.scroll}, ${g.rows.length} open rows + ${all.rows.length} rows alone >=48px, ${g.buttons.length} disclosures >=44px, ${g.jobs.length} jobs on ${wraps} line(s)`);
  }
} finally { await browser.close(); }
