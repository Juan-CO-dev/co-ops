import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Launch-day hotfix pins: the PIN confirm must POST once, and a late
// "instance_closed" must never overwrite a saved closing's success banner.
const modal = readFileSync("components/auth/PinConfirmModal.tsx", "utf8");
const closing = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");

/** Body of every `setPin((prev) => { ... })` updater (brace-balanced). */
function updaterBodies(src: string): string[] {
  const out: string[] = [];
  const re = /setPin\(\s*\(\s*\w+\s*\)\s*=>\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    if (src[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      out.push(src.slice(start, i + 1));
    } else {
      out.push(src.slice(i, src.indexOf(")", i) + 1));
    }
  }
  return out;
}

describe("PinConfirmModal fires the confirm POST once", () => {
  it("has setPin updaters (sanity) and none schedules a side effect", () => {
    const bodies = updaterBodies(modal);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toMatch(/setTimeout/);
      expect(b).not.toMatch(/submit\s*\(/);
    }
  });

  it("submit() starts with the inFlight guard", () => {
    expect(modal).toMatch(/const inFlight = useRef\(false\)/);
    const at = modal.indexOf("async (full: string) => {");
    expect(at).toBeGreaterThan(-1);
    const head = modal.slice(at, at + 200).replace(/\s+/g, " ");
    expect(head).toContain("if (inFlight.current) return; inFlight.current = true;");
  });

  it("digit and system input are guarded by inFlight alongside submitting", () => {
    expect(modal).toMatch(/handleDigit = useCallback\(\s*\(d: string\) => \{\s*if \(submitting \|\| inFlight\.current\) return;/);
    expect(modal).toMatch(/handleSystemInput = useCallback\(\s*\(value: string\) => \{\s*if \(submitting \|\| inFlight\.current\) return;/);
  });

  it("releases the guard on non-success exits and re-open, but not on success", () => {
    expect(modal).toMatch(/if \(!confirmed\) inFlight\.current = false;/);
    expect(modal).toMatch(/useEffect\(\(\) => \{\s*if \(open\) inFlight\.current = false;\s*\}, \[open\]\)/);
  });
});

describe("closing-client handles a late instance_closed", () => {
  const start = closing.indexOf("const handlePinError = useCallback(");
  const end = closing.indexOf("// ─── Auto-collapse on scroll-past");
  const handler = closing.slice(start, end);

  it("locates the handler", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("no longer renders concurrent_modification for instance_closed", () => {
    expect(handler).not.toContain("closing.error.concurrent_modification");
    expect(handler).toContain("closing.error.instance_closed");
  });

  it("ignores a late error once THIS tab confirmed (ref, not stale state)", () => {
    expect(closing).toMatch(/const confirmedHereRef = useRef\(false\)/);
    // set in handlePinConfirmed
    const pc = closing.slice(closing.indexOf("const handlePinConfirmed = useCallback("), start);
    expect(pc).toContain("confirmedHereRef.current = true;");
    // checked first thing in the instance_closed path, returning before any banner write
    const guard = handler.indexOf("confirmedHereRef.current");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(handler.indexOf("setBanner"));
    expect(handler).toMatch(/instance_closed"[^]*?confirmedHereRef\.current\)\s*return;/);
  });
});
