const WATER_ANGLE=104.5*Math.PI/180;
const HALF_WATER_ANGLE=WATER_ANGLE*.5;

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
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
  return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
}

export class MonolayerWaterMD{
  constructor(options={}){
    this.count=options.count??250;
    this.dt=options.dt??1/180;
    this.mass=1;
    this.inertia=.012;
    this.oh=.072;
    this.om=.012;
    this.acceptorRadius=.064;
    this.hardCoreOO=.188;

    // Keep the same reduced TIP4P-style ingredients as scene 01, but use a
    // stronger directional H-bond well so temperature changes alter network
    // stability on browser-accessible timescales.
    this.qH=.42;
    this.qM=-.84;
    this.coulombK=.0031;
    this.coulombSoftening=.030;
    this.coulombScreening=.34;
    this.coulombCutoff=.52;
    this.hBondEpsilon=.018;

    this.interactionCutoff=.68;
    this.skin=.08;
    this.listCutoff=this.interactionCutoff+this.skin;

    this.temperatureKelvin=options.temperatureKelvin??240;
    this.pressureGPa=options.pressureGPa??1.0;
    this.temperature=0;
    this.gamma=1.8;
    this.gammaRot=2.3;
    this.setTemperatureKelvin(this.temperatureKelvin);

    this.domainHalf=2.46;
    this.minDomainHalf=1.86;
    this.maxDomainHalf=2.70;
    this.referenceHalf=this.domainHalf;

    this.molecules=[];
    this.bonds=new Map();
    this.neighborPairs=[];
    this.refX=new Float64Array(this.count);
    this.refY=new Float64Array(this.count);
    this.randomState=0x6d2b79f5;
    this.stepCount=0;
    this.neighborRebuilds=0;
    this.neighborAge=0;
    this.neighborDirty=true;
    this.bondsFormed=0;
    this.bondsBroken=0;
    this.maxDonorDegree=0;
    this.maxAcceptorDegree=0;
    this.maxTotalDegree=0;

    // Virial-feedback barostat. The user-facing GPa scale is a qualitative
    // calibration around the starting state; the dynamics respond to measured
    // kinetic + configurational lateral pressure rather than a prescribed box.
    this.virial=0;
    this.reducedPressure=0;
    this.pressureEMA=0;
    this.referenceReducedPressure=0;
    this.pressureSlope=.085;
    this.barostatRate=.22;

    this.seed();
    this.rebuildNeighborList();
    this.computeForces(true);
    this.reducedPressure=this.instantaneousPressure();
    this.pressureEMA=this.reducedPressure;
    this.referenceReducedPressure=this.reducedPressure;
  }

  reducedTemperature(kelvin){
    const x=clamp((kelvin-120)/380,0,1);
    return .0075+x*.0445;
  }
  setTemperatureKelvin(value){
    this.temperatureKelvin=clamp(Number(value)||240,120,500);
    const x=clamp((this.temperatureKelvin-120)/380,0,1);
    this.temperature=this.reducedTemperature(this.temperatureKelvin);
    // Friction changes only relaxation time, not the target equilibrium.
    // Lower friction when cold lets directional H-bond torques anneal instead
    // of simply freezing the initial geometry.
    this.gamma=1.35+x*1.15;
    this.gammaRot=1.45+x*1.75;
  }
  setPressureGPa(value){
    this.pressureGPa=clamp(Number(value)||0,0,6);
  }
  targetReducedPressure(){
    return this.referenceReducedPressure+(this.pressureGPa-1)*this.pressureSlope;
  }
  measuredPressureGPa(){
    return 1+(this.pressureEMA-this.referenceReducedPressure)/this.pressureSlope;
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
    while(v>=this.domainHalf)v-=span;
    while(v< -this.domainHalf)v+=span;
    return v;
  }
  minimumImage(d){
    const span=this.domainHalf*2;
    if(d>this.domainHalf)d-=span;
    if(d< -this.domainHalf)d+=span;
    return d;
  }

