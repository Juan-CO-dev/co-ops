export const MEDIA_READY_TIMEOUT_MS=1500;
/** A signal never bypasses paint; missing performance entries never latch readiness. */
export function createMediaReadiness(startedAt:number){
  let paints=0,signalled=false;
  return {
    paint(){paints++;},
    signal(){signalled=true;},
    ready(now:number){return paints>=2&&(signalled||now-startedAt>=MEDIA_READY_TIMEOUT_MS);},
  };
}

export function waitForMediaReadiness(onReady:()=>void){
  const gate=createMediaReadiness(performance.now());
  let stopped=false,frame=0,observer:PerformanceObserver|undefined;
  const check=()=>{if(!stopped&&gate.ready(performance.now())){stop();onReady();}};
  const signal=()=>{gate.signal();check();};
  const timer=window.setTimeout(check,MEDIA_READY_TIMEOUT_MS);
  function stop(){stopped=true;cancelAnimationFrame(frame);clearTimeout(timer);observer?.disconnect();window.removeEventListener('load',signal);}
  frame=requestAnimationFrame(()=>{gate.paint();frame=requestAnimationFrame(()=>{gate.paint();check();});});
  if(document.readyState==='complete')signal();
  else window.addEventListener('load',signal,{once:true});
  try{
    if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')){
      observer=new PerformanceObserver(entries=>{if(entries.getEntries().length)signal();});
      observer.observe({type:'largest-contentful-paint',buffered:true});
    }
  }catch{/* Load or the deadline still releases readiness. */}
  return stop;
}
