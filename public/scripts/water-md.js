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
    this.acceptorRadius=.064;
    this.molecules=[];
    this.bonds=new Map();
    this.stepCount=0;
    this.bondsFormed=0;
    this.bondsBroken=0;
    this.randomState=0x13579bdf;
    this.temperature=options.temperature??.18;
    this.gamma=options.gamma??1.35;
    this.gammaRot=options.gammaRot??1.8;
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
          vx:(this.random()-.5)*.16,
          vy:(this.random()-.5)*.16,
          angle:this.random()*TAU,
          omega:(this.random()-.5)*2.0,
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
        let f=this.wcaForce(d,.165,.010);
        if(f){
          const ux=dx/d,uy=dy/d;
          this.addCenterForce(a,-ux*f,-uy*f);
          this.addCenterForce(b,ux*f,uy*f);
        }

        // Hydrogen–hydrogen excluded volume.
        for(const ha of ah)for(const hb of bh){
          dx=this.minimumImage(hb.x-ha.x);dy=this.minimumImage(hb.y-ha.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.075,.0045);
          if(!f)continue;
          const ux=dx/d,uy=dy/d;
          this.addSiteForce(a,ha,-ux*f,-uy*f);
          this.addSiteForce(b,hb,ux*f,uy*f);
        }

        // Short-range H–O cores in both directions.
        for(const ha of ah){
          dx=this.minimumImage(b.x-ha.x);dy=this.minimumImage(b.y-ha.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.082,.006);
          if(f){
            const ux=dx/d,uy=dy/d;
            this.addSiteForce(a,ha,-ux*f,-uy*f);
            this.addCenterForce(b,ux*f,uy*f);
          }
        }
        for(const hb of bh){
          dx=this.minimumImage(a.x-hb.x);dy=this.minimumImage(a.y-hb.y);d=Math.hypot(dx,dy);
          f=this.wcaForce(d,.082,.006);
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
    const epsilon=.040;
    const target=.132;
    const width=.042;
    const angularTorque=.012;

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

    this.computeForces();

    // B: second half kick.
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
      m.omega+=half*m.torque/this.inertia;
    }

    this.stepCount++;
  }

  diagnostics(){
    let speed=0,angular=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angular+=Math.abs(m.omega);
    }
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
    };
  }
}