  seed(){
    // Random sequential placement avoids imprinting a square lattice on the
    // network before the interactive experiment begins.
    const minSep=.205;
    for(let id=0;id<this.count;id++){
      let placed=false;
      for(let attempt=0;attempt<1400&&!placed;attempt++){
        const x=(this.random()*2-1)*this.domainHalf;
        const y=(this.random()*2-1)*this.domainHalf;
        let clear=true;
        for(const other of this.molecules){
          if(Math.hypot(this.minimumImage(x-other.x),this.minimumImage(y-other.y))<minSep){clear=false;break;}
        }
        if(!clear)continue;

        const yaw=this.random()*Math.PI*2;
        const tilt=(this.random()-.5)*.34;
        const halfYaw=yaw*.5,halfTilt=tilt*.5;
        const qYaw={w:Math.cos(halfYaw),x:0,y:0,z:Math.sin(halfYaw)};
        const qTilt={w:Math.cos(halfTilt),x:Math.sin(halfTilt),y:0,z:0};
        const q=quatMul(qTilt,qYaw);
        quatNormalize(q);
        this.molecules.push({
          id,x,y,z:0,
          vx:this.gaussian()*.045,vy:this.gaussian()*.045,
          q,wx:this.gaussian()*.22,wy:this.gaussian()*.22,wz:this.gaussian()*.32,
          fx:0,fy:0,tx:0,ty:0,tz:0,
        });
        placed=true;
      }
      if(!placed)throw new Error('Could not seed monolayer without overlap');
    }
  }

  localToSite(m,local,index=0){
    const r=rotateVec(m.q,local);
    return{index,rx:r.x,ry:r.y,rz:r.z,x:m.x+r.x,y:m.y+r.y,z:r.z};
  }
  hydrogenSites(m){
    return[-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((a,index)=>
      this.localToSite(m,{x:Math.cos(a)*this.oh,y:Math.sin(a)*this.oh,z:0},index)
    );
  }
  acceptorSites(m){
    return[-HALF_WATER_ANGLE,HALF_WATER_ANGLE].map((a,index)=>
      this.localToSite(m,{x:-Math.cos(a)*this.acceptorRadius,y:Math.sin(a)*this.acceptorRadius,z:0},index)
    );
  }
  mSite(m){
    const s=this.localToSite(m,{x:this.om,y:0,z:0},0);
    return{...s,type:'M',charge:this.qM};
  }
  siteDelta(a,b){
    return{x:this.minimumImage(b.x-a.x),y:this.minimumImage(b.y-a.y),z:b.z-a.z};
  }

  needsNeighborRebuild(){
    if(this.neighborDirty||this.neighborAge>=30)return true;
    const threshold=this.skin*.5;
    for(let i=0;i<this.count;i++){
      const m=this.molecules[i];
      const dx=this.minimumImage(m.x-this.refX[i]);
      const dy=this.minimumImage(m.y-this.refY[i]);
      if(dx*dx+dy*dy>threshold*threshold)return true;
    }
    return false;
  }

  rebuildNeighborList(){
    const span=this.domainHalf*2;
    const cellsPerAxis=Math.max(3,Math.floor(span/this.listCutoff));
    const cellCount=cellsPerAxis*cellsPerAxis;
    const head=new Int32Array(cellCount);head.fill(-1);
    const next=new Int32Array(this.count);next.fill(-1);
    const cellOf=new Int32Array(this.count);
    const toCell=v=>{
      let c=Math.floor((v+this.domainHalf)/span*cellsPerAxis);
      if(c<0)c=0;if(c>=cellsPerAxis)c=cellsPerAxis-1;
      return c;
    };
    for(let i=0;i<this.count;i++){
      const m=this.molecules[i];
      const cx=toCell(m.x),cy=toCell(m.y),cell=cy*cellsPerAxis+cx;
      cellOf[i]=cell;next[i]=head[cell];head[cell]=i;
      this.refX[i]=m.x;this.refY[i]=m.y;
    }
    const pairs=[];
    const cutoff2=this.listCutoff*this.listCutoff;
    for(let i=0;i<this.count;i++){
      const cell=cellOf[i];
      const cx=cell%cellsPerAxis,cy=Math.floor(cell/cellsPerAxis);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const nx=(cx+ox+cellsPerAxis)%cellsPerAxis;
        const ny=(cy+oy+cellsPerAxis)%cellsPerAxis;
        let j=head[ny*cellsPerAxis+nx];
        while(j!==-1){
          if(j>i){
            const a=this.molecules[i],b=this.molecules[j];
            const dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
            if(dx*dx+dy*dy<cutoff2)pairs.push([i,j]);
          }
          j=next[j];
        }
      }
    }
    this.neighborPairs=pairs;
    this.cellsPerAxis=cellsPerAxis;
    this.neighborRebuilds++;
    this.neighborAge=0;
    this.neighborDirty=false;
  }

