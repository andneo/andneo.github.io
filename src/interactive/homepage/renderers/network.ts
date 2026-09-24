import type { FieldRect, HomepageRenderer } from './types';
import { createLatticeGraph, type LatticeGraph, type LatticeKind } from './lattices';

const SIMULATION_DT=1/60;
const MAX_SUBSTEPS=5;
const RETARGET_PROBABILITY=.5;
const TRAIL_FADE=.055;
const CORAL_FRACTION=.13;
const DISTRIBUTION_COLUMNS=6;
const DISTRIBUTION_ROWS=3;
const DISTRIBUTION_BIN_COUNT=DISTRIBUTION_COLUMNS*DISTRIBUTION_ROWS;
const FOCUS_FRACTION=.38;
const FOCUS_DISTANCE=48;
const FOCUS_WIDTH=92;
const EDGE_SAMPLES=[0,.25,.5,.75,1] as const;

const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

function createRng(seed=0x5f3759df){
  let state=seed>>>0;
  return()=>{
    state^=state<<13;
    state^=state>>>17;
    state^=state<<5;
    return(state>>>0)/4294967296;
  };
}

function parseColor(value:string,fallback:[number,number,number]):[number,number,number]{
  const input=value.trim();
  const hex=input.match(/^#([0-9a-f]{6})$/i);
  if(hex){
    const n=Number.parseInt(hex[1],16);
    return[(n>>16)&255,(n>>8)&255,n&255];
  }
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
  speed:number;
  frameTravel:number;
  totalTravel:number;
  age:number;
  life:number;
  ageSinceStuck:number;
  focus:boolean;
  hue:number;
}

export function createNetworkRenderer(
  baseCanvas:HTMLCanvasElement,
  canvas:HTMLCanvasElement,
  activeSvg:SVGSVGElement,
  lattice:LatticeKind,
):HomepageRenderer{
  const visibleContext=canvas.getContext('2d',{alpha:true});
  const baseContext=baseCanvas.getContext('2d',{alpha:true});
  if(!visibleContext||!baseContext)throw new Error('Canvas 2D is unavailable');

  const ctx:CanvasRenderingContext2D=visibleContext;
  const baseCtx:CanvasRenderingContext2D=baseContext;
  const rng=createRng();

  let width=1;
  let height=1;
  let dpr=1;
  let disposed=false;
  let reducedMotion=false;
  let simulationAccumulator=0;
  let graph:LatticeGraph=createLatticeGraph(lattice,1,1,true);
  let obstacle:FieldRect|null=null;
  let field=new Float32Array(0);
  let busy=new Uint16Array(0);
  let blockedNeighbors=new Uint8Array(0);
  let blockedEdges=new Uint8Array(0);
  let spawnBins:number[][]=[];
  let focusNodes:number[]=[];
  let spawnCursor=0;
  let activityMask=0;
  let walkers:Walker[]=[];
  let transitionCount=0;
  let simulationSteps=0;
  let renderFrames=0;
  let pendingFadeSteps=0;
  let lastTransitionTime=0;
  let lastDiagnosticTime=0;
  let primary:[number,number,number]=[120,170,166];
  let secondary:[number,number,number]=[239,128,105];
  let tertiary:[number,number,number]=[103,133,150];
  let paint={
    primaryEdge:'rgba(120,170,166,.38)',
    coralEdge:'rgba(239,128,105,.56)',
    primaryTrail:'rgba(120,170,166,.42)',
    coralTrail:'rgba(239,128,105,.62)',
    primaryActive:'rgba(120,170,166,.70)',
    coralActive:'rgba(239,128,105,.86)',
    primaryParticle:'rgba(120,170,166,.86)',
    coralParticle:'rgba(239,128,105,.96)',
    primaryTarget:'rgba(120,170,166,.62)',
    coralTarget:'rgba(239,128,105,.80)',
    base:'rgba(103,133,150,.10)',
  };
  const queuedPrimaryEdges:number[]=[];
  const queuedCoralEdges:number[]=[];
  const queuedPrimaryTrails:number[]=[];
  const queuedCoralTrails:number[]=[];
  const activePaths={
    primaryEdge:activeSvg.querySelector<SVGPathElement>('[data-active="primary-edge"]'),
    coralEdge:activeSvg.querySelector<SVGPathElement>('[data-active="coral-edge"]'),
    primaryParticle:activeSvg.querySelector<SVGPathElement>('[data-active="primary-particle"]'),
    coralParticle:activeSvg.querySelector<SVGPathElement>('[data-active="coral-particle"]'),
    primaryTarget:activeSvg.querySelector<SVGPathElement>('[data-active="primary-target"]'),
    coralTarget:activeSvg.querySelector<SVGPathElement>('[data-active="coral-target"]'),
  };
  const activeMaskBackground=activeSvg.querySelector<SVGRectElement>('[data-active-mask="background"]');
  const activeMaskObstacle=activeSvg.querySelector<SVGRectElement>('[data-active-mask="obstacle"]');

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
    const ox=Math.max(qx,0);
    const oy=Math.max(qy,0);
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

  function rebuildBlockedEdges(){
    blockedNeighbors=new Uint8Array(graph.neighbors.length);
    blockedEdges=new Uint8Array(graph.edgeCount);
    if(!obstacle)return;

    for(let node=0;node<graph.nodeCount;node++){
      for(let p=graph.offsets[node];p<graph.offsets[node+1];p++){
        blockedNeighbors[p]=edgeIntersectsObstacle(node,graph.neighbors[p])?1:0;
      }
    }
    for(let edge=0;edge<graph.edgeCount;edge++){
      blockedEdges[edge]=edgeIntersectsObstacle(graph.edges[edge*2],graph.edges[edge*2+1])?1:0;
    }
  }

  function updatePaint(){
    const rgb=(color:[number,number,number],alpha:number)=>`rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    paint={
      primaryEdge:rgb(primary,.38),
      coralEdge:rgb(secondary,.56),
      primaryTrail:rgb(primary,.42),
      coralTrail:rgb(secondary,.62),
      primaryActive:rgb(primary,.70),
      coralActive:rgb(secondary,.86),
      primaryParticle:rgb(primary,.86),
      coralParticle:rgb(secondary,.96),
      primaryTarget:rgb(primary,.62),
      coralTarget:rgb(secondary,.80),
      base:rgb(tertiary,.10),
    };
  }

  function clearLayer(layer:HTMLCanvasElement,context:CanvasRenderingContext2D){
    context.save();
    context.setTransform(1,0,0,1,0,0);
    context.clearRect(0,0,layer.width,layer.height);
    context.restore();
  }

  function configureLayer(layer:HTMLCanvasElement,context:CanvasRenderingContext2D){
    layer.width=canvas.width;
    layer.height=canvas.height;
    context.setTransform(dpr,0,0,dpr,0,0);
    context.lineCap='round';
    context.lineJoin='round';
  }

  function carve(context:CanvasRenderingContext2D,pad=12){
    if(!obstacle)return;
    const radius=(obstacle.radius??28)+pad;
    const x=obstacle.left-pad;
    const y=obstacle.top-pad;
    const w=obstacle.right-obstacle.left+pad*2;
    const h=obstacle.bottom-obstacle.top+pad*2;
    context.save();
    context.globalCompositeOperation='destination-out';
    context.beginPath();
    context.roundRect(x,y,w,h,radius);
    context.fillStyle='rgba(0,0,0,1)';
    context.fill();
    context.restore();
  }

  function updateActiveMask(){
    activeMaskBackground?.setAttribute('width',String(width));
    activeMaskBackground?.setAttribute('height',String(height));
    if(!activeMaskObstacle)return;
    if(!obstacle){
      activeMaskObstacle.setAttribute('width','0');
      activeMaskObstacle.setAttribute('height','0');
      return;
    }
    const pad=12;
    const radius=(obstacle.radius??28)+pad;
    activeMaskObstacle.setAttribute('x',String(obstacle.left-pad));
    activeMaskObstacle.setAttribute('y',String(obstacle.top-pad));
    activeMaskObstacle.setAttribute('width',String(obstacle.right-obstacle.left+pad*2));
    activeMaskObstacle.setAttribute('height',String(obstacle.bottom-obstacle.top+pad*2));
    activeMaskObstacle.setAttribute('rx',String(radius));
    activeMaskObstacle.setAttribute('ry',String(radius));
  }

  function distributionBin(x:number,y:number){
    const column=Math.min(DISTRIBUTION_COLUMNS-1,Math.max(0,Math.floor(x/Math.max(1,width)*DISTRIBUTION_COLUMNS)));
    const row=Math.min(DISTRIBUTION_ROWS-1,Math.max(0,Math.floor(y/Math.max(1,height)*DISTRIBUTION_ROWS)));
    return row*DISTRIBUTION_COLUMNS+column;
  }

  function markActivity(x:number,y:number){
    activityMask|=1<<distributionBin(x,y);
  }

  function bitCount(value:number){
    let count=0;
    let remaining=value>>>0;
    while(remaining){
      remaining&=remaining-1;
      count++;
    }
    return count;
  }

  function buildField(){
    field=new Float32Array(graph.nodeCount);
    busy=new Uint16Array(graph.nodeCount);
    spawnBins=Array.from({length:DISTRIBUTION_BIN_COUNT},()=>[]);
    focusNodes=[];

    for(let i=0;i<graph.nodeCount;i++){
      const x=graph.x[i];
      const y=graph.y[i];
      const nx=x/Math.max(1,width);
      const ny=y/Math.max(1,height);
      const obstacleDistance=obstacle?roundedRectSdf(x,y,obstacle):Infinity;

      // The scalar field should structure motion across the whole hero. The
      // identity rectangle is an obstacle only; it must not create an annular
      // high-value band that attracts every walker to the text.
      const waveA=Math.sin((nx*2.15+ny*.72)*Math.PI*2);
      const waveB=Math.cos((ny*2.55-nx*.83)*Math.PI*2+.65);
      const waveC=Math.sin((nx*1.05+ny*1.65)*Math.PI*2+1.35);
      const globalField=126+34*waveA+27*waveB+18*waveC;
      const nearObstacle=Number.isFinite(obstacleDistance)&&obstacleDistance<96
        ?-74*Math.pow(1-clamp(obstacleDistance,0,96)/96,2)
        :0;
      const boundary=(x<16||x>width-16||y<16||y>height-16)?-42:0;
      field[i]=obstacleDistance<12?-1000:globalField+nearObstacle+boundary;

      if(
        x>=8&&x<=width-8&&y>=8&&y<=height-8&&
        obstacleDistance>=18
      ){
        spawnBins[distributionBin(x,y)].push(i);
        if(Number.isFinite(obstacleDistance)&&obstacleDistance<=190)focusNodes.push(i);
      }
    }

    canvas.dataset.fieldMode='global';
    canvas.dataset.nodes=String(graph.nodeCount);
    canvas.dataset.edges=String(graph.edgeCount);
  }

  function spawnWalker(existing?:Walker,focusMode=existing?.focus??false){
    if(graph.nodeCount===0)throw new Error('Cannot spawn a network walker without graph nodes');

    let candidates:number[]|null=null;
    if(focusMode&&focusNodes.length){
      candidates=focusNodes;
    }else{
      let selectedBin=spawnCursor++%DISTRIBUTION_BIN_COUNT;
      for(let offset=0;offset<DISTRIBUTION_BIN_COUNT&&spawnBins[selectedBin].length===0;offset++){
        selectedBin=(selectedBin+1)%DISTRIBUTION_BIN_COUNT;
      }
      candidates=spawnBins[selectedBin].length?spawnBins[selectedBin]:null;
    }

    let best=candidates?.[0]??Math.floor(rng()*graph.nodeCount);
    let bestScore=-Infinity;
    const attempts=candidates?Math.min(candidates.length,72):Math.min(graph.nodeCount,72);

    for(let attempt=0;attempt<attempts;attempt++){
      const candidate=candidates
        ?candidates[Math.floor(rng()*candidates.length)]
        :Math.floor(rng()*graph.nodeCount);
      const x=graph.x[candidate];
      const y=graph.y[candidate];
      const obstacleDistance=obstacle?roundedRectSdf(x,y,obstacle):Infinity;
      if(obstacleDistance<18)continue;

      const occupied=busy[candidate]>0&&busy[candidate]<=15?80:0;
      const focusBonus=focusMode&&Number.isFinite(obstacleDistance)
        ?105*Math.exp(-Math.pow((obstacleDistance-FOCUS_DISTANCE)/FOCUS_WIDTH,2))
        :0;
      const fieldWeight=focusMode?.38:.10;
      const score=field[candidate]*fieldWeight+focusBonus-occupied+rng()*(focusMode?32:52);
      if(score>bestScore){
        bestScore=score;
        best=candidate;
      }
    }

    const walker=existing??({} as Walker);
    const existingTravel=existing?.totalTravel??0;
    walker.node=best;
    walker.previous=best;
    walker.x=graph.x[best];
    walker.y=graph.y[best];
    walker.vx=0;
    walker.vy=0;
    walker.speed=0;
    walker.frameTravel=0;
    walker.totalTravel=existingTravel;
    walker.age=0;
    walker.life=(focusMode?520:760)+Math.floor(rng()*(focusMode?360:420));
    walker.ageSinceStuck=0;
    walker.focus=focusMode;
    walker.hue=rng();
    busy[best]=1;
    return walker;
  }

  function rebuildWalkers(){
    spawnCursor=0;
    activityMask=0;
    const total=walkerTarget();
    const focusCount=Math.round(total*FOCUS_FRACTION);
    walkers=Array.from({length:total},(_,index)=>spawnWalker(undefined,index<focusCount));
    canvas.dataset.walkers=String(walkers.length);
    canvas.dataset.focusWalkers=String(focusCount);
    canvas.dataset.explorerWalkers=String(total-focusCount);
  }

  function chooseNeighbor(walker:Walker){
    const start=graph.offsets[walker.node];
    const end=graph.offsets[walker.node+1];
    if(start===end)return walker.node;

    const previousX=graph.x[walker.previous];
    const previousY=graph.y[walker.previous];
    const currentX=graph.x[walker.node];
    const currentY=graph.y[walker.node];
    const previousDx=currentX-previousX;
    const previousDy=currentY-previousY;
    const previousMagnitude=Math.hypot(previousDx,previousDy)||1;

    let best=walker.node;
    let bestScore=-Infinity;

    for(let p=start;p<end;p++){
      const candidate=graph.neighbors[p];
      const nextX=graph.x[candidate];
      const nextY=graph.y[candidate];
      if(obstacle&&(roundedRectSdf(nextX,nextY,obstacle)<12||blockedNeighbors[p]))continue;

      const dx=nextX-currentX;
      const dy=nextY-currentY;
      const magnitude=Math.hypot(dx,dy)||1;
      const directional=(previousDx*dx+previousDy*dy)/(previousMagnitude*magnitude);
      const immediateReverse=candidate===walker.previous?-14:0;
      const obstacleDistance=obstacle?roundedRectSdf(nextX,nextY,obstacle):Infinity;

      let score:number;
      if(walker.focus){
        // Focus walkers make the perimeter visually active without turning it
        // into the global attractor for the whole simulation.
        const focusBonus=Number.isFinite(obstacleDistance)
          ?92*Math.exp(-Math.pow((obstacleDistance-FOCUS_DISTANCE)/FOCUS_WIDTH,2))
          :0;
        score=field[candidate]*.34+focusBonus+34*rng()+13*directional+immediateReverse;
      }else{
        // Explorers are intentionally weakly coupled to the scalar field.
        // Never-visited and long-unvisited nodes receive a bonus so activity
        // keeps diffusing through regions that would otherwise go dormant.
        const visitAge=busy[candidate];
        const explorationBonus=visitAge===0?38:Math.min(24,visitAge*.24);
        score=field[candidate]*.11+explorationBonus+48*rng()+16*directional+immediateReverse;
      }
      if(score>bestScore){
        bestScore=score;
        best=candidate;
      }
    }

    return best;
  }

  function queueSegment(target:number[],x1:number,y1:number,x2:number,y2:number){
    target.push(x1,y1,x2,y2);
  }

  function drawTrailEdge(a:number,b:number,walker:Walker){
    queueSegment(
      walker.hue<CORAL_FRACTION?queuedCoralEdges:queuedPrimaryEdges,
      graph.x[a],graph.y[a],graph.x[b],graph.y[b],
    );
  }

  function attemptAttractorMove(walker:Walker){
    if(rng()>=RETARGET_PROBABILITY)return false;

    const next=chooseNeighbor(walker);
    if(next===walker.node){
      walker.ageSinceStuck++;
      if(walker.ageSinceStuck>=10)spawnWalker(walker);
      return false;
    }

    if(busy[next]!==0&&busy[next]<=15){
      walker.ageSinceStuck++;
      if(walker.ageSinceStuck>=10)spawnWalker(walker);
      return false;
    }

    walker.previous=walker.node;
    walker.node=next;
    walker.ageSinceStuck=0;
    busy[next]=1;
    transitionCount++;
    lastTransitionTime=performance.now();
    markActivity(graph.x[walker.node],graph.y[walker.node]);
    drawTrailEdge(walker.previous,walker.node,walker);
    return true;
  }

  function drawParticleTrail(walker:Walker,fromX:number,fromY:number){
    queueSegment(
      walker.hue<CORAL_FRACTION?queuedCoralTrails:queuedPrimaryTrails,
      fromX,fromY,walker.x,walker.y,
    );
  }

  function advanceWalker(walker:Walker){
    attemptAttractorMove(walker);

    const targetX=graph.x[walker.node];
    const targetY=graph.y[walker.node];
    const previousX=walker.x;
    const previousY=walker.y;

    // The CodePen spring is intentionally frame based. Preserve its constants,
    // but run the simulation at fixed 60 Hz independently of canvas paint rate.
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

    walker.speed=Math.hypot(walker.x-previousX,walker.y-previousY);
    walker.frameTravel+=walker.speed;
    walker.totalTravel+=walker.speed;
    walker.age++;

    if(walker.speed>0.01&&walker.speed<30)drawParticleTrail(walker,previousX,previousY);
    if(walker.age>walker.life)spawnWalker(walker);
  }

  function ageBusy(){
    for(let i=0;i<busy.length;i++){
      if(busy[i]>0&&busy[i]<65535)busy[i]++;
    }
  }

  function fadeTrails(steps:number){
    if(steps<=0)return;
    const alpha=1-Math.pow(1-TRAIL_FADE,steps);
    ctx.save();
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle=`rgba(0,0,0,${alpha})`;
    ctx.fillRect(0,0,width,height);
    ctx.restore();
  }

  function strokeSegments(segments:number[],style:string,lineWidth:number,alpha=1){
    if(!segments.length)return;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.strokeStyle=style;
    ctx.lineWidth=lineWidth;
    ctx.beginPath();
    for(let i=0;i<segments.length;i+=4){
      ctx.moveTo(segments[i],segments[i+1]);
      ctx.lineTo(segments[i+2],segments[i+3]);
    }
    ctx.stroke();
    ctx.restore();
    segments.length=0;
  }

  function flushTrails(){
    const survival=Math.pow(1-TRAIL_FADE,pendingFadeSteps*.5);
    strokeSegments(queuedPrimaryEdges,paint.primaryEdge,1.25,survival);
    strokeSegments(queuedCoralEdges,paint.coralEdge,1.65,survival);
    strokeSegments(queuedPrimaryTrails,paint.primaryTrail,1.05,survival);
    strokeSegments(queuedCoralTrails,paint.coralTrail,1.45,survival);
  }

  function simulationStep(){
    ageBusy();
    for(const walker of walkers)advanceWalker(walker);
    simulationSteps++;
    pendingFadeSteps++;
  }

  function renderBaseGraph(){
    clearLayer(baseCanvas,baseCtx);
    baseCtx.save();
    baseCtx.lineWidth=.7;
    baseCtx.strokeStyle=paint.base;
    baseCtx.beginPath();
    for(let e=0;e<graph.edgeCount;e++){
      if(blockedEdges[e])continue;
      const a=graph.edges[e*2];
      const b=graph.edges[e*2+1];
      baseCtx.moveTo(graph.x[a],graph.y[a]);
      baseCtx.lineTo(graph.x[b],graph.y[b]);
    }
    baseCtx.stroke();
    baseCtx.restore();
    carve(baseCtx);
  }

  function circlePath(x:number,y:number,radius:number){
    return `M${(x+radius).toFixed(2)} ${y.toFixed(2)}a${radius} ${radius} 0 1 0 ${(-radius*2).toFixed(2)} 0a${radius} ${radius} 0 1 0 ${(radius*2).toFixed(2)} 0`;
  }

  function updateActiveOverlay(){
    const primaryEdges:string[]=[];
    const coralEdges:string[]=[];
    const primaryParticles:string[]=[];
    const coralParticles:string[]=[];
    const primaryTargets:string[]=[];
    const coralTargets:string[]=[];

    for(const walker of walkers){
      const coral=walker.hue<CORAL_FRACTION;
      if(walker.previous!==walker.node){
        (coral?coralEdges:primaryEdges).push(
          `M${graph.x[walker.previous].toFixed(2)} ${graph.y[walker.previous].toFixed(2)}L${graph.x[walker.node].toFixed(2)} ${graph.y[walker.node].toFixed(2)}`,
        );
      }
      (coral?coralParticles:primaryParticles).push(circlePath(walker.x,walker.y,coral?2:1.65));
      (coral?coralTargets:primaryTargets).push(circlePath(
        graph.x[walker.node],graph.y[walker.node],coral?1.45:1.1,
      ));
    }

    activePaths.primaryEdge?.setAttribute('d',primaryEdges.join(''));
    activePaths.coralEdge?.setAttribute('d',coralEdges.join(''));
    activePaths.primaryParticle?.setAttribute('d',primaryParticles.join(''));
    activePaths.coralParticle?.setAttribute('d',coralParticles.join(''));
    activePaths.primaryTarget?.setAttribute('d',primaryTargets.join(''));
    activePaths.coralTarget?.setAttribute('d',coralTargets.join(''));
  }

  function compose(){
    if(disposed)return;

    fadeTrails(pendingFadeSteps);
    flushTrails();
    carve(ctx);
    updateActiveOverlay();
    pendingFadeSteps=0;
    renderFrames++;

    const now=performance.now();
    if(now-lastDiagnosticTime>=250){
      updateDiagnostics();
      lastDiagnosticTime=now;
    }
  }

  function updateDiagnostics(){
    let totalFrameTravel=0;
    let maxFrameTravel=0;
    let visibleMovers=0;
    let activeEdges=0;
    let walkerMask=0;
    let explorerMask=0;
    let nearBoxWalkers=0;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;

    for(const walker of walkers){
      totalFrameTravel+=walker.frameTravel;
      maxFrameTravel=Math.max(maxFrameTravel,walker.frameTravel);
      if(walker.frameTravel>=1.5)visibleMovers++;
      if(walker.previous!==walker.node)activeEdges++;
      const bin=distributionBin(walker.x,walker.y);
      walkerMask|=1<<bin;
      if(!walker.focus)explorerMask|=1<<bin;
      if(obstacle){
        const distance=roundedRectSdf(walker.x,walker.y,obstacle);
        if(distance>=0&&distance<=150)nearBoxWalkers++;
      }
      minX=Math.min(minX,walker.x);maxX=Math.max(maxX,walker.x);
      minY=Math.min(minY,walker.y);maxY=Math.max(maxY,walker.y);
    }

    const spanX=walkers.length?(maxX-minX)/Math.max(1,width):0;
    const spanY=walkers.length?(maxY-minY)/Math.max(1,height):0;
    canvas.dataset.transitions=String(transitionCount);
    canvas.dataset.simSteps=String(simulationSteps);
    canvas.dataset.renderFrames=String(renderFrames);
    canvas.dataset.activeWalkers=String(visibleMovers);
    canvas.dataset.activeEdges=String(activeEdges);
    canvas.dataset.walkerBins=String(bitCount(walkerMask));
    canvas.dataset.explorerBins=String(bitCount(explorerMask));
    canvas.dataset.activityBins=String(bitCount(activityMask));
    canvas.dataset.nearBoxWalkers=String(nearBoxWalkers);
    canvas.dataset.walkerSpanX=spanX.toFixed(3);
    canvas.dataset.walkerSpanY=spanY.toFixed(3);
    canvas.dataset.meanTravel=(walkers.length?totalFrameTravel/walkers.length:0).toFixed(3);
    canvas.dataset.maxTravel=maxFrameTravel.toFixed(3);
    canvas.dataset.probeTravel=(walkers[0]?.totalTravel??0).toFixed(1);
    canvas.dataset.lastTransitionTime=lastTransitionTime?String(Math.round(lastTransitionTime)):'0';
  }

  function resize(){
    if(disposed)return;

    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);
    height=Math.max(1,rect.height);
    const pixelBudgetDpr=Math.sqrt(3_500_000/Math.max(1,width*height));
    dpr=Math.min(devicePixelRatio||1,lowCapability()?1:1.25,Math.max(.75,pixelBudgetDpr));

    canvas.width=Math.max(1,Math.round(width*dpr));
    canvas.height=Math.max(1,Math.round(height*dpr));
    baseCanvas.width=canvas.width;
    baseCanvas.height=canvas.height;
    canvas.style.width=`${width}px`;
    canvas.style.height=`${height}px`;
    baseCanvas.style.width=`${width}px`;
    baseCanvas.style.height=`${height}px`;
    activeSvg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    updateActiveMask();
    configureLayer(baseCanvas,baseCtx);
    configureLayer(canvas,ctx);

    graph=createLatticeGraph(lattice,width,height,lowCapability());
    canvas.dataset.lattice=lattice;
    canvas.dataset.dpr=dpr.toFixed(2);
    canvas.dataset.layers='base-dynamic';
    canvas.dataset.canvasBuffers='2';
    canvas.dataset.activeOverlay='vector';
    canvas.dataset.diagnosticsHz='4';
    buildField();
    rebuildBlockedEdges();
    rebuildWalkers();
    clearLayer(canvas,ctx);
    renderBaseGraph();
    simulationAccumulator=0;
    pendingFadeSteps=0;
    updateDiagnostics();
    compose();
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
    updateActiveMask();
    if(!changed)return;

    buildField();
    rebuildBlockedEdges();
    rebuildWalkers();
    clearLayer(canvas,ctx);
    renderBaseGraph();
    simulationAccumulator=0;
    pendingFadeSteps=0;
    updateDiagnostics();
    compose();
  }

  function step(deltaSeconds:number){
    if(disposed||reducedMotion)return;

    for(const walker of walkers)walker.frameTravel=0;
    simulationAccumulator+=clamp(deltaSeconds,0,.08);

    let substeps=0;
    while(simulationAccumulator>=SIMULATION_DT&&substeps<MAX_SUBSTEPS){
      simulationStep();
      simulationAccumulator-=SIMULATION_DT;
      substeps++;
    }
    if(substeps===MAX_SUBSTEPS&&simulationAccumulator>=SIMULATION_DT){
      simulationAccumulator=0;
    }

  }

  function draw(){
    compose();
  }

  function setReducedMotion(_reduced:boolean){
    reducedMotion=false;
    simulationAccumulator=0;
    canvas.dataset.motion='running';
    canvas.dataset.motionReason='animated';
  }

  function refreshTheme(){
    const style=getComputedStyle(canvas);
    primary=parseColor(style.getPropertyValue('--field-primary'),primary);
    secondary=parseColor(style.getPropertyValue('--field-secondary'),secondary);
    tertiary=parseColor(style.getPropertyValue('--field-tertiary'),tertiary);
    updatePaint();
    activeSvg.style.setProperty('--network-primary-edge',paint.primaryActive);
    activeSvg.style.setProperty('--network-coral-edge',paint.coralActive);
    activeSvg.style.setProperty('--network-primary-particle',paint.primaryParticle);
    activeSvg.style.setProperty('--network-coral-particle',paint.coralParticle);
    activeSvg.style.setProperty('--network-primary-target',paint.primaryTarget);
    activeSvg.style.setProperty('--network-coral-target',paint.coralTarget);
    clearLayer(canvas,ctx);
    renderBaseGraph();
    pendingFadeSteps=0;
    compose();
  }

  function dispose(){
    disposed=true;
    walkers=[];
    field=new Float32Array(0);
    busy=new Uint16Array(0);
    blockedNeighbors=new Uint8Array(0);
    blockedEdges=new Uint8Array(0);
    queuedPrimaryEdges.length=0;
    queuedCoralEdges.length=0;
    queuedPrimaryTrails.length=0;
    queuedCoralTrails.length=0;
    for(const path of Object.values(activePaths))path?.setAttribute('d','');
    clearLayer(baseCanvas,baseCtx);
    clearLayer(canvas,ctx);
  }

  return{
    resize,
    step,
    draw,
    setPointer:()=>{},
    setScroll:()=>{},
    setQuietZones,
    setReducedMotion,
    refreshTheme,
    dispose,
  };
}
