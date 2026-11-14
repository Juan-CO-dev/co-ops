export interface Point {x:number;y:number}
/** A soft S-curve from a word (above) down to its ingredient on the photo. */
export function leaderPath(from:Point,to:Point):string {
  const dy=to.y-from.y;
  const r=(n:number)=>Math.round(n*10)/10;
  return `M${r(from.x)} ${r(from.y)} C${r(from.x)} ${r(from.y+dy*.45)} ${r(to.x)} ${r(to.y-dy*.35)} ${r(to.x)} ${r(to.y)}`;
}
/** Where each word is found, as a fraction of the pinned runway (laptop polish, Juan 2026-11-13).
 * The guide pins (sticky, top 16px) while the reader scrolls a fixed runway of GUIDE_RUNWAY_SCREENS,
 * and the six finds are paced EVENLY along it. Juan: no pointer may deploy before the whole photo is
 * on screen, and the last one must point while the whole photo is still there. Pinned, the photo is
 * the largest 2:3 box the pin leaves (CSS), so it is wholly on screen for the entire runway; the
 * first find waits a tenth of the runway (about 0.18 of a screen) past the pin so the photo has
 * visibly settled, and the last lands with a fifth of the runway still pinned (the order action is
 * seen before the photo scrolls away). Measured per viewport by tests/e2e/landing/crave-field-guide. */
export const GUIDE_STEP_AT=[.1,.24,.38,.52,.66,.8] as const;
/** The runway's length in screens (svh): the CSS --guide-runway. */
export const GUIDE_RUNWAY_SCREENS=1.8;
/** Words above the photo; the rest sit below it, so every leader runs from its own word straight
 * into its half of the photo without crossing another word or another leader. */
export const GUIDE_WORDS_ABOVE=3;
/** Where a word's leader starts: the middle of its bottom edge when the word is above the photo,
 * of its top edge when it is below. */
export function leaderStart(word:{left:number;width:number;top:number;bottom:number},photo:{top:number;bottom:number}):Point {
  return {x:word.left+word.width/2,y:word.top>=photo.bottom-1?word.top:word.bottom};
}
/** The flush line, as a fraction of the runway: still pinned (the pin lets go at 1), well past the
 * last find. A reader who gets here with words still queued is scrolling fast (or jumped), so the
 * one-per-beat stagger would carry on after the photo has scrolled away: every queued word lands at
 * once instead (findsNow). Astra review, PR #543. */
export const GUIDE_FLUSH_AT=.92;
/** The trigger band is the top tenth of the viewport. Each step marker runs from its own position
 * to the end of the runway, so it intersects the band exactly once its start has risen above the
 * band's lower edge. The CSS places markers with the same 10svh (see .landing-v5-guide-step). */
export const GUIDE_STEP_BAND=.1;
/** The band as an IntersectionObserver root margin in PIXELS of the given viewport height. A
 * percentage bottom margin is not relied on (how it resolves has differed between the spec text
 * and engines), so the caller rebuilds the observer when the viewport height changes. */
export function guideStepRootMargin(viewportHeight:number):string {
  const height=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:0;
  return `0px 0px -${Math.round(height*(1-GUIDE_STEP_BAND))}px 0px`;
}
/** Without JS the guide is a plain list: no pin, no runway, the photo at its natural size
 * (rendered once, in the page's own noscript style). */
export const GUIDE_NO_JS_CSS='.landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-pin { position:static; display:block; min-height:0; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-runway { display:none; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] :is(.landing-v6-guide-board,.landing-v3-guide-figure) { display:block; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-slot { container-type:normal; flex:none; min-height:0; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-photo { width:100%; }';
/** A step marker has been reached: it is in the band, or (the first report after a reload or a
 * jump) the whole marker already lies above the viewport. Taken from the observer's entry only:
 * no layout reads of our own. */
export function stepReached(isIntersecting:boolean,bottom:number):boolean {
  return isIntersecting||(Number.isFinite(bottom)&&bottom<0);
}
/** The scroll's find target after a marker report. Forward only: a target never falls, and
 * reaching marker k means the first k+1 words are due. */
export function stepTarget(current:number,index:number,reached:boolean,total:number):number {
  if(!reached||!Number.isInteger(index)||index<0)return current;
  return Math.max(current,Math.min(total,index+1));
}
/** The next ingredient the scroll finds: the first one not found yet (taps can skip ahead). */
export function nextUnfound(found:number,total:number):number {
  for(let index=0;index<total;index++)if(!(found&(1<<index)))return index;
  return -1;
}
/** Which words to find right now. Inside the runway the scroll finds one more per beat while the
 * target is ahead (the rest wait their turn); once the flush line is reached, every word not yet
 * found lands at once. Never a word already found (taps can skip ahead). */
export function findsNow(mask:number,target:number,total:number,flush:boolean):number[] {
  if(flush){const due:number[]=[];for(let index=0;index<total;index++)if(!(mask&(1<<index)))due.push(index);return due;}
  if(foundCount(mask,total)>=target)return [];
  const next=nextUnfound(mask,total);
  return next<0?[]:[next];
}
export function foundCount(mask:number,total:number):number {
  let count=0;for(let index=0;index<total;index++)if(mask&(1<<index))count++;
  return count;
}
