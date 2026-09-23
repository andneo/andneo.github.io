type Renderer = { resize(): void; step(): void; draw(): void; dispose(): void };
class ScientificHero extends HTMLElement {
  cleanup?: () => void;
  async connectedCallback() {
    if (this.dataset.enabled !== 'true') return;
    const canvas=this.querySelector('canvas')!,button=this.querySelector('button')!,poster=this.querySelector<SVGElement>('svg')!;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let model: Renderer|undefined,frame=0,last=0,accumulator=0,visible=false,paused=motion.matches,disposed=false;
    const tick=(now:number)=>{
      accumulator+=Math.min(last?now-last:16,80);last=now;
      while(accumulator>=16){model!.step();accumulator-=16;}
      model!.draw();frame=requestAnimationFrame(tick);
    };
    const sync=()=>{cancelAnimationFrame(frame);last=0;accumulator=0;button.textContent=paused?'Play animation':'Pause animation';button.setAttribute('aria-pressed',String(!paused));if(model&&visible&&!paused&&!document.hidden)frame=requestAnimationFrame(tick);};
    const toggle=()=>{paused=!paused;sync();};
    const reduce=()=>{if(motion.matches)paused=true;sync();};
    const observer=new IntersectionObserver(([e])=>{visible=e.isIntersecting;sync();});
    const resize=new ResizeObserver(()=>model?.resize());
    this.cleanup=()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();document.removeEventListener('visibilitychange',sync);motion.removeEventListener('change',reduce);button.removeEventListener('click',toggle);model?.dispose();};
    try {
      // Renderer registry is deliberately explicit; importing an unrelated page never loads it.
      if(this.dataset.renderer!=='particles')throw new Error('Unknown renderer');
      const {createParticleHero}=await import('./particles.js');
      if(disposed)return;
      model=createParticleHero(canvas);canvas.hidden=false;poster.style.display='none';button.hidden=false;
      observer.observe(this);resize.observe(this);document.addEventListener('visibilitychange',sync);motion.addEventListener('change',reduce);button.addEventListener('click',toggle);sync();
    } catch {
      this.cleanup(); canvas.hidden=true;poster.style.display='';button.hidden=true;
      this.querySelector('.hero-status')!.textContent='Static preview';
    }
  }
  disconnectedCallback(){this.cleanup?.();}
}
if(!customElements.get('scientific-hero'))customElements.define('scientific-hero',ScientificHero);
