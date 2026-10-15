// scripts/guide-test/gt.mjs
/** The one tool every guide tester uses. No dependencies: plain Node fetch to the daemon.
 * Usage: node gt.mjs <session> <command> [args]
 *   start [phone|tablet|desktop] [walker] · look · tap <number|label> · type <number|label> <text>
 *   press <key> · scroll [down|up] · back · stop · goto </path> (walkers) · shot <guide/NN-slug.png> [full] (walkers)
 */
const [session, cmd, ...args] = process.argv.slice(2);
if (!session || !cmd) { console.log("usage: node gt.mjs <session> <command> [args]"); process.exit(2); }
const body = { session };
if (cmd === "start") { body.viewport = args[0] ?? "phone"; body.walker = args[1] === "walker"; }
if (cmd === "tap") body.target = args.join(" ");
if (cmd === "type") { body.target = args[0]; body.text = args.slice(1).join(" "); }
if (cmd === "press") body.key = args[0];
if (cmd === "scroll") body.direction = args[0] ?? "down";
if (cmd === "goto") body.path = args[0];
if (cmd === "shot") { body.file = args[0]; body.fullPage = args[1] === "full"; }
try {
  const res = await fetch(`http://127.0.0.1:3199/${cmd}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(await res.text());
  process.exitCode = res.ok ? 0 : 1;
} catch {
  console.log("The test browser is not running. Tell the person running the test.");
  process.exitCode = 1;
}
