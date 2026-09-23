/** Playback only: coordinates are normalised to [0,1], no physical model is inferred. */
export async function mountTrajectory(host: HTMLElement) {
  const response=await fetch(host.dataset.src!); if(!response.ok)throw new Error('Trajectory unavailable');
  const data: {fps: number; frames: number[][][]}=await response.json();
  if(!Number.isFinite(data.fps)||data.fps<=0||data.fps>60||!Array.isArray(data.frames)||!data.frames.length||data.frames.length>10000||data.frames.some(f=>!Array.isArray(f)||f.length>2000||f.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))))throw new Error('Invalid trajectory');
  const canvas=host.querySelector('canvas')!,ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
  const button=host.querySelector('button')!,poster=host.querySelector('img')!;
  let frame=0,raf=0,last=0,visible=true,playing=false;
  const draw=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=getComputedStyle(host).getPropertyValue('--accent');for(const [x,y] of data.frames[frame]){ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,5,0,Math.PI*2);ctx.fill();}};
  const tick=(time:number)=>{if(time-last>=1000/data.fps){frame=(frame+1)%data.frames.length;draw();last=time;}raf=requestAnimationFrame(tick);};
  const sync=()=>{cancelAnimationFrame(raf);last=0;if(playing&&visible&&!document.hidden)raf=requestAnimationFrame(tick);button.textContent=playing?'Pause playback':'Play playback';};
  const toggle=()=>{playing=!playing;sync();};
  const motion=matchMedia('(prefers-reduced-motion: reduce)');const reduce=()=>{if(motion.matches){playing=false;sync();}};
  const observer=new IntersectionObserver(([e])=>{visible=e.isIntersecting;sync();});observer.observe(host);
  button.addEventListener('click',toggle);document.addEventListener('visibilitychange',sync);motion.addEventListener('change',reduce);
  canvas.hidden=false;poster.hidden=true;draw();sync();
  return ()=>{cancelAnimationFrame(raf);observer.disconnect();button.removeEventListener('click',toggle);document.removeEventListener('visibilitychange',sync);motion.removeEventListener('change',reduce);};
}
