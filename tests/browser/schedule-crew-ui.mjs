/** Isolated crew-card geometry with the real Tailwind stylesheet. No app server or credentials. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
// Optional module path lets a dedicated clone use the already-installed local browser harness.
const { chromium } = createRequire(import.meta.url)(process.argv[2] ?? "@playwright/test");

const root = process.cwd();
const bundled = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { TranslationProvider } from "./lib/i18n/provider";
    import { CrewDayCards } from "./components/schedule/CrewDayCards";
    import { OpenShiftList } from "./components/schedule/OpenShiftList";
    import { ShortStretchList } from "./components/schedule/ShortStretchList";
    const positions = { station: { name: "Register and delivery with a long label", nameEs: "Caja y entregas con un nombre largo", role: "register" } };
    const shift = {ref:{date:"2026-10-26",userId:"one",startQ:40},startQ:40,endQ:82,crewType:{id:"mid",name:"Mid"},segments:[{positionId:"station",startQ:40,endQ:82}]};
    const day = {rows:[{userId:"one",name:"Long Name for the Scheduling Fixture",shifts:[shift]}],mod:[{hour:10,userIds:["one"],tone:"gap"}]};
    const opens = [{typeId:"mid",name:"Mid shift with a long descriptive label",fromQ:40,toQ:82,missing:2,reasons:[{key:"schedule.gap.certificate.unresolved_search"}]}];
    const shorts = [{positionId:"station",fromQ:44,toQ:46,missing:1},{positionId:"station",fromQ:52,toQ:54,missing:1}];
    export function render(language) {return renderToStaticMarkup(
      <TranslationProvider initialLanguage={language}><main className="grid min-w-0 gap-3 p-4">
        <OpenShiftList items={opens}/><CrewDayCards day={day} positions={positions} names={{one:"Fixture Manager"}} onSelect={()=>{}}/>
        <ShortStretchList items={shorts} positions={positions}/>
      </main></TranslationProvider>);}
  ` },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "sandbox-files", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const request = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : args.path;
      if (["util", "stream", "crypto", "async_hooks"].includes(request) || request.startsWith("node:")) return { path: request, external: true };
      const require = createRequire(path.join(args.resolveDir || root, "fixture-resolver.cjs"));
      for (const candidate of [request, `${request}.ts`, `${request}.tsx`]) {
        try { return { path: require.resolve(candidate), namespace: "local" }; } catch { /* Try TS extensions. */ }
      }
      throw new Error(`Cannot resolve fixture import ${request}`);
    });
    builder.onLoad({ filter: /.*/, namespace: "local" }, async args => ({ contents: await readFile(args.path, "utf8"),
      loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : args.path.endsWith(".json") ? "json" : "js", resolveDir: path.dirname(args.path) }));
  } }],
});
await mkdir("tmp", { recursive: true });
const renderPath = path.join(root, "tmp/crew-browser-render.cjs");
await writeFile(renderPath, bundled.outputFiles[0].text);
const { render } = createRequire(import.meta.url)(renderPath);
const css = await postcss([tailwind({ base: root })]).process(await readFile("app/globals.css", "utf8"), { from: path.join(root, "app/globals.css") });
const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  for (const language of ["en", "es"]) {
    await page.setContent(`<!doctype html><html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body>${render(language)}</body></html>`);
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll("button")].map(b => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
      cards: [...document.querySelectorAll('[data-section="crew-day-cards"] article')].map(c => ({ left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right })),
    }));
    assert.equal(geometry.scroll, 375, `${language}: page overflow`);
    assert.ok(geometry.controls.length >= 2);
    for (const b of geometry.controls) assert.ok(b.width >= 44 && b.height >= 44, `${language}: small control ${JSON.stringify(b)}`);
    for (const c of geometry.cards) assert.ok(c.left >= 0 && c.right <= 375, `${language}: overflowing card`);
    console.log(`${language}: 375px, scroll=${geometry.scroll}px, ${geometry.controls.length} controls >=44px; stacked crew cards fit`);
  }
} finally { await browser.close(); }