  resetForces(){
    for(const m of this.molecules){m.fx=0;m.fy=0;m.tx=0;m.ty=0;m.tz=0;}
  }
  addSiteForce(m,site,fx,fy,fz){
    m.fx+=fx;m.fy+=fy;
    const t=cross({x:site.rx,y:site.ry,z:site.rz},{x:fx,y:fy,z:fz});
    m.tx+=t.x;m.ty+=t.y;m.tz+=t.z;
  }
  addCenterForce(m,fx,fy){m.fx+=fx;m.fy+=fy;}
  wcaForce(distance,sigma,epsilon){
    const cutoff=Math.pow(2,1/6)*sigma;
    if(distance<=1e-7||distance>=cutoff)return 0;
    const sr=sigma/distance,sr2=sr*sr,sr6=sr2*sr2*sr2;
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
    return clamp(derivative*taper,-.46,.46);
  }

  applyPairForces(a,b){
    const beforeFx=a.fx,beforeFy=a.fy;
    const ah=this.hydrogenSites(a),bh=this.hydrogenSites(b);
    const pairDx=this.minimumImage(b.x-a.x),pairDy=this.minimumImage(b.y-a.y);
    let d=Math.hypot(pairDx,pairDy);
    let f=this.wcaForce(d,.172,.018);
    if(f){
      const ux=pairDx/d,uy=pairDy/d;
      this.addCenterForce(a,-ux*f,-uy*f);
      this.addCenterForce(b,ux*f,uy*f);
    }
    for(const ha of ah)for(const hb of bh){
      const dv=this.siteDelta(ha,hb);d=Math.hypot(dv.x,dv.y,dv.z);f=this.wcaForce(d,.091,.017);
      if(f){
        const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
        this.addSiteForce(a,ha,-fx,-fy,-fz);this.addSiteForce(b,hb,fx,fy,fz);
      }
    }
    for(const ha of ah){
      const dv={x:this.minimumImage(b.x-ha.x),y:this.minimumImage(b.y-ha.y),z:-ha.z};
      d=Math.hypot(dv.x,dv.y,dv.z);f=this.wcaForce(d,.094,.014);
      if(f){
        const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
        this.addSiteForce(a,ha,-fx,-fy,-fz);this.addCenterForce(b,fx,fy);
      }
    }
    for(const hb of bh){
      const dv={x:this.minimumImage(a.x-hb.x),y:this.minimumImage(a.y-hb.y),z:-hb.z};
      d=Math.hypot(dv.x,dv.y,dv.z);f=this.wcaForce(d,.094,.014);
      if(f){
        const fx=dv.x/d*f,fy=dv.y/d*f,fz=dv.z/d*f;
        this.addSiteForce(b,hb,-fx,-fy,-fz);this.addCenterForce(a,fx,fy);
      }
    }
    const aSites=[...ah.map(h=>({...h,charge:this.qH})),this.mSite(a)];
    const bSites=[...bh.map(h=>({...h,charge:this.qH})),this.mSite(b)];
    for(const sa of aSites)for(const sb of bSites){
      const dv=this.siteDelta(sa,sb);d=Math.hypot(dv.x,dv.y,dv.z);
      if(d<=1e-7||d>=this.coulombCutoff)continue;
      const scalar=this.electrostaticForce(d,sa.charge,sb.charge);
      if(!scalar)continue;
      const fx=dv.x/d*scalar,fy=dv.y/d*scalar,fz=dv.z/d*scalar;
      this.addSiteForce(a,sa,fx,fy,fz);this.addSiteForce(b,sb,-fx,-fy,-fz);
    }
    const dfx=a.fx-beforeFx,dfy=a.fy-beforeFy;
    this.virial+=-pairDx*dfx-pairDy*dfy;
  }

