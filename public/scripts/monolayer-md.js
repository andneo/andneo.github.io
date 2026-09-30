const WATER_ANGLE=104.5*Math.PI/180;
const HALF_WATER_ANGLE=WATER_ANGLE*.5;
const KB_KJ_MOL_K=0.00831446261815324;
const GPA_NM3_TO_KJ_MOL=602.214076;

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

    // Geometry is in nm and energies are in kJ/mol. The dynamics use an
    // arbitrary but fixed time unit; thermodynamic ratios are not arbitrary:
    // kBT is calculated from the requested Kelvin temperature.
    this.dt=options.dt??1/600;
    this.mass=18.015;
    this.inertia=.085;
    this.oh=.0957;
    this.acceptorRadius=.065;
    this.temperatureKelvin=options.temperatureKelvin??240;
    this.pressureGPa=options.pressureGPa??1.0;
    this.kBT=KB_KJ_MOL_K*this.temperatureKelvin;
    this.gamma=2.0;
    this.gammaRot=2.4;

    // A continuous conservative four-patch model. O centres repel through WCA;
    // each of the two H donor sites attracts either of two virtual acceptor
    // sites on a neighbouring water through a Gaussian well. The display bond
    // graph is derived from this potential and never feeds back into the force.
    this.ooSigma=.260;
    this.ooEpsilon=5.0;
    this.ooCutoff=Math.pow(2,1/6)*this.ooSigma;
    this.hBondEpsilon=7.0;
    this.hBondR0=.125;
    this.hBondWidth=.028;
    this.hBondCutoff=.280;

    this.interactionCutoff=.64;
    this.skin=.09;
    this.listCutoff=this.interactionCutoff+this.skin;

    // The released 144-water starting cell is ~37.56 x 37.30 A, corresponding
    // to 10.28 molecules/nm^2. Use that areal density for the 250-water box.
    this.initialArealDensity=10.2800643033;
    this.domainHalf=.5*Math.sqrt(this.count/this.initialArealDensity);
    this.referenceHalf=this.domainHalf;
    this.minDomainHalf=1.62;
    this.maxDomainHalf=3.20;

    // The paper reports inferred confinement pressure Pconf and uses a 5 A
    // confinement width. Since Pconf=Pxy*z/w, Pxy*(A*z)=Pconf*(A*w), so the
    // correct pressure work for an isotropic area move is Pconf*w*dA.
    this.confinementWidthNm=.50;
    this.pressureWorkScale=GPA_NM3_TO_KJ_MOL*this.confinementWidthNm;

    this.molecules=[];
    this.bonds=new Map();
    this.neighborPairs=[];
    this.neighborsOf=Array.from({length:this.count},()=>[]);
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

    this.virial=0;
    this.potentialEnergy=0;
    this.virialPressureGPa=0;
    this.virialPressureEMA=0;

    // NPT sampling uses Metropolis area moves instead of a feedback controller.
    // This removes the previous arbitrary pressure-to-box mapping.
    this.areaMoveInterval=14;
    this.areaLogStep=.0045;
    this.areaMoveAttempts=0;
    this.areaMoveAccepted=0;
    this.areaWindowAttempts=0;
    this.areaWindowAccepted=0;

    // Small Metropolis rigid-body rotations accelerate orientational
    // equilibration at low T while preserving the canonical distribution.
    this.orientationMoveInterval=3;
    this.orientationMoveAngle=.20;
    this.orientationMoveAttempts=0;
    this.orientationMoveAccepted=0;

    // Parameter changes trigger extra *equilibrium-preserving* Monte Carlo
    // attempts. These accelerate relaxation after a slider move without
    // changing the target NPT distribution.
    this.pressureRelaxationMoves=500;
    this.orientationRelaxationMoves=800;
    this.temperatureRescales=0;

    this.seed();
    this.rebuildNeighborList();
    this.computeForces(true);
    this.updatePressureEstimate(true);
  }

  setTemperatureKelvin(value){
    const nextKelvin=clamp(Number(value)||240,120,500);
    const nextKBT=KB_KJ_MOL_K*nextKelvin;
    if(this.molecules.length&&this.kBT>0){
      const scale=clamp(Math.sqrt(nextKBT/this.kBT),.35,3.0);
      for(const m of this.molecules){
        m.vx*=scale;m.vy*=scale;
        m.wx*=scale;m.wy*=scale;m.wz*=scale;
      }
      this.temperatureRescales++;
    }
    this.temperatureKelvin=nextKelvin;
    this.kBT=nextKBT;
    this.orientationRelaxationMoves=Math.max(this.orientationRelaxationMoves,800);
    this.pressureRelaxationMoves=Math.max(this.pressureRelaxationMoves,300);
  }

  setPressureGPa(value){
    const next=clamp(Number(value)||0,0,6);
    if(Math.abs(next-this.pressureGPa)>.02){
      this.pressureRelaxationMoves=Math.max(this.pressureRelaxationMoves,500);
    }
    this.pressureGPa=next;
  }

  random(){
    let x=this.randomState|0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    this.randomState=x|0;
    return((x>>>0)+.5)/4294967296;
  }
  gaussian(){
    const u=Math.max(1e-12,this.random());
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
    // Random sequential placement avoids seeding a square crystal. The
    // conservative repulsion then relaxes residual close contacts.
    const minSep=.220;
    for(let id=0;id<this.count;id++){
      let placed=false;
      for(let attempt=0;attempt<2200&&!placed;attempt++){
        const x=(this.random()*2-1)*this.domainHalf;
        const y=(this.random()*2-1)*this.domainHalf;
        let clear=true;
        for(const other of this.molecules){
          if(Math.hypot(this.minimumImage(x-other.x),this.minimumImage(y-other.y))<minSep){
            clear=false;break;
          }
        }
        if(!clear)continue;

        const yaw=this.random()*Math.PI*2;
        const tilt=(this.random()-.5)*.38;
        const halfYaw=yaw*.5,halfTilt=tilt*.5;
        const qYaw={w:Math.cos(halfYaw),x:0,y:0,z:Math.sin(halfYaw)};
        const qTilt={w:Math.cos(halfTilt),x:Math.sin(halfTilt),y:0,z:0};
        const q=quatMul(qTilt,qYaw);
        quatNormalize(q);

        const sigmaV=Math.sqrt(this.kBT/this.mass);
        const sigmaW=Math.sqrt(this.kBT/this.inertia);
        this.molecules.push({
          id,x,y,z:0,
          vx:this.gaussian()*sigmaV,vy:this.gaussian()*sigmaV,
          q,
          wx:this.gaussian()*sigmaW*.45,
          wy:this.gaussian()*sigmaW*.45,
          wz:this.gaussian()*sigmaW*.45,
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
  sites(m){return{h:this.hydrogenSites(m),a:this.acceptorSites(m)};}
  makeSiteCache(){return this.molecules.map(m=>this.sites(m));}
  siteDelta(a,b){
    return{x:this.minimumImage(b.x-a.x),y:this.minimumImage(b.y-a.y),z:b.z-a.z};
  }

  needsNeighborRebuild(){
    if(this.neighborDirty||this.neighborAge>=36)return true;
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
    const head=new Int32Array(cellsPerAxis*cellsPerAxis);head.fill(-1);
    const next=new Int32Array(this.count);next.fill(-1);
    const cellOf=new Int32Array(this.count);
    const neighbors=Array.from({length:this.count},()=>[]);
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
            if(dx*dx+dy*dy<cutoff2){
              pairs.push([i,j]);neighbors[i].push(j);neighbors[j].push(i);
            }
          }
          j=next[j];
        }
      }
    }

    this.neighborPairs=pairs;
    this.neighborsOf=neighbors;
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

  wcaPotential(distance){
    if(distance<=1e-10)return 1e9;
    if(distance>=this.ooCutoff)return 0;
    const sr=this.ooSigma/distance;
    const sr2=sr*sr,sr6=sr2*sr2*sr2,sr12=sr6*sr6;
    return 4*this.ooEpsilon*(sr12-sr6)+this.ooEpsilon;
  }
  wcaForce(distance){
    if(distance<=1e-10||distance>=this.ooCutoff)return 0;
    const sr=this.ooSigma/distance;
    const sr2=sr*sr,sr6=sr2*sr2*sr2,sr12=sr6*sr6;
    return 24*this.ooEpsilon*(2*sr12-sr6)/distance;
  }

  patchPotential(distance){
    if(distance>=this.hBondCutoff)return 0;
    const delta=(distance-this.hBondR0)/this.hBondWidth;
    return-this.hBondEpsilon*Math.exp(-delta*delta);
  }
  patchDerivative(distance){
    if(distance<=1e-10||distance>=this.hBondCutoff)return 0;
    const delta=(distance-this.hBondR0)/this.hBondWidth;
    return 2*this.hBondEpsilon*delta/this.hBondWidth*Math.exp(-delta*delta);
  }

  pairPotentialFromSites(a,b,sa,sb){
    const dx=this.minimumImage(b.x-a.x),dy=this.minimumImage(b.y-a.y);
    const centerDistance=Math.hypot(dx,dy);
    if(centerDistance>=this.interactionCutoff)return 0;
    let energy=this.wcaPotential(centerDistance);

    for(const h of sa.h)for(const acc of sb.a){
      const dv=this.siteDelta(h,acc);
      energy+=this.patchPotential(Math.hypot(dv.x,dv.y,dv.z));
    }
    for(const h of sb.h)for(const acc of sa.a){
      const dv=this.siteDelta(h,acc);
      energy+=this.patchPotential(Math.hypot(dv.x,dv.y,dv.z));
    }
    return energy;
  }

  applyPatchForce(donor,hydrogen,acceptor,acceptorSite){
    const dv=this.siteDelta(hydrogen,acceptorSite);
    const r=Math.hypot(dv.x,dv.y,dv.z);
    const derivative=this.patchDerivative(r);
    if(!derivative)return this.patchPotential(r);
    const fx=dv.x/r*derivative,fy=dv.y/r*derivative,fz=dv.z/r*derivative;
    this.addSiteForce(donor,hydrogen,fx,fy,fz);
    this.addSiteForce(acceptor,acceptorSite,-fx,-fy,-fz);
    return this.patchPotential(r);
  }

  applyPairForces(a,b,sa,sb){
    const centerDx=this.minimumImage(b.x-a.x);
    const centerDy=this.minimumImage(b.y-a.y);
    const centerDistance=Math.hypot(centerDx,centerDy);
    if(centerDistance>=this.interactionCutoff)return 0;

    const beforeFx=a.fx,beforeFy=a.fy;
    let energy=this.wcaPotential(centerDistance);
    const repulsion=this.wcaForce(centerDistance);
    if(repulsion){
      const ux=centerDx/centerDistance,uy=centerDy/centerDistance;
      this.addCenterForce(a,-ux*repulsion,-uy*repulsion);
      this.addCenterForce(b,ux*repulsion,uy*repulsion);
    }

    for(const h of sa.h)for(const acc of sb.a)energy+=this.applyPatchForce(a,h,b,acc);
    for(const h of sb.h)for(const acc of sa.a)energy+=this.applyPatchForce(b,h,a,acc);

    const pairFx=a.fx-beforeFx,pairFy=a.fy-beforeFy;
    this.virial+=-centerDx*pairFx-centerDy*pairFy;
    return energy;
  }

  listedPotentialEnergy(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const cache=this.makeSiteCache();
    let energy=0;
    for(const [ia,ib] of this.neighborPairs){
      energy+=this.pairPotentialFromSites(
        this.molecules[ia],this.molecules[ib],cache[ia],cache[ib]
      );
    }
    return energy;
  }

  localPotentialEnergy(id){
    const m=this.molecules[id];
    const sm=this.sites(m);
    let energy=0;
    for(const j of this.neighborsOf[id]){
      const other=this.molecules[j];
      energy+=this.pairPotentialFromSites(m,other,sm,this.sites(other));
    }
    return energy;
  }

  updateBondNetwork(cache=this.makeSiteCache()){
    const previous=this.bonds;
    const candidates=[];
    const threshold=-this.hBondEpsilon*.50;

    const collect=(donor,acceptor,donorSites,acceptorSites)=>{
      for(let di=0;di<2;di++)for(let ai=0;ai<2;ai++){
        const h=donorSites.h[di],acc=acceptorSites.a[ai];
        const dv=this.siteDelta(h,acc);
        const r=Math.hypot(dv.x,dv.y,dv.z);
        const energy=this.patchPotential(r);
        if(energy<=threshold){
          candidates.push({donorId:donor.id,donorIndex:di,acceptorId:acceptor.id,acceptorIndex:ai,energy,r});
        }
      }
    };

    for(const [ia,ib] of this.neighborPairs){
      collect(this.molecules[ia],this.molecules[ib],cache[ia],cache[ib]);
      collect(this.molecules[ib],this.molecules[ia],cache[ib],cache[ia]);
    }
    candidates.sort((a,b)=>a.energy-b.energy);

    const next=new Map(),donorUsed=new Set(),acceptorUsed=new Set(),pairUsed=new Set();
    for(const c of candidates){
      const dk=c.donorId+':'+c.donorIndex;
      const ak=c.acceptorId+':'+c.acceptorIndex;
      const pairKey=c.donorId<c.acceptorId?c.donorId+'-'+c.acceptorId:c.acceptorId+'-'+c.donorId;
      if(donorUsed.has(dk)||acceptorUsed.has(ak)||pairUsed.has(pairKey))continue;
      const key=dk+'>'+ak;
      donorUsed.add(dk);acceptorUsed.add(ak);pairUsed.add(pairKey);
      next.set(key,{...c,key,age:(previous.get(key)?.age??0)+this.dt*6});
    }

    for(const key of next.keys())if(!previous.has(key))this.bondsFormed++;
    for(const key of previous.keys())if(!next.has(key))this.bondsBroken++;
    this.bonds=next;

    const donor=new Uint8Array(this.count),acceptor=new Uint8Array(this.count);
    for(const b of next.values()){donor[b.donorId]++;acceptor[b.acceptorId]++;}
    let md=0,ma=0,mt=0;
    for(let i=0;i<this.count;i++){
      md=Math.max(md,donor[i]);ma=Math.max(ma,acceptor[i]);mt=Math.max(mt,donor[i]+acceptor[i]);
    }
    this.maxDonorDegree=md;this.maxAcceptorDegree=ma;this.maxTotalDegree=mt;
  }

  computeForces(forceBondUpdate=false){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    this.resetForces();
    this.virial=0;
    this.potentialEnergy=0;
    const cache=this.makeSiteCache();

    for(const [ia,ib] of this.neighborPairs){
      this.potentialEnergy+=this.applyPairForces(
        this.molecules[ia],this.molecules[ib],cache[ia],cache[ib]
      );
    }

    if(forceBondUpdate||this.stepCount%6===0)this.updateBondNetwork(cache);
  }

  rotateOrientation(m,dt){
    const omega={w:0,x:m.wx,y:m.wy,z:m.wz};
    const dq=quatMul(omega,m.q);
    m.q.w+=.5*dq.w*dt;m.q.x+=.5*dq.x*dt;m.q.y+=.5*dq.y*dt;m.q.z+=.5*dq.z*dt;
    quatNormalize(m.q);
  }

  attemptOrientationMove(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const id=Math.floor(this.random()*this.count);
    const m=this.molecules[id];
    const oldQ={...m.q};
    const oldEnergy=this.localPotentialEnergy(id);

    let ax=this.gaussian(),ay=this.gaussian(),az=this.gaussian();
    const n=Math.hypot(ax,ay,az)||1;ax/=n;ay/=n;az/=n;
    const angle=(this.random()*2-1)*this.orientationMoveAngle;
    const half=.5*angle,s=Math.sin(half);
    const dq={w:Math.cos(half),x:ax*s,y:ay*s,z:az*s};
    m.q=quatMul(dq,m.q);quatNormalize(m.q);

    const newEnergy=this.localPotentialEnergy(id);
    const delta=newEnergy-oldEnergy;
    const accept=delta<=0||Math.log(Math.max(1e-12,this.random()))<-delta/this.kBT;
    this.orientationMoveAttempts++;
    if(accept)this.orientationMoveAccepted++;
    else m.q=oldQ;
  }

  attemptAreaMove(){
    const oldHalf=this.domainHalf;
    const oldArea=4*oldHalf*oldHalf;
    const dlnA=(this.random()*2-1)*this.areaLogStep;
    const scale=Math.exp(.5*dlnA);
    const newHalf=oldHalf*scale;
    this.areaMoveAttempts++;
    this.areaWindowAttempts++;

    if(newHalf<this.minDomainHalf||newHalf>this.maxDomainHalf){
      this.adaptAreaStep();
      return false;
    }

    // The Verlet skin is far wider than a single trial scale displacement, so
    // the current pair list safely contains every pair that could enter the
    // interaction cutoff during this one trial. Rebuild after acceptance.
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const oldEnergy=this.listedPotentialEnergy();
    this.domainHalf=newHalf;
    for(const m of this.molecules){m.x*=scale;m.y*=scale;}
    const newEnergy=this.listedPotentialEnergy();
    const newArea=4*newHalf*newHalf;

    const pressureWork=this.pressureGPa*this.pressureWorkScale*(newArea-oldArea);
    const logAcceptance=
      -(newEnergy-oldEnergy+pressureWork)/this.kBT+
      this.count*Math.log(newArea/oldArea);

    const accept=logAcceptance>=0||Math.log(Math.max(1e-12,this.random()))<logAcceptance;
    if(accept){
      this.areaMoveAccepted++;
      this.areaWindowAccepted++;
      this.neighborDirty=true;
    }else{
      const inverse=1/scale;
      this.domainHalf=oldHalf;
      for(const m of this.molecules){m.x*=inverse;m.y*=inverse;}
    }
    this.adaptAreaStep();
    return accept;
  }

  adaptAreaStep(){
    if(this.areaWindowAttempts<80)return;
    const rate=this.areaWindowAccepted/this.areaWindowAttempts;
    if(rate<.22)this.areaLogStep=Math.max(.0008,this.areaLogStep*.82);
    else if(rate>.48)this.areaLogStep=Math.min(.018,this.areaLogStep*1.18);
    this.areaWindowAttempts=0;
    this.areaWindowAccepted=0;
  }

  updatePressureEstimate(immediate=false){
    const area=4*this.domainHalf*this.domainHalf;
    const pressureKJMolNm3=
      (this.count*this.kBT+.5*this.virial)/(area*this.confinementWidthNm);
    const pressure=pressureKJMolNm3/GPA_NM3_TO_KJ_MOL;
    this.virialPressureGPa=pressure;
    if(immediate||!Number.isFinite(this.virialPressureEMA))this.virialPressureEMA=pressure;
    else this.virialPressureEMA+=.025*(pressure-this.virialPressureEMA);
  }

  integrate(){
    const dt=this.dt,half=.5*dt;

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;m.wy+=half*m.ty/this.inertia;m.wz+=half*m.tz/this.inertia;
    }

    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);m.y=this.wrap(m.y+half*m.vy);
      this.rotateOrientation(m,half);
    }

    const cv=Math.exp(-this.gamma*dt),cw=Math.exp(-this.gammaRot*dt);
    const sv=Math.sqrt(this.kBT*(1-cv*cv)/this.mass);
    const sw=Math.sqrt(this.kBT*(1-cw*cw)/this.inertia);
    for(const m of this.molecules){
      m.vx=cv*m.vx+sv*this.gaussian();
      m.vy=cv*m.vy+sv*this.gaussian();
      m.wx=cw*m.wx+sw*this.gaussian();
      m.wy=cw*m.wy+sw*this.gaussian();
      m.wz=cw*m.wz+sw*this.gaussian();
    }

    for(const m of this.molecules){
      m.x=this.wrap(m.x+half*m.vx);m.y=this.wrap(m.y+half*m.vy);
      this.rotateOrientation(m,half);
    }

    this.neighborAge++;
    if(this.stepCount%this.orientationMoveInterval===0){
      this.attemptOrientationMove();
      this.attemptOrientationMove();
    }
    if(this.orientationRelaxationMoves>0){
      const extra=Math.min(4,this.orientationRelaxationMoves);
      for(let i=0;i<extra;i++)this.attemptOrientationMove();
      this.orientationRelaxationMoves-=extra;
    }

    if(this.stepCount>0&&this.stepCount%this.areaMoveInterval===0)this.attemptAreaMove();
    if(this.pressureRelaxationMoves>0&&this.stepCount%2===0){
      this.attemptAreaMove();
      this.pressureRelaxationMoves--;
    }

    this.computeForces();

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.inertia;m.wy+=half*m.ty/this.inertia;m.wz+=half*m.tz/this.inertia;
    }

    this.updatePressureEstimate();
    this.stepCount++;
  }

  diagnostics(){
    let speed=0,angular=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angular+=Math.hypot(m.wx,m.wy,m.wz);
    }
    const area=4*this.domainHalf*this.domainHalf;
    const areaAcceptance=this.areaMoveAttempts?this.areaMoveAccepted/this.areaMoveAttempts:0;
    const orientationAcceptance=this.orientationMoveAttempts?
      this.orientationMoveAccepted/this.orientationMoveAttempts:0;
    return{
      steps:this.stepCount,bonds:this.bonds.size,
      formed:this.bondsFormed,broken:this.bondsBroken,
      bondsPerMolecule:this.bonds.size/this.count,
      meanDegree:2*this.bonds.size/this.count,
      meanSpeed:speed/this.count,
      meanAngularSpeed:angular/this.count,
      neighborPairs:this.neighborPairs.length,neighborRebuilds:this.neighborRebuilds,
      cellsPerAxis:this.cellsPerAxis??0,averageNeighbors:this.neighborPairs.length*2/this.count,
      domainHalf:this.domainHalf,area,arealDensity:this.count/area,
      temperatureKelvin:this.temperatureKelvin,kBT:this.kBT,
      pressureGPa:this.pressureGPa,virialPressureGPa:this.virialPressureEMA,
      pressureWorkScale:this.pressureWorkScale,confinementWidthNm:this.confinementWidthNm,
      hBondThermalRatio:this.hBondEpsilon/this.kBT,
      potentialEnergyPerMolecule:this.potentialEnergy/this.count,
      areaMoveAttempts:this.areaMoveAttempts,areaMoveAccepted:this.areaMoveAccepted,
      areaAcceptance,areaLogStep:this.areaLogStep,
      orientationMoveAttempts:this.orientationMoveAttempts,
      orientationMoveAccepted:this.orientationMoveAccepted,
      orientationAcceptance,
      pressureRelaxationMoves:this.pressureRelaxationMoves,
      orientationRelaxationMoves:this.orientationRelaxationMoves,
      temperatureRescales:this.temperatureRescales,
      maxDonorDegree:this.maxDonorDegree,maxAcceptorDegree:this.maxAcceptorDegree,
      maxTotalDegree:this.maxTotalDegree,
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
    this.canvas.dataset.model='rigid-four-patch-monolayer-water';
    this.canvas.dataset.moleculeCount='250';
    this.canvas.dataset.spatialIndex='cell-verlet';
    this.canvas.dataset.boundary='periodic-xy';
    this.canvas.dataset.ensemble='hybrid-npt-langevin-metropolis';
    this.canvas.dataset.barostat='metropolis-area-npt';
    this.canvas.dataset.pressureCoupling='pconf-times-area-times-5A-width';
    this.canvas.dataset.pressureEstimator='2d-virial-over-effective-confinement-volume';
    this.canvas.dataset.temperatureCoupling='physical-kbt-langevin-plus-metropolis';
    this.canvas.dataset.potential='continuous-conservative-four-patch';
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
    const t=Number(this.tempInput?.value)||240;
    const p=Number(this.pressureInput?.value)||0;
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
    const half=this.md?.domainHalf??2.4657;
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
    ctx.strokeStyle=dark?'rgba(167,211,224,.38)':'rgba(42,103,123,.34)';
    for(const bond of this.md.bonds.values()){
      const donor=this.md.molecules[bond.donorId];
      const acceptor=this.md.molecules[bond.acceptorId];
      const h=this.md.hydrogenSites(donor)[bond.donorIndex];
      const dx=this.md.minimumImage(acceptor.x-h.x);
      const dy=this.md.minimumImage(acceptor.y-h.y);
      const a=this.toCanvas(h.x,h.y,view);
      const b=this.toCanvas(h.x+dx,h.y+dy,view);
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
      const p=this.toCanvas(h.x,h.y,view);
      ctx.moveTo(p.x+hRadius,p.y);ctx.arc(p.x,p.y,hRadius,0,Math.PI*2);
    }
    ctx.fill();

    ctx.fillStyle='#d94b43';ctx.beginPath();
    for(const m of this.md.molecules){
      const p=this.toCanvas(m.x,m.y,view);
      ctx.moveTo(p.x+oRadius,p.y);ctx.arc(p.x,p.y,oRadius,0,Math.PI*2);
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
    this.canvas.dataset.bondsPerMolecule=d.bondsPerMolecule.toFixed(3);
    this.canvas.dataset.meanDegree=d.meanDegree.toFixed(3);
    this.canvas.dataset.neighborPairs=String(d.neighborPairs);
    this.canvas.dataset.neighborRebuilds=String(d.neighborRebuilds);
    this.canvas.dataset.cellsPerAxis=String(d.cellsPerAxis);
    this.canvas.dataset.averageNeighbors=d.averageNeighbors.toFixed(2);
    this.canvas.dataset.domainHalf=d.domainHalf.toFixed(4);
    this.canvas.dataset.boxArea=d.area.toFixed(4);
    this.canvas.dataset.arealDensity=d.arealDensity.toFixed(4);
    this.canvas.dataset.temperatureK=String(Math.round(d.temperatureKelvin));
    this.canvas.dataset.kbt=d.kBT.toFixed(5);
    this.canvas.dataset.pressureGpa=d.pressureGPa.toFixed(1);
    this.canvas.dataset.measuredPressureGpa=d.virialPressureGPa.toFixed(2);
    this.canvas.dataset.pressureWorkScale=d.pressureWorkScale.toFixed(6);
    this.canvas.dataset.confinementWidthNm=d.confinementWidthNm.toFixed(3);
    this.canvas.dataset.hbondThermalRatio=d.hBondThermalRatio.toFixed(3);
    this.canvas.dataset.potentialEnergyPerMolecule=d.potentialEnergyPerMolecule.toFixed(4);
    this.canvas.dataset.areaMoveAttempts=String(d.areaMoveAttempts);
    this.canvas.dataset.areaMoveAccepted=String(d.areaMoveAccepted);
    this.canvas.dataset.areaMoveAcceptance=d.areaAcceptance.toFixed(3);
    this.canvas.dataset.areaLogStep=d.areaLogStep.toFixed(5);
    this.canvas.dataset.orientationMoveAttempts=String(d.orientationMoveAttempts);
    this.canvas.dataset.orientationMoveAcceptance=d.orientationAcceptance.toFixed(3);
    this.canvas.dataset.pressureRelaxationRemaining=String(d.pressureRelaxationMoves);
    this.canvas.dataset.orientationRelaxationRemaining=String(d.orientationRelaxationMoves);
    this.canvas.dataset.temperatureRescales=String(d.temperatureRescales);
    this.canvas.dataset.meanSpeed=d.meanSpeed.toFixed(5);
    this.canvas.dataset.meanAngularSpeed=d.meanAngularSpeed.toFixed(5);
    this.canvas.dataset.maxTotalDegree=String(d.maxTotalDegree);

    if(this.measuredPressureOutput){
      this.measuredPressureOutput.textContent=d.virialPressureGPa.toFixed(1)+' GPa';
    }
    if(this.densityOutput)this.densityOutput.textContent=d.arealDensity.toFixed(2);
    if(this.status){
      this.status.textContent=
        d.bonds+' H-bonds · degree '+d.meanDegree.toFixed(2)+
        ' · area MC '+Math.round(d.areaAcceptance*100)+'%';
    }
  }

  frame(now){
    const elapsed=Math.min(.05,Math.max(0,(now-this.last)/1000));this.last=now;
    const active=this.visible&&this.host?.dataset.scene==='1'&&this.host?.dataset.paused!=='true';
    if(active){
      this.ensureSimulation();
      this.accumulator=Math.min(this.accumulator+elapsed,this.md.dt*7);
      let steps=0;
      while(this.accumulator>=this.md.dt&&steps<7){
        this.md.integrate();
        this.accumulator-=this.md.dt;
        steps++;
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
