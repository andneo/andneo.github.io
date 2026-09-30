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
function circularMean(a,b){
  return Math.atan2(Math.sin(a)+Math.sin(b),Math.cos(a)+Math.cos(b));
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
    this.gamma=1.15;
    this.maxForce=420;

    this.ooSigma=.260;
    this.ooEpsilon=5.0;
    this.ooCutoff=Math.pow(2,1/6)*this.ooSigma;
    this.networkOn=.300;
    this.networkOff=.360;
    this.networkBondDepth=1.0;
    this.coordK3=3.2;
    this.coordK4=3.2;
    this.coord4Offset=3.0;
    this.overCoordK=24.0;
    this.orient3Depth=2.2;
    this.orient4Depth=2.0;
    this.softMinWidth=.55;

    this.skin=.100;
    this.listCutoff=this.networkOff+this.skin;
    this.neighborPairs=[];
    this.neighborsOf=Array.from({length:this.count},()=>[]);
    this.refX=new Float64Array(this.count);
    this.refY=new Float64Array(this.count);
    this.neighborRebuilds=0;
    this.neighborDirty=true;

    const initialArea=this.count/10.2800643033;
    const side=Math.sqrt(initialArea);
    this.cell={lx:side,ly:side,shear:0};
    this.minArea=this.count/20;
    this.maxArea=this.count/6.5;
    this.maxAspect=1.62;
    this.maxShearFraction=.34;

    // The pressure control is reported as inferred confinement pressure.
    // P_conf * A * w is the work term corresponding to w = 5 A.
    this.confinementWidthNm=.50;
    this.pressureWorkScale=GPA_NM3_TO_KJ_MOL*this.confinementWidthNm;

    // Continuous weak-coupling flexible-cell barostat. It uses the
    // configurational pressure -dU/dA plus the ideal kinetic contribution.
    this.barostatInterval=24;
    this.barostatGain=.008;
    this.maxAreaLogChange=.012;
    this.shapeGain=.0010;
    this.maxShapeLogChange=.0025;
    this.shearGain=.0009;
    this.maxShearChange=.0025;
    this.cellFiniteDifference=.0016;
    this.barostatUpdates=0;
    this.pressureEstimateGPa=this.pressureGPa;
    this.pressureEstimateEMA=this.pressureGPa;
    this.shapeGradient=0;
    this.shearGradient=0;

    this.molecules=[];
    this.randomState=0x6d2b79f5;
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
    this.meanCoordination=0;
    this.networkEnergy=0;
    this.potentialEnergy=0;

    this.seed();
    this.rebuildNeighborList();
    this.computeForces();
    this.potentialEnergy=this.totalEnergy();
    this.updateBondNetwork(true);
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
      const old=this.kBT;
      const nextKBT=KB_KJ_MOL_K*next;
      if(old>0){
        const scale=Math.sqrt(nextKBT/old);
        for(const m of this.molecules){m.vx*=scale;m.vy*=scale;}
      }
      this.boostFrames=Math.max(this.boostFrames,180);
    }
    this.temperatureKelvin=next;
    this.kBT=KB_KJ_MOL_K*next;
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
    let fy=dy/cell.ly;
    let fx=(dx-cell.shear*fy)/cell.lx;
    fx-=Math.round(fx);
    fy-=Math.round(fy);
    return{x:fx*cell.lx+fy*cell.shear,y:fy*cell.ly};
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
          fx:0,fy:0,
          visualAngle:this.random()*Math.PI*2,
          targetAngle:this.random()*Math.PI*2,
          visualOmega:this.gaussian()*.5,
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
    const excess=Math.max(0,coordination-4.05);
    energy+=this.overCoordK*Math.pow(excess,4);
    return energy;
  }

  pairRepulsionEnergy(i,j){
    return this.wcaPotential(this.distanceBetween(this.molecules[i],this.molecules[j]).r);
  }

  totalEnergy(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    let pair=0,network=0;
    for(const[ia,ib]of this.neighborPairs)pair+=this.pairRepulsionEnergy(ia,ib);
    for(let i=0;i<this.count;i++)network+=this.centerNetworkEnergy(i);
    this.networkEnergy=network;
    return pair+network;
  }

  computeForces(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    for(const m of this.molecules){m.fx=0;m.fy=0;}

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
        (c>4.05?4*this.overCoordK*Math.pow(c-4.05,3):0);

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

        const fx=clamp(gx,-this.maxForce,this.maxForce);
        const fy=clamp(gy,-this.maxForce,this.maxForce);
        center.fx+=fx;center.fy+=fy;
        this.molecules[n.j].fx-=fx;
        this.molecules[n.j].fy-=fy;
      }
    }
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
    const oldCell={...this.cell};
    const fractions=this.fractionalSnapshot(oldCell);
    const oldArea=this.area(oldCell);
    const eps=this.cellFiniteDifference;

    const isoPlusScale=Math.sqrt(1+eps);
    const isoMinusScale=Math.sqrt(1-eps);
    const plusIso={
      lx:oldCell.lx*isoPlusScale,
      ly:oldCell.ly*isoPlusScale,
      shear:oldCell.shear*isoPlusScale,
    };
    const minusIso={
      lx:oldCell.lx*isoMinusScale,
      ly:oldCell.ly*isoMinusScale,
      shear:oldCell.shear*isoMinusScale,
    };
    const uPlus=this.energyInCell(plusIso,fractions);
    const aPlus=this.area();
    const uMinus=this.energyInCell(minusIso,fractions);
    const aMinus=this.area();
    const dUdA=(uPlus-uMinus)/(aPlus-aMinus);

    const shapeEps=eps;
    const plusShape={
      lx:oldCell.lx*Math.exp(shapeEps),
      ly:oldCell.ly*Math.exp(-shapeEps),
      shear:oldCell.shear,
    };
    const minusShape={
      lx:oldCell.lx*Math.exp(-shapeEps),
      ly:oldCell.ly*Math.exp(shapeEps),
      shear:oldCell.shear,
    };
    const usPlus=this.energyInCell(plusShape,fractions);
    const usMinus=this.energyInCell(minusShape,fractions);
    const dUdShape=(usPlus-usMinus)/(2*shapeEps);

    const shearEps=eps*oldCell.ly;
    const plusShear={...oldCell,shear:oldCell.shear+shearEps};
    const minusShear={...oldCell,shear:oldCell.shear-shearEps};
    const uhPlus=this.energyInCell(plusShear,fractions);
    const uhMinus=this.energyInCell(minusShear,fractions);
    const dUdShear=(uhPlus-uhMinus)/(2*eps);

    this.applyCell(oldCell,fractions);
    this.potentialEnergy=this.totalEnergy();

    const pressure2D=this.count*this.kBT/oldArea-dUdA;
    const pGPa=pressure2D/(this.confinementWidthNm*GPA_NM3_TO_KJ_MOL);
    return{pGPa,dUdShape,dUdShear,oldArea};
  }

  updateBarostat(){
    const response=this.evaluateCellResponse();
    const error=response.pGPa-this.pressureGPa;
    this.pressureEstimateGPa=response.pGPa;
    this.pressureEstimateEMA=.82*this.pressureEstimateEMA+.18*response.pGPa;
    this.shapeGradient=response.dUdShape/this.count;
    this.shearGradient=response.dUdShear/this.count;

    const dlnA=clamp(
      error*this.barostatGain,
      -this.maxAreaLogChange,
      this.maxAreaLogChange
    );
    const dshape=clamp(
      -this.shapeGradient*this.shapeGain,
      -this.maxShapeLogChange,
      this.maxShapeLogChange
    );
    const dshearFraction=clamp(
      -this.shearGradient*this.shearGain,
      -this.maxShearChange,
      this.maxShearChange
    );

    const oldCell={...this.cell};
    const fractions=this.fractionalSnapshot(oldCell);
    const areaScale=Math.exp(.5*dlnA);
    let lx=oldCell.lx*areaScale*Math.exp(dshape);
    let ly=oldCell.ly*areaScale*Math.exp(-dshape);
    let shear=oldCell.shear*areaScale+dshearFraction*ly;

    const aspect=lx/ly;
    if(aspect>this.maxAspect){
      const target=Math.sqrt(this.maxAspect*lx*ly);
      lx=target;ly=(lx*ly)/target;
    }else if(aspect<1/this.maxAspect){
      const area=lx*ly;
      ly=Math.sqrt(area*this.maxAspect);
      lx=area/ly;
    }
    shear=clamp(shear,-this.maxShearFraction*lx,this.maxShearFraction*lx);

    const newArea=lx*ly;
    if(newArea>=this.minArea&&newArea<=this.maxArea){
      this.applyCell({lx,ly,shear},fractions);
    }else{
      this.applyCell(oldCell,fractions);
    }
    this.barostatUpdates++;
  }

  drift(factor){
    for(const m of this.molecules){
      const dx=factor*m.vx,dy=factor*m.vy;
      m.x+=dx;m.y+=dy;
      m.diffX+=dx;m.diffY+=dy;
      this.wrapPoint(m);
    }
  }

  integrateStep(){
    const half=.5*this.dt;
    for(const m of this.molecules){
      m.vx+=half*m.fx/this.mass;
      m.vy+=half*m.fy/this.mass;
    }

    this.drift(half);

    const c=Math.exp(-this.gamma*this.dt);
    const sigma=Math.sqrt(this.kBT*(1-c*c)/this.mass);
    for(const m of this.molecules){
      m.vx=c*m.vx+sigma*this.gaussian();
      m.vy=c*m.vy+sigma*this.gaussian();
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
    }

    if(this.stepCount%6===0)this.updateBondNetwork();
    if(this.stepCount%18===0)this.potentialEnergy=this.totalEnergy();
  }

  updateBondNetwork(force=false){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const previous=this.bonds;
    const candidates=[];
    for(const[ia,ib]of this.neighborPairs){
      const d=this.distanceBetween(this.molecules[ia],this.molecules[ib]);
      const weight=this.switchWeight(d.r);
      if(weight>.20)candidates.push({ia,ib,r:d.r,score:weight});
    }
    candidates.sort((a,b)=>b.score-a.score||a.r-b.r);

    const degree=new Uint8Array(this.count);
    const next=new Map();
    for(const c of candidates){
      if(degree[c.ia]>=4||degree[c.ib]>=4)continue;
      const key=c.ia+'-'+c.ib;
      degree[c.ia]++;degree[c.ib]++;
      next.set(key,{key,a:c.ia,b:c.ib,r:c.r,score:c.score,age:(previous.get(key)?.age??0)+1});
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
    this.overCoordinatedFraction=0;
    this.updateVisualTargets();
  }

  updateVisualTargets(){
    const adj=Array.from({length:this.count},()=>[]);
    for(const bond of this.bonds.values()){
      const a=this.molecules[bond.a],b=this.molecules[bond.b];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const angle=Math.atan2(d.y,d.x);
      adj[bond.a].push(angle);
      adj[bond.b].push(wrapAngle(angle+Math.PI));
    }

    for(let i=0;i<this.count;i++){
      const m=this.molecules[i],angles=adj[i];
      if(!angles.length)continue;
      let target=angles[0]-HALF_WATER_ANGLE;
      if(angles.length>=2){
        let best=Infinity,bestTarget=target;
        for(let a=0;a<angles.length;a++)for(let b=a+1;b<angles.length;b++){
          const p1=circularMean(angles[a]-HALF_WATER_ANGLE,angles[b]+HALF_WATER_ANGLE);
          const e1=Math.abs(wrapAngle(p1+HALF_WATER_ANGLE-angles[a]))+
            Math.abs(wrapAngle(p1-HALF_WATER_ANGLE-angles[b]));
          const p2=circularMean(angles[a]+HALF_WATER_ANGLE,angles[b]-HALF_WATER_ANGLE);
          const e2=Math.abs(wrapAngle(p2-HALF_WATER_ANGLE-angles[a]))+
            Math.abs(wrapAngle(p2+HALF_WATER_ANGLE-angles[b]));
          if(e1<best){best=e1;bestTarget=p1;}
          if(e2<best){best=e2;bestTarget=p2;}
        }
        target=bestTarget;
      }
      m.targetAngle=target;
    }
  }

  advanceVisualOrientations(frameDt=.016){
    const tempScale=Math.sqrt(this.temperatureKelvin/240);
    for(const m of this.molecules){
      const delta=wrapAngle(m.targetAngle-m.visualAngle);
      const noise=this.gaussian()*.12*tempScale;
      m.visualOmega+=frameDt*(10*delta-3.2*m.visualOmega+noise);
      m.visualAngle=wrapAngle(m.visualAngle+frameDt*m.visualOmega);
    }
  }

  advance(substeps=3){
    for(let i=0;i<substeps;i++)this.integrateStep();
    this.advanceVisualOrientations();
    if(this.boostFrames>0)this.boostFrames--;
  }

  diagnostics(){
    const area=this.area();
    let speed=0,msd=0;
    for(const m of this.molecules){
      speed+=Math.hypot(m.vx,m.vy);
      msd+=m.diffX*m.diffX+m.diffY*m.diffY;
    }
    speed/=this.count;msd/=this.count;
    return{
      steps:this.stepCount,simTime:this.simTime,
      bonds:this.bonds.size,
      bondsPerMolecule:this.bonds.size/this.count,
      meanDegree:this.meanCoordination,
      degree3Fraction:this.degree3Fraction,
      degree4Fraction:this.degree4Fraction,
      overCoordinatedFraction:this.overCoordinatedFraction,
      meanSpeed:speed,msd,
      diffusionProxy:this.simTime>0?msd/(4*this.simTime):0,
      area,arealDensity:this.count/area,
      cellLx:this.cell.lx,cellLy:this.cell.ly,cellShear:this.cell.shear,
      cellAspect:this.cell.lx/this.cell.ly,
      temperatureKelvin:this.temperatureKelvin,kBT:this.kBT,
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
    this.status=this.host?.querySelector('[data-monolayer-status]');
    this.md=null;
    this.width=1;this.height=1;this.dpr=1;this.visible=true;this.frameCount=0;
    this.resize=this.resize.bind(this);this.frame=this.frame.bind(this);
    this.tempInput?.addEventListener('input',()=>this.updateControls());
    this.pressureInput?.addEventListener('input',()=>this.updateControls());
    this.ro=new ResizeObserver(this.resize);if(this.stage)this.ro.observe(this.stage);
    this.io=new IntersectionObserver(entries=>{this.visible=entries[0]?.isIntersecting??true;},{threshold:.01});
    this.io.observe(this.canvas);

    this.resize();this.paintIdle();
    this.canvas.dataset.renderer='monolayer-network-md';
    this.canvas.dataset.model='smooth-multiwell-network-water-md-v3';
    this.canvas.dataset.moleculeCount='250';
    this.canvas.dataset.spatialIndex='verlet-neighbor-list';
    this.canvas.dataset.boundary='periodic-flexible-cell';
    this.canvas.dataset.ensemble='langevin-md-weak-coupling-npt';
    this.canvas.dataset.barostat='continuous-flexible-cell-weak-coupling';
    this.canvas.dataset.pressureCoupling='configurational-pressure-plus-ideal-term';
    this.canvas.dataset.pressureEstimator='finite-difference-configurational';
    this.canvas.dataset.temperatureCoupling='langevin-kbt';
    this.canvas.dataset.potential='smooth-coordination-multiwell-network';
    this.canvas.dataset.dynamics='continuous-diffusive-md';
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
    const c=this.md?.cell??{lx:4.93,ly:4.93,shear:0};
    const spanX=c.lx+Math.abs(c.shear);
    const spanY=c.ly;
    const maxWidth=this.width*(mobile?.92:.60);
    const maxHeight=this.height*(mobile?.62:.94);
    const scale=Math.min(maxWidth/spanX,maxHeight/spanY);
    const cx=mobile?this.width*.5:this.width*.70;
    const cy=mobile?this.height*.62:this.height*.50;
    return{cx,cy,scale};
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

    ctx.lineWidth=1;ctx.setLineDash([4,3]);
    ctx.strokeStyle=dark?'rgba(167,211,224,.40)':'rgba(42,103,123,.35)';
    for(const bond of this.md.bonds.values()){
      const a=this.md.molecules[bond.a],b=this.md.molecules[bond.b];
      const d=this.md.minimumImageVector(b.x-a.x,b.y-a.y);
      const p=this.toCanvas(a.x,a.y,view);
      const q=this.toCanvas(a.x+d.x,a.y+d.y,view);
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
    }
    ctx.setLineDash([]);

    const oh=.0957;
    ctx.strokeStyle=dark?'rgba(236,241,240,.68)':'rgba(80,92,94,.58)';
    ctx.lineWidth=1;
    ctx.beginPath();
    for(const m of this.md.molecules){
      const o=this.toCanvas(m.x,m.y,view);
      for(const sign of[-1,1]){
        const angle=m.visualAngle+sign*HALF_WATER_ANGLE;
        const h=this.toCanvas(m.x+Math.cos(angle)*oh,m.y+Math.sin(angle)*oh,view);
        ctx.moveTo(o.x,o.y);ctx.lineTo(h.x,h.y);
      }
    }
    ctx.stroke();

    const hRadius=clamp(view.scale*.009,1.05,2.05);
    const oRadius=clamp(view.scale*.017,2.05,3.75);
    ctx.fillStyle=dark?'#f1eee7':'#fffdf7';ctx.beginPath();
    for(const m of this.md.molecules)for(const sign of[-1,1]){
      const angle=m.visualAngle+sign*HALF_WATER_ANGLE;
      const h=this.toCanvas(m.x+Math.cos(angle)*oh,m.y+Math.sin(angle)*oh,view);
      ctx.moveTo(h.x+hRadius,h.y);ctx.arc(h.x,h.y,hRadius,0,Math.PI*2);
    }
    ctx.fill();

    ctx.fillStyle='#d94b43';ctx.beginPath();
    for(const m of this.md.molecules){
      const p=this.toCanvas(m.x,m.y,view);
      ctx.moveTo(p.x+oRadius,p.y);ctx.arc(p.x,p.y,oRadius,0,Math.PI*2);
    }
    ctx.fill();
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
    this.canvas.dataset.meanSpeed=d.meanSpeed.toFixed(5);
    this.canvas.dataset.msd=d.msd.toFixed(6);
    this.canvas.dataset.diffusionProxy=d.diffusionProxy.toFixed(6);
    this.canvas.dataset.neighborPairs=String(d.neighborPairs);
    this.canvas.dataset.neighborRebuilds=String(d.neighborRebuilds);
    this.canvas.dataset.averageNeighbors=d.averageNeighbors.toFixed(2);
    this.canvas.dataset.boxArea=d.area.toFixed(4);
    this.canvas.dataset.arealDensity=d.arealDensity.toFixed(4);
    this.canvas.dataset.cellAspect=d.cellAspect.toFixed(4);
    this.canvas.dataset.cellShear=d.cellShear.toFixed(4);
    this.canvas.dataset.temperatureK=String(Math.round(d.temperatureKelvin));
    this.canvas.dataset.kbt=d.kBT.toFixed(5);
    this.canvas.dataset.pressureGpa=d.pressureGPa.toFixed(1);
    this.canvas.dataset.measuredPressureGpa=d.pressureEstimateGPa.toFixed(2);
    this.canvas.dataset.pressureWorkScale=d.pressureWorkScale.toFixed(6);
    this.canvas.dataset.confinementWidthNm=d.confinementWidthNm.toFixed(3);
    this.canvas.dataset.potentialEnergyPerMolecule=d.potentialEnergyPerMolecule.toFixed(4);
    this.canvas.dataset.networkEnergyPerMolecule=d.networkEnergyPerMolecule.toFixed(4);
    this.canvas.dataset.forceEvaluations=String(d.forceEvaluations);
    this.canvas.dataset.barostatUpdates=String(d.barostatUpdates);
    this.canvas.dataset.boostFrames=String(d.boostFrames);

    if(this.measuredPressureOutput){
      this.measuredPressureOutput.textContent=d.pressureEstimateGPa.toFixed(1)+' GPa';
    }
    if(this.densityOutput)this.densityOutput.textContent=d.arealDensity.toFixed(2);
    if(this.status){
      this.status.textContent=
        d.bonds+' H-bonds · degree '+d.meanDegree.toFixed(2)+
        ' · D* '+d.diffusionProxy.toFixed(3);
    }
  }

  frame(){
    const active=this.visible&&this.host?.dataset.scene==='1'&&this.host?.dataset.paused!=='true';
    if(active){
      this.ensureSimulation();
      const mobile=this.width<760;
      const boosted=this.md.boostFrames>0;
      this.md.advance(mobile?(boosted?2:1):(boosted?3:2));
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
