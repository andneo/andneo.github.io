const WATER_ANGLE=104.5*Math.PI/180;
const HALF_WATER_ANGLE=WATER_ANGLE*.5;
const KB_KJ_MOL_K=0.00831446261815324;
const GPA_NM3_TO_KJ_MOL=602.214076;

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function wrapAngle(a){
  while(a>Math.PI)a-=Math.PI*2;
  while(a<=-Math.PI)a+=Math.PI*2;
  return a;
}
// Quaternion rotates molecule-frame vectors into the lab frame.
function rotateVector(q,x,y,z){
  const tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
  return {
    x:x+q.w*tx+q.y*tz-q.z*ty,
    y:y+q.w*ty+q.z*tx-q.x*tz,
    z:z+q.w*tz+q.x*ty-q.y*tx,
  };
}
function cross(a,b){
  return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
}

export class MonolayerWaterMD{
  constructor(options={}){
    this.count=options.count??250;
    this.temperatureKelvin=options.temperatureKelvin??240;
    this.pressureGPa=options.pressureGPa??1;
    this.kBT=KB_KJ_MOL_K*this.temperatureKelvin;

    // Coarse-grained oxygen-network MD. Positions and velocities evolve
    // continuously under forces derived from one smooth potential energy.
    // The potential has competing 3-fold and 4-fold coordination basins:
    // pressure can therefore favour denser square/rhombic-like local order
    // without rewarding 5-6 fold close packing.
    this.dt=.004;
    this.mass=18.015;
    // The noisy Langevin bath remains fluctuation-dissipation consistent.
    // Higher temporary friction dissipates the large strain energy
    // present in randomly seeded initial configurations.
    this.gamma=8.0;
    this.thermalizationGamma=32.0;
    this.thermalizationLength=160;
    this.thermalizationRemaining=this.thermalizationLength;
    // 2D centre-of-mass translations, but full SO(3) rigid rotations.
    // Isotropic effective inertia is phenomenological, not a water tensor.
    this.rotInertia=.012;
    // Rotational Langevin friction (ps^-1 in the effective units).
    // Reduces unbound rotational diffusion without artificially cooling
    // the rotational kinetic degrees of freedom.
    this.rotGamma=8;
    this.ohLength=.0957;
    this.hbDepth=13;
    // s=2.4 suppresses the restoring torque at a formed donor contact
    // by exp(-2.4); s=0.6 retains valence saturation without making
    // the low-temperature bonds nearly free rotors.
    this.hbSaturation=.6;
    this.hbDonorSharpness=4;
    this.hbAcceptorSharpness=1.6;
    this.hbAcceptorPenalty=3;
    this.hhCore=.155;
    this.hhStiffness=480;

    // Reduced O-O repulsion calibrated to preserve the *geometric*
    // low-pressure reference lattice, not a transferable TIP4P sigma.
    this.ooSigma=.252;
    this.ooEpsilon=5.0;
    this.ooCutoff=Math.pow(2,1/6)*this.ooSigma;
    this.networkOn=.300;
    this.networkOff=.360;
    this.networkBondDepth=1.0;
    this.oxygenRingCutoff=.35;
    this.ringCounts={three:0,four:0,five:0,six:0,seven:0,other:0};
    this.geometricRingCount=0;
    this.meanGeometricDegree=0;
    this.rotationCorrelationLagSteps=160;
    this.rotationCorrelation=1;
    this.rotationReference=null;
    this.coordK3=8.0;
    this.coordK4=3.2;
    this.coord4Offset=6.7;
    // Quadratic valence penalty, replacing the almost-flat quartic
    // immediately above coordination four.
    this.overCoordK=80.0;
    this.orient3Depth=2.2;
    this.orient4Depth=2.0;
    this.softMinWidth=.55;
    // Soft oxygen shell, no artificial ring-size or crystalline template.
    this.anglePenaltyK=80.0;
    this.anglePenaltyCos=Math.cos(80*Math.PI/180);
    this.radialDepth=1.5;
    this.radialCenter=.282;
    this.radialWidth=.038;
    this.mixedCoordinationK=.8;
    this.mixedCoordinationSteepness=10;

    this.skin=.100;
    this.listCutoff=this.networkOff+this.skin;
    this.neighborPairs=[];
    this.neighborsOf=Array.from({length:this.count},()=>[]);
    this.refX=new Float64Array(this.count);
    this.refY=new Float64Array(this.count);
    this.neighborRebuilds=0;
    this.neighborDirty=true;

    const initialArea=this.count/10.2800643033;
    // A rectangular initial cell can fill a wide visualization without
    // distorting the rendered molecules. Its shape remains fixed under P.
    this.initialAspect=clamp(Number(options.initialAspect??1),.65,1.6);
    this.cell={
      lx:Math.sqrt(initialArea*this.initialAspect),
      ly:Math.sqrt(initialArea/this.initialAspect),
      shear:0,
    };
    this.minArea=this.count/20;
    // Allow modest low-pressure dilation while keeping the largest
    // displayed physical box inside the stage with a visible margin.
    this.maxArea=this.count/(options.minArealDensity??6.5);
    // The live demonstrator starts square. Published/reference crystals
    // may use other initial cell shapes, which scale isotropically too.
    this.cellShapeMode='fixed-shape-isotropic';
    this.initialArea=initialArea;

    // The pressure control is reported as inferred confinement pressure.
    // P_conf * A * w is the work term corresponding to w = 5 A.
    this.confinementWidthNm=.50;
    this.pressureWorkScale=GPA_NM3_TO_KJ_MOL*this.confinementWidthNm;

    // Continuous weak-coupling flexible-cell barostat. It uses the
    // configurational pressure -dU/dA plus the ideal kinetic contribution.
    this.barostatInterval=16;
    this.barostatGain=.010;
    this.maxAreaLogChange=.014;
    this.cellFiniteDifference=.0016;
    this.barostatUpdates=0;
    this.pressureEstimateGPa=this.pressureGPa;
    this.pressureEstimateEMA=this.pressureGPa;
    this.shapeGradient=0;
    this.shearGradient=0;

    this.molecules=[];
    // Independent repeat runs are required for any phase-formation claim.
    this.randomState=(options.randomSeed??0x6d2b79f5)|0;
    if(this.randomState===0)this.randomState=0x6d2b79f5;
    this.stepCount=0;
    this.simTime=0;
    this.forceEvaluations=0;
    this.boostFrames=180;

    this.bonds=new Map();
    this.bondsFormed=0;
    this.bondsBroken=0;
    this.degree3Fraction=0;
    this.degree4Fraction=0;
    this.overCoordinatedFraction=0;
    this.closePackedFraction=0;
    this.meanWeightedCoordination=0;
    this.meanLocalQ3=0;
    this.meanLocalQ4=0;
    this.meanCoordination=0;
    this.networkEnergy=0;
    this.potentialEnergy=0;

    this.seed();
    this.measuredTranslationalK=0;
    this.measuredRotationalK=0;
    this.updateKineticTemperatureEMA(true);
    this.rotationReference=this.molecularFrames().map(f=>f.donors.map(v=>({...v})));
    this.rebuildNeighborList();
    this.computeForces();
    this.potentialEnergy=this.totalEnergy();
    this.updateBondNetwork(true);
    this.updateOxygenRingStatistics();
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

  setTemperatureKelvin(value){
    const next=clamp(Number(value)||240,120,500);
    if(Math.abs(next-this.temperatureKelvin)>1){
      // No instantaneous velocity rescaling: the OU stochastic bath
      // relaxes the kinetic energy naturally after a temperature change.
      this.thermalizationRemaining=this.thermalizationLength;
      this.boostFrames=Math.max(this.boostFrames,180);
    }
    this.temperatureKelvin=next;
    this.kBT=KB_KJ_MOL_K*next;
  }

  randomQuaternion(){
    // Shoemake's Haar-uniform SO(3) distribution.
    const u=this.random(),v=2*Math.PI*this.random(),w=2*Math.PI*this.random();
    return{
      x:Math.sqrt(1-u)*Math.sin(v),
      y:Math.sqrt(1-u)*Math.cos(v),
      z:Math.sqrt(u)*Math.sin(w),
      w:Math.sqrt(u)*Math.cos(w),
    };
  }
  // Exact constant-world-angular-velocity rotation, left multiplying q
  // by a unit axis-angle quaternion. No out-of-plane centre translation.
  rotateOrientation(m,wx,wy,wz,dt){
    const norm=Math.hypot(wx,wy,wz);
    if(norm<1e-15||dt===0)return;
    const a=.5*norm*dt,scale=Math.sin(a)/norm;
    const pw=Math.cos(a),px=wx*scale,py=wy*scale,pz=wz*scale;
    const q=m.q;
    const rw=pw*q.w-px*q.x-py*q.y-pz*q.z;
    const rx=pw*q.x+px*q.w+py*q.z-pz*q.y;
    const ry=pw*q.y-px*q.z+py*q.w+pz*q.x;
    const rz=pw*q.z+px*q.y-py*q.x+pz*q.w;
    const inv=1/Math.hypot(rw,rx,ry,rz);
    q.w=rw*inv;q.x=rx*inv;q.y=ry*inv;q.z=rz*inv;
  }
  molecularFrames(){
    const co=Math.cos(HALF_WATER_ANGLE),si=Math.sin(HALF_WATER_ANGLE);
    return this.molecules.map(m=>({
      bisector:rotateVector(m.q,1,0,0),
      donors:[rotateVector(m.q,co,-si,0),rotateVector(m.q,co,si,0)],
    }));
  }
  kineticTemperatures(){
    // Temperature estimates from kinetic equipartition. Remove the
    // instantaneous centre-of-mass velocity for the 2(N-1) translational
    // DOFs; each nonlinear rigid water has 3 rotational DOFs.
    let vx=0,vy=0,v2=0,w2=0;
    for(const m of this.molecules){
      vx+=m.vx;vy+=m.vy;
      v2+=m.vx*m.vx+m.vy*m.vy;
      w2+=m.wx*m.wx+m.wy*m.wy+m.wz*m.wz;
    }
    const relative=Math.max(0,v2-(vx*vx+vy*vy)/this.count);
    return{
      translationKelvin:this.mass*relative/(2*Math.max(1,this.count-1)*KB_KJ_MOL_K),
      rotationKelvin:this.rotInertia*w2/(3*this.count*KB_KJ_MOL_K),
    };
  }

  updateKineticTemperatureEMA(reset=false){
    const measurement=this.kineticTemperatures();
    const alpha=reset?1:.18;
    this.measuredTranslationalK+=
      alpha*(measurement.translationKelvin-this.measuredTranslationalK);
    this.measuredRotationalK+=
      alpha*(measurement.rotationKelvin-this.measuredRotationalK);
  }

  setPressureGPa(value){
    const next=clamp(Number(value)||0,0,6);
    if(Math.abs(next-this.pressureGPa)>.02)this.boostFrames=Math.max(this.boostFrames,220);
    this.pressureGPa=next;
  }

  area(cell=this.cell){return cell.lx*cell.ly;}

  fractional(x,y,cell=this.cell){
    const fy=y/cell.ly;
    const fx=(x-cell.shear*fy)/cell.lx;
    return{fx,fy};
  }

  cartesian(fx,fy,cell=this.cell){
    return{x:fx*cell.lx+fy*cell.shear,y:fy*cell.ly};
  }

  wrapPoint(m){
    let{fx,fy}=this.fractional(m.x,m.y);
    fx-=Math.floor(fx+.5);
    fy-=Math.floor(fy+.5);
    const p=this.cartesian(fx,fy);
    m.x=p.x;m.y=p.y;
  }

  minimumImageVector(dx,dy,cell=this.cell){
    // Component-wise rounding is exact for a rectangular cell, but is not
    // generally the shortest image in a sheared periodic cell.
    let fy=dy/cell.ly;
    let fx=(dx-cell.shear*fy)/cell.lx;
    fx-=Math.round(fx);
    fy-=Math.round(fy);
    if(Math.abs(cell.shear)<1e-12){
      return{x:fx*cell.lx,y:fy*cell.ly};
    }
    // For each of the three possible nearby y images, select the
    // optimal integer x translation directly. This gives the same
    // minimum-image distance as searching all nine neighbours for
    // the permitted aspect-ratio and shear bounds.
    let bestX=0,bestY=0,bestR2=Infinity;
    for(let sy=-1;sy<=1;sy++){
      const v=fy+sy,y=v*cell.ly;
      const xx=fx*cell.lx+v*cell.shear;
      const x=xx-Math.round(xx/cell.lx)*cell.lx;
      const r2=x*x+y*y;
      if(r2<bestR2){bestR2=r2;bestX=x;bestY=y;}
    }
    return{x:bestX,y:bestY};
  }

  distanceBetween(a,b){
    const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
    return{x:d.x,y:d.y,r:Math.hypot(d.x,d.y)};
  }

  seed(){
    const minSep=.225;
    const sigma=Math.sqrt(this.kBT/this.mass);
    for(let id=0;id<this.count;id++){
      let placed=false;
      for(let attempt=0;attempt<3500&&!placed;attempt++){
        const p=this.cartesian(this.random()-.5,this.random()-.5);
        let clear=true;
        for(const other of this.molecules){
          const d=this.minimumImageVector(p.x-other.x,p.y-other.y);
          if(Math.hypot(d.x,d.y)<minSep){clear=false;break;}
        }
        if(!clear)continue;
        this.molecules.push({
          id,x:p.x,y:p.y,
          vx:this.gaussian()*sigma,vy:this.gaussian()*sigma,
          diffX:0,diffY:0,
          fx:0,fy:0,tx:0,ty:0,tz:0,
          q:this.randomQuaternion(),
          wx:this.gaussian()*Math.sqrt(this.kBT/this.rotInertia),
          wy:this.gaussian()*Math.sqrt(this.kBT/this.rotInertia),
          wz:this.gaussian()*Math.sqrt(this.kBT/this.rotInertia),
        });
        placed=true;
      }
      if(!placed)throw new Error('Could not seed monolayer without overlap');
    }

    let vx=0,vy=0;
    for(const m of this.molecules){vx+=m.vx;vy+=m.vy;}
    vx/=this.count;vy/=this.count;
    for(const m of this.molecules){m.vx-=vx;m.vy-=vy;}
  }

  switchWeight(r){
    if(r<=this.networkOn)return 1;
    if(r>=this.networkOff)return 0;
    const x=(r-this.networkOn)/(this.networkOff-this.networkOn);
    return .5*(1+Math.cos(Math.PI*x));
  }

  switchDerivative(r){
    if(r<=this.networkOn||r>=this.networkOff)return 0;
    const width=this.networkOff-this.networkOn;
    const x=(r-this.networkOn)/width;
    return-.5*Math.PI/width*Math.sin(Math.PI*x);
  }

  wcaPotential(r){
    if(r<=1e-10)return 1e9;
    if(r>=this.ooCutoff)return 0;
    const sr=this.ooSigma/r;
    const sr6=Math.pow(sr,6);
    return 4*this.ooEpsilon*(sr6*sr6-sr6)+this.ooEpsilon;
  }

  needsNeighborRebuild(){
    if(this.neighborDirty)return true;
    const threshold=this.skin*.45;
    for(let i=0;i<this.count;i++){
      const m=this.molecules[i];
      const d=this.minimumImageVector(m.x-this.refX[i],m.y-this.refY[i]);
      if(d.x*d.x+d.y*d.y>threshold*threshold)return true;
    }
    return false;
  }

  rebuildNeighborList(){
    const pairs=[];
    const neighbors=Array.from({length:this.count},()=>[]);
    const cutoff2=this.listCutoff*this.listCutoff;
    for(let i=0;i<this.count;i++){
      const a=this.molecules[i];
      for(let j=i+1;j<this.count;j++){
        const b=this.molecules[j];
        const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
        if(d.x*d.x+d.y*d.y<cutoff2){
          pairs.push([i,j]);
          neighbors[i].push(j);
          neighbors[j].push(i);
        }
      }
      this.refX[i]=a.x;this.refY[i]=a.y;
    }
    this.neighborPairs=pairs;
    this.neighborsOf=neighbors;
    this.neighborRebuilds++;
    this.neighborDirty=false;
  }

  smoothMin(a,b){
    const w=this.softMinWidth;
    const m=Math.min(a,b);
    return m-w*Math.log(Math.exp(-(a-m)/w)+Math.exp(-(b-m)/w));
  }

  centerNetworkEnergy(i){
    const a=this.molecules[i];
    let coordination=0;
    let q3x=0,q3y=0,q4x=0,q4y=0;

    for(const j of this.neighborsOf[i]){
      const b=this.molecules[j];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const r=Math.hypot(d.x,d.y);
      const weight=this.switchWeight(r);
      if(weight<=0)continue;
      coordination+=weight;
      const angle=Math.atan2(d.y,d.x);
      q3x+=weight*Math.cos(3*angle);
      q3y+=weight*Math.sin(3*angle);
      q4x+=weight*Math.cos(4*angle);
      q4y+=weight*Math.sin(4*angle);
    }

    const norm=Math.max(.35,coordination);
    const q3=(q3x*q3x+q3y*q3y)/(norm*norm);
    const q4=(q4x*q4x+q4y*q4y)/(norm*norm);

    const e3=
      this.coordK3*(coordination-3)*(coordination-3)-
      this.orient3Depth*q3;
    const e4=
      this.coord4Offset+
      this.coordK4*(coordination-4)*(coordination-4)-
      this.orient4Depth*q4;

    let energy=this.smoothMin(e3,e4)-.5*this.networkBondDepth*coordination;
    const excess=Math.max(0,coordination-4);
    energy+=this.overCoordK*excess*excess;
    return energy;
  }

  pairRepulsionEnergy(i,j){
    return this.wcaPotential(this.distanceBetween(this.molecules[i],this.molecules[j]).r);
  }


  // Directed donor-patch to broad acceptor-hemisphere interactions.
  // The O-H geometry is literal; the acceptor is phenomenological,
  // with capacity two and no fictitious TIP4P charge site.
  directedContacts(frames=this.molecularFrames()){
    const contacts=[],donorSums=new Float64Array(2*this.count);
    const acceptSums=new Float64Array(this.count);
    const kd=this.hbDonorSharpness,ka=this.hbAcceptorSharpness;
    for(const[i,j]of this.neighborPairs){
      const d=this.distanceBetween(this.molecules[i],this.molecules[j]);
      if(d.r<1e-10)continue;
      const w=this.switchWeight(d.r);
      if(w<=0)continue;
      const radialDeriv=this.switchDerivative(d.r);
      // Oxygen centres lie in z=0; O-H vectors are fully 3D.
      for(const [donor,acceptor,nx,ny] of [
        [i,j,d.x/d.r,d.y/d.r],[j,i,-d.x/d.r,-d.y/d.r]
      ]){
        const bisector=frames[acceptor].bisector;
        const cosA=bisector.x*nx+bisector.y*ny;
        const fa=Math.exp(-ka*(1-cosA));
        for(let patch=0;patch<2;patch++){
          const arm=frames[donor].donors[patch];
          const cosD=arm.x*nx+arm.y*ny;
          const fd=Math.exp(-kd*(1-cosD));
          const score=w*fd*fa;
          if(score<=1e-10)continue;
          const inv=1/d.r,dr=radialDeriv*fd*fa;
          const gradX=dr*nx+score*inv*(
            kd*(arm.x-cosD*nx)+ka*(bisector.x-cosA*nx));
          const gradY=dr*ny+score*inv*(
            kd*(arm.y-cosD*ny)+ka*(bisector.y-cosA*ny));
          const dir={x:nx,y:ny,z:0};
          const donorCross=cross(arm,dir),acceptCross=cross(bisector,dir);
          contacts.push({
            donor,acceptor,patch,score,r:d.r,gradX,gradY,
            donorTX:score*kd*donorCross.x,
            donorTY:score*kd*donorCross.y,
            donorTZ:score*kd*donorCross.z,
            acceptTX:score*ka*acceptCross.x,
            acceptTY:score*ka*acceptCross.y,
            acceptTZ:score*ka*acceptCross.z,
          });
          donorSums[2*donor+patch]+=score;
          acceptSums[acceptor]+=score;
        }
      }
    }
    return{contacts,donorSums,acceptSums};
  }

  directionalEnergy(data=this.directedContacts()){
    let u=0;
    const saturation=this.hbSaturation;
    // A donor patch gains little additional energy from a second acceptor.
    for(const value of data.donorSums)
      u-=this.hbDepth*(-Math.expm1(-saturation*value))/saturation;
    for(const value of data.acceptSums){
      const excess=Math.max(0,value-2);
      u+=this.hbAcceptorPenalty*excess*excess;
    }
    return u;
  }

  // Effective, finite H-H excluded-volume penalty; not a TIP4P LJ term.
  // The H sites coincide with the displayed rigid O-H bonds.
  hhEnergy(forces=false,frames=this.molecularFrames()){
    const l=this.ohLength,core=this.hhCore,k=this.hhStiffness;
    let energy=0;
    for(const[i,j]of this.neighborPairs){
      const a=this.molecules[i],b=this.molecules[j];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      if(Math.hypot(d.x,d.y)>core+2*l)continue;
      for(let p=0;p<2;p++)for(let q=0;q<2;q++){
        const au=frames[i].donors[p],bu=frames[j].donors[q];
        const aa={x:l*au.x,y:l*au.y,z:l*au.z};
        const bb={x:l*bu.x,y:l*bu.y,z:l*bu.z};
        const v={x:d.x+bb.x-aa.x,y:d.y+bb.y-aa.y,z:bb.z-aa.z};
        const r=Math.hypot(v.x,v.y,v.z);
        if(r>=core)continue;
        const overlap=core-r;
        energy+=.5*k*overlap*overlap;
        if(!forces||r<1e-12)continue;
        const f=k*overlap/r;
        // Holonomic constraint: discard centre-of-mass z forces,
        // while retaining all three components of rotational torque.
        const FB={x:f*v.x,y:f*v.y,z:f*v.z};
        a.fx-=FB.x;a.fy-=FB.y;b.fx+=FB.x;b.fy+=FB.y;
        const TA=cross(aa,{x:-FB.x,y:-FB.y,z:-FB.z});
        const TB=cross(bb,FB);
        a.tx+=TA.x;a.ty+=TA.y;a.tz+=TA.z;
        b.tx+=TB.x;b.ty+=TB.y;b.tz+=TB.z;
      }
    }
    return energy;
  }

  computeDirectionalForces(frames=this.molecularFrames()){
    const d=this.directedContacts(frames),s=this.hbSaturation;
    const dg=new Float64Array(2*this.count),ag=new Float64Array(this.count);
    for(let i=0;i<dg.length;i++)dg[i]=-this.hbDepth*Math.exp(-s*d.donorSums[i]);
    for(let i=0;i<ag.length;i++)ag[i]=2*this.hbAcceptorPenalty*Math.max(0,d.acceptSums[i]-2);
    for(const c of d.contacts){
      const factor=dg[2*c.donor+c.patch]+ag[c.acceptor];
      const a=this.molecules[c.donor],b=this.molecules[c.acceptor];
      const fx=factor*c.gradX,fy=factor*c.gradY;
      a.fx+=fx;a.fy+=fy;b.fx-=fx;b.fy-=fy;
      a.tx-=factor*c.donorTX;a.ty-=factor*c.donorTY;a.tz-=factor*c.donorTZ;
      b.tx-=factor*c.acceptTX;b.ty-=factor*c.acceptTY;b.tz-=factor*c.acceptTZ;
    }
  }


  // A conservative coarse-grained oxygen network interaction. Each term
  // depends only on instantaneous distances, angles and local coordination,
  // never on a specified ring size or phase label.
  cooperativeNetworkEnergy(applyForces=false){
    const coordination=new Float64Array(this.count),edges=[];
    let energy=0;
    const radialWidth2=this.radialWidth*this.radialWidth;
    for(const [i,j] of this.neighborPairs){
      const a=this.molecules[i],b=this.molecules[j];
      const v=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const r=Math.hypot(v.x,v.y);
      if(r<1e-10)continue;
      const w=this.switchWeight(r),dw=this.switchDerivative(r);
      if(w<=0)continue;
      coordination[i]+=w;coordination[j]+=w;
      edges.push({i,j,r,dx:v.x,dy:v.y,w,dw});
      const delta=r-this.radialCenter;
      const well=Math.exp(-.5*delta*delta/radialWidth2);
      energy-=this.radialDepth*w*well;
      if(applyForces){
        const dUdr=-this.radialDepth*well*(dw-w*delta/radialWidth2);
        const fx=dUdr*v.x/r,fy=dUdr*v.y/r;
        a.fx+=fx;a.fy+=fy;b.fx-=fx;b.fy-=fy;
      }
    }
    // An effective local-coordination mixing term. Unlike coordination
    // contacts are favored; no five-sided polygons are prescribed.
    const k=this.mixedCoordinationSteepness,J=this.mixedCoordinationK;
    const p4=new Float64Array(this.count),dp4=new Float64Array(this.count);
    const dEdc=new Float64Array(this.count);
    for(let i=0;i<this.count;i++){
      const p=1/(1+Math.exp(-k*(coordination[i]-3.5)));
      p4[i]=p;dp4[i]=k*p*(1-p);
    }
    for(const edge of edges){
      const {i,j,w}=edge;
      const mix=p4[i]+p4[j]-2*p4[i]*p4[j];
      edge.mix=mix;
      energy-=J*w*mix;
      if(applyForces){
        dEdc[i]-=J*w*(1-2*p4[j])*dp4[i];
        dEdc[j]-=J*w*(1-2*p4[i])*dp4[j];
      }
    }
    if(applyForces)for(const edge of edges){
      const {i,j,r,dx,dy,dw}=edge;
      const dUdr=(-J*edge.mix+dEdc[i]+dEdc[j])*dw;
      const fx=dUdr*dx/r,fy=dUdr*dy/r;
      this.molecules[i].fx+=fx;this.molecules[i].fy+=fy;
      this.molecules[j].fx-=fx;this.molecules[j].fy-=fy;
    }
    // Smooth triplet penalty for acute angles (<80 degrees) suppresses
    // triangular local packing without encoding hex/pentagon/square rings.
    for(let i=0;i<this.count;i++){
      const a=this.molecules[i],local=[];
      for(const j of this.neighborsOf[i]){
        const b=this.molecules[j];
        const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
        const r=Math.hypot(d.x,d.y),w=this.switchWeight(r);
        if(w<=0||r<1e-10)continue;
        local.push({j,r,w,dw:this.switchDerivative(r),ux:d.x/r,uy:d.y/r});
      }
      for(let p=0;p<local.length;p++)for(let q=p+1;q<local.length;q++){
        const v=local[p],u=local[q];
        const co=v.ux*u.ux+v.uy*u.uy;
        const excess=Math.max(0,co-this.anglePenaltyCos);
        if(excess<=0)continue;
        const weight=this.anglePenaltyK*v.w*u.w;
        energy+=weight*excess*excess;
        if(!applyForces)continue;
        const base=excess*excess,deriv=2*excess;
        const g1=this.anglePenaltyK*v.dw*u.w*base;
        const g2=this.anglePenaltyK*u.dw*v.w*base;
        const h1=weight*deriv/v.r,h2=weight*deriv/u.r;
        const fx1=g1*v.ux+h1*(u.ux-co*v.ux);
        const fy1=g1*v.uy+h1*(u.uy-co*v.uy);
        const fx2=g2*u.ux+h2*(v.ux-co*u.ux);
        const fy2=g2*u.uy+h2*(v.uy-co*u.uy);
        a.fx+=fx1+fx2;a.fy+=fy1+fy2;
        this.molecules[v.j].fx-=fx1;this.molecules[v.j].fy-=fy1;
        this.molecules[u.j].fx-=fx2;this.molecules[u.j].fy-=fy2;
      }
    }
    return energy;
  }

  totalEnergy(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    let pair=0,network=0;
    for(const[ia,ib]of this.neighborPairs)pair+=this.pairRepulsionEnergy(ia,ib);
    for(let i=0;i<this.count;i++)network+=this.centerNetworkEnergy(i);
    this.networkEnergy=network;
    const frames=this.molecularFrames();
    return pair+network+this.directionalEnergy(this.directedContacts(frames))+this.hhEnergy(false,frames)+this.cooperativeNetworkEnergy();
  }

  computeForces(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    for(const m of this.molecules){m.fx=0;m.fy=0;m.tx=0;m.ty=0;m.tz=0;}

    // Pairwise oxygen repulsion.
    for(const[ia,ib]of this.neighborPairs){
      const a=this.molecules[ia],b=this.molecules[ib];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const r=Math.hypot(d.x,d.y);
      if(r<=1e-10||r>=this.ooCutoff)continue;
      const sr=this.ooSigma/r;
      const sr6=Math.pow(sr,6);
      const magnitude=24*this.ooEpsilon*(2*sr6*sr6-sr6)/r;
      const fx=magnitude*d.x/r,fy=magnitude*d.y/r;
      a.fx-=fx;a.fy-=fy;
      b.fx+=fx;b.fy+=fy;
    }

    // Many-body coordination/orientational force. For each oxygen centre,
    // analytically differentiate its smooth coordination and bond-order
    // invariants with respect to every neighbour vector.
    for(let i=0;i<this.count;i++){
      const center=this.molecules[i];
      const local=[];
      let c=0,x3=0,y3=0,x4=0,y4=0;

      for(const j of this.neighborsOf[i]){
        const other=this.molecules[j];
        const d=this.minimumImageVector(other.x-center.x,other.y-center.y);
        const r=Math.hypot(d.x,d.y);
        const w=this.switchWeight(r);
        if(w<=0||r<=1e-10)continue;
        const angle=Math.atan2(d.y,d.x);
        const c3=Math.cos(3*angle),s3=Math.sin(3*angle);
        const c4=Math.cos(4*angle),s4=Math.sin(4*angle);
        local.push({j,dx:d.x,dy:d.y,r,w,dw:this.switchDerivative(r),c3,s3,c4,s4});
        c+=w;
        x3+=w*c3;y3+=w*s3;
        x4+=w*c4;y4+=w*s4;
      }

      if(!local.length)continue;
      const norm=Math.max(.35,c);
      const norm2=norm*norm;
      const q3=(x3*x3+y3*y3)/norm2;
      const q4=(x4*x4+y4*y4)/norm2;
      const e3=this.coordK3*(c-3)*(c-3)-this.orient3Depth*q3;
      const e4=this.coord4Offset+this.coordK4*(c-4)*(c-4)-this.orient4Depth*q4;

      const minE=Math.min(e3,e4);
      const a3=Math.exp(-(e3-minE)/this.softMinWidth);
      const a4=Math.exp(-(e4-minE)/this.softMinWidth);
      const invA=1/(a3+a4);
      const p3=a3*invA,p4=a4*invA;

      const baseDc=
        p3*2*this.coordK3*(c-3)+
        p4*2*this.coordK4*(c-4)-
        .5*this.networkBondDepth+
        (c>4?2*this.overCoordK*(c-4):0);

      for(const n of local){
        const ux=n.dx/n.r,uy=n.dy/n.r;
        const dcx=n.dw*ux,dcy=n.dw*uy;
        const invR2=1/(n.r*n.r);
        const dthetaX=-n.dy*invR2;
        const dthetaY=n.dx*invR2;

        const dx3x=n.c3*dcx+n.w*(-3*n.s3)*dthetaX;
        const dx3y=n.c3*dcy+n.w*(-3*n.s3)*dthetaY;
        const dy3x=n.s3*dcx+n.w*( 3*n.c3)*dthetaX;
        const dy3y=n.s3*dcy+n.w*( 3*n.c3)*dthetaY;

        const dx4x=n.c4*dcx+n.w*(-4*n.s4)*dthetaX;
        const dx4y=n.c4*dcy+n.w*(-4*n.s4)*dthetaY;
        const dy4x=n.s4*dcx+n.w*( 4*n.c4)*dthetaX;
        const dy4y=n.s4*dcy+n.w*( 4*n.c4)*dthetaY;

        const dq3x=
          2*(x3*dx3x+y3*dy3x)/norm2-
          (c>.35?2*q3*dcx/c:0);
        const dq3y=
          2*(x3*dx3y+y3*dy3y)/norm2-
          (c>.35?2*q3*dcy/c:0);
        const dq4x=
          2*(x4*dx4x+y4*dy4x)/norm2-
          (c>.35?2*q4*dcx/c:0);
        const dq4y=
          2*(x4*dx4y+y4*dy4y)/norm2-
          (c>.35?2*q4*dcy/c:0);

        const gx=
          baseDc*dcx-
          p3*this.orient3Depth*dq3x-
          p4*this.orient4Depth*dq4x;
        const gy=
          baseDc*dcy-
          p3*this.orient3Depth*dq3y-
          p4*this.orient4Depth*dq4y;

        // Do not cap gradients: clipping would make the MD forces
        // inconsistent with the Hamiltonian and the barostat energy.
        const fx=gx,fy=gy;
        center.fx+=fx;center.fy+=fy;
        this.molecules[n.j].fx-=fx;
        this.molecules[n.j].fy-=fy;
      }
    }
    const frames=this.molecularFrames();
    this.computeDirectionalForces(frames);
    this.hhEnergy(true,frames);
    this.cooperativeNetworkEnergy(true);
    this.forceEvaluations+=this.neighborPairs.length;
  }

  fractionalSnapshot(cell=this.cell){
    return this.molecules.map(m=>this.fractional(m.x,m.y,cell));
  }

  applyCell(cell,fractions){
    this.cell={...cell};
    for(let i=0;i<this.count;i++){
      const p=this.cartesian(fractions[i].fx,fractions[i].fy);
      this.molecules[i].x=p.x;this.molecules[i].y=p.y;
    }
    this.neighborDirty=true;
    this.rebuildNeighborList();
  }

  energyInCell(cell,fractions){
    this.applyCell(cell,fractions);
    return this.totalEnergy();
  }

  evaluateCellResponse(){
    // Compute the isotropic configurational pressure, keeping the
    // periodic-cell shape (aspect ratio and lattice angle) fixed.
    const previous={...this.cell};
    const fractions=this.fractionalSnapshot(previous);
    const area=this.area(previous);
    const eps=this.cellFiniteDifference;
    const sp=Math.sqrt(1+eps),sm=Math.sqrt(1-eps);
    const Uplus=this.energyInCell({
      lx:previous.lx*sp,ly:previous.ly*sp,shear:previous.shear*sp,
    },fractions);
    const Uminus=this.energyInCell({
      lx:previous.lx*sm,ly:previous.ly*sm,shear:previous.shear*sm,
    },fractions);
    const dUdA=(Uplus-Uminus)/(2*eps*area);
    this.applyCell(previous,fractions);
    this.potentialEnergy=this.totalEnergy();
    const pressure2D=this.count*this.kBT/area-dUdA;
    return{pGPa:pressure2D/this.pressureWorkScale,oldArea:area};
  }

  updateBarostat(){
    const response=this.evaluateCellResponse();
    this.pressureEstimateGPa=response.pGPa;
    this.pressureEstimateEMA=.82*this.pressureEstimateEMA+.18*response.pGPa;
    this.shapeGradient=0;this.shearGradient=0;
    // Weak-coupling area relaxation; the target pressure never
    // determines cell area directly. No independent shear drift.
    const dlnA=clamp(
      (response.pGPa-this.pressureGPa)*this.barostatGain,
      -this.maxAreaLogChange,this.maxAreaLogChange);
    const nextArea=clamp(response.oldArea*Math.exp(dlnA),this.minArea,this.maxArea);
    const scale=Math.sqrt(nextArea/response.oldArea);
    this.lastAreaChangeFraction=nextArea/response.oldArea-1;
    if(Math.abs(scale-1)>1e-12){
      const previous={...this.cell};
      const fractions=this.fractionalSnapshot(previous);
      this.applyCell({
        lx:previous.lx*scale,ly:previous.ly*scale,
        shear:previous.shear*scale,
      },fractions);
    }
    this.barostatUpdates++;
  }

  drift(factor){
    for(const m of this.molecules){
      const dx=factor*m.vx,dy=factor*m.vy;
      m.x+=dx;m.y+=dy;
      this.rotateOrientation(m,m.wx,m.wy,m.wz,factor);
      m.diffX+=dx;m.diffY+=dy;
      this.wrapPoint(m);
    }
  }

  integrateStep(updateBonds=true){
    const half=.5*this.dt;
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.rotInertia;
      m.wy+=half*m.ty/this.rotInertia;
      m.wz+=half*m.tz/this.rotInertia;
    }

    this.drift(half);

    const fraction=this.thermalizationRemaining/this.thermalizationLength;
    const effectiveGamma=this.gamma+(this.thermalizationGamma-this.gamma)*fraction;
    const c=Math.exp(-effectiveGamma*this.dt),cr=Math.exp(-this.rotGamma*this.dt);
    this.thermalizationRemaining=Math.max(0,this.thermalizationRemaining-1);
    const sigma=Math.sqrt(this.kBT*(1-c*c)/this.mass);
    const sigmaRot=Math.sqrt(this.kBT*(1-cr*cr)/this.rotInertia);
    for(const m of this.molecules){
      m.vx=c*m.vx+sigma*this.gaussian();
      m.vy=c*m.vy+sigma*this.gaussian();
      m.wx=cr*m.wx+sigmaRot*this.gaussian();
      m.wy=cr*m.wy+sigmaRot*this.gaussian();
      m.wz=cr*m.wz+sigmaRot*this.gaussian();
    }

    this.drift(half);
    this.stepCount++;
    this.simTime+=this.dt;

    if(this.stepCount%this.barostatInterval===0)this.updateBarostat();
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    this.computeForces();

    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
      m.wx+=half*m.tx/this.rotInertia;
      m.wy+=half*m.ty/this.rotInertia;
      m.wz+=half*m.tz/this.rotInertia;
    }

