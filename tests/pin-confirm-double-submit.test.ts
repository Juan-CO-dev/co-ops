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
  it("has no setPin updaters left (the ref is the source of truth) and none schedules a side effect", () => {
    const bodies = updaterBodies(modal);
    expect(bodies.length).toBe(0);
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
    expect(modal).toMatch(/if \(!confirmed\) \{\s*inFlight\.current = false;/);
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

// ─── B3 / #57: Cancel, Escape and Clear are dead from the moment the 4th digit
// schedules the POST (the 60 ms window before `submitting` flips). ───────────
describe("PinConfirmModal queued window (#57)", () => {
  it("sets a queued flag when the submit is scheduled and keeps the timer id in a ref", () => {
    expect(modal).toMatch(/const \[queued, setQueued\] = useState\(false\)/);
    expect(modal).toMatch(/const queuedTimer = useRef<number \| null>\(null\)/);
    const at = modal.indexOf("const queueSubmit = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const body = modal.slice(at, at + 400);
    expect(body).toContain("setQueued(true)");
    expect(body).toContain("queuedTimer.current = window.setTimeout(");
  });

  it("digit and system-keyboard paths schedule through queueSubmit, not a bare setTimeout", () => {
    expect(modal).not.toMatch(/window\.setTimeout\(\(\) => void submit\(/);
    expect(modal).toMatch(/if \(step\.completed\) queueSubmit\(step\.pin\);/);
    expect(modal).toMatch(/entry\.input\(value\)[^]*?queueSubmit\(step\.pin\)/);
  });

  it("Cancel, Clear, digits and the toggle are disabled while queued", () => {
    expect(modal).toMatch(/onClick=\{handleCancel\}\s*disabled=\{submitting \|\| queued\}/);
    expect(modal).toMatch(/onClick=\{handleClear\} disabled=\{submitting \|\| queued\}/);
    expect(modal).toMatch(/onClick=\{\(\) => handleDigit\(d\)\} disabled=\{submitting \|\| queued\}/);
    expect(modal).toMatch(/handleClear = useCallback\(\(\) => \{\s*if \(submitting \|\| queued\) return;/);
  });

  it("Escape and Backspace (the keydown handler) bail while queued", () => {
    expect(modal).toMatch(/function onKey\(e: KeyboardEvent\) \{[^]*?if \(submitting \|\| queued \|\| inFlight\.current \|\| entry\.frozen\) return;/);
    // Escape goes through handleCancel, never a raw onCancel()
    expect(modal).toMatch(/e\.key === "Escape"\)[^]*?handleCancel\(\);/);
  });

  it("Cancel and close/unmount clear the scheduled timer", () => {
    const cancel = modal.slice(modal.indexOf("const handleCancel = useCallback("));
    expect(cancel.slice(0, 350)).toContain("clearQueued();");
    expect(modal).toMatch(/window\.clearTimeout\(queuedTimer\.current\)/);
    expect(modal).toMatch(/useEffect\(\(\) => \{\s*if \(!open\) clearQueued\(\);\s*return clearQueued;\s*\}, \[open, clearQueued\]\)/);
  });

  it("submit() clears the queued flag once the POST actually starts", () => {
    const at = modal.indexOf("async (full: string) => {");
    expect(modal.slice(at, at + 400)).toContain("setQueued(false);");
  });
});

// ─── B3 / #55: the login keypad had the same updater side effect, and it
// re-enabled itself while the route was still loading. ──────────────────────
const keypad = readFileSync("components/auth/PinKeypad.tsx", "utf8");

describe("PinKeypad (tile login) fires the PIN POST once (#55)", () => {
  it("has no setPin updaters left (the ref is the source of truth) and none schedules a side effect", () => {
    const bodies = updaterBodies(keypad);
    expect(bodies.length).toBe(0);
    for (const b of bodies) {
      expect(b).not.toMatch(/setTimeout/);
      expect(b).not.toMatch(/submit\s*\(/);
      expect(b).not.toMatch(/queueSubmit\s*\(/);
    }
  });

  it("digit input computes `next` outside any updater and queues once", () => {
    expect(keypad).toMatch(/const step = entry\.append\(d\);\s*if \(!step\) return;[^]*?setPin\(step\.pin\);\s*if \(step\.completed\) queueSubmit\(step\.pin\);/);
  });

  it("queueSubmit takes an inFlight latch and locks the keypad at the 4th digit", () => {
    expect(keypad).toMatch(/const inFlight = useRef\(false\)/);
    const at = keypad.indexOf("const queueSubmit = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const head = keypad.slice(at, at + 400).replace(/\s+/g, " ");
    expect(head).toContain("if (inFlight.current) return; inFlight.current = true; setSubmitting(true);");
  });

  it("digit, clear and system input check the latch alongside submitting", () => {
    expect(keypad).toMatch(/if \(submitting \|\| inFlight\.current \|\| retryRemaining !== null\) return;/);
    expect(keypad).toMatch(/handleClear = useCallback\(\(\) => \{\s*if \(submitting \|\| inFlight\.current\) return;/);
    expect(keypad).toMatch(/handleSystemInput = useCallback\(\s*\(value: string\) => \{\s*if \(submitting \|\| inFlight\.current\) return;/);
  });

  it("stays locked on an ok answer when lockOnSuccess, and releases on every failure", () => {
    expect(keypad).toMatch(/lockOnSuccess\?: boolean/);
    expect(keypad).toMatch(/if \(result\.ok\) navigating = lockOnSuccess;/);
    expect(keypad).toMatch(/if \(navigating\) \{[^]*?\} else \{\s*release\(\);/);
    // the dead-keypad escape hatch exists
    expect(keypad).toMatch(/NAVIGATE_RELEASE_MS/);
  });

  it("the login page opts in to lockOnSuccess and maps answers through pinErrorFromResponse", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toMatch(/<PinKeypad[^>]*\blockOnSuccess\b/);
    expect(page).toContain("pinErrorFromResponse(res.status, body.code, body.retry_after_seconds)");
    // the old blanket mapping is gone
    expect(page).not.toMatch(/return \{ ok: false, error: \{ kind: "invalid" \} \};/);
  });

  it("scheduled timers are cleared on unmount", () => {
    expect(keypad).toMatch(/for \(const id of pending\) window\.clearTimeout\(id\)/);
  });
});
