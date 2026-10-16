/**
 * Next server-init hook (runs once per server instance, before any request).
 *
 * The ONLY thing it does today: in sim mode (SIM_MODE set by the launch-readiness launcher), install
 * the outbound network guard so the Node runtime can reach exactly the sim app origin and the sim
 * Supabase project — nothing else. Inert in production (no SIM_MODE → no import, no side effect).
 *
 * Why here and not a `--import` preload: a tsx loader in NODE_OPTIONS makes `next dev` (Turbopack)
 * hang before it listens (probed 2026-09-09). `register()` is the sanctioned place to patch the server
 * process, and it runs before Next wraps `fetch`, so the guard sits underneath Next's own fetch.
 */
export async function register(): Promise<void> {
  if (!process.env.SIM_MODE || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installNetworkGuard } = await import("./scripts/sim/launch-readiness/network");
  installNetworkGuard(process.env);
  console.log("[sim] outbound network guard installed (app origin + sim project only)");
}
