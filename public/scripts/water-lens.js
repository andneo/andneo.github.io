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
    canvas.dataset.dynamics='planar-translation-3d-rotation-transient-network';
    canvas.dataset.integrator='baoab-180hz';
    canvas.dataset.hbondValence='2-donor-2-acceptor';
    canvas.dataset.repulsion='oxygen-oxygen-hydrogen-hydrogen-hydrogen-oxygen';
    canvas.dataset.electrostatics='screened-tip4p-style-m-site-3d';
    canvas.dataset.orientation='quaternion-3d';
    canvas.dataset.translation='planar-xy';
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

    // Fully opaque microscopic medium. Keep this purely presentational:
    // the MD state and force model are unchanged.
    ctx.fillStyle=dark?'#1d2024':'#34383d';
    ctx.fillRect(0,0,this.width,this.height);

    const g=ctx.createRadialGradient(
      this.width*.36,this.height*.28,0,
      this.center.x,this.center.y,this.radius*1.06
    );
    g.addColorStop(0,dark?'rgba(132,139,146,.18)':'rgba(165,171,178,.18)');
    g.addColorStop(.52,dark?'rgba(73,79,85,.15)':'rgba(102,108,114,.14)');
    g.addColorStop(1,dark?'rgba(6,8,10,.34)':'rgba(15,18,21,.28)');
    ctx.fillStyle=g;
    ctx.fillRect(0,0,this.width,this.height);

    const vignette=ctx.createRadialGradient(
      this.center.x,this.center.y,this.radius*.44,
      this.center.x,this.center.y,this.radius
    );
    vignette.addColorStop(0,'rgba(0,0,0,0)');
    vignette.addColorStop(1,dark?'rgba(0,0,0,.34)':'rgba(0,0,0,.25)');
    ctx.fillStyle=vignette;
    ctx.fillRect(0,0,this.width,this.height);
  }

  drawBond(bond){
    const donor=this.md.molecules[bond.donorId];
    const acceptor=this.md.molecules[bond.acceptorId];
    if(!this.visibleMolecule(donor)&&!this.visibleMolecule(acceptor))return;

    const h=this.md.hydrogenSites(donor)[bond.donorIndex];

    // The 3D acceptor geometry decides whether the bond exists, but the
    // visible chemical convention remains O-H···O.
    const dx=this.md.minimumImage(acceptor.x-h.x);
    const dy=this.md.minimumImage(acceptor.y-h.y);
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
    const oxygenRadius=10.6*scale;
    const hydrogenBase=5.9*scale;
    const sites=this.md.hydrogenSites(m);

    const hydrogens=sites.map(site=>{
      const hp=this.toCanvas(site.x,site.y);
      const depth=site.z/this.md.oh;
      return{
        ...hp,
        z:site.z,
        depth,
        radius:hydrogenBase*(1+.16*depth),
        alpha:.76+.20*((depth+1)*.5),
      };
    });

    // Orthographic projection: bond shortening is the visual cue for tilt.
    ctx.strokeStyle='rgba(239,243,243,.86)';
    ctx.lineWidth=2.15*scale;
    ctx.lineCap='round';
    ctx.beginPath();
    for(const h of hydrogens){
      ctx.moveTo(p.x,p.y);
      ctx.lineTo(h.x,h.y);
    }
    ctx.stroke();

    // Draw the farther hydrogen first so near/far ordering remains legible.
    hydrogens.sort((a,b)=>a.z-b.z);
    for(const h of hydrogens){
      const r=Math.max(3.9*scale,h.radius);
      const hg=ctx.createRadialGradient(
        h.x-r*.34,h.y-r*.38,.5,
        h.x,h.y,r
      );
      hg.addColorStop(0,'rgba(255,255,255,1)');
      hg.addColorStop(.68,'rgba(237,240,239,.98)');
      hg.addColorStop(1,'rgba(184,194,196,.96)');
      ctx.save();
      ctx.globalAlpha=h.alpha;
      ctx.fillStyle=hg;
      ctx.beginPath();
      ctx.arc(h.x,h.y,r,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
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
    this.canvas.dataset.meanOutOfPlane=d.meanOutOfPlane.toFixed(4);
    this.canvas.dataset.maxCenterZ=d.maxCenterZ.toFixed(6);
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
