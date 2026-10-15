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
  if (error.code === "23503") return new RouteError(400, "invalid_component");
  return new Error(`${context}: ${error.message}`);
}
