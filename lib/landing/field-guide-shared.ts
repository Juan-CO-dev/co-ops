export interface Point {x:number;y:number}
/** A soft S-curve from a word (above) down to its ingredient on the photo. */
export function leaderPath(from:Point,to:Point):string {
  const dy=to.y-from.y;
  const r=(n:number)=>Math.round(n*10)/10;
  return `M${r(from.x)} ${r(from.y)} C${r(from.x)} ${r(from.y+dy*.45)} ${r(to.x)} ${r(to.y-dy*.35)} ${r(to.x)} ${r(to.y)}`;
}
/** Where each word is found, as a fraction of the pinned runway (laptop polish, Juan 2026-11-13).
 * Four of the six ingredients sit in the photo's top quarter, so tying a find to the photo's own
 * visibility bunched four finds into the first few wheel ticks. The guide now pins while the
 * reader scrolls a fixed runway, and the six finds are paced EVENLY along it: the first right as
 * it pins, the last with a fifth of the runway left so the order action is seen before it unpins. */
export const GUIDE_STEP_AT=[.05,.2,.35,.5,.65,.8] as const;
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
export const GUIDE_NO_JS_CSS='.landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-pin { position:static; display:block; min-height:0; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-runway { display:none; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v3-guide-figure { display:block; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-slot { container-type:normal; flex:none; min-height:0; } .landing-v2 .landing-v3-guide[data-guide-mode="list"] .landing-v5-guide-photo { width:100%; }';
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
export function foundCount(mask:number,total:number):number {
  let count=0;for(let index=0;index<total;index++)if(mask&(1<<index))count++;
  return count;
}
