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

    // Coarse-grained O-network Hamiltonian. The old four-patch pair model
    // rewarded every nearby donor/acceptor contact and therefore drove a
    // close-packed triangular oxygen layer. This model instead gives each
    // oxygen a low-energy three-coordinate basin, a slightly higher-energy
    // four-coordinate basin, and a steep penalty above four neighbours.
    // Pressure can therefore trade open 3-fold networks for denser 4-fold
    // networks rather than simply creating 5-6 close neighbours.
    this.ooSigma=.260;
    this.ooEpsilon=5.0;
    this.ooCutoff=Math.pow(2,1/6)*this.ooSigma;
    this.networkOn=.300;
    this.networkOff=.360;
    this.networkBondDepth=.80;
    this.coordK3=4.0;
    this.coordK4=4.0;
    this.coord4Offset=3.2;
    this.overCoordK=22.0;
    this.angularK3=2.4;
    this.angularK4=1.8;

    this.skin=.095;
    this.listCutoff=this.networkOff+this.skin;
    this.translationStep=.020;
    this.translationAttempts=0;
    this.translationAccepted=0;
    this.translationWindowAttempts=0;
    this.translationWindowAccepted=0;

    // The released 144-water structure used in the paper has an in-plane
    // density of ~10.28 waters/nm^2. Start the 250-water browser system there.
    this.initialArealDensity=10.2800643033;
    const initialArea=this.count/this.initialArealDensity;
    const side=Math.sqrt(initialArea);
    this.cell={lx:side,ly:side,shear:0};
    this.minArea=this.count/22;
    this.maxArea=this.count/6.5;
    this.maxAspect=1.62;
    this.maxShearFraction=.34;

    // P_conf * A * w is the pressure-work term corresponding to the 5 A
    // confinement width used in the paper.
    this.confinementWidthNm=.50;
    this.pressureWorkScale=GPA_NM3_TO_KJ_MOL*this.confinementWidthNm;

    this.molecules=[];
    this.neighborPairs=[];
    this.neighborsOf=Array.from({length:this.count},()=>[]);
    this.refX=new Float64Array(this.count);
    this.refY=new Float64Array(this.count);
    this.neighborRebuilds=0;
    this.neighborDirty=true;

    this.areaLogStep=.008;
    this.areaMoveAttempts=0;
    this.areaMoveAccepted=0;
    this.areaWindowAttempts=0;
    this.areaWindowAccepted=0;
    this.shapeLogStep=.010;
    this.shearStep=.012;
    this.shapeMoveAttempts=0;
    this.shapeMoveAccepted=0;

    this.moveCount=0;
    this.bonds=new Map();
    this.bondsFormed=0;
    this.bondsBroken=0;
    this.degree3Fraction=0;
    this.degree4Fraction=0;
    this.overCoordinatedFraction=0;
    this.meanCoordination=0;
    this.networkEnergy=0;
    this.potentialEnergy=0;

    this.pressureEstimateGPa=this.pressureGPa;
    this.pressureEstimateEMA=this.pressureGPa;
    this.lastPressureEstimateMove=-1e9;

    this.relaxationFrames=180;
    this.randomState=0x6d2b79f5;
    this.seed();
    this.rebuildNeighborList();
    this.potentialEnergy=this.totalEnergy();
    this.updateBondNetwork(true);
  }

  random(){
    let x=this.randomState|0;
    x^=x<<13;x^=x>>>17;x^=x<<5;
    this.randomState=x|0;
    return((x>>>0)+.5)/4294967296;
  }

  setTemperatureKelvin(value){
    const next=clamp(Number(value)||240,120,500);
    if(Math.abs(next-this.temperatureKelvin)>1)this.relaxationFrames=Math.max(this.relaxationFrames,180);
    this.temperatureKelvin=next;
    this.kBT=KB_KJ_MOL_K*next;
  }

  setPressureGPa(value){
    const next=clamp(Number(value)||0,0,6);
    if(Math.abs(next-this.pressureGPa)>.02)this.relaxationFrames=Math.max(this.relaxationFrames,220);
    this.pressureGPa=next;
  }

  area(cell=this.cell){return cell.lx*cell.ly;}
  aspect(cell=this.cell){return cell.lx/cell.ly;}

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
    const minSep=.220;
    for(let id=0;id<this.count;id++){
      let placed=false;
      for(let attempt=0;attempt<3000&&!placed;attempt++){
        const p=this.cartesian(this.random()-.5,this.random()-.5);
        let clear=true;
        for(const other of this.molecules){
          const d=this.minimumImageVector(p.x-other.x,p.y-other.y);
          if(Math.hypot(d.x,d.y)<minSep){clear=false;break;}
        }
        if(!clear)continue;
        this.molecules.push({
          id,x:p.x,y:p.y,
          visualAngle:this.random()*Math.PI*2,
          targetAngle:this.random()*Math.PI*2,
        });
        placed=true;
      }
      if(!placed)throw new Error('Could not seed monolayer without overlap');
    }
  }

  switchWeight(r){
    if(r<=this.networkOn)return 1;
    if(r>=this.networkOff)return 0;
    const x=(r-this.networkOn)/(this.networkOff-this.networkOn);
    return .5*(1+Math.cos(Math.PI*x));
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
    // For N=250, an O(N^2) rebuild is cheaper and more robust than maintaining
    // a skew-cell linked list. The expensive per-move work still uses this
    // Verlet list, so rebuilds are infrequent and force/energy locality is O(N).
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

  angularPatternEnergy(vectors,k){
    if(k<3)return 0;
    const chosen=vectors.slice().sort((a,b)=>a.r-b.r).slice(0,k);
    chosen.sort((a,b)=>a.angle-b.angle);
    const gaps=[];
    for(let i=0;i<k;i++){
      const next=i===k-1?chosen[0].angle+Math.PI*2:chosen[i+1].angle;
      gaps.push(next-chosen[i].angle);
    }
    gaps.sort((a,b)=>a-b);

    if(k===3){
      const target=2*Math.PI/3;
      let strain=0;
      for(const gap of gaps)strain+=(gap-target)*(gap-target);
      return this.angularK3*strain;
    }

    const square=[90,90,90,90].map(v=>v*Math.PI/180);
    const rhombic=[72,72,98,118].map(v=>v*Math.PI/180);
    let sq=0,rh=0;
    for(let i=0;i<4;i++){
      sq+=(gaps[i]-square[i])*(gaps[i]-square[i]);
      rh+=(gaps[i]-rhombic[i])*(gaps[i]-rhombic[i]);
    }
    return this.angularK4*Math.min(sq,rh+.06);
  }

  centerNetworkEnergy(i){
    const a=this.molecules[i];
    const vectors=[];
    let coordination=0;
    for(const j of this.neighborsOf[i]){
      const b=this.molecules[j];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const r=Math.hypot(d.x,d.y);
      const w=this.switchWeight(r);
      if(w<=0)continue;
      coordination+=w;
      vectors.push({x:d.x,y:d.y,r,weight:w,angle:Math.atan2(d.y,d.x)});
    }

    const u3=this.coordK3*(coordination-3)*(coordination-3);
    const u4=this.coord4Offset+this.coordK4*(coordination-4)*(coordination-4);
    let energy=Math.min(u3,u4)-.5*this.networkBondDepth*coordination;
    const excess=Math.max(0,coordination-4.05);
    energy+=this.overCoordK*Math.pow(excess,4);

    let k=0;
    if(coordination>=2.45&&coordination<3.55)k=3;
    else if(coordination>=3.55&&vectors.length>=4)k=4;
    if(k)energy+=this.angularPatternEnergy(vectors,k);
    return energy;
  }

  pairRepulsionEnergy(i,j){
    const d=this.distanceBetween(this.molecules[i],this.molecules[j]);
    return this.wcaPotential(d.r);
  }

  totalEnergy(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    let pair=0,network=0;
    for(const[ia,ib]of this.neighborPairs)pair+=this.pairRepulsionEnergy(ia,ib);
    for(let i=0;i<this.count;i++)network+=this.centerNetworkEnergy(i);
    this.networkEnergy=network;
    return pair+network;
  }

  localMoveEnergy(i,affected){
    let energy=0;
    for(const j of this.neighborsOf[i])energy+=this.pairRepulsionEnergy(i,j);
    for(const j of affected)energy+=this.centerNetworkEnergy(j);
    return energy;
  }

  attemptTranslationMove(){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const i=Math.floor(this.random()*this.count);
    const m=this.molecules[i];
    const affected=[i,...this.neighborsOf[i]];
    const oldEnergy=this.localMoveEnergy(i,affected);
    const ox=m.x,oy=m.y;
    m.x+= (this.random()*2-1)*this.translationStep;
    m.y+= (this.random()*2-1)*this.translationStep;
    this.wrapPoint(m);
    const newEnergy=this.localMoveEnergy(i,affected);
    const delta=newEnergy-oldEnergy;
    const accept=delta<=0||Math.log(Math.max(1e-12,this.random()))<-delta/this.kBT;

    this.translationAttempts++;
    this.translationWindowAttempts++;
    if(accept){
      this.translationAccepted++;
      this.translationWindowAccepted++;
    }else{
      m.x=ox;m.y=oy;
    }
    this.adaptTranslationStep();
    return accept;
  }

  adaptTranslationStep(){
    if(this.translationWindowAttempts<300)return;
    const rate=this.translationWindowAccepted/this.translationWindowAttempts;
    if(rate<.28)this.translationStep=Math.max(.004,this.translationStep*.88);
    else if(rate>.52)this.translationStep=Math.min(.030,this.translationStep*1.10);
    this.translationWindowAttempts=0;
    this.translationWindowAccepted=0;
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

  attemptAreaMove(){
    const oldCell={...this.cell};
    const fractions=this.fractionalSnapshot(oldCell);
    const oldArea=this.area(oldCell);
    const oldEnergy=this.totalEnergy();
    const dlnA=(this.random()*2-1)*this.areaLogStep;
    const scale=Math.exp(.5*dlnA);
    const newCell={
      lx:oldCell.lx*scale,
      ly:oldCell.ly*scale,
      shear:oldCell.shear*scale,
    };
    const newArea=this.area(newCell);
    this.areaMoveAttempts++;
    this.areaWindowAttempts++;

    if(newArea<this.minArea||newArea>this.maxArea){
      this.adaptAreaStep();return false;
    }

    this.applyCell(newCell,fractions);
    const newEnergy=this.totalEnergy();
    const pressureWork=this.pressureGPa*this.pressureWorkScale*(newArea-oldArea);
    const logAcceptance=
      -(newEnergy-oldEnergy+pressureWork)/this.kBT+
      this.count*Math.log(newArea/oldArea);
    const accept=logAcceptance>=0||Math.log(Math.max(1e-12,this.random()))<logAcceptance;

    if(accept){
      this.areaMoveAccepted++;
      this.areaWindowAccepted++;
      this.potentialEnergy=newEnergy;
    }else{
      this.applyCell(oldCell,fractions);
      this.potentialEnergy=oldEnergy;
    }
    this.adaptAreaStep();
    return accept;
  }

  adaptAreaStep(){
    if(this.areaWindowAttempts<100)return;
    const rate=this.areaWindowAccepted/this.areaWindowAttempts;
    if(rate<.22)this.areaLogStep=Math.max(.001,this.areaLogStep*.84);
    else if(rate>.48)this.areaLogStep=Math.min(.025,this.areaLogStep*1.16);
    this.areaWindowAttempts=0;this.areaWindowAccepted=0;
  }

  attemptShapeMove(){
    const oldCell={...this.cell};
    const fractions=this.fractionalSnapshot(oldCell);
    const oldEnergy=this.totalEnergy();
    const dlog=(this.random()*2-1)*this.shapeLogStep;
    const newCell={
      lx:oldCell.lx*Math.exp(dlog),
      ly:oldCell.ly*Math.exp(-dlog),
      shear:oldCell.shear+(this.random()*2-1)*this.shearStep*Math.min(oldCell.lx,oldCell.ly),
    };
    const aspect=newCell.lx/newCell.ly;
    this.shapeMoveAttempts++;
    if(
      aspect>this.maxAspect||aspect<1/this.maxAspect||
      Math.abs(newCell.shear)>this.maxShearFraction*newCell.lx
    )return false;

    this.applyCell(newCell,fractions);
    const newEnergy=this.totalEnergy();
    const delta=newEnergy-oldEnergy;
    const accept=delta<=0||Math.log(Math.max(1e-12,this.random()))<-delta/this.kBT;
    if(accept){
      this.shapeMoveAccepted++;
      this.potentialEnergy=newEnergy;
    }else{
      this.applyCell(oldCell,fractions);
      this.potentialEnergy=oldEnergy;
    }
    return accept;
  }

  updateBondNetwork(force=false){
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    const previous=this.bonds;
    const candidates=[];
    for(const[ia,ib]of this.neighborPairs){
      const d=this.distanceBetween(this.molecules[ia],this.molecules[ib]);
      const w=this.switchWeight(d.r);
      if(w>.22)candidates.push({ia,ib,r:d.r,score:w});
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
    if(force||this.moveCount%120===0){
      for(const key of next.keys())if(!previous.has(key))this.bondsFormed++;
      for(const key of previous.keys())if(!next.has(key))this.bondsBroken++;
    }
    this.bonds=next;

    let d3=0,d4=0,over=0,sum=0;
    for(const d of degree){
      sum+=d;if(d===3)d3++;if(d===4)d4++;if(d>4)over++;
    }
    this.meanCoordination=sum/this.count;
    this.degree3Fraction=d3/this.count;
    this.degree4Fraction=d4/this.count;
    this.overCoordinatedFraction=over/this.count;
    this.updateVisualAngles();
  }

  updateVisualAngles(){
    const adj=Array.from({length:this.count},()=>[]);
    for(const bond of this.bonds.values()){
      const a=this.molecules[bond.a],b=this.molecules[bond.b];
      const d=this.minimumImageVector(b.x-a.x,b.y-a.y);
      const aa=Math.atan2(d.y,d.x);
      adj[bond.a].push(aa);
      adj[bond.b].push(wrapAngle(aa+Math.PI));
    }

    for(let i=0;i<this.count;i++){
      const m=this.molecules[i],angles=adj[i];
      if(!angles.length)continue;
      let target=angles[0]-HALF_WATER_ANGLE;
      if(angles.length>=2){
        let best=Infinity,bestTarget=target;
        for(let a=0;a<angles.length;a++)for(let b=a+1;b<angles.length;b++){
          const p1=circularMean(
            angles[a]-HALF_WATER_ANGLE,
            angles[b]+HALF_WATER_ANGLE
          );
          const e1=Math.abs(wrapAngle(p1+HALF_WATER_ANGLE-angles[a]))+
            Math.abs(wrapAngle(p1-HALF_WATER_ANGLE-angles[b]));
          const p2=circularMean(
            angles[a]+HALF_WATER_ANGLE,
            angles[b]-HALF_WATER_ANGLE
          );
          const e2=Math.abs(wrapAngle(p2-HALF_WATER_ANGLE-angles[a]))+
            Math.abs(wrapAngle(p2+HALF_WATER_ANGLE-angles[b]));
          if(e1<best){best=e1;bestTarget=p1;}
          if(e2<best){best=e2;bestTarget=p2;}
        }
        target=bestTarget;
      }
      m.targetAngle=target;
      m.visualAngle=wrapAngle(m.visualAngle+.22*wrapAngle(target-m.visualAngle));
    }
  }

  estimatePressure(){
    if(this.moveCount-this.lastPressureEstimateMove<900)return this.pressureEstimateEMA;
    this.lastPressureEstimateMove=this.moveCount;
    const oldCell={...this.cell};
    const fractions=this.fractionalSnapshot(oldCell);
    const oldArea=this.area(oldCell);
    const eps=.0015;

    const scalePlus=Math.sqrt(1+eps);
    const plus={lx:oldCell.lx*scalePlus,ly:oldCell.ly*scalePlus,shear:oldCell.shear*scalePlus};
    this.applyCell(plus,fractions);
    const uPlus=this.totalEnergy();
    const aPlus=this.area();

    const scaleMinus=Math.sqrt(1-eps);
    const minus={lx:oldCell.lx*scaleMinus,ly:oldCell.ly*scaleMinus,shear:oldCell.shear*scaleMinus};
    this.applyCell(minus,fractions);
    const uMinus=this.totalEnergy();
    const aMinus=this.area();

    this.applyCell(oldCell,fractions);
    this.potentialEnergy=this.totalEnergy();

    const dUdA=(uPlus-uMinus)/(aPlus-aMinus);
    const p2D=this.count*this.kBT/oldArea-dUdA;
    const estimate=p2D/(this.confinementWidthNm*GPA_NM3_TO_KJ_MOL);
    this.pressureEstimateGPa=estimate;
    if(Number.isFinite(estimate)){
      this.pressureEstimateEMA=.8*this.pressureEstimateEMA+.2*estimate;
    }
    return this.pressureEstimateEMA;
  }

  advance(baseMoves=58){
    const extra=this.relaxationFrames>0?34:0;
    const attempts=baseMoves+extra;
    for(let n=0;n<attempts;n++){
      this.attemptTranslationMove();
      this.moveCount++;
      if(this.moveCount%45===0)this.attemptAreaMove();
      if(this.moveCount%70===0)this.attemptShapeMove();
    }
    if(this.relaxationFrames>0){
      this.attemptAreaMove();
      this.attemptShapeMove();
      this.relaxationFrames--;
    }
    if(this.needsNeighborRebuild())this.rebuildNeighborList();
    this.potentialEnergy=this.totalEnergy();
    this.updateBondNetwork();
    this.estimatePressure();
  }

  diagnostics(){
    const area=this.area();
    const translationAcceptance=this.translationAttempts?
      this.translationAccepted/this.translationAttempts:0;
    const areaAcceptance=this.areaMoveAttempts?
      this.areaMoveAccepted/this.areaMoveAttempts:0;
    const shapeAcceptance=this.shapeMoveAttempts?
      this.shapeMoveAccepted/this.shapeMoveAttempts:0;
    return{
      steps:this.moveCount,
      bonds:this.bonds.size,
      bondsPerMolecule:this.bonds.size/this.count,
      meanDegree:this.meanCoordination,
      degree3Fraction:this.degree3Fraction,
      degree4Fraction:this.degree4Fraction,
      overCoordinatedFraction:this.overCoordinatedFraction,
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
      translationAcceptance,
      translationStep:this.translationStep,
      areaMoveAttempts:this.areaMoveAttempts,areaMoveAccepted:this.areaMoveAccepted,areaAcceptance,
      shapeMoveAttempts:this.shapeMoveAttempts,shapeMoveAccepted:this.shapeMoveAccepted,shapeAcceptance,
      pressureWorkScale:this.pressureWorkScale,
      confinementWidthNm:this.confinementWidthNm,
      relaxationFrames:this.relaxationFrames,
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
    this.visible=true;this.frameCount=0;
    this.resize=this.resize.bind(this);this.frame=this.frame.bind(this);
    this.tempInput?.addEventListener('input',()=>this.updateControls());
    this.pressureInput?.addEventListener('input',()=>this.updateControls());
    this.ro=new ResizeObserver(this.resize);if(this.stage)this.ro.observe(this.stage);
    this.io=new IntersectionObserver(entries=>{this.visible=entries[0]?.isIntersecting??true;},{threshold:.01});
    this.io.observe(this.canvas);

    this.resize();this.paintIdle();
    this.canvas.dataset.renderer='monolayer-network-mc';
    this.canvas.dataset.model='valence-limited-network-water-v2';
    this.canvas.dataset.moleculeCount='250';
    this.canvas.dataset.spatialIndex='verlet-neighbor-list';
    this.canvas.dataset.boundary='periodic-flexible-cell';
    this.canvas.dataset.ensemble='npt-metropolis-network';
    this.canvas.dataset.barostat='metropolis-area-and-shape';
    this.canvas.dataset.pressureCoupling='pconf-times-area-times-5A-width';
    this.canvas.dataset.pressureEstimator='finite-difference-configurational';
    this.canvas.dataset.temperatureCoupling='boltzmann-metropolis-kbt';
    this.canvas.dataset.potential='coordination-saturated-multiwell-network';
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
    this.canvas.dataset.hydrogenBonds=String(d.bonds);
    this.canvas.dataset.bondsPerMolecule=d.bondsPerMolecule.toFixed(3);
    this.canvas.dataset.meanDegree=d.meanDegree.toFixed(3);
    this.canvas.dataset.degree3Fraction=d.degree3Fraction.toFixed(3);
    this.canvas.dataset.degree4Fraction=d.degree4Fraction.toFixed(3);
    this.canvas.dataset.overcoordinatedFraction=d.overCoordinatedFraction.toFixed(3);
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
    this.canvas.dataset.translationAcceptance=d.translationAcceptance.toFixed(3);
    this.canvas.dataset.translationStep=d.translationStep.toFixed(4);
    this.canvas.dataset.areaMoveAttempts=String(d.areaMoveAttempts);
    this.canvas.dataset.areaMoveAcceptance=d.areaAcceptance.toFixed(3);
    this.canvas.dataset.shapeMoveAttempts=String(d.shapeMoveAttempts);
    this.canvas.dataset.shapeMoveAcceptance=d.shapeAcceptance.toFixed(3);
    this.canvas.dataset.relaxationFrames=String(d.relaxationFrames);

    if(this.measuredPressureOutput){
      this.measuredPressureOutput.textContent=d.pressureEstimateGPa.toFixed(1)+' GPa';
    }
    if(this.densityOutput)this.densityOutput.textContent=d.arealDensity.toFixed(2);
    if(this.status){
      this.status.textContent=
        d.bonds+' H-bonds · degree '+d.meanDegree.toFixed(2)+
        ' · 3-fold '+Math.round(d.degree3Fraction*100)+'%'+
        ' · 4-fold '+Math.round(d.degree4Fraction*100)+'%';
    }
  }

  frame(){
    const active=this.visible&&this.host?.dataset.scene==='1'&&this.host?.dataset.paused!=='true';
    if(active){
      this.ensureSimulation();
      const mobile=this.width<760;
      this.md.advance(mobile?34:58);
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
