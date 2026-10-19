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
