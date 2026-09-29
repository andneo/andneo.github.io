import {RigidWaterMD} from './water-md.js';

class WaterLens {
  constructor(canvas){
    this.canvas=canvas;
    this.host=canvas.closest('water-network-story');
    this.ctx=canvas.getContext('2d',{alpha:false});
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.width=1;
    this.height=1;
    this.radius=1;
    this.center={x:0,y:0};
    this.visibleRadius=.75;
    this.md=new RigidWaterMD({count:28,domainHalf:.80,dt:1/120});
    this.accumulator=0;
    this.last=performance.now();
    this.visible=true;
    this.ro=new ResizeObserver(()=>this.resize());
    this.io=new IntersectionObserver(([entry])=>{this.visible=entry?.isIntersecting??true;},{threshold:.01});

    this.resize();
    this.ro.observe(canvas);
    this.io.observe(canvas);

    canvas.dataset.renderer='molecular-lens';
    canvas.dataset.moleculeCount=String(this.md.count);
    canvas.dataset.model='rigid-water-langevin-md';
    canvas.dataset.dynamics='inertial-translation-rotation-transient-network';
    canvas.dataset.integrator='baoab-120hz';
    canvas.dataset.hbondValence='2-donor-2-acceptor';
    canvas.dataset.repulsion='oxygen-oxygen-hydrogen-hydrogen-hydrogen-oxygen';
    canvas.dataset.background='opaque-microscopic-water';
    if(this.host)this.host.dataset.lensReady='true';

    this.frame=this.frame.bind(this);
    requestAnimationFrame(this.frame);
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

  toCanvas(x,y){
    const scale=this.radius*(.95/this.visibleRadius);
    return{
      x:this.center.x+x*scale,
      y:this.center.y+y*scale,
    };
  }

  visibleMolecule(m){
    return Math.hypot(m.x,m.y)<this.visibleRadius+.12;
  }

  paintBackground(){
    const ctx=this.ctx;
    const dark=document.documentElement.dataset.theme==='dark';

    // Fully opaque microscopic medium. The macroscopic pool iframe must never
    // composite through the aperture.
    ctx.fillStyle=dark?'#17303a':'#b7d6df';
    ctx.fillRect(0,0,this.width,this.height);

    const g=ctx.createRadialGradient(
      this.width*.36,this.height*.28,0,
      this.center.x,this.center.y,this.radius*1.05
    );
    g.addColorStop(0,dark?'rgba(133,190,202,.55)':'rgba(240,252,253,.88)');
    g.addColorStop(.54,dark?'rgba(58,115,130,.30)':'rgba(173,215,225,.48)');
    g.addColorStop(1,dark?'rgba(4,26,34,.46)':'rgba(77,139,157,.34)');
    ctx.fillStyle=g;
    ctx.fillRect(0,0,this.width,this.height);

    const vignette=ctx.createRadialGradient(
      this.center.x,this.center.y,this.radius*.46,
      this.center.x,this.center.y,this.radius
    );
    vignette.addColorStop(0,'rgba(0,0,0,0)');
    vignette.addColorStop(1,dark?'rgba(0,10,14,.32)':'rgba(20,68,82,.16)');
    ctx.fillStyle=vignette;
    ctx.fillRect(0,0,this.width,this.height);
  }

  drawBond(bond){
    const donor=this.md.molecules[bond.donorId];
    const acceptor=this.md.molecules[bond.acceptorId];
    if(!this.visibleMolecule(donor)&&!this.visibleMolecule(acceptor))return;

    const h=this.md.hydrogenSites(donor)[bond.donorIndex];
    const a=this.md.acceptorSites(acceptor)[bond.acceptorIndex];
    const dx=this.md.minimumImage(a.x-h.x);
    const dy=this.md.minimumImage(a.y-h.y);
    const p1=this.toCanvas(h.x,h.y);
    const p2=this.toCanvas(h.x+dx,h.y+dy);

    const ageFade=Math.min(1,bond.age/.10);
    const strength=Math.max(.18,Math.min(1,bond.score??.4));
    const alpha=.18+.55*ageFade*strength;

    const ctx=this.ctx;
    ctx.save();
    ctx.lineCap='round';
    ctx.setLineDash([4.5,4.5]);
    ctx.lineWidth=1.2;
    ctx.strokeStyle=`rgba(221,247,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(p1.x,p1.y);
    ctx.lineTo(p2.x,p2.y);
    ctx.stroke();
    ctx.restore();
  }

  drawMolecule(m){
    const ctx=this.ctx;
    const p=this.toCanvas(m.x,m.y);
    const scale=Math.max(.92,Math.min(1.42,this.radius/175));
    const ohPixels=21.0*scale;
    const oxygenRadius=10.6*scale;
    const hydrogenRadius=5.9*scale;
    const half=52.25*Math.PI/180;

    const h1={
      x:p.x+Math.cos(m.angle-half)*ohPixels,
      y:p.y+Math.sin(m.angle-half)*ohPixels,
    };
    const h2={
      x:p.x+Math.cos(m.angle+half)*ohPixels,
      y:p.y+Math.sin(m.angle+half)*ohPixels,
    };

    ctx.strokeStyle='rgba(239,243,243,.86)';
    ctx.lineWidth=2.15*scale;
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);ctx.lineTo(h1.x,h1.y);
    ctx.moveTo(p.x,p.y);ctx.lineTo(h2.x,h2.y);
    ctx.stroke();

    for(const h of [h1,h2]){
      const hg=ctx.createRadialGradient(
        h.x-hydrogenRadius*.34,h.y-hydrogenRadius*.38,.5,
        h.x,h.y,hydrogenRadius
      );
      hg.addColorStop(0,'#ffffff');
      hg.addColorStop(.68,'#edf0ef');
      hg.addColorStop(1,'#b8c2c4');
      ctx.fillStyle=hg;
      ctx.beginPath();
      ctx.arc(h.x,h.y,hydrogenRadius,0,Math.PI*2);
      ctx.fill();
    }

    const og=ctx.createRadialGradient(
      p.x-oxygenRadius*.38,p.y-oxygenRadius*.42,1,
      p.x,p.y,oxygenRadius
    );
    og.addColorStop(0,'#ffaaa0');
    og.addColorStop(.40,'#e85b51');
    og.addColorStop(1,'#9f2624');
    ctx.fillStyle=og;
    ctx.beginPath();
    ctx.arc(p.x,p.y,oxygenRadius,0,Math.PI*2);
    ctx.fill();
  }

  draw(){
    const ctx=this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,0,Math.PI*2);
    ctx.clip();

    this.paintBackground();

    for(const bond of this.md.bonds.values())this.drawBond(bond);

    const order=this.md.molecules
      .filter(m=>this.visibleMolecule(m))
      .sort((a,b)=>a.y-b.y);
    for(const molecule of order)this.drawMolecule(molecule);

    const sheen=ctx.createLinearGradient(0,0,this.width,this.height);
    sheen.addColorStop(0,'rgba(255,255,255,.10)');
    sheen.addColorStop(.30,'rgba(255,255,255,.018)');
    sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen;
    ctx.fillRect(0,0,this.width,this.height);
    ctx.restore();
  }

  updateDiagnostics(){
    const d=this.md.diagnostics();
    this.canvas.dataset.mdSteps=String(d.steps);
    this.canvas.dataset.hydrogenBonds=String(d.bonds);
    this.canvas.dataset.bondsFormed=String(d.formed);
    this.canvas.dataset.bondsBroken=String(d.broken);
    this.canvas.dataset.meanSpeed=d.meanSpeed.toFixed(4);
    this.canvas.dataset.meanAngularSpeed=d.meanAngularSpeed.toFixed(4);
    this.canvas.dataset.maxDonorDegree=String(d.maxDonorDegree);
    this.canvas.dataset.maxAcceptorDegree=String(d.maxAcceptorDegree);
    this.canvas.dataset.maxTotalDegree=String(d.maxTotalDegree);
    this.canvas.dataset.visibleMolecules=String(
      this.md.molecules.filter(m=>Math.hypot(m.x,m.y)<=this.visibleRadius).length
    );
  }

  frame(now){
    const elapsed=Math.min(.06,Math.max(0,(now-this.last)/1000));
    this.last=now;

    const active=this.visible&&this.host?.dataset.scene==='0'&&this.host?.dataset.paused!=='true';
    if(active){
      this.accumulator=Math.min(this.accumulator+elapsed,this.md.dt*4);
      let steps=0;
      while(this.accumulator>=this.md.dt&&steps<4){
        this.md.integrate();
        this.accumulator-=this.md.dt;
        steps++;
      }
      this.draw();
      this.updateDiagnostics();
    }else{
      this.accumulator=0;
    }

    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-water-lens-canvas]').forEach(canvas=>{
  if(canvas.__waterLens)return;
  canvas.__waterLens=new WaterLens(canvas);
});
