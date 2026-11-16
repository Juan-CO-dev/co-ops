/** The one line an operator CLI prints for a failure (item 1 PR B fix round 1). Pure, zero I/O.
 * A named code the script itself raised passes through; `server-only`'s throw (a server module imported
 * without `--conditions=react-server`) is named `needs_react_server_condition`; anything else is the
 * script's generic code — a raw message may carry a payload or a URL, so it is never printed. */
const SERVER_ONLY_MESSAGE = "cannot be imported from a Client Component module";

export function scriptErrorCode(error: unknown, named: RegExp, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (named.test(error.message)) return error.message;
  if (error.message.includes(SERVER_ONLY_MESSAGE)) return "needs_react_server_condition";
  return fallback;
}
