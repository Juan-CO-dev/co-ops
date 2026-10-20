"use client";
import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react';
import {spinFrameAt,spinLoadOrder,wrapAngle} from '@/lib/landing/spin-shared';
import {subscribeCalm} from '@/lib/landing/motion-policy-shared';

interface Props {frames:readonly string[];width:number;height:number;label:string;stillLabel:string;valueText:(degrees:number)=>string;
  /** Keep turning on its own (the order sheet): no scroll coupling, no arrival spin; a drag still turns it. */
  auto?:boolean;
  /** Decoration beside another control: hidden from assistive tech, no slider role or keys. */
  decorative?:boolean}
/** One full turn every few seconds while it keeps turning on its own. */
const AUTO_TURN_MS=6000;

/** The drawn Crunchy Boi turntable: scroll turns it, drag/keys turn it, one intro turn
 * on arrival. Frames load only near the viewport; reduced motion and Save-Data keep the
 * single front still. Never a <video>, never controls. */
export function SpinCanvas({frames,width,height,label,stillLabel,valueText,auto=false,decorative=false}:Props) {
  const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const images=useRef<(HTMLImageElement|undefined)[]>([]);
  const angle=useRef(0),frame=useRef(0),drag=useRef<{x:number;angle:number}|null>(null);
  const redraw=useRef<()=>void>(()=>{});
  // The visitor's own turn always wins over the one arrival spin.
  const tookOver=useRef(false);
  const [step,setStep]=useState(0);
  const [interactive,setInteractive]=useState(false);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const element=root.current,surface=canvas.current;if(!element||!surface)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData=Boolean((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData);
    if(reduced||saveData||typeof IntersectionObserver==='undefined')return;
    let disposed=false,visible=false,lastY=scrollY,intro=0,loaded=0,started=false,introDone=false,turning=0,lastTurn=0;
    const context=surface.getContext('2d');
    const draw=()=>{
      frame.current=0;if(!context)return;
      const index=spinFrameAt(angle.current,frames.length,i=>!!images.current[i]);
      const image=index===null?undefined:images.current[index];
      if(!image)return;
      const ratio=Math.min(devicePixelRatio||1,2);
      const w=Math.round(surface.clientWidth*ratio),h=Math.round(surface.clientHeight*ratio);
      if(surface.width!==w||surface.height!==h){surface.width=w;surface.height=h;}
      context.clearRect(0,0,w,h);context.drawImage(image,0,0,w,h);
      if(decorative)return;
      const nextStep=Math.round(wrapAngle(angle.current,frames.length));
      setStep(previous=>previous===nextStep?previous:nextStep);
    };
    const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(draw);};
    redraw.current=schedule;
    // Auto mode: a steady turn while visible; a drag holds it, release resumes from there.
    const turn=(now:number)=>{
      if(disposed||calm)return;
      if(visible&&!drag.current&&lastTurn){angle.current+=(now-lastTurn)*frames.length/AUTO_TURN_MS;schedule();}
      lastTurn=now;turning=requestAnimationFrame(turn);
    };
    const runIntro=()=>{
      if(auto){if(!turning&&loaded>0)turning=requestAnimationFrame(turn);return;}
      if(introDone||loaded<12||!visible)return;introDone=true;
      const start=performance.now(),duration=2400;
      const tick=(now:number)=>{
        if(disposed||tookOver.current)return;
        const t=Math.min(1,(now-start)/duration);
        angle.current=frames.length*(1-Math.pow(1-t,3));schedule();
        if(t<1)intro=requestAnimationFrame(tick);else angle.current=0;
      };
      intro=requestAnimationFrame(tick);
    };
    const load=()=>{
      if(started)return;started=true;
      void (async()=>{
        for(const index of spinLoadOrder(frames.length)){
          if(disposed)return;
          const image=new Image();image.decoding='async';image.src=frames[index]!;
          try{await image.decode();}catch{continue;}
          if(disposed)return;
          images.current[index]=image;loaded++;
          if(loaded===1){setReady(true);setInteractive(true);}
          schedule();runIntro();
        }
      })();
    };
    const near=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){load();near.disconnect();}},{rootMargin:'100% 0px'});
    near.observe(element);
    const inView=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);lastY=scrollY;if(visible)runIntro();},{threshold:.35});
    inView.observe(element);
    // Reduced motion / Save-Data switched on mid-visit: stop the intro and scroll coupling.
    let calm=false;
    const unsubscribeCalm=subscribeCalm(next=>{calm=next;if(next){tookOver.current=true;cancelAnimationFrame(intro);cancelAnimationFrame(turning);turning=0;}});
    const onScroll=()=>{
      const y=scrollY;if(!visible||calm||auto){lastY=y;return;}
      // A real scroll during the arrival spin hands control to the visitor (no snap-back).
      if(Math.abs(y-lastY)>2)tookOver.current=true;
      angle.current+=(y-lastY)/14;lastY=y;schedule();
    };
    addEventListener('scroll',onScroll,{passive:true});
    const resize=new ResizeObserver(schedule);resize.observe(surface);
    return ()=>{disposed=true;unsubscribeCalm();redraw.current=()=>{};cancelAnimationFrame(frame.current);cancelAnimationFrame(intro);cancelAnimationFrame(turning);near.disconnect();inView.disconnect();resize.disconnect();removeEventListener('scroll',onScroll);};
  },[frames,auto,decorative]);
  const nudge=(next:number)=>{tookOver.current=true;angle.current=next;redraw.current();};
  const onPointerDown=(event:PointerEvent<HTMLDivElement>)=>{if(!interactive)return;tookOver.current=true;drag.current={x:event.clientX,angle:angle.current};event.currentTarget.setPointerCapture(event.pointerId);};
  const onPointerMove=(event:PointerEvent<HTMLDivElement>)=>{
    const state=drag.current,surface=canvas.current;if(!state||!surface)return;
    nudge(state.angle-(event.clientX-state.x)*frames.length/(surface.clientWidth*1.2));
  };
  const onPointerUp=()=>{drag.current=null;};
  const onKeyDown=(event:KeyboardEvent<HTMLDivElement>)=>{
    const delta=event.key==='ArrowRight'||event.key==='ArrowUp'?1:event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:0;
    if(event.key==='Home'){event.preventDefault();nudge(0);return;}
    if(!delta)return;event.preventDefault();nudge(Math.round(angle.current)+delta);
  };
  const degrees=Math.round(step*360/frames.length)%360;
  return <div ref={root} data-spin-stage data-spin-ready={ready} className="landing-v3-spin"
    {...(decorative?{'aria-hidden':true,...(interactive?{onPointerDown,onPointerMove,onPointerUp,onPointerCancel:onPointerUp}:{})}:interactive?{role:'slider',tabIndex:0,'aria-label':label,'aria-valuemin':0,'aria-valuemax':359,'aria-valuenow':degrees,'aria-valuetext':valueText(degrees),onPointerDown,onPointerMove,onPointerUp,onPointerCancel:onPointerUp,onKeyDown}:{role:'img','aria-label':stillLabel})}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={frames[0]} width={width} height={height} alt="" loading="lazy" decoding="async" className="landing-v3-spin-still" data-hidden={ready}/>
    <canvas ref={canvas} aria-hidden="true" className="landing-v3-spin-canvas"/>
  </div>;
}
