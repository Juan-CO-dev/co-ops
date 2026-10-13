// scripts/guide-test/browser-daemon.mjs
/** Guides v2 tester browser. SIM ONLY: every page lives on http://localhost:3100 and nothing else.
 * Run: node scripts/guide-test/browser-daemon.mjs        (listens on 127.0.0.1:3199)
 * Every tester family (Claude subagents, Codex, the GLM/DeepSeek API loop) drives the app through
 * this one daemon (via gt.mjs or plain HTTP), so the comparison is fair and each run has its own
 * browser context. Testers may only look, tap, type, press, scroll and go back; `goto` and `shot`
 * exist for photo walkers only (sessions started with walker=true).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SIM = "http://localhost:3100";
const PORT = 3199;
const RUNS = path.resolve("docs/guides/testing/runs");
const IMG = path.resolve("docs/guides/img");
const SHOT_FILE = /^(staff|manager|catering)\/[0-9]{2}[a-z]?-[a-z0-9-]+\.png$/;
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const CONTROLS = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=option], summary';

const browser = await chromium.launch({ headless: true });
const sessions = new Map();

function log(s, entry) {
  fs.appendFileSync(path.join(s.dir, "actions.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function start({ session, viewport = "phone", walker = false }) {
  if (sessions.has(session)) await stop({ session });
  const dir = path.join(RUNS, session);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ ...(VIEWPORTS[viewport] ?? VIEWPORTS.phone), baseURL: SIM });
  await ctx.route("**/*", (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && !req.url().startsWith(SIM)) return route.abort();
    return route.continue();
  });
  const page = await ctx.newPage();
  const s = { ctx, page, dir, walker: Boolean(walker), looks: 0, dialogs: [] };
  page.on("dialog", async (d) => { s.dialogs.push(`${d.type()}: ${d.message()}`); await d.accept().catch(() => {}); });
  sessions.set(session, s);
  await page.goto("/");
  await settle(page);
  log(s, { action: "start", viewport, walker: s.walker });
  return `OK started ${session} (${viewport}). Now run: look`;
}

async function look({ session }) {
  const s = must(session);
  const { page } = s;
  const controls = await page.$$eval(CONTROLS, (nodes) => {
    let i = 0;
    const out = [];
    for (const n of nodes) {
      n.removeAttribute("data-gt");
      const r = n.getBoundingClientRect();
      const st = getComputedStyle(n);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none" || n.closest('[aria-hidden="true"]')) continue;
      i += 1;
      n.setAttribute("data-gt", String(i));
      const tag = n.tagName.toLowerCase();
      const kind = tag === "input" ? `input:${n.type}` : (n.getAttribute("role") ?? tag);
      const label = (n.getAttribute("aria-label") || n.innerText || n.getAttribute("placeholder") || n.getAttribute("title") || n.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 90);
      let extra = "";
      if (tag === "input" || tag === "textarea") extra = n.type === "checkbox" || n.type === "radio" ? (n.checked ? " [checked]" : " [unchecked]") : ` value="${String(n.value).slice(0, 40)}"`;
      if (tag === "select") extra = ` selected="${n.selectedOptions[0]?.text ?? ""}" options=[${[...n.options].map((o) => o.text).slice(0, 15).join(" | ")}]`;
      if (n.disabled || n.getAttribute("aria-disabled") === "true") extra += " [disabled]";
      out.push(`[${i}] ${kind} "${label}"${extra}`);
    }
    return out;
  });
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
  s.looks += 1;
  const shot = path.join(s.dir, `${String(s.looks).padStart(3, "0")}.png`);
  await page.screenshot({ path: shot });
  const dialogs = s.dialogs.splice(0).map((d) => `DIALOG (accepted) ${d}`).join("\n");
  log(s, { action: "look", url: page.url() });
  return [`URL: ${page.url().replace(SIM, "")}`, `TITLE: ${await page.title()}`, dialogs, "SCREEN TEXT:", text, "", "CONTROLS:", ...controls, "", `SCREENSHOT: ${shot}`].filter((l) => l !== "").join("\n");
}

function locate(page, target) {
  const t = String(target ?? "").trim();
  if (/^#?\d+$/.test(t)) return page.locator(`[data-gt="${t.replace("#", "")}"]`);
  return page.getByRole("button", { name: t }).or(page.getByRole("link", { name: t })).or(page.getByRole("tab", { name: t })).or(page.getByText(t, { exact: true })).first();
}

async function act(session, entry, fn) {
  const s = must(session);
  try {
    await fn(s.page);
  } catch (e) {
    log(s, { ...entry, error: String(e.message).slice(0, 200) });
    return `FAILED: ${String(e.message).split("\n")[0].slice(0, 200)}. The screen may have changed: run look again.`;
  }
  await settle(s.page);
  log(s, { ...entry, url: s.page.url() });
  return `OK. Now at ${s.page.url().replace(SIM, "")}. Run look to see the screen.`;
}

const tap = ({ session, target }) => act(session, { action: "tap", target }, (p) => locate(p, target).click({ timeout: 5000 }));
const type = ({ session, target, text }) => act(session, { action: "type", target, text }, async (p) => {
  const el = locate(p, target);
  const tag = await el.evaluate((n) => n.tagName.toLowerCase(), undefined, { timeout: 5000 });
  if (tag === "select") await el.selectOption({ label: String(text) }, { timeout: 5000 });
  else await el.fill(String(text), { timeout: 5000 });
});
const press = ({ session, key }) => act(session, { action: "press", key }, (p) => p.keyboard.press(String(key)));
const scroll = ({ session, direction = "down" }) => act(session, { action: "scroll", direction }, (p) => p.mouse.wheel(0, direction === "up" ? -700 : 700));
const back = ({ session }) => act(session, { action: "back" }, (p) => p.goBack());

async function goto({ session, path: to }) {
  const s = must(session);
  if (!s.walker) return "REFUSED: testers move by tapping, like a person. goto is for photo walkers only.";
  if (!String(to).startsWith("/")) return "REFUSED: goto takes a path that starts with /.";
  return act(session, { action: "goto", path: to }, (p) => p.goto(String(to)));
}

async function shot({ session, file, fullPage = false }) {
  const s = must(session);
  if (!s.walker) return "REFUSED: shot is for photo walkers only.";
  if (!SHOT_FILE.test(String(file))) return "REFUSED: file must look like staff/07-opening-verify.png";
  const out = path.join(IMG, String(file));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await s.page.screenshot({ path: out, fullPage: Boolean(fullPage) });
  log(s, { action: "shot", file });
  return `OK saved docs/guides/img/${file}`;
}

async function stop({ session }) {
  const s = sessions.get(session);
  if (!s) return "OK (no such session)";
  sessions.delete(session);
  await s.ctx.close().catch(() => {});
  return `OK stopped ${session}`;
}

function must(session) {
  const s = sessions.get(session);
  if (!s) throw new Error(`no session "${session}": run start first`);
  return s;
}

const ROUTES = { start, look, tap, type, press, scroll, back, goto, shot, stop };

http.createServer((req, res) => {
  const name = (req.url ?? "/").slice(1);
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", async () => {
    const fn = ROUTES[name];
    if (req.method !== "POST" || !fn) { res.writeHead(404); return res.end("unknown command"); }
    try {
      const out = await fn(JSON.parse(body || "{}"));
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(out);
    } catch (e) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(`ERROR: ${String(e.message).slice(0, 300)}`);
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`guide-test daemon on http://127.0.0.1:${PORT} (sim ${SIM})`));
