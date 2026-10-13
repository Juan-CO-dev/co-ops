// scripts/guide-test/make-workspace.mjs
/** Build one tester workspace OUTSIDE the repo, so a tester can see only its guide.
 * Usage: node scripts/guide-test/make-workspace.mjs <guide> <modelLabel> <round> <lane: claude|codex|api>
 * Writes C:/Users/conta/guide-test-ws/r<round>/<modelLabel>-<guide>/ with guide.md, img/, gt.mjs, PROMPT.md.
 */
import fs from "node:fs";
import path from "node:path";

const [guide, modelLabel, round, lane] = process.argv.slice(2);
const PERSONAS = {
  staff: { shop: "P Street", roleLabel: "Employee", roleWords: "crew member", name: "Maya Torres", pin: "1111", device: "phone", viewport: "phone" },
  manager: { shop: "Capitol Hill", roleLabel: "Assistant General Manager", roleWords: "manager", name: "Nicole Boyd", pin: "8888", password: "sim-nicole-pw", device: "tablet", viewport: "tablet" },
  catering: { shop: "P Street", roleLabel: "General Manager", roleWords: "manager who runs catering", name: "Marcus Webb", pin: "9999", password: "sim-marcus-pw", device: "tablet", viewport: "tablet" },
};
const p = PERSONAS[guide];
if (!p || !modelLabel || !round || !["claude", "codex", "api"].includes(lane)) {
  console.error("usage: make-workspace.mjs <staff|manager|catering> <modelLabel> <round> <claude|codex|api>");
  process.exit(2);
}
const root = process.cwd();
const session = `${modelLabel}-${guide}-r${round}`;
// Catering leads are not part of the day reset, so each run gets its own fake company name.
p.passwordLine = p.password ? `If the app asks for your password, it is **${p.password}**.` : "";
p.company = `Hill Staffers ${modelLabel[0].toUpperCase()}${modelLabel.slice(1)} R${round} LLC`;
const ws = path.join("C:/Users/conta/guide-test-ws", `r${round}`, `${modelLabel}-${guide}`);
fs.rmSync(ws, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
const guideMd = fs.readFileSync(path.join(root, "docs/guides", `${guide}-guide.md`), "utf8").replace(/\]\(img\//g, "](img/");
fs.writeFileSync(path.join(ws, "guide.md"), guideMd);
fs.cpSync(path.join(root, "docs/guides/img"), path.join(ws, "img"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts/guide-test/gt.mjs"), path.join(ws, "gt.mjs"));
const goals = fs.readFileSync(path.join(root, "docs/guides/testing", `goals-${guide}.md`), "utf8").replace(/^#.*\n+/, "");
const reportWhere = lane === "api" ? "call finish with it" : lane === "codex" ? "as your final answer" : `write it with your Write tool to ${path.join(root, "docs/guides/testing", `round-${round}`, `${modelLabel}-${guide}.md`).replace(/\\/g, "/")}, then reply with one line saying it is written`;
const prompt = fs.readFileSync(path.join(root, "docs/guides/testing/tester-prompt.md"), "utf8")
  .replace(/^[\s\S]*?(?=You are testing)/, "")
  .replaceAll("{session}", session).replaceAll("{goals}", goals.trim()).replaceAll("{reportWhere}", reportWhere)
  .replaceAll("{modelLabel}", modelLabel).replaceAll("{guide}", guide)
  .replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m));
fs.writeFileSync(path.join(ws, "PROMPT.md"), prompt);
console.log(JSON.stringify({ ws, session, viewport: p.viewport }));
