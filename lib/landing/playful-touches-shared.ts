import inventory from '@/config/tenant/landing-touches.json';
export function validateTouchInventory(entries:typeof inventory){
 const slots=new Set<string>(),characters=new Set<string>();let previousCharacter:string|undefined;
 for(const entry of entries){
  if(slots.has(entry.slot)||entry.duration<=0||entry.duration>1200)throw Error('Invalid decorative slot');
  slots.add(entry.slot);
  if(entry.character){
   if(characters.has(entry.id)||previousCharacter===entry.id)throw Error('Repeated decorative character');
   characters.add(entry.id);previousCharacter=entry.id;
  }
 }
 const required=['hero','crave','lineup','field-guide','catering','shops'];
 if(slots.size!==required.length||required.some(slot=>!slots.has(slot)))throw Error('Incomplete decorative slots');
 return entries;
}
export const TOUCHES=validateTouchInventory(inventory);
export type TouchSlot='hero'|'crave'|'lineup'|'field-guide'|'catering'|'shops';
export function createTouchArbiter(){
 const automatic=new Set<string>(),intent=new Set<string>();let active:string|null=null;
 return {
  claim(slot:TouchSlot,reason:'auto'|'intent'){
   const used=reason==='auto'?automatic:intent;
   if(used.has(slot))return false;
   // A competing appearance is consumed, never queued for a later scroll event.
   used.add(slot);if(active)return false;
   active=slot;return true;
  },
  release(slot:TouchSlot){if(active===slot)active=null;},
 };
}
