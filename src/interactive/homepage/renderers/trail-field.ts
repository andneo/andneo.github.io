import type { FieldRect, HomepageRenderer } from './types';

const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

function createRng(seed=0x9e3779b9){
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

interface Agent{
  x:number;y:number;px:number;py:number;vx:number;vy:number;
  age:number;life:number;offset:number;direction:number;coral:boolean;
}

export function createHeroTrailRenderer(canvas:HTMLCanvasElement):HomepageRenderer{
  const context=canvas.getContext('2d',{alpha:true});
  if(!context)throw new Error('Canvas 2D is unavailable');
  const ctx:CanvasRenderingContext2D=context;
  const rng=createRng();

  let width=1,height=1,elapsed=0,disposed=false,reducedMotion=false;
  let obstacle:FieldRect|null=null;
  let agents:Agent[]=[];
  let primary:[number,number,number]=[102,156,153];
  let secondary:[number,number,number]=[234,126,103];

  const lowCapability=()=> (navigator.hardwareConcurrency||4)<=4 || matchMedia('(max-width:720px)').matches;
  const agentTarget=()=>lowCapability()?68:124;

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

  function normalAt(x:number,y:number){
    if(!obstacle)return{x:0,y:-1};
    const e=2.2;
    const gx=roundedRectSdf(x+e,y,obstacle)-roundedRectSdf(x-e,y,obstacle);
    const gy=roundedRectSdf(x,y+e,obstacle)-roundedRectSdf(x,y-e,obstacle);
    const m=Math.hypot(gx,gy)||1;
    return{x:gx/m,y:gy/m};
  }

  function flowNoise(x:number,y:number,t:number){
    return(Math.sin(x*.009+y*.006+t*.31)+Math.cos(x*.004-y*.011-t*.23))*.5;
  }

  function spawn(agent?:Agent){
    const a=agent??({} as Agent);
    if(!obstacle){
      a.x=rng()*width;a.y=rng()*height;
    }else{
      const r=obstacle,side=Math.floor(rng()*4),margin=34+rng()*90;
      if(side===0){a.x=lerp(r.left,r.right,rng());a.y=r.top-margin;}
      else if(side===1){a.x=r.right+margin;a.y=lerp(r.top,r.bottom,rng());}
      else if(side===2){a.x=lerp(r.left,r.right,rng());a.y=r.bottom+margin;}
      else{a.x=r.left-margin;a.y=lerp(r.top,r.bottom,rng());}
      a.x=clamp(a.x,8,width-8);a.y=clamp(a.y,8,height-8);
    }
    a.px=a.x;a.py=a.y;a.vx=0;a.vy=0;a.age=0;
    a.life=(lowCapability()?430:650)+rng()*650;
    a.offset=24+rng()*76;
    a.direction=rng()>.5?1:-1;
    a.coral=rng()<.09;
    return a;
  }

  function rebuildAgents(){
    agents=Array.from({length:agentTarget()},()=>spawn());
    canvas.dataset.agents=String(agents.length);
  }

  function resize(){
    if(disposed)return;
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    canvas.width=Math.max(1,Math.round(width));
    canvas.height=Math.max(1,Math.round(height));
    canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,width,height);
    rebuildAgents();
    if(reducedMotion)settleStatic();
  }

  function setQuietZones(rects:FieldRect[]){
    const next=rects[0]??null;
    if(!next){obstacle=null;return;}
    const changed=!obstacle||
      Math.abs(next.left-obstacle.left)>2||Math.abs(next.top-obstacle.top)>2||
      Math.abs(next.right-obstacle.right)>2||Math.abs(next.bottom-obstacle.bottom)>2||
      Math.abs((next.radius??0)-(obstacle.radius??0))>1;
    obstacle=next;
    canvas.dataset.quietZones=String(rects.length);
    if(changed){
      rebuildAgents();
      ctx.clearRect(0,0,width,height);
      if(reducedMotion)settleStatic();
    }
  }

  function updateAgent(a:Agent,dt:number){
    a.px=a.x;a.py=a.y;
    const n=normalAt(a.x,a.y);
    const tangent={x:-n.y*a.direction,y:n.x*a.direction};
    const d=obstacle?roundedRectSdf(a.x,a.y,obstacle):120;
    const target=a.offset+Math.sin(elapsed*.12+a.offset*.07)*12;
    const radial=clamp((target-d)*.018,-1.15,1.15);
    const noise=flowNoise(a.x,a.y,elapsed+a.offset*.1);
    let fx=tangent.x*.78+n.x*radial+Math.cos(noise*Math.PI*2)*.32;
    let fy=tangent.y*.78+n.y*radial+Math.sin(noise*Math.PI*2)*.32;

    if(obstacle&&d<9){
      const push=(9-d)*.17;fx+=n.x*push;fy+=n.y*push;
    }

    const fm=Math.hypot(fx,fy)||1;fx/=fm;fy/=fm;
    const speed=(lowCapability()?12.5:16)+(a.offset%28)*.1;
    const blend=1-Math.exp(-dt*2.8);
    a.vx=lerp(a.vx,fx*speed,blend);a.vy=lerp(a.vy,fy*speed,blend);
    a.x+=a.vx*dt;a.y+=a.vy*dt;a.age+=dt*60;

    if(a.x<-30||a.x>width+30||a.y<-30||a.y>height+30||a.age>a.life)spawn(a);
  }

  function step(deltaSeconds:number){
    if(disposed||reducedMotion)return;
    elapsed+=clamp(deltaSeconds,0,.08);
    const dt=clamp(deltaSeconds,1/120,.08);
    for(const a of agents)updateAgent(a,dt);
  }

  function strokeFor(a:Agent){
    const c=a.coral?secondary:primary;
    const alpha=a.coral?0.40:0.26;
    return`rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  function carveObstacle(){
    if(!obstacle)return;
    const pad=11,radius=(obstacle.radius??28)+pad;
    const x=obstacle.left-pad,y=obstacle.top-pad;
    const w=obstacle.right-obstacle.left+pad*2,h=obstacle.bottom-obstacle.top+pad*2;
    ctx.save();ctx.globalCompositeOperation='destination-out';
    ctx.beginPath();ctx.roundRect(x,y,w,h,radius);
    ctx.fillStyle='rgba(0,0,0,.98)';ctx.fill();ctx.restore();
  }

  function draw(){
    if(disposed)return;
    if(!reducedMotion){
      ctx.save();ctx.globalCompositeOperation='destination-out';
      ctx.fillStyle='rgba(0,0,0,.028)';ctx.fillRect(0,0,width,height);ctx.restore();
    }

    ctx.save();ctx.globalCompositeOperation='source-over';ctx.lineCap='round';
    for(const a of agents){
      if(Math.hypot(a.x-a.px,a.y-a.py)>36)continue;
      ctx.beginPath();ctx.moveTo(a.px,a.py);ctx.lineTo(a.x,a.y);
      ctx.strokeStyle=strokeFor(a);ctx.lineWidth=a.coral?1.2:.9;ctx.stroke();
    }
    ctx.restore();
    carveObstacle();
  }

  function settleStatic(){
    ctx.clearRect(0,0,width,height);
    const iterations=lowCapability()?240:340;
    for(let i=0;i<iterations;i++){
      elapsed+=1/24;
      for(const a of agents)updateAgent(a,1/24);
      ctx.save();ctx.lineCap='round';
      for(const a of agents){
        if(Math.hypot(a.x-a.px,a.y-a.py)>36)continue;
        ctx.beginPath();ctx.moveTo(a.px,a.py);ctx.lineTo(a.x,a.y);
        ctx.strokeStyle=strokeFor(a);ctx.lineWidth=a.coral?1.1:.82;ctx.stroke();
      }
      ctx.restore();
    }
    carveObstacle();
  }

  function setReducedMotion(reduced:boolean){
    reducedMotion=reduced;canvas.dataset.motion=reduced?'static':'running';
    if(reduced)settleStatic();
  }

  function refreshTheme(){
    const style=getComputedStyle(canvas);
    primary=parseColor(style.getPropertyValue('--field-primary'),primary);
    secondary=parseColor(style.getPropertyValue('--field-secondary'),secondary);
  }

  function dispose(){disposed=true;agents=[];}

  refreshTheme();resize();

  return{resize,step,draw,setPointer:()=>{},setScroll:()=>{},setQuietZones,setReducedMotion,refreshTheme,dispose};
}
