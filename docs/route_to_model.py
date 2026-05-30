"""
Route a prompt to a specific model via OpenRouter or Ollama.
Aggie's bypass for delegate_task's broken model routing.

Usage:
    route_to_model("Summarize this text", "nvidia/nemotron-3-super-120b-a12b:free")
    route_to_model("Format this", "ollama:llama3.2:3b")
"""

import os, json, urllib.request, subprocess

def route_to_model(prompt, model, system=None):
    # Ollama local models
    if model.startswith("ollama:"):
        local_model = model.split(":", 1)[1]
        result = subprocess.run(
            ["ollama", "run", local_model, prompt],
            capture_output=True, text=True, timeout=120
        )
        return result.stdout.strip()

    # OpenRouter models
    env_path = os.path.expanduser("~/AppData/Local/hermes/.env")
    key = None
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if 'OPENROUTER' in line and 'API_KEY' in line and '=' in line and not line.startswith('#'):
                parts = line.split('=', 1)
                if len(parts) == 2 and parts[1]:
                    key = parts[1].strip().strip('"').strip("'")
                    break

    if not key:
        return "Error: OpenRouter API key not found"

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    data = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": 500
    }).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
        if "choices" in resp and len(resp["choices"]) > 0:
            msg = resp["choices"][0]["message"]
            if msg.get("content"):
                return msg["content"].strip()
            elif msg.get("reasoning"):
                return f"[reasoning only] {msg['reasoning'].strip()}"
        return f"Error: No response. Keys: {list(resp.keys())}"
    except Exception as e:
        return f"Error: {e}"