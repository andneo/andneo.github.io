const VENDOR_BASE='/vendor/evan-water/';
const VENDOR_SCRIPTS=[
  'OES_texture_float_linear-polyfill.js',
  'assets.js',
  'lightgl.js',
  'cubemap.js',
  'water.js',
  'renderer.js',
];

function loadClassic(src){
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[data-evan-water-src="${src}"]`);
    if(existing){
      if(existing.dataset.loaded==='true')resolve();
      else{
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',reject,{once:true});
      }
      return;
    }
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.dataset.evanWaterSrc=src;
    script.addEventListener('load',()=>{
      script.dataset.loaded='true';
      resolve();
    },{once:true});
    script.addEventListener('error',()=>reject(new Error(`Failed to load ${src}`)),{once:true});
    document.head.appendChild(script);
  });
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.decoding='async';
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error('Failed to decode Evan Wallace water asset'));
    image.src=src;
  });
}

async function ensureEngine(){
  if(window.__evanWaterEngineReady)return;
  if(window.__evanWaterEnginePromise)return window.__evanWaterEnginePromise;
  window.__evanWaterEnginePromise=(async()=>{
    for(const file of VENDOR_SCRIPTS)await loadClassic(VENDOR_BASE+file);
    if(!window.GL||!window.Water||!window.Renderer||!window.Cubemap||!window.EVAN_WATER_ASSETS){
      throw new Error('Evan Wallace water engine did not expose its expected globals');
    }
    window.__evanWaterEngineReady=true;
  })();
  return window.__evanWaterEnginePromise;
}

class EvanWaterHero{
  constructor(placeholder){
    this.placeholder=placeholder;
    this.host=placeholder.closest('water-network-story');
    this.stage=placeholder.parentElement;
    this.visible=true;
    this.active=this.host?.dataset.scene==='0';
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.last=performance.now();
    this.elapsed=0;
    this.nextDrop=1.15;
    this.dropIndex=0;
    this.resizeObserver=null;
    this.intersectionObserver=null;
    this.sceneObserver=null;
    this.raf=0;
  }

  async init(){
    await ensureEngine();
    const assets=window.EVAN_WATER_ASSETS;
    const [tiles,xneg,xpos,ypos,zneg,zpos]=await Promise.all([
      loadImage(assets['tiles.jpg']),
      loadImage(assets['xneg.jpg']),
      loadImage(assets['xpos.jpg']),
      loadImage(assets['ypos.jpg']),
      loadImage(assets['zneg.jpg']),
      loadImage(assets['zpos.jpg']),
    ]);

    // Renderer() in the original demo looks up this image by id.
    let tileElement=document.getElementById('tiles');
    if(!tileElement){
      tiles.id='tiles';
      tiles.hidden=true;
      document.body.appendChild(tiles);
      tileElement=tiles;
    }

    // LightGL intentionally creates the WebGL canvas because its matrix stack
    // and context bookkeeping are attached to that context.
    window.gl=window.GL.create({alpha:false,antialias:true});
    const gl=window.gl;
    const canvas=gl.canvas;
    canvas.className=this.placeholder.className;
    canvas.setAttribute('data-water-hero-canvas','');
    canvas.setAttribute('aria-label','Living water surface with real-time reflections, refractions and caustics');
    canvas.dataset.renderer='evan-wallace-water';
    canvas.dataset.rendererReady='false';
    canvas.style.position='absolute';
    canvas.style.inset='0';
    canvas.style.width='100%';
    canvas.style.height='100%';
    canvas.style.display='block';
    canvas.style.pointerEvents='none';
    this.placeholder.replaceWith(canvas);
    this.canvas=canvas;

    window.water=new window.Water();
    window.renderer=new window.Renderer();
    window.cubemap=new window.Cubemap({
      xneg,xpos,
      yneg:ypos,
      ypos,
      zneg,zpos,
    });
    this.water=window.water;
    this.renderer=window.renderer;
    this.cubemap=window.cubemap;

    if(!this.water.textureA.canDrawTo()||!this.water.textureB.canDrawTo()){
      throw new Error('Rendering to floating-point textures is required but not supported');
    }

    // Remove the demo sphere from the optical solution without introducing
    // divide-by-zero in its ambient-occlusion helper functions.
    this.hiddenSphereCenter=new window.GL.Vector(0,-20,0);
    this.hiddenSphereRadius=.01;
    this.renderer.sphereCenter=this.hiddenSphereCenter;
    this.renderer.sphereRadius=this.hiddenSphereRadius;

    gl.clearColor(.035,.095,.12,1);

    // Seed a living but calm surface, then let the deterministic auto-drops
    // maintain motion without turning this into a mouse sandbox.
    const seeds=[
      [-.55,-.20,.040,.010],
      [.48,.32,.055,-.008],
      [-.12,.54,.035,.008],
      [.22,-.48,.045,-.007],
      [.02,.04,.032,.006],
    ];
    for(const [x,z,r,s] of seeds)this.water.addDrop(x,z,r,s);
    for(let i=0;i<8;i++)this.water.stepSimulation();
    this.water.updateNormals();
    this.renderer.updateCaustics(this.water);

    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(this.stage);
    this.intersectionObserver=new IntersectionObserver(([entry])=>{
      this.visible=entry?.isIntersecting??true;
    },{threshold:.02});
    this.intersectionObserver.observe(this.stage);
    this.sceneObserver=new MutationObserver(()=>this.syncScene());
    this.sceneObserver.observe(this.host,{attributes:true,attributeFilter:['data-scene']});

    this.resize();
    this.syncScene();
    canvas.dataset.rendererReady='true';
    if(this.host){
      this.host.dataset.heroReady='true';
      this.host.dataset.waterEngine='heightfield-raytrace-caustics';
      delete this.host.dataset.moleculeCount;
      delete this.host.dataset.pickableMolecules;
      delete this.host.dataset.hydrogenBonds;
      delete this.host.dataset.selectedMolecule;
    }
    this.frame=this.frame.bind(this);
    this.raf=requestAnimationFrame(this.frame);
  }

  syncScene(){
    this.active=this.host?.dataset.scene==='0';
    if(this.canvas)this.canvas.style.opacity=this.active?'1':'0';
  }

  resize(){
    if(!this.canvas)return;
    const gl=window.gl;
    gl.makeCurrent();
    const rect=this.stage.getBoundingClientRect();
    const ratio=Math.min(window.devicePixelRatio||1,1.6);
    const width=Math.max(1,Math.round(rect.width*ratio));
    const height=Math.max(1,Math.round(rect.height*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){
      this.canvas.width=width;
      this.canvas.height=height;
    }
    this.canvas.style.width=rect.width+'px';
    this.canvas.style.height=rect.height+'px';
    gl.viewport(0,0,width,height);
    gl.matrixMode(gl.PROJECTION);
    gl.loadIdentity();
    gl.perspective(45,width/height,.01,100);
    gl.matrixMode(gl.MODELVIEW);
    this.draw();
  }

  addAutonomousDrop(){
    const pattern=[
      [-.42,.24,.034,.0065],
      [.36,-.18,.030,-.0055],
      [.08,.46,.026,.0050],
      [-.18,-.44,.032,-.0052],
      [.51,.36,.024,.0047],
      [-.52,-.28,.028,-.0048],
    ];
    const [x,z,r,s]=pattern[this.dropIndex%pattern.length];
    this.dropIndex++;
    this.water.addDrop(x,z,r,s);
  }

  update(dt){
    this.elapsed+=dt;
    if(!this.reduced&&this.elapsed>=this.nextDrop){
      this.addAutonomousDrop();
      this.nextDrop=this.elapsed+1.45+(this.dropIndex%3)*.38;
    }
    this.water.stepSimulation();
    this.water.stepSimulation();
    this.water.updateNormals();
    this.renderer.updateCaustics(this.water);
  }

  draw(){
    if(!this.canvas)return;
    const gl=window.gl;
    gl.makeCurrent();
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.loadIdentity();

    // Original Evan Wallace composition, fixed rather than user-orbitable.
    const angleX=-25;
    const angleY=-200.5;
    gl.translate(0,0,-4);
    gl.rotate(-angleX,1,0,0);
    gl.rotate(-angleY,0,1,0);
    gl.translate(0,.5,0);

    gl.enable(gl.DEPTH_TEST);
    this.renderer.sphereCenter=this.hiddenSphereCenter;
    this.renderer.sphereRadius=this.hiddenSphereRadius;
    this.renderer.renderCube();
    this.renderer.renderWater(this.water,this.cubemap);
    gl.disable(gl.DEPTH_TEST);
  }

  frame(now){
    const dt=Math.min(.04,Math.max(0,(now-this.last)/1000));
    this.last=now;
    if(this.visible&&this.active){
      if(!this.reduced)this.update(dt);
      this.draw();
    }
    this.raf=requestAnimationFrame(this.frame);
  }
}

async function mount(){
  const placeholders=[...document.querySelectorAll('[data-water-hero-canvas]')];
  for(const placeholder of placeholders){
    if(placeholder.dataset.evanWaterMount==='true')continue;
    placeholder.dataset.evanWaterMount='true';
    const hero=new EvanWaterHero(placeholder);
    try{
      await hero.init();
      hero.canvas.__waterHero=hero;
    }catch(error){
      console.error('Evan Wallace water hero failed to initialize',error);
      if(hero.host){
        hero.host.dataset.heroReady='false';
        hero.host.dataset.waterEngine='fallback';
      }
    }
  }
}

mount();
