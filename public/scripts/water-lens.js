class WaterLens {
  constructor(canvas){
    this.canvas=canvas;
    this.host=canvas.closest('water-network-story');
    this.ctx=canvas.getContext('2d',{alpha:true});
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.width=1;
    this.height=1;
    this.radius=1;
    this.center={x:0,y:0};
    this.visibleRadius=.72;
    this.domainHalf=.78;
    this.molecules=[];
    this.hbonds=[];
    this.bondMemory=new Map();
    this.time=0;
    this.last=performance.now();
    this.visible=true;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.randomState=0x5f3759df;
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
    canvas.dataset.model='overdamped-langevin-rigid-water';
    canvas.dataset.dynamics='brownian-rigidbody-directional-hbond-v2';
    canvas.dataset.hbondForce='directional-donor-acceptor';
    if(this.host)this.host.dataset.lensReady='true';
  }

  random(){
    let x=this.randomState|0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    this.randomState=x|0;
    return((x>>>0)+.5)/4294967296;
  }

  gaussian(){
    const u=Math.max(1e-9,this.random());
    const v=this.random();
    return Math.sqrt(-2*Math.log(u))*Math.cos(Math.PI*2*v);
  }

  wrap(v){
    const span=this.domainHalf*2;
    if(v>this.domainHalf)return v-span;
    if(v<-this.domainHalf)return v+span;
    return v;
  }

  minimumImage(d){
    const span=this.domainHalf*2;
    if(d>this.domainHalf)return d-span;
    if(d<-this.domainHalf)return d+span;
    return d;
  }

  seed(){
    const count=28;
    const minSep=.17;
    for(let i=0;i<count;i++){
      let placed=false;
      for(let attempt=0;attempt<500&&!placed;attempt++){
        const x=(this.random()*2-1)*this.domainHalf;
        const y=(this.random()*2-1)*this.domainHalf;
        let ok=true;
        for(const other of this.molecules){
          const dx=this.minimumImage(x-other.x);
          const dy=this.minimumImage(y-other.y);
          if(Math.hypot(dx,dy)<minSep){ok=false;break;}
        }
        if(!ok)continue;
        this.molecules.push({
          id:i,
          x,y,
          angle:this.random()*Math.PI*2,
          fx:0,fy:0,torque:0,
        });
        placed=true;
      }
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

  donorSites(m){
    const half=52.25*Math.PI/180;
    const oh=.085;
    return [m.angle-half,m.angle+half].map((a,index)=>({
      index,
      angle:a,
      x:m.x+Math.cos(a)*oh,
      y:m.y+Math.sin(a)*oh,
    }));
  }

  acceptorAngles(m){
    const spread=52.25*Math.PI/180;
    return [m.angle+Math.PI-spread,m.angle+Math.PI+spread];
  }

  resetForces(){
    for(const m of this.molecules){
      m.fx=0;m.fy=0;m.torque=0;
    }
  }

  applyExcludedVolume(){
    const sigma=.158;
    const cutoff=.19;
    const stiffness=3.6;

    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i];
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j];
        const dx=this.minimumImage(b.x-a.x);
        const dy=this.minimumImage(b.y-a.y);
        const d=Math.hypot(dx,dy);
        if(d<=1e-6||d>=cutoff)continue;

        const nx=dx/d,ny=dy/d;
        const overlap=Math.max(0,(cutoff-d)/(cutoff-sigma*.72));
        const force=stiffness*overlap*overlap;

        a.fx-=nx*force;a.fy-=ny*force;
        b.fx+=nx*force;b.fy+=ny*force;
      }
    }
  }

  hbondCandidate(donor,acceptor,site){
    const dx=this.minimumImage(acceptor.x-site.x);
    const dy=this.minimumImage(acceptor.y-site.y);
    const d=Math.hypot(dx,dy);
    if(d<.105||d>.245)return null;

    const ux=dx/d,uy=dy/d;
    const donorUx=Math.cos(site.angle),donorUy=Math.sin(site.angle);
    const donorAlignment=Math.max(0,donorUx*ux+donorUy*uy);
    if(donorAlignment<.78)return null;

    const towardDonorX=-ux,towardDonorY=-uy;
    let acceptorAlignment=-1;
    let acceptorAngle=0;
    for(const angle of this.acceptorAngles(acceptor)){
      const score=Math.cos(angle)*towardDonorX+Math.sin(angle)*towardDonorY;
      if(score>acceptorAlignment){
        acceptorAlignment=score;
        acceptorAngle=angle;
      }
    }
    if(acceptorAlignment<.28)return null;

    const target=.158;
    const width=.055;
    const distanceScore=Math.exp(-Math.pow((d-target)/width,2));
    const donorScore=Math.pow(donorAlignment,6);
    const acceptorScore=Math.pow(Math.max(0,acceptorAlignment),3);
    const strength=distanceScore*donorScore*acceptorScore;
    if(strength<.08)return null;

    return{
      donor,acceptor,site,
      dx,dy,d,ux,uy,
      acceptorAngle,
      donorAlignment,
      acceptorAlignment,
      strength,
    };
  }

  applyHydrogenBondForces(){
    const candidates=[];

    for(const donor of this.molecules){
      for(const site of this.donorSites(donor)){
        for(const acceptor of this.molecules){
          if(acceptor===donor)continue;
          const candidate=this.hbondCandidate(donor,acceptor,site);
          if(candidate)candidates.push(candidate);
        }
      }
    }

    candidates.sort((a,b)=>b.strength-a.strength);

    const donorUsed=new Set();
    const acceptorDegree=new Map();
    const chosen=[];
    for(const bond of candidates){
      const donorKey=`${bond.donor.id}:${bond.site.index}`;
      const degree=acceptorDegree.get(bond.acceptor.id)||0;
      if(donorUsed.has(donorKey)||degree>=2)continue;

      donorUsed.add(donorKey);
      acceptorDegree.set(bond.acceptor.id,degree+1);
      chosen.push(bond);
      if(chosen.length>=14)break;
    }

    const attraction=1.18;
    const orientTorque=.055;

    for(const bond of chosen){
      const force=attraction*bond.strength;
      bond.donor.fx+=bond.ux*force;
      bond.donor.fy+=bond.uy*force;
      bond.acceptor.fx-=bond.ux*force;
      bond.acceptor.fy-=bond.uy*force;

      const desiredDonor=Math.atan2(bond.uy,bond.ux);
      const donorError=this.angleDifference(desiredDonor,bond.site.angle);
      bond.donor.torque+=donorError*orientTorque*bond.strength;

      const desiredAcceptor=Math.atan2(-bond.uy,-bond.ux);
      const acceptorError=this.angleDifference(desiredAcceptor,bond.acceptorAngle);
      bond.acceptor.torque+=acceptorError*orientTorque*bond.strength;
    }

    this.updateBondMemory(chosen);
  }

  angleDifference(target,current){
    let d=target-current;
    while(d>Math.PI)d-=Math.PI*2;
    while(d<-Math.PI)d+=Math.PI*2;
    return d;
  }

  updateBondMemory(chosen){
    const active=new Set();

    for(const bond of chosen){
      const key=`${bond.donor.id}:${bond.site.index}>${bond.acceptor.id}`;
      active.add(key);
      const previous=this.bondMemory.get(key);
      this.bondMemory.set(key,{
        key,
        donor:bond.donor,
        acceptor:bond.acceptor,
        hIndex:bond.site.index,
        hx:bond.site.x,
        hy:bond.site.y,
        strength:previous?previous.strength*.72+bond.strength*.28:bond.strength*.4,
        life:Math.min(1,(previous?.life||0)+.16),
      });
    }

    for(const [key,bond] of this.bondMemory){
      if(active.has(key))continue;
      bond.life-=.11;
      bond.strength*=.86;
      if(bond.life<=0||bond.strength<.025)this.bondMemory.delete(key);
    }

    this.hbonds=[...this.bondMemory.values()]
      .filter(b=>b.life>.06)
      .sort((a,b)=>b.strength-a.strength)
      .slice(0,14);

    this.canvas.dataset.hydrogenBonds=String(this.hbonds.length);
    this.canvas.dataset.visibleMolecules=String(
      this.molecules.filter(m=>Math.hypot(m.x,m.y)<=this.visibleRadius).length
    );
  }

  step(dt){
    if(this.reduced){
      this.resetForces();
      this.applyExcludedVolume();
      this.applyHydrogenBondForces();
      return;
    }

    this.resetForces();
    this.applyExcludedVolume();
    this.applyHydrogenBondForces();

    const translationalMobility=.033;
    const rotationalMobility=.62;
    const diffusion=.00018;
    const rotationalDiffusion=.032;
    const sqrtDt=Math.sqrt(Math.max(dt,1e-5));

    for(const m of this.molecules){
      const dx=translationalMobility*m.fx*dt+
        Math.sqrt(2*diffusion)*sqrtDt*this.gaussian();
      const dy=translationalMobility*m.fy*dt+
        Math.sqrt(2*diffusion)*sqrtDt*this.gaussian();
      const da=rotationalMobility*m.torque*dt+
        Math.sqrt(2*rotationalDiffusion)*sqrtDt*this.gaussian();

      m.x=this.wrap(m.x+dx);
      m.y=this.wrap(m.y+dy);
      m.angle+=da;
    }
  }

  toCanvas(x,y){
    const scale=this.radius*(.94/this.visibleRadius);
    return{
      x:this.center.x+x*scale,
      y:this.center.y+y*scale,
    };
  }

  visibleMolecule(m){
    return Math.hypot(m.x,m.y)<this.visibleRadius+.12;
  }

  draw(){
    const ctx=this.ctx;
    ctx.clearRect(0,0,this.width,this.height);

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,0,Math.PI*2);
    ctx.clip();

    const wash=ctx.createRadialGradient(
      this.width*.38,this.height*.30,0,
      this.center.x,this.center.y,this.radius
    );
    wash.addColorStop(0,'rgba(232,248,250,.34)');
    wash.addColorStop(.58,'rgba(104,165,182,.26)');
    wash.addColorStop(1,'rgba(28,82,103,.35)');
    ctx.fillStyle=wash;
    ctx.fillRect(0,0,this.width,this.height);

    this.drawBonds();

    const order=this.molecules
      .filter(m=>this.visibleMolecule(m))
      .sort((a,b)=>a.y-b.y);
    for(const molecule of order)this.drawMolecule(molecule);

    const sheen=ctx.createLinearGradient(0,0,this.width,this.height);
    sheen.addColorStop(0,'rgba(255,255,255,.14)');
    sheen.addColorStop(.32,'rgba(255,255,255,.018)');
    sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen;
    ctx.fillRect(0,0,this.width,this.height);

    ctx.restore();
  }

  drawBonds(){
    const ctx=this.ctx;
    ctx.save();
    ctx.lineCap='round';
    ctx.setLineDash([5,5]);

    for(const bond of this.hbonds){
      if(!this.visibleMolecule(bond.donor)&&!this.visibleMolecule(bond.acceptor))continue;
      const donorSites=this.donorSites(bond.donor);
      const site=donorSites[bond.hIndex];
      const h=this.toCanvas(site.x,site.y);

      const dx=this.minimumImage(bond.acceptor.x-site.x);
      const dy=this.minimumImage(bond.acceptor.y-site.y);
      const a=this.toCanvas(site.x+dx,site.y+dy);

      const alpha=(.10+.54*bond.strength)*Math.min(1,bond.life);
      ctx.strokeStyle=`rgba(204,239,249,${alpha})`;
      ctx.lineWidth=1.35;
      ctx.beginPath();
      ctx.moveTo(h.x,h.y);
      ctx.lineTo(a.x,a.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawMolecule(m){
    const ctx=this.ctx;
    const p=this.toCanvas(m.x,m.y);
    const scale=Math.max(.9,Math.min(1.35,this.radius/170));
    const ohPixels=20.5*scale;
    const oxygenRadius=10.7*scale;
    const hydrogenRadius=6.0*scale;
    const half=52.25*Math.PI/180;

    const h1={
      x:p.x+Math.cos(m.angle-half)*ohPixels,
      y:p.y+Math.sin(m.angle-half)*ohPixels,
    };
    const h2={
      x:p.x+Math.cos(m.angle+half)*ohPixels,
      y:p.y+Math.sin(m.angle+half)*ohPixels,
    };

    ctx.strokeStyle='rgba(232,236,235,.78)';
    ctx.lineWidth=2.35*scale;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);ctx.lineTo(h1.x,h1.y);
    ctx.moveTo(p.x,p.y);ctx.lineTo(h2.x,h2.y);
    ctx.stroke();

    for(const h of [h1,h2]){
      const g=ctx.createRadialGradient(
        h.x-hydrogenRadius*.35,h.y-hydrogenRadius*.4,.6,
        h.x,h.y,hydrogenRadius
      );
      g.addColorStop(0,'#ffffff');
      g.addColorStop(.72,'#eceeed');
      g.addColorStop(1,'#c4cbcd');
      ctx.fillStyle=g;
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

  frame(now){
    const dt=Math.min(.035,Math.max(0,(now-this.last)/1000));
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
