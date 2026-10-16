/** Translate database ownership refusals into the caller's existing route error class.
 * Pure; only use at catalog writes that can reach the ownership triggers.
 */
import { ShopOwnedError, shopOwnedErrorFromRpc } from "@/lib/catalog/shop-owned-shared";

type WriteError = { code?: string; message: string };
type RouteErrorConstructor = new (status: number, code: string, message?: string) => Error;

export function catalogWriteError(error: WriteError, RouteError: RouteErrorConstructor, context: string): Error {
  if (error instanceof ShopOwnedError) return Object.assign(new RouteError(error.status, error.code), error.line ? { line: error.line } : {});
  if (error.message.startsWith("shop_owned:")) {
    try { shopOwnedErrorFromRpc(error.message); } catch (parsed) {
      if (parsed instanceof ShopOwnedError) return Object.assign(new RouteError(parsed.status, parsed.code), parsed.line ? { line: parsed.line } : {});
      // Unknown/malformed namespace messages are programming failures, never client refusals.
      return new Error(`${context}: ${error.message}`);
    }
  }
  if (error.message === "recipe_version:dependencies_busy") return new RouteError(409, "dependencies_busy");
  // PostgREST puts the FK constraint in its message. Match the complete name,
  // never an arbitrary 23503 (actor/parent FKs are server defects).
  if (error.code === "23503" && /(?:^|"|\s)(?:recipe_inputs|recipe_version_lines)_component_(?:sku|item|product)_id_fkey(?:$|"|\s)/.test(error.message)) {
    return new RouteError(400, "invalid_component");
  }
  // Preserve unexpected constraint names in the thrown error: the route rethrows
  // it for Next's server error logging and generic 500, without a client refusal.
  return new Error(`${context}: ${error.message}`);
}