  candidate(donor,donorIndex,acceptor,acceptorIndex,loose=false){
    const h=this.hydrogenSites(donor)[donorIndex];
    const a=this.acceptorSites(acceptor)[acceptorIndex];
    const dv=this.siteDelta(h,a);
    const r=Math.hypot(dv.x,dv.y,dv.z);
    const rMax=loose ? .280 : .240;
    if(r<.070||r>rMax)return null;
    const ux=dv.x/r,uy=dv.y/r,uz=dv.z/r;
    const donorOH={x:h.rx/this.oh,y:h.ry/this.oh,z:h.rz/this.oh};
    const acceptorDir={x:a.rx/this.acceptorRadius,y:a.ry/this.acceptorRadius,z:a.rz/this.acceptorRadius};
    const donorAlign=donorOH.x*ux+donorOH.y*uy+donorOH.z*uz;
    const acceptorAlign=-(acceptorDir.x*ux+acceptorDir.y*uy+acceptorDir.z*uz);
    if(donorAlign<(loose ? .42 : .62)||acceptorAlign<(loose ? .24 : .42))return null;
    const radial=Math.exp(-Math.pow((r-.137)/.052,2));
    const score=radial*Math.pow(Math.max(0,donorAlign),3)*Math.pow(Math.max(0,acceptorAlign),2);
    if(score<(loose ? .008 : .025))return null;
    return{donor,donorIndex,acceptor,acceptorIndex,h,a,r,ux,uy,uz,donorAlign,acceptorAlign,score};
  }
  bondKey(donorId,donorIndex,acceptorId,acceptorIndex){
    return donorId+':'+donorIndex+'>'+acceptorId+':'+acceptorIndex;
  }

