/** Auto-advance cadence: WCAG 2.2.2 pause control is rendered beside the roster. */
export const AUTO_ADVANCE_MS = 5000;
/** The next card while auto-advancing, or null once one full loop has been shown. */
export function nextFighter(current:number,count:number,advanced:number):number|null {
  if(count<2||advanced>=count-1)return null;
  return (current+1)%count;
}
/** The Crunchy Boi leads the roster; the rest keep the approved roster order. */
export function rosterOrder<T extends {id:string}>(items:readonly T[]):T[] {
  return [...items.filter(item=>item.id==='crunchy-boi'),...items.filter(item=>item.id!=='crunchy-boi')];
}
/** Fighter photos are 2:3. A cover crop shows `visible` of the photo's height (the 4:3 stage:
 * 1/2, the square card: 2/3); this is the object-position (in %) that centres the sub's focal
 * point in that crop, clamped to the photo. Computed here (not in CSS calc) so every engine agrees. */
export const STAGE_VISIBLE=1/2, CARD_VISIBLE=2/3;
export function focalPosition(focusY:number,visible:number):number {
  if(!Number.isFinite(focusY)||!(visible>0&&visible<1))return 50;
  const position=(focusY-visible/2)/(1-visible);
  return Math.round(Math.min(1,Math.max(0,position))*1000)/10;
}
