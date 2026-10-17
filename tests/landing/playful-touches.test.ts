import {describe,it,expect} from 'vitest';
import {createTouchArbiter,TOUCHES,validateTouchInventory} from '@/lib/landing/playful-touches-shared';
describe('bounded playful touches',()=>{
 it('requires exactly the six render slots and marks the chip illustrated',async()=>{
  expect(()=>validateTouchInventory(TOUCHES.slice(1))).toThrow();
  expect(()=>validateTouchInventory(TOUCHES.map(t=>({...t,slot:t.slot==='hero'?'unknown':t.slot})))).toThrow();
  const {default:sidecar}=await import('../../assets/provenance/touch-doodle-chip.json');
  expect(sidecar).toHaveProperty('illustrated',true);
 });
 it('assigns distinct families and a single character with bounded durations',()=>{
  expect(new Set(TOUCHES.map(t=>t.id)).size).toBe(TOUCHES.length);
  expect(TOUCHES.filter(t=>t.character)).toHaveLength(1);
  for(const t of TOUCHES)expect(t.duration).toBeLessThanOrEqual(1200);
 });
 it('allows one automatic play per section and one intentional replay, without queues',()=>{
  const a=createTouchArbiter();
  expect(a.claim('hero','auto')).toBe(true);
  expect(a.claim('lineup','auto')).toBe(false);
  a.release('hero');
  expect(a.claim('hero','auto')).toBe(false);
  expect(a.claim('hero','intent')).toBe(true);
  a.release('hero');
  expect(a.claim('hero','intent')).toBe(false);
  expect(a.claim('lineup','auto')).toBe(false);
  expect(a.claim('shops','auto')).toBe(true);
 });
 it('rejects duplicate character assignments and oversized motion recipes',()=>{
  const character=TOUCHES.find(t=>t.character)!;
  expect(()=>validateTouchInventory([character,{...character,slot:'other'}])).toThrow('Repeated decorative character');
  expect(()=>validateTouchInventory([{...character,duration:1201}])).toThrow();
 });
 it('does not let another slot release the active animation',()=>{
  const a=createTouchArbiter();a.claim('hero','auto');a.release('shops');
  expect(a.claim('shops','auto')).toBe(false);
 });
});
