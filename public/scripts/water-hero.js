import * as THREE from '../vendor/three.module.min.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rand=(i)=>{
  const x=Math.sin(i*12.9898+78.233)*43758.5453;
  return x-Math.floor(x);
};

function makeWaterSurface(radius=1.04,rings=26,segments=96){
  const positions=[];
  const indices=[];
  positions.push(0,0,0);
  for(let r=1;r<=rings;r++){
    const rr=radius*r/rings;
    for(let s=0;s<segments;s++){
      const a=Math.PI*2*s/segments;
      positions.push(Math.cos(a)*rr,Math.sin(a)*rr,0);
    }
  }
  for(let s=0;s<segments;s++){
    const a=1+s;
    const b=1+(s+1)%segments;
    indices.push(0,a,b);
  }
  for(let r=1;r<rings;r++){
    const inner=1+(r-1)*segments;
    const outer=1+r*segments;
    for(let s=0;s<segments;s++){
      const sn=(s+1)%segments;
      indices.push(inner+s,outer+s,outer+sn);
      indices.push(inner+s,outer+sn,inner+sn);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.base=geometry.attributes.position.array.slice();
  return geometry;
}

function makeGlassGeometry(){
  const p=[
    new THREE.Vector2(.88,-1.78),
    new THREE.Vector2(1.00,-1.74),
    new THREE.Vector2(1.18,1.62),
    new THREE.Vector2(1.20,1.76),
    new THREE.Vector2(1.15,1.83),
    new THREE.Vector2(1.02,1.82),
    new THREE.Vector2(.98,1.67),
    new THREE.Vector2(.82,-1.57),
    new THREE.Vector2(.78,-1.67),
    new THREE.Vector2(.88,-1.78),
  ];
  return new THREE.LatheGeometry(p,128);
}

function makeStudioTexture(){
  const canvas=document.createElement('canvas');
  canvas.width=1024; canvas.height=512;
  const ctx=canvas.getContext('2d');
  const g=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
  g.addColorStop(0,'#eef4f5');
  g.addColorStop(.45,'#c7d9dd');
  g.addColorStop(1,'#758f98');
  ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);
  const glow=ctx.createRadialGradient(710,130,10,710,130,390);
  glow.addColorStop(0,'rgba(255,255,255,.98)');
  glow.addColorStop(.34,'rgba(255,255,255,.48)');
  glow.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=glow;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='rgba(255,255,255,.76)';
  ctx.fillRect(560,45,105,380);
  ctx.fillStyle='rgba(39,67,77,.20)';
  ctx.fillRect(675,45,18,380);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.mapping=THREE.EquirectangularReflectionMapping;
  return tex;
}

class WaterHero{
  constructor(canvas){
    this.canvas=canvas;
    this.canvas.dataset.renderer='threejs-water';
    this.canvas.dataset.rendererReady='false';
    this.host=canvas.closest('water-network-story');
    this.stage=canvas.parentElement;
    this.active=true;
    this.visible=true;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.time=0;
    this.last=performance.now();

    this.renderer=new THREE.WebGLRenderer({
      canvas,
      antialias:true,
      alpha:true,
      powerPreference:'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.82;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color('#b9d3dc');
    this.environment=makeStudioTexture();
    this.scene.environment=this.environment;

    this.camera=new THREE.PerspectiveCamera(24,1,.1,50);
    this.camera.position.set(-.45,.08,10.15);
    this.camera.lookAt(.28,-.18,0);

    this.root=new THREE.Group();
    this.root.position.set(.72,-.05,0);
    this.root.rotation.y=-.035;
    this.scene.add(this.root);

    this.buildLighting();
    this.buildBackdrop();
    this.buildGlass();
    this.buildWater();
    this.buildPourSource();
    this.buildStream();
    this.buildBubbles();
    this.buildMolecules();

    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(this.stage);
    this.intersectionObserver=new IntersectionObserver(([entry])=>{
      this.visible=entry?.isIntersecting??true;
    },{threshold:.02});
    this.intersectionObserver.observe(this.stage);
    this.sceneObserver=new MutationObserver(()=>this.syncScene());
    this.sceneObserver.observe(this.host,{attributes:true,attributeFilter:['data-scene']});
    this.syncScene();
    this.resize();
    this.canvas.dataset.rendererReady='true';
    if(this.host)this.host.dataset.heroReady='true';
    this.frame=this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  buildLighting(){
    this.scene.add(new THREE.HemisphereLight(0xd9eff5,0x304851,1.35));

    const key=new THREE.DirectionalLight(0xeaf8ff,3.35);
    key.position.set(-4.5,5.5,5.5);
    key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);
    key.shadow.camera.left=-5;key.shadow.camera.right=5;
    key.shadow.camera.top=5;key.shadow.camera.bottom=-5;
    this.scene.add(key);

    const rim=new THREE.DirectionalLight(0x7fc7df,1.65);
    rim.position.set(5,2,-2);
    this.scene.add(rim);

    const fill=new THREE.PointLight(0xb8dce8,5.5,12,2);
    fill.position.set(-2.8,1.5,4.5);
    this.scene.add(fill);
  }

  buildBackdrop(){
    const floor=new THREE.Mesh(
      new THREE.PlaneGeometry(18,11),
      new THREE.MeshStandardMaterial({color:0x8eabb6,roughness:.42,metalness:.02})
    );
    floor.rotation.x=-Math.PI/2;
    floor.position.y=-1.93;
    floor.position.z=-.2;
    floor.receiveShadow=true;
    this.scene.add(floor);

    const back=new THREE.Mesh(
      new THREE.PlaneGeometry(18,10),
      new THREE.MeshStandardMaterial({color:0xc1d8df,roughness:.88,metalness:0})
    );
    back.position.set(0,1,-4.2);
    this.scene.add(back);

    const bright=new THREE.Mesh(
      new THREE.PlaneGeometry(.82,5.8),
      new THREE.MeshBasicMaterial({color:0xd7edf3})
    );
    bright.position.set(3.45,1.05,-3.95);
    this.scene.add(bright);

    const cool=new THREE.Mesh(
      new THREE.PlaneGeometry(.22,5.8),
      new THREE.MeshBasicMaterial({color:0x385968})
    );
    cool.position.set(4.0,1.05,-3.92);
    this.scene.add(cool);
  }

  buildGlass(){
    this.glassMaterial=new THREE.MeshPhysicalMaterial({
      color:0xc9e5ec,
      roughness:.07,
      metalness:0,
      transmission:.92,
      thickness:.28,
      ior:1.50,
      attenuationColor:new THREE.Color(0x527a8a),
      attenuationDistance:3.4,
      transparent:true,
      opacity:.98,
      envMapIntensity:1.18,
      clearcoat:.50,
      clearcoatRoughness:.06,
      side:THREE.DoubleSide,
    });
    this.glass=new THREE.Mesh(makeGlassGeometry(),this.glassMaterial);
    this.glass.castShadow=true;
    this.glass.receiveShadow=true;
    this.root.add(this.glass);

    const rim=new THREE.Mesh(
      new THREE.TorusGeometry(1.105,.045,18,128),
      new THREE.MeshPhysicalMaterial({
        color:0xc9e7ef,
        roughness:.045,
        transmission:.93,
        thickness:.16,
        ior:1.5,
        transparent:true,
        envMapIntensity:2,
      })
    );
    rim.rotation.x=Math.PI/2;
    rim.position.y=1.755;
    this.root.add(rim);
  }

  buildWater(){
    this.waterBodyMaterial=new THREE.MeshPhysicalMaterial({
      color:0x77b8cd,
      roughness:.065,
      metalness:0,
      transmission:.76,
      thickness:1.5,
      ior:1.333,
      attenuationColor:new THREE.Color(0x317d9a),
      attenuationDistance:1.75,
      transparent:true,
      opacity:.96,
      envMapIntensity:.92,
      side:THREE.DoubleSide,
    });
    this.waterBody=new THREE.Mesh(
      new THREE.CylinderGeometry(1.035,.82,2.82,128,1,false),
      this.waterBodyMaterial
    );
    this.waterBody.position.y=-.24;
    this.root.add(this.waterBody);

    this.surfaceGeometry=makeWaterSurface(1.035,28,112);
    this.surfaceMaterial=new THREE.MeshPhysicalMaterial({
      color:0x8fc9da,
      roughness:.04,
      metalness:0,
      transmission:.78,
      thickness:.34,
      ior:1.333,
      attenuationColor:new THREE.Color(0x4f9fba),
      attenuationDistance:1.65,
      transparent:true,
      opacity:.98,
      envMapIntensity:1.32,
      clearcoat:.58,
      clearcoatRoughness:.045,
      side:THREE.DoubleSide,
    });
    this.surface=new THREE.Mesh(this.surfaceGeometry,this.surfaceMaterial);
    this.surface.rotation.x=-Math.PI/2;
    this.surface.position.y=1.17;
    this.root.add(this.surface);

    const meniscus=new THREE.Mesh(
      new THREE.TorusGeometry(1.025,.024,12,128),
      new THREE.MeshPhysicalMaterial({
        color:0xa8dce8,
        roughness:.035,
        transmission:.84,
        transparent:true,
        opacity:.86,
        envMapIntensity:2.4,
      })
    );
    meniscus.rotation.x=Math.PI/2;
    meniscus.position.y=1.17;
    this.root.add(meniscus);
    this.meniscus=meniscus;
  }

  buildPourSource(){
    const bottleMaterial=new THREE.MeshPhysicalMaterial({
      color:0x8fb4c1,
      roughness:.085,
      metalness:0,
      transmission:.78,
      thickness:.22,
      ior:1.49,
      attenuationColor:new THREE.Color(0x355f70),
      attenuationDistance:2.1,
      transparent:true,
      opacity:.92,
      envMapIntensity:1.15,
      side:THREE.DoubleSide,
    });

    this.pourSource=new THREE.Group();
    this.pourSource.position.set(2.35,2.55,.12);
    this.pourSource.rotation.z=-1.03;
    this.pourSource.rotation.y=.08;

    const body=new THREE.Mesh(
      new THREE.CylinderGeometry(.78,.95,3.35,64,1,false),
      bottleMaterial
    );
    body.position.y=.86;
    body.scale.z=.82;
    this.pourSource.add(body);

    const shoulder=new THREE.Mesh(
      new THREE.CylinderGeometry(.34,.78,.72,64,1,false),
      bottleMaterial
    );
    shoulder.position.y=-1.16;
    this.pourSource.add(shoulder);

    const neck=new THREE.Mesh(
      new THREE.CylinderGeometry(.23,.30,.92,48,1,false),
      bottleMaterial
    );
    neck.position.y=-1.92;
    this.pourSource.add(neck);

    const lip=new THREE.Mesh(
      new THREE.TorusGeometry(.255,.045,14,64),
      bottleMaterial
    );
    lip.rotation.x=Math.PI/2;
    lip.position.y=-2.40;
    this.pourSource.add(lip);

    const waterInside=new THREE.Mesh(
      new THREE.CylinderGeometry(.70,.84,1.70,48),
      new THREE.MeshPhysicalMaterial({
        color:0x4f9fba,roughness:.05,transmission:.68,thickness:.9,ior:1.333,
        attenuationColor:new THREE.Color(0x2d718c),attenuationDistance:1.2,
        transparent:true,opacity:.83,envMapIntensity:.7
      })
    );
    waterInside.position.y=.80;
    waterInside.scale.z=.80;
    this.pourSource.add(waterInside);

    this.root.add(this.pourSource);
  }

  buildStream(){
    this.streamMaterial=new THREE.MeshPhysicalMaterial({
      color:0x9ed9e7,
      roughness:.035,
      transmission:.88,
      thickness:.18,
      ior:1.333,
      transparent:true,
      opacity:.97,
      envMapIntensity:1.45,
    });
    this.stream=new THREE.Mesh(
      new THREE.CylinderGeometry(.085,.12,3.0,32,14,false),
      this.streamMaterial
    );
    this.stream.position.set(.20,3.20,.03);
    this.stream.rotation.z=-.035;
    this.root.add(this.stream);

    const dropletGeo=new THREE.SphereGeometry(.10,20,16);
    this.droplets=[];
    for(let i=0;i<6;i++){
      const d=new THREE.Mesh(dropletGeo,this.streamMaterial);
      d.scale.set(.7,1.45,.7);
      d.userData.phase=i/6;
      this.root.add(d);
      this.droplets.push(d);
    }

    const splashMat=new THREE.MeshPhysicalMaterial({
      color:0xdaf7fc,roughness:.03,transmission:.90,transparent:true,opacity:.92,
      thickness:.15,ior:1.333,envMapIntensity:2
    });
    this.splash=[];
    for(let i=0;i<9;i++){
      const s=new THREE.Mesh(new THREE.SphereGeometry(.035+rand(i)*.025,14,10),splashMat);
      s.userData.angle=rand(100+i)*Math.PI*2;
      s.userData.radius=.10+rand(200+i)*.24;
      s.userData.phase=rand(300+i);
      this.root.add(s);this.splash.push(s);
    }
  }

  buildBubbles(){
    const geo=new THREE.SphereGeometry(.035,14,10);
    const mat=new THREE.MeshPhysicalMaterial({
      color:0xffffff,
      roughness:.04,
      transmission:1,
      thickness:.05,
      ior:1.0,
      transparent:true,
      opacity:.72,
      envMapIntensity:2.4,
    });
    this.bubbleData=[];
    this.bubbles=new THREE.InstancedMesh(geo,mat,42);
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy=new THREE.Object3D();
    for(let i=0;i<42;i++){
      const a=rand(i*7)*Math.PI*2;
      const r=Math.sqrt(rand(i*7+1))*.72;
      const y=-1.55+rand(i*7+2)*2.55;
      const scale=.55+rand(i*7+3)*1.55;
      this.bubbleData.push({a,r,y,speed:.12+rand(i*7+4)*.24,scale,drift:rand(i*7+5)*6.28});
      dummy.position.set(Math.cos(a)*r,y,Math.sin(a)*r);
      dummy.scale.setScalar(scale);dummy.updateMatrix();
      this.bubbles.setMatrixAt(i,dummy.matrix);
    }
    this.root.add(this.bubbles);
  }

  makeBond(a,b,material,radius=.016){
    const dir=new THREE.Vector3().subVectors(b,a);
    const len=dir.length();
    const mesh=new THREE.Mesh(
      new THREE.CylinderGeometry(radius,radius,len,10),
      material
    );
    mesh.position.copy(a).addScaledVector(dir,.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.clone().normalize());
    return mesh;
  }

  makeWaterMolecule(id){
    const group=new THREE.Group();
    group.userData.moleculeId=id;

    const oxygenMaterial=new THREE.MeshStandardMaterial({
      color:0xd83b3b,roughness:.28,metalness:0
    });
    const hydrogenMaterial=new THREE.MeshStandardMaterial({
      color:0xf5f5f2,roughness:.22,metalness:0
    });
    const covalentMaterial=new THREE.MeshStandardMaterial({
      color:0xd9d9d4,roughness:.34,metalness:0
    });

    const oxygen=new THREE.Mesh(new THREE.SphereGeometry(.082,22,18),oxygenMaterial);
    oxygen.userData.pickable=true;
    oxygen.userData.moleculeId=id;
    group.add(oxygen);

    const halfAngle=THREE.MathUtils.degToRad(52.25);
    const bondLength=.145;
    const h1Pos=new THREE.Vector3(Math.sin(halfAngle)*bondLength,Math.cos(halfAngle)*bondLength,0);
    const h2Pos=new THREE.Vector3(-Math.sin(halfAngle)*bondLength,Math.cos(halfAngle)*bondLength,0);

    const h1=new THREE.Mesh(new THREE.SphereGeometry(.050,18,14),hydrogenMaterial);
    const h2=new THREE.Mesh(new THREE.SphereGeometry(.050,18,14),hydrogenMaterial);
    h1.position.copy(h1Pos);h2.position.copy(h2Pos);
    group.add(h1,h2);
    group.add(this.makeBond(new THREE.Vector3(),h1Pos,covalentMaterial,.013));
    group.add(this.makeBond(new THREE.Vector3(),h2Pos,covalentMaterial,.013));

    return {group,oxygen,hydrogens:[h1,h2]};
  }

  buildMolecules(){
    this.moleculeLayer=new THREE.Group();
    this.moleculeLayer.renderOrder=3;
    this.root.add(this.moleculeLayer);
    this.molecules3d=[];
    this.pickTargets=[];
    this.raycaster=new THREE.Raycaster();
    this.pointerNdc=new THREE.Vector2();

    const count=14;
    for(let i=0;i<count;i++){
      const molecule=this.makeWaterMolecule(i);
      const a=rand(800+i*11)*Math.PI*2;
      const r=Math.sqrt(rand(801+i*11))*.54;
      const y=-1.02+rand(802+i*11)*1.62;
      const position=new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);
      molecule.group.position.copy(position);
      molecule.group.rotation.set(
        rand(803+i*11)*Math.PI*2,
        rand(804+i*11)*Math.PI*2,
        rand(805+i*11)*Math.PI*2
      );
      const velocity=new THREE.Vector3(
        (rand(806+i*11)-.5)*.055,
        (rand(807+i*11)-.5)*.045,
        (rand(808+i*11)-.5)*.055
      );
      const angularVelocity=new THREE.Vector3(
        (rand(809+i*11)-.5)*.55,
        (rand(810+i*11)-.5)*.55,
        (rand(811+i*11)-.5)*.55
      );
      this.molecules3d.push({
        id:i,
        group:molecule.group,
        oxygen:molecule.oxygen,
        hydrogens:molecule.hydrogens,
        position,
        velocity,
        angularVelocity,
        phase:rand(812+i*11)*Math.PI*2,
      });
      this.pickTargets.push(molecule.oxygen);
      this.moleculeLayer.add(molecule.group);
    }

    const hPositions=new Float32Array(10*2*3);
    this.hbondGeometry=new THREE.BufferGeometry();
    this.hbondGeometry.setAttribute('position',new THREE.BufferAttribute(hPositions,3));
    this.hbondGeometry.setDrawRange(0,0);
    this.hbondMaterial=new THREE.LineDashedMaterial({
      color:0xbfeaf4,
      transparent:true,
      opacity:.38,
      dashSize:.045,
      gapSize:.035,
      depthWrite:false,
    });
    this.hbondLines=new THREE.LineSegments(this.hbondGeometry,this.hbondMaterial);
    this.hbondLines.computeLineDistances();
    this.hbondLines.renderOrder=2;
    this.moleculeLayer.add(this.hbondLines);

    this.canvas.addEventListener('pointerdown',event=>this.handleMoleculePick(event));
    if(this.host){
      this.host.dataset.moleculeCount=String(count);
      this.host.dataset.pickableMolecules=String(this.pickTargets.length);
    }
  }

  handleMoleculePick(event){
    if(!this.active)return;
    const rect=this.canvas.getBoundingClientRect();
    this.pointerNdc.x=((event.clientX-rect.left)/rect.width)*2-1;
    this.pointerNdc.y=-((event.clientY-rect.top)/rect.height)*2+1;
    this.raycaster.setFromCamera(this.pointerNdc,this.camera);
    const hits=this.raycaster.intersectObjects(this.pickTargets,false);
    if(!hits.length)return;
    const id=hits[0].object.userData.moleculeId;
    if(this.host)this.host.dataset.selectedMolecule=String(id);
  }

  updateMolecules(dt,t){
    const maxR=.64;
    const minY=-1.18;
    const maxY=.88;
    const impact=new THREE.Vector3(.18,.78,0);

    for(const mol of this.molecules3d){
      const p=mol.position;
      const v=mol.velocity;

      v.x+=Math.sin(t*1.7+mol.phase)*.010*dt;
      v.y+=Math.cos(t*1.3+mol.phase*1.7)*.010*dt;
      v.z+=Math.sin(t*1.9+mol.phase*.7)*.010*dt;

      const dx=p.x-impact.x,dy=p.y-impact.y,dz=p.z-impact.z;
      const r2=dx*dx+dy*dy+dz*dz;
      if(r2<.72){
        const stir=Math.exp(-r2*3.2);
        v.x+=(-dz*.12)*stir*dt;
        v.z+=(dx*.12)*stir*dt;
        v.y+=(-.045+.075*stir)*dt;
      }

      const radial=Math.hypot(p.x,p.z);
      if(radial>maxR){
        const nx=p.x/radial,nz=p.z/radial;
        const push=(radial-maxR)*2.4+.16;
        v.x-=nx*push*dt;
        v.z-=nz*push*dt;
      }
      if(p.y<minY)v.y+=(minY-p.y)*2.7*dt+.035;
      if(p.y>maxY)v.y-=(p.y-maxY)*2.7*dt+.035;

      v.multiplyScalar(Math.pow(.994,dt*60));
      p.addScaledVector(v,dt);

      // Hard safety clamp keeps the pickable objects physically inside the water/glass volume.
      const newR=Math.hypot(p.x,p.z);
      if(newR>maxR){
        p.x*=maxR/newR;p.z*=maxR/newR;
        v.x*=-.45;v.z*=-.45;
      }
      if(p.y<minY){p.y=minY;v.y=Math.abs(v.y)*.45;}
      if(p.y>maxY){p.y=maxY;v.y=-Math.abs(v.y)*.45;}

      mol.group.position.copy(p);
      mol.group.rotation.x+=mol.angularVelocity.x*dt;
      mol.group.rotation.y+=mol.angularVelocity.y*dt;
      mol.group.rotation.z+=mol.angularVelocity.z*dt;
    }
  }

  updateHydrogenBonds(t){
    const candidates=[];
    for(let i=0;i<this.molecules3d.length;i++){
      for(let j=i+1;j<this.molecules3d.length;j++){
        const a=this.molecules3d[i],b=this.molecules3d[j];
        const d=a.position.distanceTo(b.position);
        if(d<.62){
          const gate=.5+.5*Math.sin(t*1.6+a.phase-b.phase*.7);
          if(gate>.34)candidates.push({a,b,d,gate});
        }
      }
    }
    candidates.sort((x,y)=>(x.d-.08*x.gate)-(y.d-.08*y.gate));
    const chosen=candidates.slice(0,10);
    const pos=this.hbondGeometry.attributes.position;
    let cursor=0;
    for(const bond of chosen){
      pos.setXYZ(cursor++,bond.a.position.x,bond.a.position.y,bond.a.position.z);
      pos.setXYZ(cursor++,bond.b.position.x,bond.b.position.y,bond.b.position.z);
    }
    this.hbondGeometry.setDrawRange(0,cursor);
    pos.needsUpdate=true;
    this.hbondLines.computeLineDistances();
    this.hbondMaterial.opacity=.25+.12*(.5+.5*Math.sin(t*.9));
    if(this.host)this.host.dataset.hydrogenBonds=String(chosen.length);
  }

  syncScene(){
    this.active=this.host?.dataset.scene==='0';
    this.canvas.style.opacity=this.active?'1':'0';
    this.canvas.style.pointerEvents='none';
  }

  resize(){
    const r=this.stage.getBoundingClientRect();
    const w=Math.max(1,r.width),h=Math.max(1,r.height);
    this.renderer.setSize(w,h,false);
    this.camera.aspect=w/h;
    this.camera.updateProjectionMatrix();
  }

  updateSurface(t){
    const pos=this.surfaceGeometry.attributes.position;
    const base=this.surfaceGeometry.userData.base;
    const impactX=.18, impactY=.02;
    for(let i=0;i<pos.count;i++){
      const x=base[i*3],y=base[i*3+1];
      const radial=Math.sqrt((x-impactX)**2+(y-impactY)**2);
      const broad=.018*Math.sin(x*3.2+t*1.8)+.014*Math.sin(y*4.0-t*1.35);
      const ring=.034*Math.sin(radial*19-t*7.2)*Math.exp(-radial*2.25);
      const impact=.055*Math.exp(-radial*radial*10.5)*(1+.22*Math.sin(t*8.1));
      pos.setZ(i,broad+ring-impact);
    }
    pos.needsUpdate=true;
    this.surfaceGeometry.computeVertexNormals();
    this.surfaceGeometry.attributes.normal.needsUpdate=true;
    this.meniscus.position.y=1.17+.004*Math.sin(t*1.2);
  }

  updateBubbles(dt,t){
    const dummy=new THREE.Object3D();
    this.bubbleData.forEach((b,i)=>{
      b.y+=b.speed*dt;
      if(b.y>1.05)b.y=-1.55-rand(i+Math.floor(t))*0.20;
      const x=Math.cos(b.a)*b.r+Math.sin(t*.7+b.drift)*.035;
      const z=Math.sin(b.a)*b.r+Math.cos(t*.55+b.drift)*.028;
      dummy.position.set(x,b.y,z);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      this.bubbles.setMatrixAt(i,dummy.matrix);
    });
    this.bubbles.instanceMatrix.needsUpdate=true;
  }

  updateStream(t){
    this.stream.scale.x=.88+.08*Math.sin(t*7.1)+.04*Math.sin(t*13.7);
    this.stream.scale.z=.92+.06*Math.cos(t*5.9);
    this.stream.position.x=.20+.018*Math.sin(t*2.2);

    for(const d of this.droplets){
      const p=(t*.36+d.userData.phase)%1;
      d.position.set(
        .17+.035*Math.sin(t*2.4+p*7),
        4.75-p*3.28,
        .02+.025*Math.cos(t*2.0+p*6)
      );
      const squash=.65+.35*Math.sin(Math.PI*p);
      d.scale.set(.65*squash,1.2+.55*(1-squash),.65*squash);
    }

    for(const s of this.splash){
      const p=(t*.72+s.userData.phase)%1;
      const a=s.userData.angle;
      const r=s.userData.radius*(.25+p);
      s.position.set(
        .18+Math.cos(a)*r,
        1.20+.34*Math.sin(Math.PI*p)-.18*p,
        Math.sin(a)*r
      );
      s.scale.setScalar(1-p*.55);
      s.visible=p<.96;
    }
  }

  frame(now){
    const dt=clamp((now-this.last)/1000,0,.04);
    this.last=now;
    if(this.visible&&this.active){
      if(!this.reduced){
        this.time+=dt;
        this.updateSurface(this.time);
        this.updateStream(this.time);
        this.updateBubbles(dt,this.time);
        this.updateMolecules(dt,this.time);
        this.updateHydrogenBonds(this.time);
        this.root.rotation.y=-.035+.006*Math.sin(this.time*.28);
      }
      this.renderer.render(this.scene,this.camera);
    }
    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-water-hero-canvas]').forEach(canvas=>{
  if(!canvas.__waterHero) canvas.__waterHero=new WaterHero(canvas);
});
