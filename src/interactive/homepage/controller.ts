import type { FieldRect, HomepageRenderer } from './renderers/types';
import type { LatticeKind } from './renderers/lattices';

const latticeKinds=new Set<LatticeKind>(['square','honeycomb','hexagonal','kagome','penrose']);

async function createRenderer(name:string,canvas:HTMLCanvasElement,lattice:LatticeKind):Promise<HomepageRenderer>{
  switch(name){
    case 'network':
    case 'network-walkers':{
      const {createNetworkRenderer}=await import('./renderers/network');
      return createNetworkRenderer(canvas,lattice);
    }
    default:throw new Error(`Unknown homepage renderer: ${name}`);
  }
}

class HomepageBackgroundElement extends HTMLElement{
  cleanup?:()=>void;

  async connectedCallback(){
    if(this.dataset.enabled!=='true')return;

    const canvas=this.querySelector<HTMLCanvasElement>('canvas');
    const poster=this.querySelector<SVGElement>('.homepage-field__poster');
    const field=this.querySelector<HTMLElement>('.homepage-field');
    const hero=this.closest<HTMLElement>('.home-hero');
    const quietTargets=hero?[...hero.querySelectorAll<HTMLElement>('[data-field-quiet]')]:[];
    if(!canvas||!poster||!field||!hero)return;

    const requested=this.dataset.lattice as LatticeKind|undefined;
    const lattice=requested&&latticeKinds.has(requested)?requested:'kagome';
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const systemTheme=matchMedia('(prefers-color-scheme: dark)');
    const lowCapability=(navigator.hardwareConcurrency||4)<=4||matchMedia('(max-width:720px)').matches;
    const frameInterval=lowCapability?1000/20:1000/30;

    let renderer:HomepageRenderer|undefined;
    let frame=0,lastStep=0,lastPaint=0;
    let visible=true,paused=motion.matches,disposed=false;

    const quietRects=():FieldRect[]=>{
      const fieldRect=field.getBoundingClientRect();
      return quietTargets.map(target=>{
        const rect=target.getBoundingClientRect();
        const radius=Number.parseFloat(getComputedStyle(target).borderRadius)||28;
        return{
          left:rect.left-fieldRect.left,
          top:rect.top-fieldRect.top,
          right:rect.right-fieldRect.left,
          bottom:rect.bottom-fieldRect.top,
          radius,
        };
      });
    };

    const updateGeometry=()=>{
      if(!renderer)return;
      const rects=quietRects();
      canvas.dataset.quietZones=String(rects.length);
      renderer.setQuietZones(rects);
    };

    const tick=(now:number)=>{
      if(!renderer||paused||!visible||document.hidden)return;
      frame=requestAnimationFrame(tick);
      if(now-lastPaint<frameInterval)return;
      const delta=lastStep?Math.min((now-lastStep)/1000,.07):frameInterval/1000;
      lastStep=now;lastPaint=now;
      renderer.step(delta);renderer.draw();
    };

    const sync=()=>{
      cancelAnimationFrame(frame);frame=0;lastStep=0;lastPaint=0;
      canvas.dataset.motion=paused?'static':'running';
      if(renderer&&visible&&!paused&&!document.hidden)frame=requestAnimationFrame(tick);
    };

    const handleMotion=()=>{
      paused=motion.matches;
      renderer?.setReducedMotion(paused);
      sync();
    };

    const refreshTheme=()=>{renderer?.refreshTheme();renderer?.draw();};

    const intersection=new IntersectionObserver(([entry])=>{
      visible=Boolean(entry?.isIntersecting);sync();
    },{rootMargin:'80px'});

    const resize=new ResizeObserver(()=>{
      renderer?.resize();updateGeometry();
    });

    const themeObserver=new MutationObserver(refreshTheme);

    this.cleanup=()=>{
      disposed=true;cancelAnimationFrame(frame);
      intersection.disconnect();resize.disconnect();themeObserver.disconnect();
      document.removeEventListener('visibilitychange',sync);
      motion.removeEventListener('change',handleMotion);
      systemTheme.removeEventListener('change',refreshTheme);
      renderer?.dispose();
    };

    try{
      // The renderer must measure a visible canvas. Constructing it while the
      // HTML hidden attribute is present yields a zero-sized layout box.
      canvas.hidden=false;
      renderer=await createRenderer(this.dataset.renderer||'network',canvas,lattice);
      if(disposed){renderer.dispose();return;}

      poster.style.display='none';
      // Explicit initialization order: visible layout -> real canvas/lattice size
      // -> DOM-derived exclusion geometry -> theme/static state -> animation.
      renderer.resize();
      updateGeometry();
      renderer.refreshTheme();
      renderer.setReducedMotion(motion.matches);
      renderer.draw();

      intersection.observe(hero);resize.observe(field);
      quietTargets.forEach(target=>resize.observe(target));
      themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
      document.addEventListener('visibilitychange',sync);
      motion.addEventListener('change',handleMotion);
      systemTheme.addEventListener('change',refreshTheme);
      sync();
    }catch(error){
      console.error('Homepage network renderer failed',error);
      renderer?.dispose();canvas.hidden=true;poster.style.display='';
    }
  }

  disconnectedCallback(){this.cleanup?.();}
}

if(!customElements.get('homepage-background')){
  customElements.define('homepage-background',HomepageBackgroundElement);
}
