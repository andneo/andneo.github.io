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
  canvas:HTMLCanvasElement,
  lattice:LatticeKind,
):HomepageRenderer{
  const visibleContext=canvas.getContext('2d',{alpha:true});
  if(!visibleContext)throw new Error('Canvas 2D is unavailable');

  const baseCanvas=document.createElement('canvas');
  const trailCanvas=document.createElement('canvas');
  const baseContext=baseCanvas.getContext('2d',{alpha:true});
  const trailContext=trailCanvas.getContext('2d',{alpha:true});
  if(!baseContext||!trailContext)throw new Error('Off-screen Canvas 2D is unavailable');

  const ctx:CanvasRenderingContext2D=visibleContext;
  const baseCtx:CanvasRenderingContext2D=baseContext;
  const trailCtx:CanvasRenderingContext2D=trailContext;
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
  let spawnBins:number[][]=[];
  let focusNodes:number[]=[];
  let spawnCursor=0;
  let activityMask=0;
  let walkers:Walker[]=[];
  let transitionCount=0;
  let simulationSteps=0;
  let renderFrames=0;
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
      if(obstacle&&(roundedRectSdf(nextX,nextY,obstacle)<12||edgeIntersectsObstacle(walker.node,candidate)))continue;

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

  function drawTrailEdge(a:number,b:number,walker:Walker){
    const coral=walker.hue<CORAL_FRACTION;
    const color=coral?secondary:primary;
    trailCtx.beginPath();
    trailCtx.moveTo(graph.x[a],graph.y[a]);
    trailCtx.lineTo(graph.x[b],graph.y[b]);
    trailCtx.strokeStyle=`rgba(${color[0]},${color[1]},${color[2]},${coral?.56:.38})`;
    trailCtx.lineWidth=coral?1.65:1.25;
    trailCtx.stroke();
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
    const coral=walker.hue<CORAL_FRACTION;
    const color=coral?secondary:primary;
    trailCtx.beginPath();
    trailCtx.moveTo(fromX,fromY);
    trailCtx.lineTo(walker.x,walker.y);
    trailCtx.strokeStyle=`rgba(${color[0]},${color[1]},${color[2]},${coral?.62:.42})`;
    trailCtx.lineWidth=coral?1.45:1.05;
    trailCtx.stroke();
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

  function fadeTrails(){
    trailCtx.save();
    trailCtx.globalCompositeOperation='destination-out';
    trailCtx.fillStyle=`rgba(0,0,0,${TRAIL_FADE})`;
    trailCtx.fillRect(0,0,width,height);
    trailCtx.restore();
  }

  function simulationStep(){
    fadeTrails();
    ageBusy();
    for(const walker of walkers)advanceWalker(walker);
    carve(trailCtx);
    simulationSteps++;
  }

  function renderBaseGraph(){
    clearLayer(baseCanvas,baseCtx);
    baseCtx.save();
    baseCtx.lineWidth=.7;
    baseCtx.strokeStyle=`rgba(${tertiary[0]},${tertiary[1]},${tertiary[2]},.10)`;
    baseCtx.beginPath();
    for(let e=0;e<graph.edges.length;e+=2){
      const a=graph.edges[e];
      const b=graph.edges[e+1];
      if(edgeIntersectsObstacle(a,b))continue;
      baseCtx.moveTo(graph.x[a],graph.y[a]);
      baseCtx.lineTo(graph.x[b],graph.y[b]);
    }
    baseCtx.stroke();
    baseCtx.restore();
    carve(baseCtx);
  }

  function drawActiveOverlay(){
    for(const walker of walkers){
      const coral=walker.hue<CORAL_FRACTION;
      const color=coral?secondary:primary;
      const targetX=graph.x[walker.node];
      const targetY=graph.y[walker.node];

      if(walker.previous!==walker.node&&!edgeIntersectsObstacle(walker.previous,walker.node)){
        ctx.beginPath();
        ctx.moveTo(graph.x[walker.previous],graph.y[walker.previous]);
        ctx.lineTo(targetX,targetY);
        ctx.strokeStyle=`rgba(${color[0]},${color[1]},${color[2]},${coral?.86:.70})`;
        ctx.lineWidth=coral?2.0:1.55;
        ctx.stroke();
      }

      // The moving spring particle is explicitly visible, not just its target.
      ctx.beginPath();
      ctx.arc(walker.x,walker.y,coral?2.0:1.65,0,Math.PI*2);
      ctx.fillStyle=`rgba(${color[0]},${color[1]},${color[2]},${coral?.96:.86})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(targetX,targetY,coral?1.45:1.1,0,Math.PI*2);
      ctx.fillStyle=`rgba(${color[0]},${color[1]},${color[2]},${coral?.80:.62})`;
      ctx.fill();
    }
  }

  function compose(){
    if(disposed)return;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(baseCanvas,0,0);
    ctx.drawImage(trailCanvas,0,0);
    ctx.restore();

    ctx.save();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.lineCap='round';
    ctx.lineJoin='round';
    drawActiveOverlay();
    carve(ctx);
    ctx.restore();

    renderFrames++;
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
    canvas.style.width=`${width}px`;
    canvas.style.height=`${height}px`;
    configureLayer(baseCanvas,baseCtx);
    configureLayer(trailCanvas,trailCtx);

    graph=createLatticeGraph(lattice,width,height,lowCapability());
    canvas.dataset.lattice=lattice;
    canvas.dataset.dpr=dpr.toFixed(2);
    canvas.dataset.layers='base-trail-active';
    buildField();
    rebuildWalkers();
    clearLayer(trailCanvas,trailCtx);
    renderBaseGraph();
    simulationAccumulator=0;
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
    if(!changed)return;

    buildField();
    rebuildWalkers();
    clearLayer(trailCanvas,trailCtx);
    renderBaseGraph();
    simulationAccumulator=0;
    if(reducedMotion)primeStatic();
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

    updateDiagnostics();
  }

  function draw(){
    compose();
  }

  function primeStatic(){
    clearLayer(trailCanvas,trailCtx);
    for(const walker of walkers)walker.frameTravel=0;
    for(let i=0;i<(lowCapability()?75:95);i++)simulationStep();
    updateDiagnostics();
  }

  function setReducedMotion(reduced:boolean){
    reducedMotion=reduced;
    simulationAccumulator=0;
    canvas.dataset.motion=reduced?'static':'running';
    canvas.dataset.motionReason=reduced?'reduced-motion':'animated';
    if(reduced)primeStatic();
    compose();
  }

  function refreshTheme(){
    const style=getComputedStyle(canvas);
    primary=parseColor(style.getPropertyValue('--field-primary'),primary);
    secondary=parseColor(style.getPropertyValue('--field-secondary'),secondary);
    tertiary=parseColor(style.getPropertyValue('--field-tertiary'),tertiary);
    clearLayer(trailCanvas,trailCtx);
    renderBaseGraph();
    if(reducedMotion)primeStatic();
    compose();
  }

  function dispose(){
    disposed=true;
    walkers=[];
    field=new Float32Array(0);
    busy=new Uint16Array(0);
    clearLayer(baseCanvas,baseCtx);
    clearLayer(trailCanvas,trailCtx);
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
