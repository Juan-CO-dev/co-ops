import { expect, it, vi } from 'vitest';
import { createLandingTracker } from '@/lib/landing/tracking-client';

it('tracks Dupont Uber Eats through Pixel and CAPI without an Appfront shop counter',()=>{
  const transport={loadPixel:vi.fn(),revokePixel:vi.fn(),pixel:vi.fn(),post:vi.fn(),uuid:()=> 'd7e520f5-d054-4146-90bb-d7821f0780b6',now:()=>1792108800000};
  const tracker=createLandingTracker({serverApproved:true,pixelId:'12345',capiEnabled:true,sourceUrl:'https://eat.example.test/',allowedStores:['capitol-hill','dupont'],allowedAds:['unattributed'],allowedPlacements:['shops','hero','footer']},transport);
  const details={store:'dupont',placement:'shops',vendor:'ubereats'};
  tracker.dispatch('OrderClick',details);
  expect(transport.post).not.toHaveBeenCalled();
  tracker.setConsent(true);
  for(const patch of [{store:'capitol-hill'},{store:undefined},{vendor:'doordash'},{placement:'hero'}]) tracker.dispatch('OrderClick',{...details,...patch});
  tracker.dispatch('Lead',details);
  expect(transport.pixel).not.toHaveBeenCalled();
  expect(transport.post).not.toHaveBeenCalled();
  tracker.dispatch('OrderClick',details);
  expect(transport.pixel).toHaveBeenCalledExactlyOnceWith('trackCustom','OrderClick',{ad:'unattributed',...details},transport.uuid());
  expect(transport.post).toHaveBeenCalledTimes(1);
  expect(transport.post).toHaveBeenCalledWith('/api/landing/events',expect.objectContaining({event_name:'OrderClick',...details}));
});
