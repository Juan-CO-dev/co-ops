# scripts/guide-test/api_tester.py
"""Guides v2 tester loop for API-only models (GLM and DeepSeek). The model gets the same tools as every other
tester (look/tap/type/press/scroll/back), executed against the guide-test daemon, and ends with `finish(report)`.
Keys are read by NAME from the Hermes .env and never printed.
Usage:
  python scripts/guide-test/api_tester.py --list-models glm|deepseek
  python scripts/guide-test/api_tester.py --provider glm --model glm-5.3 --workspace <dir> --session <id> --out <report.md>
"""
import argparse, json, os, sys, time, urllib.request

ENV = os.path.expanduser("~/AppData/Local/hermes/.env")
PROVIDERS = {
    "glm": ("GLM_API_KEY", "https://api.z.ai/api/paas/v4"),
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com/v1"),
}
DAEMON = "http://127.0.0.1:3199"
MAX_STEPS = 300

def key(name):
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith(name + "="):
                return line.strip().split("=", 1)[1].strip('"').strip("'")
    raise RuntimeError(f"{name} not in the Hermes .env")

def http_json(url, payload=None, auth=None, timeout=600):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if auth: headers["Authorization"] = f"Bearer {auth}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def daemon(cmd, **body):
    req = urllib.request.Request(f"{DAEMON}/{cmd}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.read().decode("utf-8")

def tool(name, desc, props, required):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": required}}}

TOOLS = [
    tool("look", "See the screen: its text, numbered controls, and a screenshot path.", {}, []),
    tool("tap", "Tap a control by its number from the last look, or by its exact label.", {"target": {"type": "string"}}, ["target"]),
    tool("type", "Fill a field (or pick an option in a dropdown) by number or label.", {"target": {"type": "string"}, "text": {"type": "string"}}, ["target", "text"]),
    tool("press", "Press a key: Enter, Tab or Escape.", {"key": {"type": "string"}}, ["key"]),
    tool("scroll", "Scroll the screen.", {"direction": {"type": "string", "enum": ["down", "up"]}}, ["direction"]),
    tool("back", "Go back one screen.", {}, []),
    tool("finish", "End the test and hand in your report (Markdown, in the shape the instructions give).", {"report": {"type": "string"}}, ["report"]),
]

def shrink_old_looks(messages, keep_last=3):
    looks = [i for i, m in enumerate(messages) if m.get("role") == "tool" and m.get("name") == "look"]
    for i in looks[:-keep_last]:
        messages[i]["content"] = messages[i]["content"][:300] + "\n…(older screen, trimmed)"

def run(args):
    kname, base = PROVIDERS[args.provider]
    prompt = open(os.path.join(args.workspace, "PROMPT.md"), encoding="utf-8").read()
    guide = open(os.path.join(args.workspace, "guide.md"), encoding="utf-8").read()
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": "Here is the guide. Read it, then start.\n\n" + guide},
    ]
    daemon("start", session=args.session, viewport=args.viewport)
    report, steps, t0 = None, 0, time.time()
    while steps < MAX_STEPS and report is None:
        shrink_old_looks(messages)
        payload = {"model": args.model, "messages": messages, "tools": TOOLS, "temperature": 0.2, "max_tokens": 4000}
        try:
            data = http_json(f"{base}/chat/completions", payload, auth=key(kname))
        except Exception as e:
            print(f"model call failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr); time.sleep(10); continue
        msg = data["choices"][0]["message"]
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls", "reasoning_content")})
        calls = msg.get("tool_calls") or []
        if not calls:
            messages.append({"role": "user", "content": "Use a tool. When you are done with every goal, call finish with your report."})
            continue
        for c in calls:
            steps += 1
            name = c["function"]["name"]
            try: a = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError: a = {}
            if name == "finish":
                report = a.get("report", "")
                out = "Report received."
            elif name in ("look", "tap", "type", "press", "scroll", "back"):
                out = daemon(name, session=args.session, **a)
            else:
                out = f"Unknown tool {name}."
            messages.append({"role": "tool", "tool_call_id": c["id"], "name": name, "content": out})
    daemon("stop", session=args.session)
    header = f"<!-- tester {args.provider}/{args.model} · session {args.session} · {steps} actions · {round(time.time() - t0)}s -->\n"
    body = report if report is not None else f"# Report — {args.model}\n\nRUN ENDED WITHOUT A REPORT after {steps} actions (limit {MAX_STEPS})."
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + body + "\n")
    print(f"{args.model} {args.session}: {steps} actions -> {args.out}")

def list_models(provider):
    kname, base = PROVIDERS[provider]
    data = http_json(f"{base}/models", auth=key(kname))
    for m in data.get("data", []):
        print(m.get("id"))

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--list-models", choices=list(PROVIDERS))
    p.add_argument("--provider", choices=list(PROVIDERS))
    p.add_argument("--model"); p.add_argument("--workspace"); p.add_argument("--session"); p.add_argument("--out")
    p.add_argument("--viewport", default="phone", choices=["phone", "tablet", "desktop"])
    a = p.parse_args()
    if a.list_models: list_models(a.list_models)
    else: run(a)
