/**
 * The vault's on/off switch. The whole module (tables aside) deploys dark: every lib entry point,
 * route and page refuses until `VAULT_ENABLED=1` is set in the server environment. Client-safe:
 * in a browser bundle the variable is undefined, so the answer is simply false.
 */
export function vaultEnabled(): boolean {
  return process.env.VAULT_ENABLED === "1";
}
