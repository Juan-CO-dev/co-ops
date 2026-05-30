"""
Flash-direct dispatch wrapper — v5.3 T1-build coding lane.
Calls DeepSeek v4 Flash (deepseek-chat) via direct API for agentic coding tasks.
Saves output to CO-OPS repo, runs pre-gate, returns results.

Usage from Aggie:
    terminal("python scripts/flash-dispatch.py '<prompt>', workdir='~/co-ops')

Returns: JSON with {model, filepath, pre_gate_pass, ...}
"""
import os, sys, json, urllib.request, subprocess, re, tempfile, time

COOPS_ROOT = os.path.expanduser("~/co-ops")
HERMES_ENV = os.path.expanduser("~/AppData/Local/hermes/.env")

def get_api_key():
    with open(HERMES_ENV) as f:
        for line in f:
            if line.startswith("DEEPSEEK_API_KEY="):
                return line.strip().split("=", 1)[1].strip('"').strip("'")
    raise RuntimeError("DEEPSEEK_API_KEY not found")

def call_flash(prompt: str, system: str = None) -> dict:
    """Call DeepSeek v4 Flash. Returns full API response dict."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps({
        "model": "deepseek-chat",
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 8000
    }).encode()

    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {get_api_key()}"
        }
    )

    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())

def extract_code(content: str) -> str:
    """Extract code from inside markdown fences, or return raw content if no fences."""
    # Find the first code fence block
    m = re.search(r'```(?:typescript|ts|tsx|javascript|js|jsx|python|py)?\s*\n(.*?)\n```', content, re.DOTALL)
    if m:
        return m.group(1).strip()
    # No fences found — return as-is (may be raw code)
    # Strip leading/trailing markdown commentary lines (lines that don't look like code)
    lines = content.strip().split("\n")
    return "\n".join(lines).strip()

def extract_filepath(content: str, default: str = None) -> str:
    """Try to extract a filename from the response or markdown heading."""
    # Look for "Filename: path/to/file.ts" or "### path/to/file.ts"
    m = re.search(r'(?:Filename|File|Path):\s*([^\s\n]+)', content, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r'^#+\s*([^\s\n]+\.(?:ts|tsx|js|jsx|css))', content, re.MULTILINE)
    if m:
        return m.group(1)
    return default or f"flash-output-{int(time.time())}.ts"

def run_pre_gate() -> dict:
    """Run pre-gate.sh and return results."""
    result = subprocess.run(
        ["bash", "scripts/pre-gate.sh"],
        cwd=COOPS_ROOT,
        capture_output=True, text=True, timeout=600
    )
    return {
        "passed": result.returncode == 0,
        "exit_code": result.returncode,
        "output": result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout,
        "stderr": result.stderr[-500:] if result.stderr else ""
    }

def dispatch(prompt: str, system: str = None, filepath: str = None, skip_pre_gate: bool = False) -> dict:
    """Full dispatch: call Flash -> save -> pre-gate -> report."""
    start = time.time()

    # 1. Call Flash
    api_result = call_flash(prompt, system)
    model = api_result.get("model", "unknown")
    content = api_result["choices"][0]["message"]["content"]
    tokens = api_result.get("usage", {})

    # 2. Extract and save
    code = extract_code(content)
    if not filepath:
        filepath = extract_filepath(content)
    full_path = os.path.join(COOPS_ROOT, filepath)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w") as f:
        f.write(code + "\n")

    # 3. Pre-gate
    pre_gate = None
    if not skip_pre_gate:
        pre_gate = run_pre_gate()

    elapsed = time.time() - start

    return {
        "model": model,
        "filepath": full_path,
        "tokens": tokens,
        "elapsed_s": round(elapsed, 1),
        "code_lines": len(code.split("\n")),
        "pre_gate": pre_gate,
        "code_preview": code[:300] + ("..." if len(code) > 300 else "")
    }


if __name__ == "__main__":
    # CLI mode: takes prompt as first argument
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python scripts/flash-dispatch.py '<prompt>' [filepath]"}))
        sys.exit(1)

    prompt = sys.argv[1]
    filepath = sys.argv[2] if len(sys.argv) > 2 else None

    result = dispatch(prompt, filepath=filepath)
    print(json.dumps(result, indent=2))
