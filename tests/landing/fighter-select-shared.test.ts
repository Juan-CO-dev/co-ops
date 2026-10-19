import {expect,it} from 'vitest';
import {nextFighter,rosterOrder} from '@/lib/landing/fighter-select-shared';

it('auto-advances through one loop and then stops',()=>{
  const seen=[0];let current=0,advanced=0;
  for(;;){const next=nextFighter(current,4,advanced);if(next===null)break;seen.push(next);current=next;advanced++;}
  expect(seen).toEqual([0,1,2,3]);
  expect(nextFighter(0,1,0)).toBeNull();
});
it('leads with the Crunchy Boi and keeps the rest in order',()=>{
  expect(rosterOrder([{id:'frex'},{id:'crunchy-boi'},{id:'vesuvio'}]).map(item=>item.id)).toEqual(['crunchy-boi','frex','vesuvio']);
});
