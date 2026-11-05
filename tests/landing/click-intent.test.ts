import { expect, it, vi } from "vitest";
import { parseLandingEvent } from "@/lib/landing/tracking-schema-shared";
import { createLandingTracker } from "@/lib/landing/tracking-client";
import { parseOrderClick } from "@/lib/landing/order-click-shared";
const now = 1792108800000;
const base = {event_name:"OrderClick", event_id:"d7e520f5-d054-4146-90bb-d7821f0780b6", event_time:now/1000, consent:"accepted",source_url:"https://eat.example/",ad:"unattributed",placement:"hero",mode:"pickup",store:"dupont"};
const parse = (patch:Record<string,unknown>) => parseLandingEvent({...base,...patch},"https://eat.example",now);
it("requires a bounded direct mode and binds stores to pickup only",()=>{
  expect(parse({})).not.toBeNull();
  for(const mode of [undefined,null,"", "curbside", "a"]) expect(parse({mode})).toBeNull();
  expect(parse({store:undefined})).toBeNull();
  expect(parse({mode:"delivery",store:undefined})).not.toBeNull();
  expect(parse({mode:"delivery"})).toBeNull();
});
it("keeps vendor shapes separate and refuses mode on other actions",()=>{
  const vendor={vendor:"ubereats",placement:"footer",store:undefined};
  expect(parse({...vendor,mode:undefined})).not.toBeNull();
  for(const mode of ["pickup","delivery"]) expect(parse({...vendor,mode})).toBeNull();
  for(const event_name of ["Lead","CateringClick","FindLocation"]) expect(parse({event_name})).toBeNull();
});
it("requires store and placement for FindLocation",()=>{
  const visit={event_name:"FindLocation",mode:undefined};
  expect(parse(visit)).not.toBeNull();
  for(const patch of [{store:undefined},{store:"any"},{placement:undefined},{placement:"other"},{item:"frex"}]) expect(parse({...visit,...patch})).toBeNull();
});
it("requires pickup item context and permits optional bounded delivery item context only at item placements",()=>{
  for(const placement of ["lineup","crave","guide"]) {
    expect(parse({placement})).toBeNull();
    expect(parse({placement,item:"frex"})).not.toBeNull();
    for(const item of [undefined,"frex"]) expect(parse({placement,item,mode:"delivery",store:undefined})).not.toBeNull();
    expect(parse({placement,item:"unknown",mode:"delivery",store:undefined})).toBeNull();
  }
  expect(parse({item:"frex",mode:"delivery",store:undefined})).toBeNull();
});
it("counter accepts old clients, new intent pairs, and rejects invented combinations",()=>{
  expect(parseOrderClick({store:"dupont",ad:"unattributed"})).toEqual({store:"dupont",ad:"unattributed",intent:"legacy"});
  expect(parseOrderClick({ad:"unattributed",intent:"delivery"})).toEqual({ad:"unattributed",intent:"delivery"});
  for(const intent of ["pickup","visit"]) expect(parseOrderClick({store:"dupont",ad:"unattributed",intent})).not.toBeNull();
  for(const value of [{store:"any",intent:"delivery"},{store:"dupont",intent:"delivery"},{intent:"pickup"},{intent:"visit"},{store:"any",intent:"visit"},{store:"dupont",intent:"vendor"}]) expect(parseOrderClick({ad:"unattributed",...value})).toBeNull();
});
it.each([false,true])("delivery and visits use consent, correct Meta semantics and separate counters (resolving=%s)",resolving=>{
  const post=vi.fn(),pixel=vi.fn();
  const tracker=createLandingTracker({serverApproved:true,pixelId:"123",capiEnabled:true,sourceUrl:"https://eat.example/",allowedStores:["dupont"],allowedAds:["unattributed"],allowedPlacements:["hero","shops"]},{post,pixel,loadPixel:vi.fn(),revokePixel:vi.fn(),uuid:()=>base.event_id,now:()=>now});
  tracker.dispatch("FindLocation",{store:"dupont",placement:"shops"});
  tracker.dispatch("OrderClick",{mode:"delivery",placement:"hero"});
  expect(post).not.toHaveBeenCalled();
  if(resolving)tracker.beginResolution();else tracker.setConsent(true);
  tracker.dispatch("FindLocation",{store:"dupont",placement:"shops"});
  tracker.dispatch("OrderClick",{mode:"delivery",placement:"hero"});
  const counters=post.mock.calls.filter(call=>call[0]==="/api/landing/order-click").map(call=>call[1]);
  expect(counters).toEqual([{store:"dupont",ad:"unattributed",intent:"visit"},{ad:"unattributed",intent:"delivery"}]);
  const events=post.mock.calls.filter(call=>call[0]==="/api/landing/events").map(call=>call[1]);
  for(const event of events)expect(parseLandingEvent(event,"https://eat.example",now)).not.toBeNull();
  expect(events[0]).toMatchObject({event_name:"FindLocation",store:"dupont"});
  expect(events[0]).not.toHaveProperty("mode");
  expect(events[1]).toMatchObject({event_name:"OrderClick",mode:"delivery"});
  expect(events[1]).not.toHaveProperty("store");
  if(resolving)expect(pixel).not.toHaveBeenCalled();else expect(pixel.mock.calls[0]?.slice(0,2)).toEqual(["track","FindLocation"]);
  tracker.setConsent(false);tracker.dispatch("FindLocation",{store:"dupont",placement:"shops"});expect(post).toHaveBeenCalledTimes(4);
});
