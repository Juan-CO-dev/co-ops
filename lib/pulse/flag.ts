/**
 * Mid-shift Pulse v2 — the feature flag. OFF unless `PULSE_V2=1` exactly (Juan tries it first).
 * Server-only by nature (env), but it imports nothing, so a test can flip it.
 */
export function pulseV2Enabled(): boolean {
  return process.env.PULSE_V2 === "1";
}
