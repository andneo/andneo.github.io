import type { FieldRect, HomepageRenderer } from './types';
import { createLatticeGraph, type LatticeGraph, type LatticeKind } from './lattices';

const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
const CORAL_FRACTION=.13;
const EDGE_SAMPLES=[0,.25,.5,.75,1] as const;

function createRng(seed=0x5f3759df){
  let s=seed>>>0;
  return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
}

function parseColor(value:string,fallback:[number,number,number]):[number,number,number]{
  const input=value.trim();
  const hex=input.match(/^#([0-9a-f]{6})$/i);
  if(hex){const n=Number.parseInt(hex[1],16);return[(n>>16)&255,(n>>8)&255,n&255];}
  const rgb=input.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb?[Number(rgb[1]),Number(rgb[2]),Number(rgb[3])]:fallback;
}

interface Walker{
  node:number;
  previous:number;
  x:number;
  y:number;
  vx:number;
  vy:number;
  age:number;
  life:number;
  ageSinceStuck:number;
  speed:number;
  hue:number;
}

export function createNetworkRenderer(
  canvas:HTMLCanvasElement,
  lattice:LatticeKind,
):HomepageRenderer{
  const context=canvas.getContext('2d',{alpha:true});
  if(!context)throw new Error('Canvas 2D is unavailable');
  const ctx:CanvasRenderingContext2D=context;
  const rng=createRng();

  let width=1,height=1,disposed=false,reducedMotion=false;
  let graph:LatticeGraph=createLatticeGraph(lattice,1,1,true);
  let obstacle:FieldRect|null=null;
  let field=new Float32Array(0);
  let busy=new Uint16Array(0);
  let walkers:Walker[]=[];
  let frameCounter=0;
  let transitionCount=0;
  let motionDistance=0;
  let lastTransitionTime=0;
  let primary:[number,number,number]=[120,170,166];
  let secondary:[number,number,number]=[239,128,105];
  let tertiary:[number,number,number]=[103,133,150];

  const lowCapability=()=> (navigator.hardwareConcurrency||4)<=4 || matchMedia('(max-width:720px)').matches;
  const walkerTarget=()=> lowCapability()?34:58;

  function roundedRectSdf(x:number,y:number,rect:FieldRect){
    const radius=rect.radius??28;
    const cx=(rect.left+rect.right)*.5;
    const cy=(rect.top+rect.bottom)*.5;
    const hx=Math.max(1,(rect.right-rect.left)*.5-radius);
    const hy=Math.max(1,(rect.bottom-rect.top)*.5-radius);
    const qx=Math.abs(x-cx)-hx;
    const qy=Math.abs(y-cy)-hy;
    const ox=Math.max(qx,0),oy=Math.max(qy,0);
    return Math.hypot(ox,oy)+Math.min(Math.max(qx,qy),0)-radius;
  }

  function edgeIntersectsObstacle(a:number,b:number,clearance=8){
    if(!obstacle)return false;
    const ax=graph.x[a],ay=graph.y[a];
    const bx=graph.x[b],by=graph.y[b];
    for(const t of EDGE_SAMPLES){
      if(roundedRectSdf(ax+(bx-ax)*t,ay+(by-ay)*t,obstacle)<clearance)return true;
    }
    return false;
  }

  function buildField(){
    field=new Float32Array(graph.nodeCount);
    busy=new Uint16Array(graph.nodeCount);
    const cx=width*.5,cy=height*.5;
    for(let i=0;i<graph.nodeCount;i++){
      const x=graph.x[i],y=graph.y[i];
      const d=obstacle?roundedRectSdf(x,y,obstacle):Math.hypot(x-cx,y-cy)-Math.min(width,height)*.22;
      const band=Math.exp(-Math.pow((d-52)/86,2));
      const wave=.18*Math.sin(x*.011+y*.004)+.14*Math.cos(y*.013-x*.006);
      const edgePenalty=(x<12||x>width-12||y<12||y>height-12)?-.4:0;
      const inside=d<8?-2.6:0;
      field[i]=band+wave+edgePenalty+inside;
    }
    canvas.dataset.nodes=String(graph.nodeCount);
    canvas.dataset.edges=String(graph.edgeCount);
  }

  function spawnWalker(existing?:Walker){
    let best=0,bestScore=-Infinity;
    const attempts=Math.min(graph.nodeCount,48);
    for(let k=0;k<attempts;k++){
      const i=Math.floor(rng()*graph.nodeCount);
      const score=field[i]-(busy[i]||0)*.5+rng()*.25;
      if(score>bestScore){bestScore=score;best=i;}
    }
    const walker=existing??({} as Walker);
    walker.node=best;walker.previous=best;
    walker.x=graph.x[best];walker.y=graph.y[best];
    walker.vx=0;walker.vy=0;walker.speed=0;walker.age=0;
    walker.life=(lowCapability()?420:620)+rng()*520;
    walker.ageSinceStuck=0;
    walker.hue=rng();
    busy[best]=1;
    return walker;
  }

  function rebuildWalkers(){
    walkers=Array.from({length:walkerTarget()},()=>spawnWalker());
    canvas.dataset.walkers=String(walkers.length);
    canvas.dataset.transitions=String(transitionCount);
  }

  function chooseNeighbor(walker:Walker){
    const start=graph.offsets[walker.node];
    const end=graph.offsets[walker.node+1];
    if(start===end)return walker.node;

    const px=graph.x[walker.previous],py=graph.y[walker.previous];
    const cx=graph.x[walker.node],cy=graph.y[walker.node];
    const prevDx=cx-px,prevDy=cy-py;
    const prevMag=Math.hypot(prevDx,prevDy)||1;

    let best=walker.node,bestScore=-Infinity;
    for(let p=start;p<end;p++){
      const candidate=graph.neighbors[p];
      const nx=graph.x[candidate],ny=graph.y[candidate];
      if(obstacle&&(roundedRectSdf(nx,ny,obstacle)<10||edgeIntersectsObstacle(walker.node,candidate)))continue;
      const dx=nx-cx,dy=ny-cy;
      const mag=Math.hypot(dx,dy)||1;
      const directional=(prevDx*dx+prevDy*dy)/(prevMag*mag);
      const score=
        field[candidate]*1.18
        +directional*.12
        +(rng()-.5)*.9;
      if(score>bestScore){bestScore=score;best=candidate;}
    }
    return best;
  }

  function attemptAttractorMove(walker:Walker,render:boolean){
    if(rng()>=.48)return;

    const next=chooseNeighbor(walker);
    if(next===walker.node){
      walker.ageSinceStuck++;
      return;
    }

    const available=busy[next]===0||busy[next]>15;
    if(!available){
      walker.ageSinceStuck++;
      if(walker.ageSinceStuck>=10)spawnWalker(walker);
      return;
    }

    const previous=walker.node;
    walker.previous=previous;
    walker.node=next;
    walker.ageSinceStuck=0;
    busy[next]=1;
    transitionCount++;
    lastTransitionTime=performance.now();
  }

  function drawBaseGraph(){
    ctx.save();
    ctx.clearRect(0,0,width,height);
    ctx.lineWidth=.6;
    ctx.strokeStyle=`rgba(${tertiary[0]},${tertiary[1]},${tertiary[2]},.07)`;
    ctx.beginPath();
    for(let e=0;e<graph.edges.length;e+=2){
      const a=graph.edges[e],b=graph.edges[e+1];
      if(edgeIntersectsObstacle(a,b))continue;
      ctx.moveTo(graph.x[a],graph.y[a]);ctx.lineTo(graph.x[b],graph.y[b]);
    }
    ctx.stroke();
    ctx.restore();
    carveObstacle();
  }

  function carveObstacle(){
    if(!obstacle)return;
    const pad=12,r=(obstacle.radius??28)+pad;
    const x=obstacle.left-pad,y=obstacle.top-pad;
    const w=obstacle.right-obstacle.left+pad*2,h=obstacle.bottom-obstacle.top+pad*2;
    ctx.save();ctx.globalCompositeOperation='destination-out';
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);
    ctx.fillStyle='rgba(0,0,0,.995)';ctx.fill();ctx.restore();
  }

  function drawEdge(a:number,b:number,alpha:number,color:[number,number,number],lineWidth:number){
    ctx.beginPath();
    ctx.moveTo(graph.x[a],graph.y[a]);
    ctx.lineTo(graph.x[b],graph.y[b]);
    ctx.strokeStyle=`rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    ctx.lineWidth=lineWidth;
    ctx.stroke();
  }

  function resize(){
    if(disposed)return;
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    const pixelBudgetDpr=Math.sqrt(4_500_000/Math.max(1,width*height));
    const dpr=Math.min(devicePixelRatio||1,lowCapability()?1:1.25,Math.max(.75,pixelBudgetDpr));
    canvas.width=Math.max(1,Math.round(width*dpr));
    canvas.height=Math.max(1,Math.round(height*dpr));
    canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    graph=createLatticeGraph(lattice,width,height,lowCapability());
    canvas.dataset.lattice=lattice;
    buildField();rebuildWalkers();drawBaseGraph();
  }

  function setQuietZones(rects:FieldRect[]){
    const next=rects[0]??null;
    const changed=!obstacle!==!next||
      (!!next&&!!obstacle&&(
        Math.abs(next.left-obstacle.left)>2||
        Math.abs(next.top-obstacle.top)>2||
        Math.abs(next.right-obstacle.right)>2||
        Math.abs(next.bottom-obstacle.bottom)>2||
        Math.abs((next.radius??0)-(obstacle.radius??0))>1
      ));
    obstacle=next;
    canvas.dataset.quietZones=String(rects.length);
    if(changed){
      buildField();rebuildWalkers();
      if(reducedMotion)prime(lowCapability()?80:110);
      else drawBaseGraph();
      canvas.dataset.primed=reducedMotion?'static':'false';
    }
  }

  function advanceWalker(walker:Walker,render:boolean){
    attemptAttractorMove(walker,render);

    const targetX=graph.x[walker.node],targetY=graph.y[walker.node];
    const px=walker.x,py=walker.y;

    // Match the reference Pen's intentionally frame-based spring dynamics:
    // strong attraction plus heavy velocity damping gives clearly visible
    // pursuit of a moving lattice attractor without accumulating history.
    const k=8;
    const viscosity=.4;
    const dx=walker.x-targetX;
    const dy=walker.y-targetY;
    walker.vx+=-k*dx;
    walker.vy+=-k*dy;
    walker.vx*=viscosity;
    walker.vy*=viscosity;
    walker.x+=.1*walker.vx;
    walker.y+=.1*walker.vy;
    walker.speed=Math.hypot(walker.x-px,walker.y-py);
    motionDistance+=walker.speed;
    walker.age++;

    if(render){
      const coral=walker.hue<CORAL_FRACTION;
      const color=coral?secondary:primary;
      if(walker.previous!==walker.node){
        drawEdge(walker.previous,walker.node,coral?.68:.54,color,coral?1.7:1.3);
      }
      if(walker.speed<24){
        ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(walker.x,walker.y);
        ctx.strokeStyle=`rgba(${color[0]},${color[1]},${color[2]},${walker.hue<CORAL_FRACTION?.72:.5})`;
        ctx.lineWidth=walker.hue<CORAL_FRACTION?1.55:1.05;ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(targetX,targetY,walker.hue<CORAL_FRACTION?1.8:1.35,0,Math.PI*2);
      ctx.fillStyle=`rgba(${color[0]},${color[1]},${color[2]},${walker.hue<CORAL_FRACTION?.9:.7})`;
      ctx.fill();
    }

    if(walker.age>walker.life)spawnWalker(walker);
  }

  function ageBusy(){
    for(let i=0;i<busy.length;i++){
      if(busy[i]>0&&busy[i]<65535)busy[i]++;
    }
  }

  function decayBusy(_dt:number){
    ageBusy();
  }

  function fadeAndReinforceBase(){
    ctx.save();
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle=`rgba(0,0,0,${lowCapability()?.075:.06})`;
    ctx.fillRect(0,0,width,height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle=`rgba(${tertiary[0]},${tertiary[1]},${tertiary[2]},.009)`;
    ctx.lineWidth=.55;
    ctx.beginPath();
    for(let e=0;e<graph.edges.length;e+=2){
      const a=graph.edges[e],b=graph.edges[e+1];
      if(edgeIntersectsObstacle(a,b))continue;
      ctx.moveTo(graph.x[a],graph.y[a]);
      ctx.lineTo(graph.x[b],graph.y[b]);
    }
    ctx.stroke();
    ctx.restore();
  }

  function updateDiagnostics(){
    let speed=0,activeWalkers=0;
    for(const walker of walkers){
      speed+=walker.speed;
      if(walker.previous!==walker.node)activeWalkers++;
    }
    canvas.dataset.transitions=String(transitionCount);
    canvas.dataset.activeWalkers=String(activeWalkers);
    canvas.dataset.meanSpeed=(walkers.length?speed/walkers.length:0).toFixed(3);
    canvas.dataset.travel=motionDistance.toFixed(1);
    canvas.dataset.lastTransitionTime=lastTransitionTime?String(Math.round(lastTransitionTime)):'0';
  }

  function step(_deltaSeconds:number){
    if(disposed||reducedMotion)return;
    fadeAndReinforceBase();
    ageBusy();
    for(const walker of walkers)advanceWalker(walker,true);
    carveObstacle();
    frameCounter++;
    if(frameCounter%4===0)updateDiagnostics();
  }

  function draw(){
    if(disposed||reducedMotion)return;
    carveObstacle();
  }

  function prime(iterations:number){
    drawBaseGraph();
    for(let i=0;i<iterations;i++){
      fadeAndReinforceBase();
      ageBusy();
      for(const walker of walkers)advanceWalker(walker,true);
    }
    updateDiagnostics();
    carveObstacle();
  }

  function setReducedMotion(reduced:boolean){
    reducedMotion=reduced;
    canvas.dataset.motion=reduced?'static':'running';
    if(reduced)prime(lowCapability()?100:150);
  }

  function refreshTheme(){
    const style=getComputedStyle(canvas);
    primary=parseColor(style.getPropertyValue('--field-primary'),primary);
    secondary=parseColor(style.getPropertyValue('--field-secondary'),secondary);
    tertiary=parseColor(style.getPropertyValue('--field-tertiary'),tertiary);
    drawBaseGraph();
    if(reducedMotion)prime(lowCapability()?80:110);
  }

  function dispose(){
    disposed=true;
    walkers=[];
    field=new Float32Array(0);
    busy=new Uint16Array(0);
  }

  refreshTheme();

  return{
    resize,step,draw,
    setPointer:()=>{},
    setScroll:()=>{},
    setQuietZones,
    setReducedMotion,
    refreshTheme,
    dispose,
  };
}
