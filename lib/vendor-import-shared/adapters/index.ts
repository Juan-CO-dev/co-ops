import type { Adapter } from "../model";
import { pfg } from "./pfg";
import { usfoods } from "./usfoods";
import { receipts } from "./receipts";

export const ADAPTERS: readonly Adapter[] = [pfg, usfoods, receipts];
export function detectAdapter(text: string, hint?: string): Adapter | null {
  const matches = ADAPTERS.filter(adapter => (!hint || adapter.vendor === hint || adapter.id === hint) && adapter.detects(text));
  return matches.length === 1 ? matches[0]! : null;
}