    // Rebuild the rendered contact graph after every rotational MD step;
    // otherwise visually stale links can connect misoriented molecules.
    if(updateBonds)this.updateBondNetwork();
    if(this.stepCount%8===0)this.updateKineticTemperatureEMA();
    if(this.stepCount%72===0)this.updateOxygenRingStatistics();
    if(this.stepCount%this.rotationCorrelationLagSteps===0)this.updateRotationCorrelation();
    if(this.stepCount%18===0)this.potentialEnergy=this.totalEnergy();
  }

  updateBondNetwork(force=false){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const previous=this.bonds;
    // Only donor-to-acceptor aligned contacts can be displayed.
    const candidates=this.directedContacts().contacts.filter(c=>c.score>.23);
    candidates.sort((a,b)=>b.score-a.score);
    const donated=new Uint8Array(2*this.count);
    const accepted=new Uint8Array(this.count);
    const degree=new Uint8Array(this.count),next=new Map();
    for(const c of candidates){
      const slot=2*c.donor+c.patch;
      const key=Math.min(c.donor,c.acceptor)+'-'+Math.max(c.donor,c.acceptor);
      if(donated[slot]||accepted[c.acceptor]>=2||
         degree[c.donor]>=4||degree[c.acceptor]>=4||next.has(key))continue;
      donated[slot]=1;accepted[c.acceptor]++;
      degree[c.donor]++;degree[c.acceptor]++;
      next.set(key,{key,a:c.donor,b:c.acceptor,patch:c.patch,
        r:c.r,score:c.score,age:(previous.get(key)?.age??0)+1});
    }
    if(force||this.stepCount%90===0){
      for(const key of next.keys())if(!previous.has(key))this.bondsFormed++;
      for(const key of previous.keys())if(!next.has(key))this.bondsBroken++;
    }
    this.bonds=next;
    let d3=0,d4=0,sum=0;
    for(const d of degree){
      sum+=d;if(d===3)d3++;if(d===4)d4++;
    }
    this.meanCoordination=sum/this.count;
    this.degree3Fraction=d3/this.count;
    this.degree4Fraction=d4/this.count;
    if(force||this.stepCount%6===0)this.updateStructuralDiagnostics();
  }

  updateRotationCorrelation(){
    // C1(t) = average OH-vector autocorrelation over a fixed lag.
    // Measures orientational memory, not instantaneous angular velocity.
    const frames=this.molecularFrames();
    if(this.rotationReference){
      let sum=0;
      for(let i=0;i<this.count;i++)for(let h=0;h<2;h++){
        const a=this.rotationReference[i][h],b=frames[i].donors[h];
        sum+=a.x*b.x+a.y*b.y+a.z*b.z;
      }
      this.rotationCorrelation=sum/(2*this.count);
    }
    this.rotationReference=frames.map(f=>f.donors.map(v=>({...v})));
  }

  updateOxygenRingStatistics(){
    // Geometric oxygen-neighbour topology, independent of the
    // directed H-bond graph and its donor/acceptor saturation.
    // The 0.35 nm shell cut distinguishes the published hexagonal,
    // pentagonal and square reference networks; it is not an
    // atomistic hydrogen-bond criterion or a phase classifier.
    const adj=Array.from({length:this.count},()=>[]);
    for(const[i,j]of this.neighborPairs){
      const a=this.molecules[i],b=this.molecules[j];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const r=Math.hypot(d.x,d.y);
      if(r>=this.oxygenRingCutoff||r<1e-10)continue;
      adj[i].push({j,dx:d.x,dy:d.y,angle:Math.atan2(d.y,d.x)});
      adj[j].push({j:i,dx:-d.x,dy:-d.y,angle:Math.atan2(-d.y,-d.x)});
    }
    for(const edges of adj)edges.sort((a,b)=>a.angle-b.angle);
    const edgeCount=adj.reduce((sum,edges)=>sum+edges.length,0)/2;
    this.meanGeometricDegree=2*edgeCount/this.count;
    const visited=new Set(),counts=new Uint16Array(13);
    const maxIterations=Math.max(2,2*edgeCount+1);
    for(let i=0;i<this.count;i++)for(const first of adj[i]){
      const startKey=i+'-'+first.j;
      if(visited.has(startKey))continue;
      let a=i,b=first.j,x=0,y=0,area2=0,length=0,closed=false;
      const vertices=[i];
      for(let step=0;step<maxIterations;step++){
        const e=adj[a].find(v=>v.j===b);
        if(!e)break;
        visited.add(a+'-'+b);
        area2+=x*e.dy-y*e.dx;
        x+=e.dx;y+=e.dy;length++;vertices.push(b);
        const out=adj[b],back=out.findIndex(v=>v.j===a);
        if(back<0)break;
        const next=out[(back-1+out.length)%out.length].j;
        if(b===i&&next===first.j){closed=true;break;}
        a=b;b=next;
        if(visited.has(a+'-'+b))break;
      }
      if(!closed||length<3||length>12||
         Math.hypot(x,y)>1e-5||area2<=1e-8||
         new Set(vertices.slice(0,-1)).size!==length)continue;
      counts[length]++;
    }
    this.ringCounts={
      three:counts[3],four:counts[4],five:counts[5],
      six:counts[6],seven:counts[7],
      other:counts[8]+counts[9]+counts[10]+counts[11]+counts[12],
    };
    this.geometricRingCount=Object.values(this.ringCounts).reduce((a,b)=>a+b,0);
  }

  updateStructuralDiagnostics(){
    // Measure uncapped oxygen coordination independently of the graph
    // used for display. The displayed graph has a four-edge limit and
    // cannot itself diagnose overcoordination in the Hamiltonian.
    let weightedSum=0,weightedOver=0,hardOver=0,q3Sum=0,q4Sum=0;
    for(let i=0;i<this.count;i++){
      const a=this.molecules[i];
      let c=0,hard=0,x3=0,y3=0,x4=0,y4=0;
      for(const j of this.neighborsOf[i]){
        const b=this.molecules[j];
        const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
        const r=Math.hypot(d.x,d.y);
        if(r<this.networkOn)hard++;
        const w=this.switchWeight(r);
        if(w<=0)continue;
        c+=w;
        const angle=Math.atan2(d.y,d.x);
        x3+=w*Math.cos(3*angle);y3+=w*Math.sin(3*angle);
        x4+=w*Math.cos(4*angle);y4+=w*Math.sin(4*angle);
      }
      weightedSum+=c;
      if(c>4.05)weightedOver++;
      if(hard>=5)hardOver++;
      if(c>=2.5){
        q3Sum+=Math.hypot(x3,y3)/c;
        q4Sum+=Math.hypot(x4,y4)/c;
      }
    }
    this.meanWeightedCoordination=weightedSum/this.count;
    this.overCoordinatedFraction=weightedOver/this.count;
    this.closePackedFraction=hardOver/this.count;
    this.meanLocalQ3=q3Sum/this.count;
    this.meanLocalQ4=q4Sum/this.count;
  }

  advance(substeps=3){
    // Rendering graph and ring diagnostics do not enter the Hamiltonian.
    // Recompute H-bond display once after all frame substeps, so every
    // rendered edge matches the most recent 3D molecular orientations.
    for(let i=0;i<substeps;i++)this.integrateStep(false);
    this.updateBondNetwork();
    if(this.boostFrames>0)this.boostFrames--;
  }

  diagnostics(){
    const area=this.area();
    let speed=0,angularSpeed=0,outOfPlane=0,quatError=0,msd=0;
    const frames=this.molecularFrames();
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      angularSpeed+=Math.hypot(m.wx,m.wy,m.wz);
      const h=frames[m.id].donors;
      outOfPlane+=(Math.abs(h[0].z)+Math.abs(h[1].z))*.5;
      quatError=Math.max(quatError,Math.abs(Math.hypot(m.q.w,m.q.x,m.q.y,m.q.z)-1));
      msd+=m.diffX*m.diffX+m.diffY*m.diffY;
    }
    speed/=this.count;angularSpeed/=this.count;
    outOfPlane/=this.count;msd/=this.count;
    return{
      steps:this.stepCount,simTime:this.simTime,
      bonds:this.bonds.size,
      bondsPerMolecule:this.bonds.size/this.count,
      meanDegree:this.meanCoordination,
      degree3Fraction:this.degree3Fraction,
      degree4Fraction:this.degree4Fraction,
      overCoordinatedFraction:this.overCoordinatedFraction,
      closePackedFraction:this.closePackedFraction,
      meanWeightedCoordination:this.meanWeightedCoordination,
      meanLocalQ3:this.meanLocalQ3,
      meanLocalQ4:this.meanLocalQ4,
      ring3:this.ringCounts.three,
      ring4:this.ringCounts.four,
      ring5:this.ringCounts.five,
      ring6:this.ringCounts.six,
      ring7:this.ringCounts.seven,
      geometricRingCount:this.geometricRingCount,
      meanGeometricDegree:this.meanGeometricDegree,
      oxygenRingCutoff:this.oxygenRingCutoff,
      orientationalC1:this.rotationCorrelation,
      orientationLagTime:this.rotationCorrelationLagSteps*this.dt,
      meanSpeed:speed,meanAngularSpeed:angularSpeed,
      meanOutOfPlane:outOfPlane,maxQuaternionNormError:quatError,msd,
      diffusionProxy:this.simTime>0?msd/(4*this.simTime):0,
      area,arealDensity:this.count/area,
      cellLx:this.cell.lx,cellLy:this.cell.ly,cellShear:this.cell.shear,
      cellAspect:this.cell.lx/this.cell.ly,
      temperatureKelvin:this.temperatureKelvin,kBT:this.kBT,
      kineticTranslationK:this.measuredTranslationalK,
      kineticRotationK:this.measuredRotationalK,
      thermalizationRemaining:this.thermalizationRemaining,
      pressureGPa:this.pressureGPa,
      pressureEstimateGPa:this.pressureEstimateEMA,
      potentialEnergyPerMolecule:this.potentialEnergy/this.count,
      networkEnergyPerMolecule:this.networkEnergy/this.count,
      neighborPairs:this.neighborPairs.length,
      neighborRebuilds:this.neighborRebuilds,
      averageNeighbors:this.neighborPairs.length*2/this.count,
      forceEvaluations:this.forceEvaluations,
      barostatUpdates:this.barostatUpdates,
      shapeGradient:this.shapeGradient,
      shearGradient:this.shearGradient,
      pressureWorkScale:this.pressureWorkScale,
      confinementWidthNm:this.confinementWidthNm,
      boostFrames:this.boostFrames,
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
    this.areaOutput=this.host?.querySelector('[data-monolayer-area]');
    this.densityChangeOutput=this.host?.querySelector('[data-monolayer-density-change]');
    this.densityBar=this.host?.querySelector('[data-monolayer-density-meter]');
    this.translationalTemperatureOutput=this.host?.querySelector('[data-monolayer-kinetic-translation]');
    this.rotationalTemperatureOutput=this.host?.querySelector('[data-monolayer-kinetic-rotation]');
    this.thermalStateOutput=this.host?.querySelector('[data-monolayer-thermal-state]');
    this.thermoPanel=this.host?.querySelector('[data-monolayer-controls]');
    this.stageControls=this.host?.querySelector('.water-story__controls');
    this.cachedSimulationFrame=null;
    this.status=this.host?.querySelector('[data-monolayer-status]');
    this.md=null;
    this.width=1;this.height=1;this.dpr=1;this.visible=true;this.frameCount=0;
    this.averageMDStepMs=0;
    this.resize=this.resize.bind(this);this.frame=this.frame.bind(this);
    this.tempInput?.addEventListener('input',()=>this.updateControls());
    this.pressureInput?.addEventListener('input',()=>this.updateControls());
    this.ro=new ResizeObserver(this.resize);
    if(this.stage)this.ro.observe(this.stage);
    if(this.thermoPanel)this.ro.observe(this.thermoPanel);
    if(this.stageControls)this.ro.observe(this.stageControls);
    this.io=new IntersectionObserver(entries=>{this.visible=entries[0]?.isIntersecting??true;},{threshold:.01});
    this.io.observe(this.canvas);

    this.resize();this.paintIdle();
    this.canvas.dataset.renderer='monolayer-network-md';
    this.canvas.dataset.model='pseudo-2d-cooperative-network-water-md-v9';
    this.canvas.dataset.moleculeCount='400';
    this.canvas.dataset.initialAspectMode='viewport-fit-at-initialization';
    this.canvas.dataset.spatialIndex='verlet-neighbor-list';
    this.canvas.dataset.boundary='periodic-fixed-shape-cell';
    this.canvas.dataset.cellShapeMode='fixed-shape-isotropic';
    this.canvas.dataset.renderScale='container-fit-uniform';
    this.canvas.dataset.ensemble='langevin-md-weak-pressure-control';
    this.canvas.dataset.barostat='isotropic-area-weak-coupling';
    this.canvas.dataset.pressureCoupling='configurational-pressure-plus-ideal-term';
    this.canvas.dataset.pressureEstimator='finite-difference-configurational';
    this.canvas.dataset.temperatureCoupling='langevin-staged-friction-kbt';
    this.canvas.dataset.potential='directional-hbond-plus-cooperative-oxygen-network';
    this.canvas.dataset.dynamics='planar-translation-3d-rigid-rotation';
    this.canvas.dataset.translation='planar-xy';
    this.canvas.dataset.orientation='quaternion-3d';
    this.canvas.dataset.bondCriterion='donor-acceptor-orientation';
    this.canvas.dataset.viewFill='stage-margin';
    requestAnimationFrame(this.frame);
  }

  ensureSimulation(){
    if(this.md)return;
    const frame=this.simulationFrame();
    const aspect=clamp((frame.right-frame.left)/(frame.bottom-frame.top),.65,1.6);
    this.md=new MonolayerWaterMD({
      count:400,
      initialAspect:aspect,
      minArealDensity:8.5,
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
    if(this.pressureOutput)this.pressureOutput.textContent=p.toFixed(2)+' GPa';
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
    this.cachedSimulationFrame=this.calculateSimulationFrame();
    if(this.md){this.draw();this.updateDiagnostics();}else this.paintIdle();
  }

  calculateSimulationFrame(){
    // Reserve the measured slider panel and bottom navigation, not
    // approximate fractions of the stage, when finding free canvas space.
    const width=this.width,height=this.height;
    const margin=clamp(Math.min(width,height)*.027,12,22);
    const gap=Math.max(12,margin);
    const stageRect=this.stage?.getBoundingClientRect();
    const panel=this.thermoPanel?.getBoundingClientRect();
    const controls=this.stageControls?.getBoundingClientRect();
    const panelRight=stageRect&&panel?panel.right-stageRect.left:width*.30;
    const panelBottom=stageRect&&panel?panel.bottom-stageRect.top:height*.40;
    const navTop=stageRect&&controls?controls.top-stageRect.top:height*.94;
    const bottom=Math.min(height-margin,navTop-gap);
    const candidates=[
      {left:Math.max(margin,panelRight+gap),right:width-margin,
       top:margin,bottom},
      {left:margin,right:width-margin,
       top:Math.max(margin,panelBottom+gap),bottom},
    ].filter(r=>r.right-r.left>=90&&r.bottom-r.top>=80);
    if(!candidates.length){
      const top=Math.min(height-margin,panelBottom+gap);
      return{left:margin,right:width-margin,top,bottom:Math.max(top,bottom)};
    }
    const maxArea=this.md?.maxArea??400/8.5;
    const aspect=this.md?.initialAspect??1;
    const maxLx=Math.sqrt(maxArea*aspect),maxLy=Math.sqrt(maxArea/aspect);
    const fit=r=>Math.min((r.right-r.left)/maxLx,(r.bottom-r.top)/maxLy);
    return candidates.reduce((best,r)=>fit(r)>fit(best)?r:best);
  }

  simulationFrame(){
    return this.cachedSimulationFrame??this.calculateSimulationFrame();
  }

  view(){
    // A resize changes only pixels per nm and camera position; neither
    // physical area nor molecular geometry or target pressure is changed.
    const region=this.simulationFrame();
    const maxArea=this.md?.maxArea??400/8.5;
    const aspect=this.md?.initialAspect??1;
    const maxLx=Math.sqrt(maxArea*aspect);
    const maxLy=Math.sqrt(maxArea/aspect);
    const scale=Math.max(0,Math.min(
      (region.right-region.left)/maxLx,
      (region.bottom-region.top)/maxLy));
    return{cx:(region.left+region.right)/2,
      cy:(region.top+region.bottom)/2,scale};
  }

  toCanvas(x,y,view){return{x:view.cx+x*view.scale,y:view.cy-y*view.scale};}

  cellCorners(view){
    const c=this.md.cell;
    return[
      this.toCanvas(-c.lx/2-c.shear/2,-c.ly/2,view),
      this.toCanvas( c.lx/2-c.shear/2,-c.ly/2,view),
      this.toCanvas( c.lx/2+c.shear/2, c.ly/2,view),
      this.toCanvas(-c.lx/2+c.shear/2, c.ly/2,view),
    ];
  }

  clipCell(ctx,corners){
    ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
    for(let i=1;i<corners.length;i++)ctx.lineTo(corners[i].x,corners[i].y);
    ctx.closePath();ctx.clip();
  }

  paintIdle(){
    const dark=document.documentElement.dataset.theme==='dark';
    this.ctx.fillStyle=dark?'#111a20':'#dfe9ec';
    this.ctx.fillRect(0,0,this.width,this.height);
  }

  draw(){
    const ctx=this.ctx,view=this.view(),dark=document.documentElement.dataset.theme==='dark';
    const corners=this.cellCorners(view);
    ctx.fillStyle=dark?'#111a20':'#dfe9ec';ctx.fillRect(0,0,this.width,this.height);

    const radius=Math.min(this.height*.68,this.width*.46);
    const glow=ctx.createRadialGradient(view.cx,view.cy,0,view.cx,view.cy,radius);
    glow.addColorStop(0,dark?'rgba(50,75,84,.50)':'rgba(176,203,211,.68)');
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,this.width,this.height);

    ctx.save();this.clipCell(ctx,corners);
    ctx.fillStyle=dark?'rgba(12,24,30,.82)':'rgba(225,238,241,.91)';
    ctx.fillRect(0,0,this.width,this.height);

    const frames=this.md.molecularFrames(),oh=this.md.ohLength;
    ctx.lineWidth=1;ctx.setLineDash([4,3]);
    ctx.strokeStyle=dark?'rgba(167,211,224,.40)':'rgba(42,103,123,.35)';
    for(const bond of this.md.bonds.values()){
      const a=this.md.molecules[bond.a],b=this.md.molecules[bond.b];
      const d=this.md.minimumImageVector(b.x-a.x,b.y-a.y);
      const arm=frames[bond.a].donors[bond.patch];
      const p=this.toCanvas(a.x+oh*arm.x,a.y+oh*arm.y,view);
      const q=this.toCanvas(a.x+d.x,a.y+d.y,view);
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
    }
    ctx.setLineDash([]);

    // Top-down projection of rigid 3D O-H bonds. Positive and negative
    // z are encoded by contrasting H opacity/size, never by moving oxygens.
    const hRadius=clamp(view.scale*.009,1.05,2.05);
    const oRadius=clamp(view.scale*.017,2.05,3.75);
    ctx.strokeStyle=dark?'rgba(236,241,240,.68)':'rgba(80,92,94,.58)';
    ctx.lineWidth=1;
    for(let i=0;i<this.md.count;i++){
      const m=this.md.molecules[i],o=this.toCanvas(m.x,m.y,view);
      for(const arm of frames[i].donors){
        const h=this.toCanvas(m.x+oh*arm.x,m.y+oh*arm.y,view);
        ctx.globalAlpha=.45+.45*(arm.z+1)*.5;
        ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(h.x,h.y);ctx.stroke();
      }
    }
    const drawHydrogenLayer=(above)=>{
      for(let i=0;i<this.md.count;i++){
        const m=this.md.molecules[i];
        for(const arm of frames[i].donors){
          if((arm.z>=0)!==above)continue;
          const h=this.toCanvas(m.x+oh*arm.x,m.y+oh*arm.y,view);
          ctx.globalAlpha=above?.95:.48;
          ctx.fillStyle=dark?'#f1eee7':'#fffdf7';
          const radius=hRadius*(above?1.1:.8);
          ctx.beginPath();ctx.arc(h.x,h.y,radius,0,Math.PI*2);ctx.fill();
        }
      }
    };
    drawHydrogenLayer(false);
    ctx.globalAlpha=1;
    ctx.fillStyle='#d94b43';ctx.beginPath();
    for(const m of this.md.molecules){
      const p=this.toCanvas(m.x,m.y,view);
      ctx.moveTo(p.x+oRadius,p.y);ctx.arc(p.x,p.y,oRadius,0,Math.PI*2);
    }
    ctx.fill();
    drawHydrogenLayer(true);
    ctx.globalAlpha=1;
    ctx.restore();

    ctx.strokeStyle=dark?'rgba(197,220,226,.17)':'rgba(50,94,108,.18)';
    ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
    for(let i=1;i<corners.length;i++)ctx.lineTo(corners[i].x,corners[i].y);
    ctx.closePath();ctx.stroke();
  }

  updateDiagnostics(){
    if(!this.md)return;
    const d=this.md.diagnostics();
    this.canvas.dataset.mdSteps=String(d.steps);
    this.canvas.dataset.simTime=d.simTime.toFixed(4);
    this.canvas.dataset.hydrogenBonds=String(d.bonds);
    this.canvas.dataset.bondsPerMolecule=d.bondsPerMolecule.toFixed(3);
    this.canvas.dataset.meanDegree=d.meanDegree.toFixed(3);
    this.canvas.dataset.degree3Fraction=d.degree3Fraction.toFixed(3);
    this.canvas.dataset.degree4Fraction=d.degree4Fraction.toFixed(3);
    this.canvas.dataset.overcoordinatedFraction=d.overCoordinatedFraction.toFixed(3);
    this.canvas.dataset.closePackedFraction=d.closePackedFraction.toFixed(3);
    this.canvas.dataset.meanWeightedCoordination=d.meanWeightedCoordination.toFixed(3);
    this.canvas.dataset.meanLocalQ3=d.meanLocalQ3.toFixed(3);
    this.canvas.dataset.meanLocalQ4=d.meanLocalQ4.toFixed(3);
    this.canvas.dataset.oxygenRing3=String(d.ring3);
    this.canvas.dataset.oxygenRing4=String(d.ring4);
    this.canvas.dataset.oxygenRing5=String(d.ring5);
    this.canvas.dataset.oxygenRing6=String(d.ring6);
    this.canvas.dataset.oxygenRing7=String(d.ring7);
    this.canvas.dataset.oxygenRingCutoff=d.oxygenRingCutoff.toFixed(3);
    this.canvas.dataset.meanGeometricDegree=d.meanGeometricDegree.toFixed(3);
    this.canvas.dataset.orientationalC1=d.orientationalC1.toFixed(4);
    this.canvas.dataset.orientationalLagTime=d.orientationLagTime.toFixed(3);
    this.canvas.dataset.meanSpeed=d.meanSpeed.toFixed(5);
    this.canvas.dataset.meanAngularSpeed=d.meanAngularSpeed.toFixed(5);
    this.canvas.dataset.meanOutOfPlane=d.meanOutOfPlane.toFixed(5);
    this.canvas.dataset.quaternionError=d.maxQuaternionNormError.toExponential(2);
    this.canvas.dataset.msd=d.msd.toFixed(6);
    this.canvas.dataset.diffusionProxy=d.diffusionProxy.toFixed(6);
    this.canvas.dataset.neighborPairs=String(d.neighborPairs);
    this.canvas.dataset.neighborRebuilds=String(d.neighborRebuilds);
    this.canvas.dataset.averageNeighbors=d.averageNeighbors.toFixed(2);
    this.canvas.dataset.boxArea=d.area.toFixed(4);
    this.canvas.dataset.initialAspect=this.md.initialAspect.toFixed(4);
    this.canvas.dataset.cellLx=d.cellLx.toFixed(4);
    this.canvas.dataset.cellLy=d.cellLy.toFixed(4);
    this.canvas.dataset.displayPixelsPerNm=this.view().scale.toFixed(3);
    this.canvas.dataset.arealDensity=d.arealDensity.toFixed(4);
    this.canvas.dataset.cellAspect=d.cellAspect.toFixed(4);
    this.canvas.dataset.cellShear=d.cellShear.toFixed(4);
    this.canvas.dataset.densityChangePct=(100*(d.arealDensity/(this.md.count/this.md.initialArea)-1)).toFixed(2);
    this.canvas.dataset.cellAreaChangePct=(100*(d.area/this.md.initialArea-1)).toFixed(2);
    this.canvas.dataset.temperatureK=String(Math.round(d.temperatureKelvin));
    this.canvas.dataset.kbt=d.kBT.toFixed(5);
    this.canvas.dataset.kineticTranslationK=d.kineticTranslationK.toFixed(2);
    this.canvas.dataset.kineticRotationK=d.kineticRotationK.toFixed(2);
    this.canvas.dataset.thermalizationRemaining=String(d.thermalizationRemaining);
    this.canvas.dataset.pressureGpa=d.pressureGPa.toFixed(2);
    this.canvas.dataset.measuredPressureGpa=d.pressureEstimateGPa.toFixed(2);
    this.canvas.dataset.pressureWorkScale=d.pressureWorkScale.toFixed(6);
    this.canvas.dataset.confinementWidthNm=d.confinementWidthNm.toFixed(3);
    this.canvas.dataset.potentialEnergyPerMolecule=d.potentialEnergyPerMolecule.toFixed(4);
    this.canvas.dataset.networkEnergyPerMolecule=d.networkEnergyPerMolecule.toFixed(4);
    this.canvas.dataset.forceEvaluations=String(d.forceEvaluations);
    this.canvas.dataset.barostatUpdates=String(d.barostatUpdates);
    this.canvas.dataset.boostFrames=String(d.boostFrames);

    if(this.translationalTemperatureOutput){
      this.translationalTemperatureOutput.textContent=Math.round(d.kineticTranslationK)+' K';
    }
    if(this.rotationalTemperatureOutput){
      this.rotationalTemperatureOutput.textContent=Math.round(d.kineticRotationK)+' K';
    }
    if(this.thermalStateOutput){
      this.thermalStateOutput.textContent=d.thermalizationRemaining>0?
        'equilibrating':'kinetic T';
    }
    if(this.measuredPressureOutput){
      this.measuredPressureOutput.textContent=d.pressureEstimateGPa.toFixed(2)+' GPa';
    }
    if(this.densityOutput)this.densityOutput.textContent=d.arealDensity.toFixed(2)+' nm⁻²';
    if(this.areaOutput)this.areaOutput.textContent=d.area.toFixed(2)+' nm²';
    const referenceDensity=this.md.count/this.md.initialArea;
    const deltaPct=100*(d.arealDensity/referenceDensity-1);
    if(this.densityChangeOutput){
      this.densityChangeOutput.textContent=(deltaPct>0?'+':'')+deltaPct.toFixed(1)+'%';
    }
    if(this.densityBar){
      const minDensity=this.md.count/this.md.maxArea;
      const maxDensity=this.md.count/this.md.minArea;
      const normalized=clamp((d.arealDensity-minDensity)/(maxDensity-minDensity),0,1);
      this.densityBar.style.width=(100*normalized).toFixed(1)+'%';
      this.densityBar.parentElement?.setAttribute('aria-valuenow',d.arealDensity.toFixed(2));
    }
    if(this.status){
      this.status.textContent=
        d.bonds+' H-bonds · degree '+d.meanDegree.toFixed(2)+
        ' · oxygen rings: 4='+d.ring4+' 5='+d.ring5+' 6='+d.ring6;
    }
  }

  frame(){
    const active=this.visible&&this.host?.dataset.scene==='1'&&this.host?.dataset.paused!=='true';
    if(active){
      this.ensureSimulation();
      // Adaptive physical steps per draw, based on the actual local cost.
      // The Hamiltonian and time step are unchanged: never skip forces.
      const fast=this.averageMDStepMs>0&&this.averageMDStepMs<7;
      const moderate=this.averageMDStepMs>0&&this.averageMDStepMs<13;
      const substeps=fast?3:(moderate?2:1);
      const started=performance.now();
      this.md.advance(substeps);
      const measured=(performance.now()-started)/substeps;
      this.averageMDStepMs=this.averageMDStepMs?
        .85*this.averageMDStepMs+.15*measured:measured;
      this.canvas.dataset.mdSubsteps=String(substeps);
      this.canvas.dataset.mdStepMs=this.averageMDStepMs.toFixed(2);
      this.draw();this.frameCount++;
      if(this.frameCount%6===0)this.updateDiagnostics();
    }
    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-monolayer-canvas]').forEach(canvas=>{
  if(canvas.__monolayerExplorer)return;
  canvas.__monolayerExplorer=new MonolayerExplorer(canvas);
});
