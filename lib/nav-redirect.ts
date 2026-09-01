/**
 * safeNextPath — the return-to-origin sanitizer for `?next=` (P2-5).
 *
 * WHY THIS MODULE EXISTS. The login page's post-auth hop read `?next=` and
 * accepted anything starting with "/". `//evil.com` and `/\evil.com` both
 * satisfy that and are PROTOCOL-RELATIVE URLs — every browser resolves them to
 * a third-party origin. `/?next=//evil.com` therefore let a phisher spend the
 * real login ceremony's trust and then hand the signed-in operator to their own
 * page. This is the one place that decides, and every caller goes through it.
 *
 * WHERE IT LIVES, AND WHY IT IS NOT `-shared`. The `<module>-shared.ts` suffix
 * is reserved (AGENTS.md § Module boundaries) for the client-safe HALF of a
 * server-touching module. There is no server `lib/nav.ts` to split — this is a
 * whole pure module in its own right, so it takes the plain `lib/nav-*.ts`
 * spelling its two siblings already use (`nav-links.ts`, `nav-parents.ts`).
 * Zero I/O, no server imports, importable from the client `app/page.tsx`.
 *
 * THE SERVER SIDE IS NOT A CALLER AND MUST NOT BECOME ONE. `proxy.ts` and
 * `requireSessionFromHeaders` BUILD `next` out of `req.nextUrl.pathname`, which
 * is server-authoritative and already same-origin by construction. This
 * sanitizer guards the READ side — the value coming back off the URL bar, which
 * is entirely attacker-controlled.
 */

/** Where an absent or refused `next` goes: the destination login has always meant. */
export const DEFAULT_NEXT_PATH = "/dashboard";

/** Whitespace (space, tab, newline, form feed…) plus the C0 and DEL control chars. */
const FORBIDDEN_CHARS = /[\s\u0000-\u001F\u007F]/;

/**
 * The structural test for "this is a relative path on OUR origin".
 *
 * A single leading "/" and nothing that lets a browser re-read the value as an
 * authority. Note that requiring the leading "/" already excludes every scheme
 * (`https:`, `javascript:`, `data:`) — a scheme cannot appear before it.
 */
function isSameOriginRelative(value: string): boolean {
  if (!value.startsWith("/")) return false;
  // "//evil.com" and "/\evil.com" are both protocol-relative. So is "/\/evil".
  if (value[1] === "/" || value[1] === "\\") return false;
  // A backslash ANYWHERE is refused: browsers normalise "\" to "/" in URLs, so
  // "/dashboard\@evil.com" can re-parse with "evil.com" as the authority.
  if (value.includes("\\")) return false;
  // Whitespace and control characters are stripped or ignored by URL parsers
  // before resolution, so they smuggle the shapes above past a naive check.
  if (FORBIDDEN_CHARS.test(value)) return false;
  return true;
}

/** The path portion — everything before the first "?" or "#". */
function pathPartOf(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** decodeURIComponent, but a malformed escape is a REFUSAL rather than a throw. */
function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Return `raw` when it is a same-origin relative path, else DEFAULT_NEXT_PATH.
 *
 * TWO PASSES, AND THE SECOND ONE COVERS THE PATH ONLY.
 * `useSearchParams().get("next")` already percent-decodes once, so a singly
 * encoded `%2F%2Fevil.com` arrives here as `//evil.com` and the first pass
 * catches it. A DOUBLY encoded `%252F%252Fevil.com` arrives as the literal
 * `/%2F%2Fevil.com`, which passes every first-pass rule — one leading slash, no
 * backslash, no control chars — and resolves to `//evil.com` in anything that
 * decodes once more. The second pass closes that.
 *
 * It re-checks the PATH portion only, because the origin cannot be changed from
 * a query string or a fragment: `?q=sliced%20ham` must keep working, and
 * re-running the whitespace rule over a decoded query would refuse it.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_NEXT_PATH;
  if (!isSameOriginRelative(raw)) return DEFAULT_NEXT_PATH;

  const decodedPath = decodeOnce(pathPartOf(raw));
  if (decodedPath === null) return DEFAULT_NEXT_PATH;
  if (!isSameOriginRelative(decodedPath)) return DEFAULT_NEXT_PATH;

  return raw;
}
