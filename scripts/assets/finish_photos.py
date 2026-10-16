"""Local explicit-registry adapter for unchanged REAL-FX v4. Never downloads models."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TOOL = Path("C:/Users/conta/co-scenes-fx-copy/tools/vfx-footage/fxv4/finish.py")
MODELS = Path("C:/Users/conta/.rembg/models")

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="014")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "assets/source-manifest.json").read_text())
    selected = next((p for p in manifest["products"] if p["representative"] == args.only and p["eligible"] and not p["hold"]), None)
    if selected is None:
        raise RuntimeError("Held or unconfirmed source refused")
    if sha(selected["path"]) != selected["sha256"] or sha(TOOL) != manifest["tools"][TOOL.as_posix()]:
        raise RuntimeError("Source or v4 tool changed")
    missing = [name for name in ["cv2", "numpy", "pymatting", "rembg", "scipy", "PIL", "onnxruntime"] if importlib.util.find_spec(name) is None]
    for model in ["u2netp", "birefnet-general"]:
        if not (MODELS / model / (model + ".onnx")).is_file():
            missing.append("local-model:" + model)
    if missing:
        raise RuntimeError("v4 smoke blocked; no install/download attempted: " + ", ".join(missing))
    if args.check:
        print("v4 dependencies, local models, source and tool hashes verified")
        return
    # Do not allow an unresolved environment to produce a supposedly reproducible master.
    lock = (ROOT / "scripts/assets/requirements.lock.txt").read_text()
    if "UNRESOLVED" in lock:
        raise RuntimeError("v4 environment lock unresolved; resolve locally before finishing")
    from PIL import Image
    from rembg import new_session, remove
    work = ROOT / "assets/work/v4"
    work.mkdir(parents=True, exist_ok=True)
    os.environ["U2NET_HOME"] = str(MODELS / "u2netp")
    image = Image.open(selected["path"]).convert("RGB")
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    prob = work / (args.only + "-prob.png")
    remove(image, session=new_session("u2netp"), only_mask=True).save(prob)
    os.environ["U2NET_HOME"] = str(MODELS / "birefnet-general")
    sys.path.insert(0, str(TOOL.parent))
    import finish
    # Retain the v4 hero id so its red-bounce correction remains conditional on sm_014.
    pid = "pro-014" if args.only == "014" else selected["id"]
    target_file = work / "_hero_bread_ab.json"
    target = None if pid == "pro-014" else json.loads(target_file.read_text())
    target_out = finish.finish_photo(pid, {pid: {"path": selected["path"], "prob": str(prob)}}, str(work), target)
    if target_out is not None:
        target_file.write_text(json.dumps(target_out))
    record = json.loads((work / (pid + ".json")).read_text())
    record.update(classification="real-edited", toolSha256=sha(TOOL), adapterSha256=sha(__file__), probabilitySha256=sha(prob), identityEvidence=selected["evidence"])
    (work / (pid + "-provenance.json")).write_text(json.dumps(record, indent=2))
    if sha(selected["path"]) != selected["sha256"]:
        raise RuntimeError("Original changed")
    print("Finished local REAL-EDITED master; visual approval required before export")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
