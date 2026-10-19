/** Pure turntable math (no I/O): angle is measured in frames, any real number. */
export function wrapAngle(angle:number,count:number):number {
  const wrapped=angle%count;
  return wrapped<0?wrapped+count:wrapped;
}
/** Every 4th frame first (a coarse revolution), then the gaps, in order. */
export function spinLoadOrder(count:number):number[] {
  const coarse=Array.from({length:Math.ceil(count/4)},(_,i)=>i*4).filter(i=>i<count);
  return [...coarse,...Array.from({length:count},(_,i)=>i).filter(i=>i%4!==0)];
}
/** Nearest loaded frame to the angle, searching outward both ways; null when none. */
export function spinFrameAt(angle:number,count:number,loaded:(index:number)=>boolean):number|null {
  const target=Math.round(wrapAngle(angle,count))%count;
  for(let distance=0;distance<=count/2;distance++){
    for(const index of [target+distance,target-distance]){
      const wrapped=((index%count)+count)%count;
      if(loaded(wrapped))return wrapped;
    }
  }
  return null;
}
