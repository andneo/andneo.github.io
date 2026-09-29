const TAU=Math.PI*2;
const WATER_ANGLE=104.5*Math.PI/180;
const HALF_WATER_ANGLE=WATER_ANGLE*.5;

export class RigidWaterMD {
  constructor(options={}){
    this.count=options.count??28;
    this.domainHalf=options.domainHalf??.80;
    this.dt=options.dt??1/120;
    this.mass=1;
    this.inertia=.012;
    this.oh=.072;
    this.om=.012;
    this.acceptorRadius=.064;
    this.molecules=[];
    this.bonds=new Map();
    this.stepCount=0;
    this.bondsFormed=0;
    this.bondsBroken=0;
    this.randomState=0x13579bdf;
    this.temperature=options.temperature??.026;
    this.gamma=options.gamma??2.4;
    this.gammaRot=options.gammaRot??3.2;
    this.hardCoreOO=.188;
    this.hardCoreHH=.096;
    this.hardCoreHO=.086;

    // TIP4P-style charge geometry in reduced simulation units.
    // O remains the steric/covalent centre but carries no point charge.
    // The negative charge sits on an invisible M-site along the HOH bisector.
    this.qO=0;
    this.qH=.42;
    this.qM=-.84;
    this.coulombK=.0031;
    this.coulombSoftening=.030;
    this.coulombScreening=.34;
    this.coulombCutoff=.52;
    this.maxDonorDegree=0;
    this.maxAcceptorDegree=0;
    this.maxTotalDegree=0;
    this.seed();
    this.computeForces();
  }

  random(){
    let x=this.randomState|0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    this.randomState=x|0;
    return((x>>>0)+.5)/4294967296;
  }

