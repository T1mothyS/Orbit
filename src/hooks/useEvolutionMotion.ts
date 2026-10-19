import { useEffect,useRef,useState,type RefObject } from 'react';

export function useReducedMotion() {
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  return reduced;
}
export function useVisibleMotion(ref:RefObject<HTMLElement|null>) {
  const [visible,setVisible]=useState(false),[foreground,setForeground]=useState(!document.hidden);
  useEffect(()=>{const visibility=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[]);
  useEffect(()=>{const element=ref.current;if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting&&entries[0].intersectionRatio>=0.08),{threshold:0.08});observer.observe(element);return()=>observer.disconnect();});
  return visible&&foreground;
}
/** Preserve the remaining dwell time when the map or browser is hidden. */
export function useEvolutionAdvance(key:string,enabled:boolean,duration:number,advance:()=>void) {
  const state=useRef({key:'',remaining:duration}),callback=useRef(advance);callback.current=advance;
  useEffect(()=>{
    if(state.current.key!==key)state.current={key,remaining:duration};
    if(!enabled)return;
    const started=performance.now();
    const timer=setTimeout(()=>{state.current.remaining=duration;callback.current();},state.current.remaining);
    return()=>{clearTimeout(timer);state.current.remaining=Math.max(0,state.current.remaining-(performance.now()-started));};
  },[key,enabled,duration]);
}
