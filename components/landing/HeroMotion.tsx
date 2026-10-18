"use client";
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {shouldLoadMotion,shouldPlayMotion,type MotionState} from '@/lib/landing/media-policy-shared';
import {waitForMediaReadiness} from '@/lib/landing/media-readiness-shared';
import {observeLandingViewport} from '@/lib/landing/scroll-controller';

/** Optional motion never replaces the reserved, server-rendered still. */
export function HeroMotion({children,src,pauseLabel,playLabel,fallbackLabel,testId='hero-motion'}:{children:ReactNode;src:string;pauseLabel:string;playLabel:string;fallbackLabel:string;testId?:string}){
  const container=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
  const started=useRef(false),attempt=useRef({id:0});
  const entryArmed=useRef(true),restart=useRef(false);
  type RuntimeState=MotionState & {attached:boolean};
  const [state,dispatch]=useState<RuntimeState>({lcpReady:false,triggered:false,visible:false,documentVisible:false,reducedMotion:true,saveData:true,failed:false,paused:false,completed:false,attached:false});
  const setState=useCallback((update:(s:RuntimeState)=>RuntimeState)=>dispatch(s=>{
    const next=update(s);
    const attached=s.attached||next.attached||shouldLoadMotion(next);
    return attached===next.attached?next:{...next,attached};
  }),[]);
  const attached=state.attached;
  const [playing,setPlaying]=useState(false),[posterFailed,setPosterFailed]=useState(false);
  useEffect(()=>{
    const root=container.current!,epoch=attempt.current;
    const connection=(navigator as Navigator & {connection?:EventTarget & {saveData?:boolean}}).connection;
    const preferences=()=>setState(s=>({...s,saveData:connection?.saveData===true,documentVisible:!document.hidden}));
    const cancelReady=waitForMediaReadiness(()=>{preferences();setState(s=>({...s,lcpReady:true}));});
    const stop=observeLandingViewport(root.closest('section')??root,({active:sectionActive,reducedMotion})=>{
      // Hidden-tab notifications pause but are not physical viewport exits.
      // The scheduler uses any intersection, so a sliver at the edge stays one visit.
      const freshEntry=sectionActive&&entryArmed.current;
      if(!sectionActive&&!document.hidden)entryArmed.current=true;
      if(freshEntry){entryArmed.current=false;restart.current=true;}
      const box=sectionActive?root.getBoundingClientRect():null;
      const active=!!box&&box.bottom>0&&box.top<innerHeight;
      const documentVisible=!document.hidden,saveData=connection?.saveData===true;
      setState(s=>{
        if(s.visible===active&&s.reducedMotion===reducedMotion&&s.documentVisible===documentVisible&&s.saveData===saveData&&(!active||s.triggered)&&(!freshEntry||(!s.completed&&!s.paused)))return s;
        return {...s,visible:active,triggered:s.triggered||active,reducedMotion,documentVisible,saveData,...(freshEntry?{completed:false,paused:false}:{})};
      });
    });
    connection?.addEventListener('change',preferences);
    document.addEventListener('visibilitychange',preferences);
    const image=root.querySelector('img');
    // An image can fail before hydration installs React's error handler.
    if(image?.complete&&image.naturalWidth===0)setPosterFailed(true);
    return ()=>{epoch.id++;cancelReady();stop();connection?.removeEventListener('change',preferences);document.removeEventListener('visibilitychange',preferences);};
  },[setState]);
  const canPlay=shouldPlayMotion(state);
  const fail=useCallback(()=>{started.current=false;setPlaying(false);setState(s=>({...s,failed:true}));},[setState]);
  const play=useCallback(()=>{
    const element=video.current;if(!element)return;
    started.current=true;const id=++attempt.current.id;
    element.muted=true;
    if(restart.current){element.currentTime=0;restart.current=false;}
    void element.play().catch(()=>{if(attempt.current.id===id)fail();});
  },[fail]);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    if(canPlay){if(!started.current)play();}
    else {attempt.current.id++;started.current=false;element.pause();}
  },[canPlay,attached,play]);
  useEffect(()=>{
    const element=video.current;if(!attached||!canPlay||!element)return;
    let lastTime=element.currentTime,lastProgress=performance.now(),frame:number|undefined;
    const progress=()=>{
      if(element.currentTime!==lastTime){
        lastTime=element.currentTime;lastProgress=performance.now();
        if(element.readyState>=2&&element.videoWidth>0&&!element.paused)setPlaying(true);
      }
    };
    const decoded=()=>{
      if(element.readyState>=2&&element.videoWidth>0&&!element.paused){setPlaying(true);lastProgress=performance.now();}
      frame=element.requestVideoFrameCallback(decoded);
    };
    if(typeof element.requestVideoFrameCallback==='function')frame=element.requestVideoFrameCallback(decoded);
    const timer=window.setInterval(()=>{progress();if(performance.now()-lastProgress>=8000)fail();},100);
    element.addEventListener('timeupdate',progress);
    return ()=>{clearInterval(timer);if(frame!==undefined)element.cancelVideoFrameCallback(frame);element.removeEventListener('timeupdate',progress);};
  },[attached,canPlay,fail]);
  const allowed=state.lcpReady&&!state.reducedMotion&&!state.saveData;
  const toggle=()=>{
    if(playing&&!state.paused){setState(s=>({...s,paused:true}));return;}
    // Reserve this attempt before flushing so the effect cannot issue a second
    // play outside user activation. Keep the same button and video for retry.
    started.current=true;
    flushSync(()=>{setPlaying(false);setState(s=>({...s,attached:true,failed:false,paused:false,completed:false}));});
    const element=video.current;if(!element)return;
    if(element.error)element.load();
    if(element.ended||state.completed)element.currentTime=0;
    play();
  };
  return <div ref={container} data-testid={testId} data-media-ready={state.lcpReady} data-media-failed={state.failed}>
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#FFE560]">
      <div className={posterFailed?'invisible':undefined} onErrorCapture={()=>setPosterFailed(true)}>{children}</div>
      {posterFailed&&<div role="img" aria-label={fallbackLabel} className="absolute inset-0 flex items-center justify-center p-6 text-center">{fallbackLabel}</div>}
      {attached&&<video ref={video} src={src} muted playsInline preload="none" aria-hidden="true" onError={fail} onPause={()=>setPlaying(false)} onEnded={()=>{started.current=false;setPlaying(false);setState(s=>({...s,completed:true}));}} className={`absolute inset-0 h-full w-full bg-[#FFE560] object-contain ${playing&&canPlay?'opacity-100':'opacity-0'}`}/>}
    </div>
    <div className="min-h-[52px]">{allowed&&<button type="button" aria-pressed={state.paused} onClick={toggle} className="mt-2 inline-flex min-h-11 min-w-11 items-center rounded-lg border border-co-text px-4 font-bold">{playing&&!state.paused?pauseLabel:playLabel}</button>}</div>
  </div>;
}
