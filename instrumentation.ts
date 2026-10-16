/** Node initialization: preserve landing Host variance and keep the existing sim guard. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Runtime only: building without a landing allowlist must not freeze this decision.
  if (process.env.LANDING_HOSTS?.trim()) {
    const { installLandingVaryGuard } = await import('./lib/landing/vary-server');
    installLandingVaryGuard();
  }
  if (!process.env.SIM_MODE) return;
  const { installNetworkGuard } = await import('./scripts/sim/launch-readiness/network');
  installNetworkGuard(process.env);
  console.log('[sim] outbound network guard installed (app origin + sim project only)');
}