  gaussian(){
    const u=Math.max(1e-9,this.random());
    return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*this.random());
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
    const minSep=.195;
    for(let i=0;i<this.count;i++){
      let placed=false;
      for(let attempt=0;attempt<1000&&!placed;attempt++){
        const x=(this.random()*2-1)*this.domainHalf;
        const y=(this.random()*2-1)*this.domainHalf;
        if(this.molecules.some(o=>Math.hypot(this.minimumImage(x-o.x),this.minimumImage(y-o.y))<minSep))continue;
        this.molecules.push({
          id:i,x,y,
          vx:(this.random()-.5)*.055,
          vy:(this.random()-.5)*.055,
          angle:this.random()*TAU,
          omega:(this.random()-.5)*.55,
          fx:0,fy:0,torque:0,
        });
        placed=true;
      }
    }
  }

  hydrogenSites(m){
    return [-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((offset,index)=>{
      const angle=m.angle+offset;
      return{
        index,angle,
        rx:Math.cos(angle)*this.oh,
        ry:Math.sin(angle)*this.oh,
        x:m.x+Math.cos(angle)*this.oh,
        y:m.y+Math.sin(angle)*this.oh,
      };
    });
  }

  acceptorSites(m){
    const base=m.angle+Math.PI;
    return [-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((offset,index)=>{
      const angle=base+offset;
      return{
        index,angle,
        rx:Math.cos(angle)*this.acceptorRadius,
        ry:Math.sin(angle)*this.acceptorRadius,
        x:m.x+Math.cos(angle)*this.acceptorRadius,
        y:m.y+Math.sin(angle)*this.acceptorRadius,
      };
    });
  }

  mSite(m){
    return{
      type:'M',
      index:0,
      angle:m.angle,
      rx:Math.cos(m.angle)*this.om,
      ry:Math.sin(m.angle)*this.om,
      x:m.x+Math.cos(m.angle)*this.om,
      y:m.y+Math.sin(m.angle)*this.om,
      charge:this.qM,
    };
  }

  chargedSites(m){
    const hydrogens=this.hydrogenSites(m);
    return[
      ...hydrogens.map(h=>({...h,type:'H',charge:this.qH})),
      this.mSite(m),
    ];
  }

  resetForces(){
    for(const m of this.molecules){m.fx=0;m.fy=0;m.torque=0;}
  }

  addSiteForce(m,site,fx,fy){
    m.fx+=fx;m.fy+=fy;
    m.torque+=site.rx*fy-site.ry*fx;
  }

  addCenterForce(m,fx,fy){m.fx+=fx;m.fy+=fy;}

  wcaForce(distance,sigma,epsilon){
    const cutoff=Math.pow(2,1/6)*sigma;
    if(distance<=1e-6||distance>=cutoff)return 0;
    const sr=sigma/distance;
    const sr2=sr*sr;
    const sr6=sr2*sr2*sr2;
    return Math.min(2.4,24*epsilon*(2*sr6*sr6-sr6)/distance);
  }

  electrostaticForce(distance,q1,q2){
    if(distance>=this.coulombCutoff)return 0;
    const softened=Math.sqrt(distance*distance+this.coulombSoftening*this.coulombSoftening);
    const screening=Math.exp(-softened/this.coulombScreening);
    const taperStart=this.coulombCutoff*.78;
    let taper=1;
    if(distance>taperStart){
      const x=(distance-taperStart)/(this.coulombCutoff-taperStart);
      taper=.5*(1+Math.cos(Math.PI*x));
    }
    const derivative=-this.coulombK*q1*q2*screening*
      (1/(softened*softened)+1/(this.coulombScreening*softened));
    return Math.max(-.46,Math.min(.46,derivative*taper));
  }

  applyElectrostatics(){
    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i];
      const aSites=this.chargedSites(a);
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j];
        const bSites=this.chargedSites(b);
        for(const sa of aSites)for(const sb of bSites){
          const dx=this.minimumImage(sb.x-sa.x);
          const dy=this.minimumImage(sb.y-sa.y);
          const d=Math.hypot(dx,dy);
          if(d<=1e-7||d>=this.coulombCutoff)continue;
          const scalar=this.electrostaticForce(d,sa.charge,sb.charge);
          if(!scalar)continue;
          const ux=dx/d,uy=dy/d;
          const fx=ux*scalar,fy=uy*scalar;
          this.addSiteForce(a,sa,fx,fy);
          this.addSiteForce(b,sb,-fx,-fy);
        }
      }
    }
  }

  applyRepulsions(){
    const n=this.molecules.length;
    for(let i=0;i<n;i++){
      const a=this.molecules[i];
      const ah=this.hydrogenSites(a);
      for(let j=i+1;j<n;j++){
        const b=this.molecules[j];
        const bh=this.hydrogenSites(b);

        // Oxygen–oxygen excluded volume.
        let dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
        let d=Math.hypot(dx,dy);
        let f=this.wcaForce(d,.172,.018);
        if(f){
          const ux=dx/d,uy=dy/d;
          this.addCenterForce(a,-ux*f,-uy*f);
          this.addCenterForce(b,ux*f,uy*f);
        }

        // Hydrogen–hydrogen excluded volume.
        for(const ha of ah)for(const hb of bh){
          dx=this.minimumImage(hb.x-ha.x);dy=this.minimumImage(hb.y-ha.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.091,.017);
          if(!f)continue;
          const ux=dx/d,uy=dy/d;
          this.addSiteForce(a,ha,-ux*f,-uy*f);
          this.addSiteForce(b,hb,ux*f,uy*f);
        }

        // Short-range H–O cores in both directions.
        for(const ha of ah){
          dx=this.minimumImage(b.x-ha.x);dy=this.minimumImage(b.y-ha.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.094,.014);
          if(f){
            const ux=dx/d,uy=dy/d;
            this.addSiteForce(a,ha,-ux*f,-uy*f);
            this.addCenterForce(b,ux*f,uy*f);
          }
        }
        for(const hb of bh){
          dx=this.minimumImage(a.x-hb.x);dy=this.minimumImage(a.y-hb.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.094,.014);
          if(f){
            const ux=dx/d,uy=dy/d;
            this.addSiteForce(b,hb,-ux*f,-uy*f);
            this.addCenterForce(a,ux*f,uy*f);
          }
        }
      }
    }
  }

  candidate(donor,donorIndex,acceptor,acceptorIndex,loose=false){
    const h=this.hydrogenSites(donor)[donorIndex];
    const a=this.acceptorSites(acceptor)[acceptorIndex];
    const dx=this.minimumImage(a.x-h.x),dy=this.minimumImage(a.y-h.y);
    const r=Math.hypot(dx,dy);
    const rMax=loose ? .245 : .215;
    if(r<.075||r>rMax)return null;

    const ux=dx/r,uy=dy/r;
    const donorAlign=Math.cos(h.angle)*ux+Math.sin(h.angle)*uy;
    const acceptorAlign=-(Math.cos(a.angle)*ux+Math.sin(a.angle)*uy);
    const minDonor=loose ? .58 : .74;
    const minAccept=loose ? .38 : .58;
    if(donorAlign<minDonor||acceptorAlign<minAccept)return null;

    const target=.132;
    const width=.045;
    const radial=Math.exp(-Math.pow((r-target)/width,2));
    const score=radial*Math.pow(Math.max(0,donorAlign),4)*Math.pow(Math.max(0,acceptorAlign),3);
    if(score<(loose ? .025 : .065))return null;
    return{donor,donorIndex,acceptor,acceptorIndex,h,a,dx,dy,r,ux,uy,donorAlign,acceptorAlign,score};
  }

  bondKey(donorId,donorIndex,acceptorId,acceptorIndex){
    return`${donorId}:${donorIndex}>${acceptorId}:${acceptorIndex}`;
  }

  updateBondNetwork(){
    const next=new Map();
    const donorUsed=new Set();
    const acceptorUsed=new Set();

    // Preserve existing bonds using looser off thresholds (hysteresis).
    for(const [key,bond] of this.bonds){
      const donor=this.molecules[bond.donorId];
      const acceptor=this.molecules[bond.acceptorId];
      const c=this.candidate(donor,bond.donorIndex,acceptor,bond.acceptorIndex,true);
      if(!c){this.bondsBroken++;continue;}
      const dk=`${bond.donorId}:${bond.donorIndex}`;
      const ak=`${bond.acceptorId}:${bond.acceptorIndex}`;
      if(donorUsed.has(dk)||acceptorUsed.has(ak)){this.bondsBroken++;continue;}
      donorUsed.add(dk);acceptorUsed.add(ak);
      next.set(key,{...bond,...c,age:bond.age+this.dt});
    }

    // Fill free donor/acceptor slots with strongest new interactions.
    const candidates=[];
    for(const donor of this.molecules){
      for(let di=0;di<2;di++){
        const dk=`${donor.id}:${di}`;
        if(donorUsed.has(dk))continue;
        for(const acceptor of this.molecules){
          if(acceptor===donor)continue;
          for(let ai=0;ai<2;ai++){
            const ak=`${acceptor.id}:${ai}`;
            if(acceptorUsed.has(ak))continue;
            const c=this.candidate(donor,di,acceptor,ai,false);
            if(c)candidates.push(c);
          }
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);

    for(const c of candidates){
      const dk=`${c.donor.id}:${c.donorIndex}`;
      const ak=`${c.acceptor.id}:${c.acceptorIndex}`;
      if(donorUsed.has(dk)||acceptorUsed.has(ak))continue;
      const key=this.bondKey(c.donor.id,c.donorIndex,c.acceptor.id,c.acceptorIndex);
      donorUsed.add(dk);acceptorUsed.add(ak);
      next.set(key,{
        key,
        donorId:c.donor.id,donorIndex:c.donorIndex,
        acceptorId:c.acceptor.id,acceptorIndex:c.acceptorIndex,
        ...c,age:0,
      });
      this.bondsFormed++;
    }

    this.bonds=next;
    this.updateDegrees();
  }

  updateDegrees(){
    const donor=new Array(this.count).fill(0);
    const acceptor=new Array(this.count).fill(0);
    for(const b of this.bonds.values()){
      donor[b.donorId]++;
      acceptor[b.acceptorId]++;
    }
    this.maxDonorDegree=Math.max(0,...donor);
    this.maxAcceptorDegree=Math.max(0,...acceptor);
    this.maxTotalDegree=Math.max(0,...donor.map((v,i)=>v+acceptor[i]));
  }

  applyHydrogenBonds(){
    const epsilon=.0065;
    const target=.132;
    const width=.042;
    const angularTorque=.0016;

    for(const bond of this.bonds.values()){
      const c=this.candidate(
        this.molecules[bond.donorId],bond.donorIndex,
        this.molecules[bond.acceptorId],bond.acceptorIndex,true
      );
      if(!c)continue;

      // Gaussian attractive well. Positive here pulls donor H toward acceptor site.
      const delta=(c.r-target)/width;
      const angular=c.donorAlign*c.donorAlign*c.acceptorAlign*c.acceptorAlign;
      const magnitude=2*epsilon*delta/width*Math.exp(-delta*delta)*angular;
      const fx=c.ux*magnitude,fy=c.uy*magnitude;
      this.addSiteForce(c.donor,c.h,fx,fy);
      this.addSiteForce(c.acceptor,c.a,-fx,-fy);

      // Weak orientational torques encourage O-H···A alignment without hard locking.
      const donorTarget=Math.atan2(c.uy,c.ux);
      const acceptTarget=Math.atan2(-c.uy,-c.ux);
      c.donor.torque+=this.angleDifference(donorTarget,c.h.angle)*angularTorque*c.score;
      c.acceptor.torque+=this.angleDifference(acceptTarget,c.a.angle)*angularTorque*c.score;
    }
  }

  angleDifference(target,current){
    let d=target-current;
    while(d>Math.PI)d-=TAU;
    while(d<-Math.PI)d+=TAU;
    return d;
  }

  computeForces(){
    this.resetForces();
    this.applyRepulsions();
    this.applyElectrostatics();
    this.updateBondNetwork();
    this.applyHydrogenBonds();
  }

  integrate(){
    const dt=this.dt;
    const half=.5*dt;

    // B: half kick.
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
      m.omega+=half*m.torque/this.inertia;
    }

    // A: half drift.
    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);
      m.y=this.wrap(m.y+half*m.vy);
      m.angle+=half*m.omega;
    }

    // O: exact Ornstein-Uhlenbeck thermostat.
    const cv=Math.exp(-this.gamma*dt);
    const cw=Math.exp(-this.gammaRot*dt);
    const sv=Math.sqrt(this.temperature*(1-cv*cv)/this.mass);
    const sw=Math.sqrt(this.temperature*(1-cw*cw)/this.inertia);
    for(const m of this.molecules){
      m.vx=cv*m.vx+sv*this.gaussian();
      m.vy=cv*m.vy+sv*this.gaussian();
      m.omega=cw*m.omega+sw*this.gaussian();
    }

    // A: second half drift.
    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);
      m.y=this.wrap(m.y+half*m.vy);
      m.angle+=half*m.omega;
    }

    this.resolveHardCoreConstraints();
    this.computeForces();

    // B: second half kick.
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
      m.omega+=half*m.torque/this.inertia;
    }

    this.stepCount++;
  }

  resolveHardCoreConstraints(){
    // Force-based repulsion alone can penetrate at finite dt. A small
    // position-level projection guarantees non-overlap while retaining
    // the smooth Langevin dynamics between contacts.
    for(let pass=0;pass<5;pass++){
      for(let i=0;i<this.molecules.length;i++){
        const a=this.molecules[i];
        for(let j=i+1;j<this.molecules.length;j++){
          const b=this.molecules[j];

          let dx=this.minimumImage(b.x-a.x);
          let dy=this.minimumImage(b.y-a.y);
          let d=Math.hypot(dx,dy)||1e-8;
          if(d<this.hardCoreOO){
            const nx=dx/d,ny=dy/d;
            const correction=(this.hardCoreOO-d)*.5+.0002;
            a.x=this.wrap(a.x-nx*correction);
            a.y=this.wrap(a.y-ny*correction);
            b.x=this.wrap(b.x+nx*correction);
            b.y=this.wrap(b.y+ny*correction);

            const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
            if(relative<0){
              const impulse=-relative*.55;
              a.vx-=nx*impulse;a.vy-=ny*impulse;
              b.vx+=nx*impulse;b.vy+=ny*impulse;
            }
          }

          const ah=this.hydrogenSites(a);
          const bh=this.hydrogenSites(b);

          for(const ha of ah)for(const hb of bh){
            dx=this.minimumImage(hb.x-ha.x);
            dy=this.minimumImage(hb.y-ha.y);
            d=Math.hypot(dx,dy)||1e-8;
            if(d>=this.hardCoreHH)continue;
            const nx=dx/d,ny=dy/d;
            const correction=(this.hardCoreHH-d)*.46+.0001;
            a.x=this.wrap(a.x-nx*correction);
            a.y=this.wrap(a.y-ny*correction);
            b.x=this.wrap(b.x+nx*correction);
            b.y=this.wrap(b.y+ny*correction);
          }

          for(const ha of ah){
            dx=this.minimumImage(b.x-ha.x);
            dy=this.minimumImage(b.y-ha.y);
            d=Math.hypot(dx,dy)||1e-8;
            if(d<this.hardCoreHO){
              const nx=dx/d,ny=dy/d;
              const correction=(this.hardCoreHO-d)*.34+.0001;
              a.x=this.wrap(a.x-nx*correction);
              a.y=this.wrap(a.y-ny*correction);
              b.x=this.wrap(b.x+nx*correction);
              b.y=this.wrap(b.y+ny*correction);
            }
          }
          for(const hb of bh){
            dx=this.minimumImage(a.x-hb.x);
            dy=this.minimumImage(a.y-hb.y);
            d=Math.hypot(dx,dy)||1e-8;
            if(d<this.hardCoreHO){
              const nx=dx/d,ny=dy/d;
              const correction=(this.hardCoreHO-d)*.34+.0001;
              b.x=this.wrap(b.x-nx*correction);
              b.y=this.wrap(b.y-ny*correction);
              a.x=this.wrap(a.x+nx*correction);
              a.y=this.wrap(a.y+ny*correction);
            }
          }
        }
      }
    }
  }

  minimumSeparations(){
    let oo=Infinity,hh=Infinity,ho=Infinity;
    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i];
      const ah=this.hydrogenSites(a);
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j];
        const bh=this.hydrogenSites(b);
        oo=Math.min(oo,Math.hypot(this.minimumImage(b.x-a.x),this.minimumImage(b.y-a.y)));
        for(const ha of ah)for(const hb of bh){
          hh=Math.min(hh,Math.hypot(this.minimumImage(hb.x-ha.x),this.minimumImage(hb.y-ha.y)));
        }
        for(const ha of ah){
          ho=Math.min(ho,Math.hypot(this.minimumImage(b.x-ha.x),this.minimumImage(b.y-ha.y)));
        }
        for(const hb of bh){
          ho=Math.min(ho,Math.hypot(this.minimumImage(a.x-hb.x),this.minimumImage(a.y-hb.y)));
        }
      }
    }
    return{oo,hh,ho};
  }

  diagnostics(){
    let speed=0,angular=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angular+=Math.abs(m.omega);
    }
    const separation=this.minimumSeparations();
    return{
      steps:this.stepCount,
      bonds:this.bonds.size,
      formed:this.bondsFormed,
      broken:this.bondsBroken,
      meanSpeed:speed/this.count,
      meanAngularSpeed:angular/this.count,
      maxDonorDegree:this.maxDonorDegree,
      maxAcceptorDegree:this.maxAcceptorDegree,
      maxTotalDegree:this.maxTotalDegree,
      minOO:separation.oo,
      minHH:separation.hh,
      minHO:separation.ho,
      qO:this.qO,
      qH:this.qH,
      qM:this.qM,
      oM:this.om,
      electrostaticCutoff:this.coulombCutoff,
      electrostaticK:this.coulombK,
      netCharge:this.qO+2*this.qH+this.qM,
    };
  }
}
