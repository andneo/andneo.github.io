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
    this.md=new RigidWaterMD({count:28,domainHalf:.80,dt:1/180,temperature:.026,gamma:2.4,gammaRot:3.2});
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
    canvas.dataset.model='tip4p-style-rigid-water-md';
    canvas.dataset.dynamics='inertial-translation-rotation-transient-network';
    canvas.dataset.integrator='baoab-180hz';
    canvas.dataset.hbondValence='2-donor-2-acceptor';
    canvas.dataset.repulsion='oxygen-oxygen-hydrogen-hydrogen-hydrogen-oxygen';
    canvas.dataset.electrostatics='screened-tip4p-style-m-site';
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
    ctx.fillStyle=dark?'#10262f':'#8eb9c6';
    ctx.fillRect(0,0,this.width,this.height);

    const g=ctx.createRadialGradient(
      this.width*.36,this.height*.28,0,
      this.center.x,this.center.y,this.radius*1.05
    );
    g.addColorStop(0,dark?'rgba(102,159,172,.34)':'rgba(205,233,239,.52)');
    g.addColorStop(.54,dark?'rgba(38,89,103,.18)':'rgba(128,181,194,.24)');
    g.addColorStop(1,dark?'rgba(2,20,27,.30)':'rgba(46,103,119,.22)');
    ctx.fillStyle=g;
    ctx.fillRect(0,0,this.width,this.height);

    const vignette=ctx.createRadialGradient(
      this.center.x,this.center.y,this.radius*.46,
      this.center.x,this.center.y,this.radius
    );
    vignette.addColorStop(0,'rgba(0,0,0,0)');
    vignette.addColorStop(1,dark?'rgba(0,8,12,.28)':'rgba(17,59,72,.20)');
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
    const alpha=.48+.44*ageFade*strength;

    const ctx=this.ctx;
    ctx.save();
    ctx.lineCap='round';
    ctx.setLineDash([6,4]);
    ctx.lineWidth=1.8;
    ctx.shadowColor='rgba(30,96,122,.28)';
    ctx.shadowBlur=2;
    ctx.strokeStyle=`rgba(247,252,255,${alpha})`;
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
    this.canvas.dataset.minOo=d.minOO.toFixed(4);
    this.canvas.dataset.minHh=d.minHH.toFixed(4);
    this.canvas.dataset.minHo=d.minHO.toFixed(4);
    this.canvas.dataset.qO=d.qO.toFixed(2);
    this.canvas.dataset.qH=d.qH.toFixed(2);
    this.canvas.dataset.qM=d.qM.toFixed(2);
    this.canvas.dataset.oM=d.oM.toFixed(4);
    this.canvas.dataset.electrostaticK=d.electrostaticK.toFixed(4);
    this.canvas.dataset.netCharge=d.netCharge.toFixed(4);
    this.canvas.dataset.visibleMolecules=String(
      this.md.molecules.filter(m=>Math.hypot(m.x,m.y)<=this.visibleRadius).length
    );
  }

  frame(now){
    const elapsed=Math.min(.06,Math.max(0,(now-this.last)/1000));
    this.last=now;

    const active=this.visible&&this.host?.dataset.scene==='0'&&this.host?.dataset.paused!=='true';
    if(active){
      this.accumulator=Math.min(this.accumulator+elapsed,this.md.dt*6);
      let steps=0;
      while(this.accumulator>=this.md.dt&&steps<6){
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
