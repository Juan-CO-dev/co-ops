/** Human par edits only. Dynamic Pars suggestion verdicts retain PAR_WRITE_MIN. */
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { catalogShopAllowed, catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";

/** One role authority for par edits: operational level 6, any role at 7+. */
export function parWriteRoleAllowed(role: RoleCode): boolean {
  return catalogWriteRoleAllowed(role, getRoleLevel(role));
}

/** Pure pre-I/O bind. Shop activity is checked by the writer before mutation.
 * A missing/global scope never denotes a shop. Preserve GM's opaque foreign-shop refusal.
 */
export function parWriteGate(actor: { role: RoleCode; locations: readonly string[] }, locationId: string | null | undefined):
  { ok: true } | { ok: false; status: 403 | 404; code: "forbidden" | "not_found" } {
  if (!parWriteRoleAllowed(actor.role) || !locationId) return { ok: false, status: 403, code: "forbidden" };
  const level = getRoleLevel(actor.role);
  if (!catalogShopAllowed({ level, locations: actor.locations }, locationId)) {
    return level >= 7 ? { ok: false, status: 404, code: "not_found" } : { ok: false, status: 403, code: "forbidden" };
  }
  return { ok: true };
}
