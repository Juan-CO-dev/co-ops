export interface Point {x:number;y:number}
/** A soft S-curve from a word (above) down to its ingredient on the photo. */
export function leaderPath(from:Point,to:Point):string {
  const dy=to.y-from.y;
  const r=(n:number)=>Math.round(n*10)/10;
  return `M${r(from.x)} ${r(from.y)} C${r(from.x)} ${r(from.y+dy*.45)} ${r(to.x)} ${r(to.y-dy*.35)} ${r(to.x)} ${r(to.y)}`;
}
/** IntersectionObserver thresholds for the cross-section photo: one callback per step of
 * visibility, no scroll listener and no layout reads of our own. */
export const GUIDE_SCROLL_THRESHOLDS = Array.from({length:13},(_,i)=>i/12);
/** How many ingredients the scroll has found so far, from the photo's visibility. The photo
 * fully in view (or already scrolled past its top) finds all of them. Callers keep the max:
 * scrolling back never un-finds. */
export function scrollFoundTarget(ratio:number,top:number,total:number):number {
  if(!Number.isFinite(ratio)||!Number.isFinite(top)||total<=0)return 0;
  if(ratio>=.98||top<0)return total;
  return Math.max(0,Math.min(total,Math.floor(ratio*(total+1))));
}
/** The next ingredient the scroll finds: the first one not found yet (taps can skip ahead). */
export function nextUnfound(found:number,total:number):number {
  for(let index=0;index<total;index++)if(!(found&(1<<index)))return index;
  return -1;
}
export function foundCount(mask:number,total:number):number {
  let count=0;for(let index=0;index<total;index++)if(mask&(1<<index))count++;
  return count;
}