  updateBondNetwork(){
    const next=new Map(),donorUsed=new Set(),acceptorUsed=new Set();
    for(const [key,bond] of this.bonds){
      const c=this.candidate(
        this.molecules[bond.donorId],bond.donorIndex,
        this.molecules[bond.acceptorId],bond.acceptorIndex,true
      );
      if(!c){this.bondsBroken++;continue;}
      const dk=bond.donorId+':'+bond.donorIndex,ak=bond.acceptorId+':'+bond.acceptorIndex;
      if(donorUsed.has(dk)||acceptorUsed.has(ak)){this.bondsBroken++;continue;}
      donorUsed.add(dk);acceptorUsed.add(ak);
      next.set(key,{...bond,...c,age:bond.age+this.dt*4});
    }
    const candidates=[];
    for(const [ia,ib] of this.neighborPairs){
      const a=this.molecules[ia],b=this.molecules[ib];
      for(let di=0;di<2;di++)for(let ai=0;ai<2;ai++){
        let c=this.candidate(a,di,b,ai,false);if(c)candidates.push(c);
        c=this.candidate(b,di,a,ai,false);if(c)candidates.push(c);
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    for(const c of candidates){
      const dk=c.donor.id+':'+c.donorIndex,ak=c.acceptor.id+':'+c.acceptorIndex;
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
    const donor=new Uint8Array(this.count),acceptor=new Uint8Array(this.count);
    for(const b of this.bonds.values()){donor[b.donorId]++;acceptor[b.acceptorId]++;}
    let md=0,ma=0,mt=0;
    for(let i=0;i<this.count;i++){
      md=Math.max(md,donor[i]);ma=Math.max(ma,acceptor[i]);mt=Math.max(mt,donor[i]+acceptor[i]);
    }
    this.maxDonorDegree=md;this.maxAcceptorDegree=ma;this.maxTotalDegree=mt;
  }

  applyHydrogenBonds(){
    const target=.137,width=.050;
    for(const bond of this.bonds.values()){
      const donor=this.molecules[bond.donorId],acceptor=this.molecules[bond.acceptorId];
      const c=this.candidate(donor,bond.donorIndex,acceptor,bond.acceptorIndex,true);
      if(!c)continue;
      const beforeFx=donor.fx,beforeFy=donor.fy;
      const centerDx=this.minimumImage(acceptor.x-donor.x);
      const centerDy=this.minimumImage(acceptor.y-donor.y);
      const delta=(c.r-target)/width;
      const angular=c.donorAlign*c.donorAlign*c.acceptorAlign*c.acceptorAlign;
      const magnitude=2*this.hBondEpsilon*delta/width*Math.exp(-delta*delta)*angular;
      const fx=c.ux*magnitude,fy=c.uy*magnitude,fz=c.uz*magnitude;
      this.addSiteForce(donor,c.h,fx,fy,fz);
      this.addSiteForce(acceptor,c.a,-fx,-fy,-fz);
      this.virial+=-centerDx*(donor.fx-beforeFx)-centerDy*(donor.fy-beforeFy);
    }
  }

  computeForces(forceBondUpdate=false){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    this.resetForces();
    this.virial=0;
    for(const [ia,ib] of this.neighborPairs)this.applyPairForces(this.molecules[ia],this.molecules[ib]);
    if(forceBondUpdate||this.stepCount%4===0)this.updateBondNetwork();
    this.applyHydrogenBonds();
  }

  instantaneousPressure(){
    let kinetic=0;
    for(const m of this.molecules)kinetic+=this.mass*(m.vx*m.vx+m.vy*m.vy);
    const area=4*this.domainHalf*this.domainHalf;
    return(kinetic+this.virial)/(2*area);
  }

  rotateOrientation(m,dt){
    const omega={w:0,x:m.wx,y:m.wy,z:m.wz};
    const dq=quatMul(omega,m.q);
    m.q.w+=.5*dq.w*dt;m.q.x+=.5*dq.x*dt;m.q.y+=.5*dq.y*dt;m.q.z+=.5*dq.z*dt;
    quatNormalize(m.q);
  }

  applyBarostat(){
    const error=this.targetReducedPressure()-this.pressureEMA;
    const dlogL=clamp(-this.barostatRate*error*this.dt,-.0012,.0012);
    if(Math.abs(dlogL)<1e-8)return;
    const old=this.domainHalf;
    const next=clamp(old*Math.exp(dlogL),this.minDomainHalf,this.maxDomainHalf);
    const scale=next/old;
    if(Math.abs(scale-1)<1e-8)return;
    this.domainHalf=next;
    for(const m of this.molecules){m.x*=scale;m.y*=scale;}
    this.neighborDirty=true;
  }

  resolveHardCoreConstraints(){
    for(let pass=0;pass<2;pass++){
      if(this.needsNeighborRebuild())this.rebuildNeighborList();
      for(const [ia,ib] of this.neighborPairs){
        const a=this.molecules[ia],b=this.molecules[ib];
        let dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
        const d=Math.hypot(dx,dy)||1e-8;
        if(d>=this.hardCoreOO)continue;
        const nx=dx/d,ny=dy/d,correction=(this.hardCoreOO-d)*.5+.00015;
        a.x=this.wrap(a.x-nx*correction);a.y=this.wrap(a.y-ny*correction);
        b.x=this.wrap(b.x+nx*correction);b.y=this.wrap(b.y+ny*correction);
        const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(relative<0){
          const impulse=-relative*.50;
          a.vx-=nx*impulse;a.vy-=ny*impulse;
          b.vx+=nx*impulse;b.vy+=ny*impulse;
        }
      }
    }
  }

  integrate(){
    const dt=this.dt,half=.5*dt;
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;m.wy+=half*m.ty/this.inertia;m.wz+=half*m.tz/this.inertia;
    }
    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);m.y=this.wrap(m.y+half*m.vy);this.rotateOrientation(m,half);
    }

    const cv=Math.exp(-this.gamma*dt),cw=Math.exp(-this.gammaRot*dt);
    const sv=Math.sqrt(this.temperature*(1-cv*cv)/this.mass);
    const sw=Math.sqrt(this.temperature*(1-cw*cw)/this.inertia);
    for(const m of this.molecules){
      m.vx=cv*m.vx+sv*this.gaussian();m.vy=cv*m.vy+sv*this.gaussian();
      m.wx=cw*m.wx+sw*this.gaussian();m.wy=cw*m.wy+sw*this.gaussian();m.wz=cw*m.wz+sw*this.gaussian();
    }

    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);m.y=this.wrap(m.y+half*m.vy);this.rotateOrientation(m,half);
    }

    this.applyBarostat();
    this.resolveHardCoreConstraints();
    this.neighborAge++;
    this.computeForces();

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;m.wy+=half*m.ty/this.inertia;m.wz+=half*m.tz/this.inertia;
    }

    this.reducedPressure=this.instantaneousPressure();
    this.pressureEMA+=.035*(this.reducedPressure-this.pressureEMA);
    this.stepCount++;
  }

  diagnostics(){
    let speed=0,angular=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angular+=Math.hypot(m.wx,m.wy,m.wz);
    }
    const area=4*this.domainHalf*this.domainHalf;
    return{
      steps:this.stepCount,bonds:this.bonds.size,
      formed:this.bondsFormed,broken:this.bondsBroken,
      meanSpeed:speed/this.count,meanAngularSpeed:angular/this.count,
      neighborPairs:this.neighborPairs.length,neighborRebuilds:this.neighborRebuilds,
      cellsPerAxis:this.cellsPerAxis??0,averageNeighbors:this.neighborPairs.length*2/this.count,
      domainHalf:this.domainHalf,area,arealDensity:this.count/area,
      temperatureKelvin:this.temperatureKelvin,pressureGPa:this.pressureGPa,
      reducedPressure:this.pressureEMA,targetReducedPressure:this.targetReducedPressure(),
      measuredPressureGPa:this.measuredPressureGPa(),
      hBondThermalRatio:this.hBondEpsilon/this.temperature,
      maxDonorDegree:this.maxDonorDegree,maxAcceptorDegree:this.maxAcceptorDegree,maxTotalDegree:this.maxTotalDegree,
    };
  }
}

