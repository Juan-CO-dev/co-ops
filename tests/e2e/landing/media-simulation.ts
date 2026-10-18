import type {Page} from '@playwright/test';

/** State-machine evidence only. Native decoder tests must NEVER install this. */
export async function simulateSubdex(page:Page){
  await page.addInitScript(()=>{
    const clocks=new WeakMap<HTMLMediaElement,{time:number;paused:boolean}>();
    const state=(el:HTMLMediaElement)=>{let s=clocks.get(el);if(!s){s={time:0,paused:true};clocks.set(el,s);}return s;};
    const target=(el:HTMLMediaElement)=>!!el.closest('[data-testid="subdex-motion"]');
    for(const key of ['currentTime','paused','readyState'] as const){
      const original=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,key)!;
      Object.defineProperty(HTMLMediaElement.prototype,key,{configurable:true,get(){
        if(!target(this))return original.get!.call(this);
        return key==='currentTime'?state(this).time:key==='paused'?state(this).paused:2;
      },set(value){if(target(this)&&key==='currentTime')state(this).time=value;else original.set?.call(this,value);}});
    }
    const width=Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype,'videoWidth')!;
    Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{configurable:true,get(){return target(this)?720:width.get!.call(this);}});
    Object.defineProperty(HTMLVideoElement.prototype,'requestVideoFrameCallback',{configurable:true,value:undefined});
    const originalPlay=HTMLMediaElement.prototype.play,originalPause=HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play=function(){
      if(!target(this))return originalPlay.call(this);
      Reflect.set(window,'subdexAttempts',Number(Reflect.get(window,'subdexAttempts')??0)+1);
      state(this).paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause=function(){if(!target(this))return originalPause.call(this);state(this).paused=true;this.dispatchEvent(new Event('pause'));};
    document.addEventListener('error',e=>{if(e.target instanceof HTMLMediaElement&&target(e.target))e.stopImmediatePropagation();},true);
    setInterval(()=>{for(const el of document.querySelectorAll<HTMLVideoElement>('[data-testid="subdex-motion"] video')){
      if(!state(el).paused&&!Reflect.get(window,'subdexFreeze')){state(el).time+=.1;el.dispatchEvent(new Event('timeupdate'));}
    }},100);
  });
}
