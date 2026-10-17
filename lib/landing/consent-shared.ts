/** Necessary host-only preference; no marketing identifiers. */
export type ConsentChoice = 'accepted' | 'rejected' | 'unknown';
export interface PrivacySignals { doNotTrack?: string | null; globalPrivacyControl?: boolean }
export function marketingAllowed(serverApproved: boolean, choice: string | undefined, signals: PrivacySignals): boolean {
  return serverApproved && choice === 'accepted' && signals.doNotTrack !== '1' && signals.globalPrivacyControl !== true;
}
export function readConsent(cookie: string): ConsentChoice {
  const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith('landing_consent='));
  if (values.length !== 1) return 'unknown';
  const value = values[0]?.slice('landing_consent='.length);
  return value === 'accepted' || value === 'rejected' ? value : 'unknown';
}
export function consentCookie(choice: Exclude<ConsentChoice, 'unknown'>, secure: boolean): string {
  return `landing_consent=${choice}; Path=/; SameSite=Lax; Max-Age=15552000${secure ? '; Secure' : ''}`;
}