class MonolayerExplorer{
  constructor(canvas){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d',{alpha:false});
    this.host=canvas.closest('water-network-story');
    this.stage=this.host?.querySelector('[data-water-stage]');
    this.tempInput=this.host?.querySelector('[data-monolayer-temperature]');
    this.pressureInput=this.host?.querySelector('[data-monolayer-pressure]');
    this.tempOutput=this.host?.querySelector('[data-monolayer-temperature-output]');
    this.pressureOutput=this.host?.querySelector('[data-monolayer-pressure-output]');
    this.measuredPressureOutput=this.host?.querySelector('[data-monolayer-measured-pressure]');
    this.densityOutput=this.host?.querySelector('[data-monolayer-density]');
    this.status=this.host?.querySelector('[data-monolayer-status]');
    this.md=null;
    this.width=1;this.height=1;this.dpr=1;this.last=performance.now();
    this.accumulator=0;this.visible=true;this.frameCount=0;
    this.resize=this.resize.bind(this);this.frame=this.frame.bind(this);
    this.tempInput?.addEventListener('input',()=>this.updateControls());
    this.pressureInput?.addEventListener('input',()=>this.updateControls());
    this.ro=new ResizeObserver(this.resize);if(this.stage)this.ro.observe(this.stage);
    this.io=new IntersectionObserver(entries=>{this.visible=entries[0]?.isIntersecting??true;},{threshold:.01});
    this.io.observe(this.canvas);
    this.resize();this.paintIdle();
    this.canvas.dataset.renderer='monolayer-water-md';
    this.canvas.dataset.model='tip4p-style-rigid-water-browser-prototype';
    this.canvas.dataset.moleculeCount='250';
    this.canvas.dataset.spatialIndex='cell-verlet';
    this.canvas.dataset.boundary='periodic-xy';
    this.canvas.dataset.ensemble='qualitative-2d-npt-like';
    this.canvas.dataset.barostat='virial-feedback';
    this.canvas.dataset.pressureEstimator='2d-virial';
    this.canvas.dataset.viewFill='full-height';
    requestAnimationFrame(this.frame);
  }

