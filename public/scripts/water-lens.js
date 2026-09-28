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
    this.visibleRadius=.72;
    this.bathRadius=1.08;
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
    canvas.dataset.dynamics='brownian-excluded-volume-directional-hbond';
    if(this.host)this.host.dataset.lensReady='true';
  }

  rand(seed){
    const x=Math.sin(seed*12.9898+78.233)*43758.5453;
    return x-Math.floor(x);
  }

  seed(){
    const count=26;
    for(let i=0;i<count;i++){
      const a=this.rand(i+1)*Math.PI*2;
      const r=Math.sqrt(this.rand(i+31))*this.bathRadius*.94;
      this.molecules.push({
        id:i,
        x:Math.cos(a)*r,
        y:Math.sin(a)*r,
        vx:(this.rand(i+61)-.5)*.010,
        vy:(this.rand(i+91)-.5)*.010,
        angle:this.rand(i+121)*Math.PI*2,
        omega:(this.rand(i+151)-.5)*.020,
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

  hydrogenSites(m){
    const half=52.25*Math.PI/180;
    const bond=.105;
    return [
      {
        x:m.x+Math.sin(m.angle+half)*bond,
        y:m.y-Math.cos(m.angle+half)*bond,
      },
      {
        x:m.x+Math.sin(m.angle-half)*bond,
        y:m.y-Math.cos(m.angle-half)*bond,
      }
    ];
  }

  applyExcludedVolume(){
    const cutoff=.165;
    const stiffness=.024;

    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i];
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j];
        const dx=b.x-a.x,dy=b.y-a.y;
        const d=Math.hypot(dx,dy);
        if(d<=1e-5||d>=cutoff)continue;

        const nx=dx/d,ny=dy/d;
        const overlap=(cutoff-d)/cutoff;
        const impulse=stiffness*overlap*overlap;

        a.vx-=nx*impulse;
        a.vy-=ny*impulse;
        b.vx+=nx*impulse;
        b.vy+=ny*impulse;
      }
    }
  }

  step(dt){
    if(this.reduced){
      this.rebuildHBonds();
      return;
    }

    this.applyExcludedVolume();

    const translationalNoise=.00070;
    const rotationalNoise=.0019;
    const linearDrag=.989;
    const angularDrag=.975;
    const scale=dt*60;

    for(const m of this.molecules){
      m.vx+=(Math.random()-.5)*translationalNoise;
      m.vy+=(Math.random()-.5)*translationalNoise;
      m.omega+=(Math.random()-.5)*rotationalNoise;

      m.x+=m.vx*scale;
      m.y+=m.vy*scale;
      m.angle+=m.omega*scale;

      m.vx*=linearDrag;
      m.vy*=linearDrag;
      m.omega*=angularDrag;

      // Periodic-style recycling through the hidden molecular bath. This lets
      // molecules move through the visible circular field instead of bouncing
      // off an artificial optical boundary.
      const r=Math.hypot(m.x,m.y);
      if(r>this.bathRadius){
        const a=Math.atan2(m.y,m.x)+Math.PI+(Math.random()-.5)*.38;
        const rr=this.bathRadius*.96;
        m.x=Math.cos(a)*rr;
        m.y=Math.sin(a)*rr;
        const speed=.004+Math.random()*.006;
        m.vx=Math.cos(a+Math.PI)*speed+(Math.random()-.5)*.003;
        m.vy=Math.sin(a+Math.PI)*speed+(Math.random()-.5)*.003;
      }
    }

    this.rebuildHBonds();
  }

  rebuildHBonds(){
    const bonds=[];
    const maxOO=.34;
    const minOO=.16;
    const maxHO=.245;
    const minAlignment=.84;

    for(let i=0;i<this.molecules.length;i++){
      const donor=this.molecules[i];
      const hydrogens=this.hydrogenSites(donor);

      for(let j=0;j<this.molecules.length;j++){
        if(i===j)continue;
        const acceptor=this.molecules[j];

        const dxOO=acceptor.x-donor.x;
        const dyOO=acceptor.y-donor.y;
        const dOO=Math.hypot(dxOO,dyOO);
        if(dOO<minOO||dOO>maxOO)continue;

        const ux=dxOO/dOO,uy=dyOO/dOO;

        for(let hIndex=0;hIndex<hydrogens.length;hIndex++){
          const h=hydrogens[hIndex];
          const dxHO=acceptor.x-h.x;
          const dyHO=acceptor.y-h.y;
          const dHO=Math.hypot(dxHO,dyHO);
          if(dHO<=1e-5||dHO>maxHO)continue;

          const hx=dxHO/dHO,hy=dyHO/dHO;

          // Donor O->acceptor and donor H->acceptor should be nearly collinear.
          const alignment=ux*hx+uy*hy;
          if(alignment<minAlignment)continue;

          // Prefer the intermolecular shell near the liquid hydrogen-bond distance.
          const distanceScore=1-Math.min(1,Math.abs(dOO-.255)/.095);
          const angularScore=(alignment-minAlignment)/(1-minAlignment);
          const strength=.25+.75*Math.max(0,distanceScore)*Math.max(0,angularScore);

          bonds.push({
            donor,
            acceptor,
            hIndex,
            hx:h.x,
            hy:h.y,
            strength,
          });
        }
      }
    }

    bonds.sort((a,b)=>b.strength-a.strength);

    // One donor hydrogen can participate in one displayed bond at a time,
    // and limit acceptor coordination to avoid a visually implausible tangle.
    const donorSites=new Set();
    const acceptorDegree=new Map();
    this.hbonds=[];
    for(const bond of bonds){
      const donorKey=`${bond.donor.id}:${bond.hIndex}`;
      const degree=acceptorDegree.get(bond.acceptor.id)||0;
      if(donorSites.has(donorKey)||degree>=2)continue;
      donorSites.add(donorKey);
      acceptorDegree.set(bond.acceptor.id,degree+1);
      this.hbonds.push(bond);
      if(this.hbonds.length>=10)break;
    }

    this.canvas.dataset.hydrogenBonds=String(this.hbonds.length);
    this.canvas.dataset.visibleMolecules=String(
      this.molecules.filter(m=>Math.hypot(m.x,m.y)<=this.visibleRadius).length
    );
  }

  toCanvas(x,y){
    const scale=this.radius*(.91/this.visibleRadius);
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

    const bg=ctx.createRadialGradient(
      this.width*.36,this.height*.30,0,
      this.center.x,this.center.y,this.radius
    );
    bg.addColorStop(0,'rgba(226,245,247,.56)');
    bg.addColorStop(.56,'rgba(132,190,204,.42)');
    bg.addColorStop(1,'rgba(44,102,124,.58)');
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,this.width,this.height);

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.center.x,this.center.y,this.radius,0,Math.PI*2);
    ctx.clip();

    ctx.lineCap='round';
    ctx.setLineDash([5,5]);
    for(const bond of this.hbonds){
      if(!this.visibleMolecule(bond.donor)&&!this.visibleMolecule(bond.acceptor))continue;
      const h=this.toCanvas(bond.hx,bond.hy);
      const a=this.toCanvas(bond.acceptor.x,bond.acceptor.y);
      ctx.strokeStyle=`rgba(226,248,255,${.20+.42*bond.strength})`;
      ctx.lineWidth=1.35;
      ctx.beginPath();
      ctx.moveTo(h.x,h.y);
      ctx.lineTo(a.x,a.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const order=this.molecules
      .filter(m=>this.visibleMolecule(m))
      .sort((a,b)=>a.y-b.y);
    for(const molecule of order)this.drawMolecule(molecule);

    const sheen=ctx.createLinearGradient(0,0,this.width,this.height);
    sheen.addColorStop(0,'rgba(255,255,255,.22)');
    sheen.addColorStop(.28,'rgba(255,255,255,.025)');
    sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen;
    ctx.fillRect(0,0,this.width,this.height);
    ctx.restore();
  }

  drawMolecule(m){
    const ctx=this.ctx;
    const p=this.toCanvas(m.x,m.y);
    const scale=Math.max(.84,Math.min(1.28,this.radius/168));
    const bondLength=21*scale;
    const oxygenRadius=11*scale;
    const hydrogenRadius=6.3*scale;
    const half=52.25*Math.PI/180;

    const h1={
      x:p.x+Math.sin(m.angle+half)*bondLength,
      y:p.y-Math.cos(m.angle+half)*bondLength,
    };
    const h2={
      x:p.x+Math.sin(m.angle-half)*bondLength,
      y:p.y-Math.cos(m.angle-half)*bondLength,
    };

    ctx.strokeStyle='rgba(239,241,240,.88)';
    ctx.lineWidth=2.5*scale;
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
      g.addColorStop(.72,'#f1f1ef');
      g.addColorStop(1,'#ced4d5');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.arc(h.x,h.y,hydrogenRadius,0,Math.PI*2);
      ctx.fill();
    }

    const og=ctx.createRadialGradient(
      p.x-oxygenRadius*.36,p.y-oxygenRadius*.36,1,
      p.x,p.y,oxygenRadius
    );
    og.addColorStop(0,'#ff9a91');
    og.addColorStop(.42,'#e8554e');
    og.addColorStop(1,'#a62322');
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
