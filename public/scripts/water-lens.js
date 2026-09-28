class WaterLens {
  constructor(canvas){
    this.canvas=canvas;
    this.host=canvas.closest('water-network-story');
    this.ctx=canvas.getContext('2d');
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.molecules=[];
    this.hbonds=[];
    this.time=0;
    this.last=performance.now();
    this.visible=true;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.width=1;
    this.height=1;
    this.radius=1;
    this.center={x:0,y:0};
    this.ro=new ResizeObserver(()=>this.resize());
    this.io=new IntersectionObserver(([entry])=>{this.visible=entry?.isIntersecting??true;},{threshold:.01});
    this.seed();
    this.resize();
    this.ro.observe(canvas);
    this.io.observe(canvas);
    this.frame=this.frame.bind(this);
    requestAnimationFrame(this.frame);
    canvas.dataset.renderer='molecular-lens';
    canvas.dataset.moleculeCount=String(this.molecules.length);
    if(this.host)this.host.dataset.lensReady='true';
  }

  rand(seed){
    const x=Math.sin(seed*12.9898+78.233)*43758.5453;
    return x-Math.floor(x);
  }

  seed(){
    const count=14;
    for(let i=0;i<count;i++){
      const a=this.rand(i+1)*Math.PI*2;
      const r=Math.sqrt(this.rand(i+31))*.68;
      this.molecules.push({
        id:i,
        x:Math.cos(a)*r,
        y:Math.sin(a)*r,
        vx:(this.rand(i+61)-.5)*.018,
        vy:(this.rand(i+91)-.5)*.018,
        angle:this.rand(i+121)*Math.PI*2,
        va:(this.rand(i+151)-.5)*.32,
        phase:this.rand(i+181)*Math.PI*2,
      });
    }
  }

  resize(){
    const rect=this.canvas.getBoundingClientRect();
    this.width=Math.max(1,rect.width);
    this.height=Math.max(1,rect.height);
    this.radius=Math.min(this.width,this.height)*.5;
    this.center={x:this.width*.5,y:this.height*.5};
    this.canvas.width=Math.round(this.width*this.dpr);
    this.canvas.height=Math.round(this.height*this.dpr);
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
  }

  step(dt){
    if(this.reduced)return;
    for(const m of this.molecules){
      m.vx+=Math.sin(this.time*.73+m.phase)*.00018;
      m.vy+=Math.cos(this.time*.61+m.phase*1.17)*.00018;
      m.x+=m.vx*dt*60;
      m.y+=m.vy*dt*60;
      m.angle+=m.va*dt;
      m.vx*=.996;
      m.vy*=.996;

      const r=Math.hypot(m.x,m.y);
      const maxR=.72;
      if(r>maxR){
        const nx=m.x/r,ny=m.y/r;
        m.x=nx*maxR;
        m.y=ny*maxR;
        const vn=m.vx*nx+m.vy*ny;
        m.vx-=1.7*vn*nx;
        m.vy-=1.7*vn*ny;
      }
    }
    this.rebuildHBonds();
  }

  rebuildHBonds(){
    const candidates=[];
    for(let i=0;i<this.molecules.length;i++){
      for(let j=i+1;j<this.molecules.length;j++){
        const a=this.molecules[i],b=this.molecules[j];
        const dx=a.x-b.x,dy=a.y-b.y;
        const d=Math.hypot(dx,dy);
        if(d<.39){
          const phase=.5+.5*Math.sin(this.time*1.15+a.phase-b.phase*.7);
          if(phase>.3)candidates.push({a,b,d,alpha:.13+phase*.30});
        }
      }
    }
    candidates.sort((a,b)=>a.d-b.d);
    this.hbonds=candidates.slice(0,8);
    this.canvas.dataset.hydrogenBonds=String(this.hbonds.length);
  }

  point(m){
    const scale=this.radius*.76;
    return{x:this.center.x+m.x*scale,y:this.center.y+m.y*scale};
  }

  draw(){
    const ctx=this.ctx;
    ctx.clearRect(0,0,this.width,this.height);

    const bg=ctx.createRadialGradient(
      this.width*.38,this.height*.31,0,
      this.center.x,this.center.y,this.radius
    );
    bg.addColorStop(0,'rgba(225,246,250,.80)');
    bg.addColorStop(.50,'rgba(150,207,220,.58)');
    bg.addColorStop(1,'rgba(52,116,139,.72)');
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,this.width,this.height);

    ctx.save();
    ctx.lineCap='round';
    ctx.setLineDash([5,5]);
    for(const bond of this.hbonds){
      const a=this.point(bond.a),b=this.point(bond.b);
      ctx.strokeStyle=`rgba(226,250,255,${bond.alpha})`;
      ctx.lineWidth=1.35;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.stroke();
    }
    ctx.restore();

    for(const molecule of this.molecules)this.drawMolecule(molecule);

    const sheen=ctx.createLinearGradient(0,0,this.width,this.height);
    sheen.addColorStop(0,'rgba(255,255,255,.24)');
    sheen.addColorStop(.30,'rgba(255,255,255,.02)');
    sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen;
    ctx.fillRect(0,0,this.width,this.height);
  }

  drawMolecule(m){
    const ctx=this.ctx;
    const p=this.point(m);
    const scale=Math.max(.82,Math.min(1.18,this.radius/135));
    const bondLength=20*scale;
    const oxygenRadius=10.5*scale;
    const hydrogenRadius=6.1*scale;
    const half=52.25*Math.PI/180;

    const h1={
      x:p.x+Math.sin(m.angle+half)*bondLength,
      y:p.y-Math.cos(m.angle+half)*bondLength,
    };
    const h2={
      x:p.x+Math.sin(m.angle-half)*bondLength,
      y:p.y-Math.cos(m.angle-half)*bondLength,
    };

    ctx.strokeStyle='rgba(236,240,240,.86)';
    ctx.lineWidth=2.4*scale;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);ctx.lineTo(h1.x,h1.y);
    ctx.moveTo(p.x,p.y);ctx.lineTo(h2.x,h2.y);
    ctx.stroke();

    for(const h of [h1,h2]){
      const g=ctx.createRadialGradient(
        h.x-hydrogenRadius*.35,h.y-hydrogenRadius*.35,.5,
        h.x,h.y,hydrogenRadius
      );
      g.addColorStop(0,'#ffffff');
      g.addColorStop(.72,'#f0f1ef');
      g.addColorStop(1,'#cfd6d8');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.arc(h.x,h.y,hydrogenRadius,0,Math.PI*2);
      ctx.fill();
    }

    const og=ctx.createRadialGradient(
      p.x-oxygenRadius*.36,p.y-oxygenRadius*.36,1,
      p.x,p.y,oxygenRadius
    );
    og.addColorStop(0,'#ff9b93');
    og.addColorStop(.42,'#e8574f');
    og.addColorStop(1,'#a92524');
    ctx.fillStyle=og;
    ctx.beginPath();
    ctx.arc(p.x,p.y,oxygenRadius,0,Math.PI*2);
    ctx.fill();
  }

  frame(now){
    const dt=Math.min(.04,Math.max(0,(now-this.last)/1000));
    this.last=now;
    this.time+=dt;
    if(this.visible&&this.host?.dataset.scene==='0'){
      this.step(dt);
      this.draw();
    }
    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-water-lens-canvas]').forEach(canvas=>{
  if(canvas.__waterLens)return;
  canvas.__waterLens=new WaterLens(canvas);
});
