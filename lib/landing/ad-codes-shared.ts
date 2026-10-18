/** Syntax is not eligibility. Only the server registry accepts a campaign/send code. */
export const UNATTRIBUTED = 'unattributed';
export function validAdCandidate(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}
export function queryAdCandidate(query: string): string | undefined {
  const values = new URLSearchParams(query).getAll('ad');
  return values.length === 1 && validAdCandidate(values[0]) ? values[0] : undefined;
}
export type AdPolicy = (candidate: string) => string;
export const boundedAd: AdPolicy = candidate => validAdCandidate(candidate) ? candidate : UNATTRIBUTED;
