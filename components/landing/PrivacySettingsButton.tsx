"use client";
import { useConsentControl } from './TrackingProvider';

/** "Privacy settings" beside the Privacy link (footer and privacy page): reopens the consent
 * notice — same wording, same controls — so an answered choice can always be changed or withdrawn. */
export function PrivacySettingsButton({label,className}:{label:string;className?:string}) {
  const control=useConsentControl();
  if(!control.available)return null;
  return <button type="button" data-privacy-settings aria-controls="landing-consent-notice" aria-expanded={control.open} onClick={event=>control.openSettings(event.currentTarget)}
    className={className??'inline-flex min-h-11 min-w-11 items-center underline'}>{label}</button>;
}