  ensureSimulation(){
    if(this.md)return;
    this.md=new MonolayerWaterMD({
      count:250,
      temperatureKelvin:Number(this.tempInput?.value)||240,
      pressureGPa:Number(this.pressureInput?.value)||1,
    });
    this.updateControls();
    this.updateDiagnostics();
    if(this.host)this.host.dataset.monolayerReady='true';
  }

  updateControls(){
    const t=Number(this.tempInput?.value)||240,p=Number(this.pressureInput?.value)||0;
    if(this.md){this.md.setTemperatureKelvin(t);this.md.setPressureGPa(p);}
    if(this.tempOutput)this.tempOutput.textContent=Math.round(t)+' K';
    if(this.pressureOutput)this.pressureOutput.textContent=p.toFixed(1)+' GPa';
  }

  resize(){
    if(!this.stage)return;
    const r=this.stage.getBoundingClientRect();
    this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);
    this.dpr=Math.min(1.7,devicePixelRatio||1);
    this.canvas.width=Math.round(this.width*this.dpr);
    this.canvas.height=Math.round(this.height*this.dpr);
    this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    if(this.md)this.draw();else this.paintIdle();
  }

  view(){
    const mobile=this.width<760;
    const boxSize=Math.min(
      this.height*(mobile?.62:.94),
      this.width*(mobile?.94:.58)
    );
    const cx=mobile?this.width*.5:this.width*.70;
    const cy=mobile?this.height*.62:this.height*.50;
    const half=this.md?.domainHalf??2.46;
    const scale=boxSize/(2*half);
    return{boxSize,cx,cy,left:cx-boxSize*.5,top:cy-boxSize*.5,scale};
  }

  toCanvas(x,y,view){return{x:view.cx+x*view.scale,y:view.cy-y*view.scale};}

  paintIdle(){
    const dark=document.documentElement.dataset.theme==='dark';
    this.ctx.fillStyle=dark?'#111a20':'#dfe9ec';
    this.ctx.fillRect(0,0,this.width,this.height);
  }

  draw(){
    const ctx=this.ctx,view=this.view(),dark=document.documentElement.dataset.theme==='dark';
    ctx.fillStyle=dark?'#111a20':'#dfe9ec';ctx.fillRect(0,0,this.width,this.height);
    const glow=ctx.createRadialGradient(view.cx,view.cy,0,view.cx,view.cy,view.boxSize*.72);
    glow.addColorStop(0,dark?'rgba(50,75,84,.50)':'rgba(176,203,211,.68)');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,this.width,this.height);

    ctx.save();ctx.beginPath();ctx.rect(view.left,view.top,view.boxSize,view.boxSize);ctx.clip();
    ctx.fillStyle=dark?'rgba(12,24,30,.80)':'rgba(225,238,241,.90)';
    ctx.fillRect(view.left,view.top,view.boxSize,view.boxSize);

    const bondWidth=clamp(view.scale*.0055,.72,1.35);
    ctx.lineWidth=bondWidth;ctx.setLineDash([4,3]);
    ctx.strokeStyle=dark?'rgba(167,211,224,.34)':'rgba(42,103,123,.30)';
    for(const bond of this.md.bonds.values()){
      const donor=this.md.molecules[bond.donorId],acceptor=this.md.molecules[bond.acceptorId];
      const h=this.md.hydrogenSites(donor)[bond.donorIndex];
      const dx=this.md.minimumImage(acceptor.x-h.x),dy=this.md.minimumImage(acceptor.y-h.y);
      const a=this.toCanvas(h.x,h.y,view),b=this.toCanvas(h.x+dx,h.y+dy,view);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle=dark?'rgba(236,241,240,.66)':'rgba(80,92,94,.56)';
    ctx.lineWidth=clamp(view.scale*.0058,.72,1.45);
    ctx.beginPath();
    for(const m of this.md.molecules){
      const o=this.toCanvas(m.x,m.y,view);
      for(const h of this.md.hydrogenSites(m)){
        const hp=this.toCanvas(h.x,h.y,view);
        ctx.moveTo(o.x,o.y);ctx.lineTo(hp.x,hp.y);
      }
    }
    ctx.stroke();

    const hRadius=clamp(view.scale*.0100,1.20,2.15);
    const oRadius=clamp(view.scale*.0177,2.15,3.85);
    ctx.fillStyle=dark?'#f1eee7':'#fffdf7';ctx.beginPath();
    for(const m of this.md.molecules)for(const h of this.md.hydrogenSites(m)){
      const p=this.toCanvas(h.x,h.y,view);ctx.moveTo(p.x+hRadius,p.y);ctx.arc(p.x,p.y,hRadius,0,Math.PI*2);
    }
    ctx.fill();
    ctx.fillStyle='#d94b43';ctx.beginPath();
    for(const m of this.md.molecules){
      const p=this.toCanvas(m.x,m.y,view);ctx.moveTo(p.x+oRadius,p.y);ctx.arc(p.x,p.y,oRadius,0,Math.PI*2);
    }
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle=dark?'rgba(197,220,226,.16)':'rgba(50,94,108,.16)';
    ctx.lineWidth=1;
    ctx.strokeRect(view.left+.5,view.top+.5,view.boxSize-1,view.boxSize-1);
  }

  updateDiagnostics(){
    if(!this.md)return;
    const d=this.md.diagnostics();
    this.canvas.dataset.mdSteps=String(d.steps);
    this.canvas.dataset.hydrogenBonds=String(d.bonds);
    this.canvas.dataset.neighborPairs=String(d.neighborPairs);
    this.canvas.dataset.neighborRebuilds=String(d.neighborRebuilds);
    this.canvas.dataset.cellsPerAxis=String(d.cellsPerAxis);
    this.canvas.dataset.averageNeighbors=d.averageNeighbors.toFixed(2);
    this.canvas.dataset.domainHalf=d.domainHalf.toFixed(4);
    this.canvas.dataset.boxArea=d.area.toFixed(4);
    this.canvas.dataset.arealDensity=d.arealDensity.toFixed(4);
    this.canvas.dataset.temperatureK=String(Math.round(d.temperatureKelvin));
    this.canvas.dataset.pressureGpa=d.pressureGPa.toFixed(1);
    this.canvas.dataset.measuredPressureGpa=d.measuredPressureGPa.toFixed(2);
    this.canvas.dataset.reducedPressure=d.reducedPressure.toFixed(5);
    this.canvas.dataset.targetReducedPressure=d.targetReducedPressure.toFixed(5);
    this.canvas.dataset.hbondThermalRatio=d.hBondThermalRatio.toFixed(3);
    this.canvas.dataset.maxTotalDegree=String(d.maxTotalDegree);

    if(this.measuredPressureOutput){
      this.measuredPressureOutput.textContent=d.measuredPressureGPa.toFixed(1)+' GPa';
    }
    if(this.densityOutput)this.densityOutput.textContent=d.arealDensity.toFixed(2);
    if(this.status){
      this.status.textContent=d.bonds+' H-bonds · '+d.averageNeighbors.toFixed(1)+' neighbours/molecule';
    }
  }

  frame(now){
    const elapsed=Math.min(.05,Math.max(0,(now-this.last)/1000));this.last=now;
    const active=this.visible&&this.host?.dataset.scene==='1'&&this.host?.dataset.paused!=='true';
    if(active){
      this.ensureSimulation();
      this.accumulator=Math.min(this.accumulator+elapsed,this.md.dt*5);
      let steps=0;
      while(this.accumulator>=this.md.dt&&steps<5){
        this.md.integrate();this.accumulator-=this.md.dt;steps++;
      }
      this.draw();this.frameCount++;
      if(this.frameCount%6===0)this.updateDiagnostics();
    }else this.accumulator=0;
    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-monolayer-canvas]').forEach(canvas=>{
  if(canvas.__monolayerExplorer)return;
  canvas.__monolayerExplorer=new MonolayerExplorer(canvas);
});
