const WATER_ANGLE=104.5*Math.PI/180;
const HALF_WATER_ANGLE=WATER_ANGLE*.5;

function quatNormalize(q){
  const n=Math.hypot(q.w,q.x,q.y,q.z)||1;
  q.w/=n;q.x/=n;q.y/=n;q.z/=n;
}

function quatMul(a,b){
  return{
    w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
    x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
    y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
    z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
  };
}

function rotateVec(q,v){
  // q * (0,v) * q^-1, expanded.
  const tx=2*(q.y*v.z-q.z*v.y);
  const ty=2*(q.z*v.x-q.x*v.z);
  const tz=2*(q.x*v.y-q.y*v.x);
  return{
    x:v.x+q.w*tx+(q.y*tz-q.z*ty),
    y:v.y+q.w*ty+(q.z*tx-q.x*tz),
    z:v.z+q.w*tz+(q.x*ty-q.y*tx),
  };
}

function cross(a,b){
  return{
    x:a.y*b.z-a.z*b.y,
    y:a.z*b.x-a.x*b.z,
    z:a.x*b.y-a.y*b.x,
  };
}

export class RigidWaterMD {
  constructor(options={}){
    this.count=options.count??28;
    this.domainHalf=options.domainHalf??.80;
    this.dt=options.dt??1/180;
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

    // TIP4P-style charge geometry in reduced units.
    // O is the mass/steric centre. H atoms are positive and an invisible
    // M-site on the HOH bisector carries the negative charge.
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
    return Math.sqrt(-2*Math.log(u))*Math.cos(Math.PI*2*this.random());
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

        const yaw=this.random()*Math.PI*2;
        const tilt=(this.random()-.5)*.32;
        const halfYaw=yaw*.5,halfTilt=tilt*.5;
        const qYaw={w:Math.cos(halfYaw),x:0,y:0,z:Math.sin(halfYaw)};
        const qTilt={w:Math.cos(halfTilt),x:Math.sin(halfTilt),y:0,z:0};
        const q=quatMul(qTilt,qYaw);
        quatNormalize(q);

        this.molecules.push({
          id:i,x,y,z:0,
          vx:(this.random()-.5)*.055,
          vy:(this.random()-.5)*.055,
          q,
          wx:(this.random()-.5)*.34,
          wy:(this.random()-.5)*.34,
          wz:(this.random()-.5)*.55,
          fx:0,fy:0,
          tx:0,ty:0,tz:0,
        });
        placed=true;
      }
    }
  }

  localToSite(m,local,index=0){
    const r=rotateVec(m.q,local);
    return{
      index,
      rx:r.x,ry:r.y,rz:r.z,
      x:m.x+r.x,y:m.y+r.y,z:r.z,
    };
  }

  hydrogenSites(m){
    return[-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((a,index)=>
      this.localToSite(m,{
        x:Math.cos(a)*this.oh,
        y:Math.sin(a)*this.oh,
        z:0,
      },index)
    );
  }

  acceptorSites(m){
    // Two virtual acceptor directions on the side opposite the hydrogens.
    return[-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((a,index)=>
      this.localToSite(m,{
        x:-Math.cos(a)*this.acceptorRadius,
        y:Math.sin(a)*this.acceptorRadius,
        z:0,
      },index)
    );
  }

  mSite(m){
    const s=this.localToSite(m,{x:this.om,y:0,z:0},0);
    return{...s,type:'M',charge:this.qM};
  }

  chargedSites(m){
    return[
      ...this.hydrogenSites(m).map(h=>({...h,type:'H',charge:this.qH})),
      this.mSite(m),
    ];
  }

  resetForces(){
    for(const m of this.molecules){
      m.fx=0;m.fy=0;
      m.tx=0;m.ty=0;m.tz=0;
    }
  }

  addSiteForce(m,site,fx,fy,fz){
    // Molecular centres are confined to z=0; out-of-plane force contributes
    // torque only. The site itself remains rigidly attached to the molecule.
    m.fx+=fx;m.fy+=fy;
    const t=cross(
      {x:site.rx,y:site.ry,z:site.rz},
      {x:fx,y:fy,z:fz}
    );
    m.tx+=t.x;m.ty+=t.y;m.tz+=t.z;
  }

  addCenterForce(m,fx,fy){m.fx+=fx;m.fy+=fy;}

  wcaForce(distance,sigma,epsilon){
    const cutoff=Math.pow(2,1/6)*sigma;
    if(distance<=1e-7||distance>=cutoff)return 0;
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

  siteDelta(a,b){
    return{
      x:this.minimumImage(b.x-a.x),
      y:this.minimumImage(b.y-a.y),
      z:b.z-a.z,
    };
  }

  applyElectrostatics(){
    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i],aSites=this.chargedSites(a);
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j],bSites=this.chargedSites(b);
        for(const sa of aSites)for(const sb of bSites){
          const d3=this.siteDelta(sa,sb);
          const d=Math.hypot(d3.x,d3.y,d3.z);
          if(d<=1e-7||d>=this.coulombCutoff)continue;
          const scalar=this.electrostaticForce(d,sa.charge,sb.charge);
          if(!scalar)continue;
          const fx=d3.x/d*scalar,fy=d3.y/d*scalar,fz=d3.z/d*scalar;
          this.addSiteForce(a,sa,fx,fy,fz);
          this.addSiteForce(b,sb,-fx,-fy,-fz);
        }
      }
    }
  }

  applyRepulsions(){
    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i],ah=this.hydrogenSites(a);
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j],bh=this.hydrogenSites(b);

        let dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
        let d=Math.hypot(dx,dy);
        let f=this.wcaForce(d,.172,.018);
        if(f){
          const ux=dx/d,uy=dy/d;
          this.addCenterForce(a,-ux*f,-uy*f);
          this.addCenterForce(b,ux*f,uy*f);
        }

        for(const ha of ah)for(const hb of bh){
          const dv=this.siteDelta(ha,hb);
          d=Math.hypot(dv.x,dv.y,dv.z);
          f=this.wcaForce(d,.091,.017);
          if(!f)continue;
          const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
          this.addSiteForce(a,ha,-fx,-fy,-fz);
          this.addSiteForce(b,hb,fx,fy,fz);
        }

        for(const ha of ah){
          const dv={x:this.minimumImage(b.x-ha.x),y:this.minimumImage(b.y-ha.y),z:-ha.z};
          d=Math.hypot(dv.x,dv.y,dv.z);
          f=this.wcaForce(d,.094,.014);
          if(f){
            const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
            this.addSiteForce(a,ha,-fx,-fy,-fz);
            this.addCenterForce(b,fx,fy);
          }
        }
        for(const hb of bh){
          const dv={x:this.minimumImage(a.x-hb.x),y:this.minimumImage(a.y-hb.y),z:-hb.z};
          d=Math.hypot(dv.x,dv.y,dv.z);
          f=this.wcaForce(d,.094,.014);
          if(f){
            const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
            this.addSiteForce(b,hb,-fx,-fy,-fz);
            this.addCenterForce(a,fx,fy);
          }
        }
      }
    }
  }

  candidate(donor,donorIndex,acceptor,acceptorIndex,loose=false){
    const h=this.hydrogenSites(donor)[donorIndex];
    const a=this.acceptorSites(acceptor)[acceptorIndex];
    const dv=this.siteDelta(h,a);
    const r=Math.hypot(dv.x,dv.y,dv.z);
    const rMax=loose ? .245 : .215;
    if(r<.075||r>rMax)return null;

    const ux=dv.x/r,uy=dv.y/r,uz=dv.z/r;
    const donorOH={x:h.rx/this.oh,y:h.ry/this.oh,z:h.rz/this.oh};
    const acceptorDir={
      x:a.rx/this.acceptorRadius,
      y:a.ry/this.acceptorRadius,
      z:a.rz/this.acceptorRadius,
    };
    const donorAlign=donorOH.x*ux+donorOH.y*uy+donorOH.z*uz;
    const acceptorAlign=-(acceptorDir.x*ux+acceptorDir.y*uy+acceptorDir.z*uz);
    if(donorAlign<(loose ? .58 : .74)||acceptorAlign<(loose ? .38 : .58))return null;

    const target=.132,width=.045;
    const radial=Math.exp(-Math.pow((r-target)/width,2));
    const score=radial*Math.pow(Math.max(0,donorAlign),4)*Math.pow(Math.max(0,acceptorAlign),3);
    if(score<(loose ? .025 : .065))return null;
    return{donor,donorIndex,acceptor,acceptorIndex,h,a,dx:dv.x,dy:dv.y,dz:dv.z,r,ux,uy,uz,donorAlign,acceptorAlign,score};
  }

  bondKey(donorId,donorIndex,acceptorId,acceptorIndex){
    return`${donorId}:${donorIndex}>${acceptorId}:${acceptorIndex}`;
  }

  updateBondNetwork(){
    const next=new Map(),donorUsed=new Set(),acceptorUsed=new Set();

    for(const [key,bond] of this.bonds){
      const c=this.candidate(
        this.molecules[bond.donorId],bond.donorIndex,
        this.molecules[bond.acceptorId],bond.acceptorIndex,true
      );
      if(!c){this.bondsBroken++;continue;}
      const dk=`${bond.donorId}:${bond.donorIndex}`;
      const ak=`${bond.acceptorId}:${bond.acceptorIndex}`;
      if(donorUsed.has(dk)||acceptorUsed.has(ak)){this.bondsBroken++;continue;}
      donorUsed.add(dk);acceptorUsed.add(ak);
      next.set(key,{...bond,...c,age:bond.age+this.dt});
    }

    const candidates=[];
    for(const donor of this.molecules)for(let di=0;di<2;di++){
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
    candidates.sort((a,b)=>b.score-a.score);

    for(const c of candidates){
      const dk=`${c.donor.id}:${c.donorIndex}`;
      const ak=`${c.acceptor.id}:${c.acceptorIndex}`;
      if(donorUsed.has(dk)||acceptorUsed.has(ak))continue;
      const key=this.bondKey(c.donor.id,c.donorIndex,c.acceptor.id,c.acceptorIndex);
      donorUsed.add(dk);acceptorUsed.add(ak);
      next.set(key,{
        key,donorId:c.donor.id,donorIndex:c.donorIndex,
        acceptorId:c.acceptor.id,acceptorIndex:c.acceptorIndex,
        ...c,age:0,
      });
      this.bondsFormed++;
    }

    this.bonds=next;
    this.updateDegrees();
  }

  updateDegrees(){
    const donor=new Array(this.count).fill(0),acceptor=new Array(this.count).fill(0);
    for(const b of this.bonds.values()){
      donor[b.donorId]++;acceptor[b.acceptorId]++;
    }
    this.maxDonorDegree=Math.max(0,...donor);
    this.maxAcceptorDegree=Math.max(0,...acceptor);
    this.maxTotalDegree=Math.max(0,...donor.map((v,i)=>v+acceptor[i]));
  }

  applyHydrogenBonds(){
    const epsilon=.0065,target=.132,width=.042;
    for(const bond of this.bonds.values()){
      const c=this.candidate(
        this.molecules[bond.donorId],bond.donorIndex,
        this.molecules[bond.acceptorId],bond.acceptorIndex,true
      );
      if(!c)continue;
      const delta=(c.r-target)/width;
      const angular=c.donorAlign*c.donorAlign*c.acceptorAlign*c.acceptorAlign;
      const magnitude=2*epsilon*delta/width*Math.exp(-delta*delta)*angular;
      const fx=c.ux*magnitude,fy=c.uy*magnitude,fz=c.uz*magnitude;
      this.addSiteForce(c.donor,c.h,fx,fy,fz);
      this.addSiteForce(c.acceptor,c.a,-fx,-fy,-fz);
    }
  }

  computeForces(){
    this.resetForces();
    this.applyRepulsions();
    this.applyElectrostatics();
    this.updateBondNetwork();
    this.applyHydrogenBonds();
  }

  rotateOrientation(m,dt){
    const omega={w:0,x:m.wx,y:m.wy,z:m.wz};
    const dq=quatMul(omega,m.q);
    m.q.w+=.5*dq.w*dt;
    m.q.x+=.5*dq.x*dt;
    m.q.y+=.5*dq.y*dt;
    m.q.z+=.5*dq.z*dt;
    quatNormalize(m.q);
  }

  integrate(){
    const dt=this.dt,half=.5*dt;

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;
      m.wy+=half*m.ty/this.inertia;
      m.wz+=half*m.tz/this.inertia;
    }

    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);
      m.y=this.wrap(m.y+half*m.vy);
      this.rotateOrientation(m,half);
    }

    const cv=Math.exp(-this.gamma*dt),cw=Math.exp(-this.gammaRot*dt);
    const sv=Math.sqrt(this.temperature*(1-cv*cv)/this.mass);
    const sw=Math.sqrt(this.temperature*(1-cw*cw)/this.inertia);
    for(const m of this.molecules){
      m.vx=cv*m.vx+sv*this.gaussian();
      m.vy=cv*m.vy+sv*this.gaussian();
      m.wx=cw*m.wx+sw*this.gaussian();
      m.wy=cw*m.wy+sw*this.gaussian();
      m.wz=cw*m.wz+sw*this.gaussian();
    }

    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);
      m.y=this.wrap(m.y+half*m.vy);
      this.rotateOrientation(m,half);
    }

    this.resolveHardCoreConstraints();
    this.computeForces();

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;
      m.wy+=half*m.ty/this.inertia;
      m.wz+=half*m.tz/this.inertia;
    }
    this.stepCount++;
  }

  resolveHardCoreConstraints(){
    // Centre positions remain planar. These projections prevent translational
    // overlap; site-level 3D WCA forces provide the out-of-plane escape route.
    for(let pass=0;pass<4;pass++){
      for(let i=0;i<this.molecules.length;i++)for(let j=i+1;j<this.molecules.length;j++){
        const a=this.molecules[i],b=this.molecules[j];
        let dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
        let d=Math.hypot(dx,dy)||1e-8;
        if(d<this.hardCoreOO){
          const nx=dx/d,ny=dy/d,correction=(this.hardCoreOO-d)*.5+.0002;
          a.x=this.wrap(a.x-nx*correction);a.y=this.wrap(a.y-ny*correction);
          b.x=this.wrap(b.x+nx*correction);b.y=this.wrap(b.y+ny*correction);
          const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
          if(relative<0){
            const impulse=-relative*.55;
            a.vx-=nx*impulse;a.vy-=ny*impulse;
            b.vx+=nx*impulse;b.vy+=ny*impulse;
          }
        }
      }
    }
  }

  minimumSeparations(){
    let oo=Infinity,hh=Infinity,ho=Infinity;
    for(let i=0;i<this.molecules.length;i++){
      const a=this.molecules[i],ah=this.hydrogenSites(a);
      for(let j=i+1;j<this.molecules.length;j++){
        const b=this.molecules[j],bh=this.hydrogenSites(b);
        oo=Math.min(oo,Math.hypot(this.minimumImage(b.x-a.x),this.minimumImage(b.y-a.y)));
        for(const ha of ah)for(const hb of bh){
          const d=this.siteDelta(ha,hb);
          hh=Math.min(hh,Math.hypot(d.x,d.y,d.z));
        }
        for(const ha of ah){
          ho=Math.min(ho,Math.hypot(this.minimumImage(b.x-ha.x),this.minimumImage(b.y-ha.y),ha.z));
        }
        for(const hb of bh){
          ho=Math.min(ho,Math.hypot(this.minimumImage(a.x-hb.x),this.minimumImage(a.y-hb.y),hb.z));
        }
      }
    }
    return{oo,hh,ho};
  }

  diagnostics(){
    let speed=0,angular=0,tilt=0,maxCenterZ=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angular+=Math.hypot(m.wx,m.wy,m.wz);
      const hs=this.hydrogenSites(m);
      tilt+=(Math.abs(hs[0].z)+Math.abs(hs[1].z))/(2*this.oh);
      maxCenterZ=Math.max(maxCenterZ,Math.abs(m.z||0));
    }
    const separation=this.minimumSeparations();
    return{
      steps:this.stepCount,bonds:this.bonds.size,
      formed:this.bondsFormed,broken:this.bondsBroken,
      meanSpeed:speed/this.count,
      meanAngularSpeed:angular/this.count,
      meanOutOfPlane:tilt/this.count,
      maxCenterZ,
      maxDonorDegree:this.maxDonorDegree,
      maxAcceptorDegree:this.maxAcceptorDegree,
      maxTotalDegree:this.maxTotalDegree,
      minOO:separation.oo,minHH:separation.hh,minHO:separation.ho,
      qO:this.qO,qH:this.qH,qM:this.qM,oM:this.om,
      electrostaticCutoff:this.coulombCutoff,
      electrostaticK:this.coulombK,
      netCharge:this.qO+2*this.qH+this.qM,
    };
  }
}
