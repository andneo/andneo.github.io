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
    this.renderer.toneMappingExposure=1.03;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color('#dfe9eb');
    this.environment=makeStudioTexture();
    this.scene.environment=this.environment;

    this.camera=new THREE.PerspectiveCamera(31,1,.1,50);
    this.camera.position.set(0.25,.35,8.4);
    this.camera.lookAt(.72,-.15,0);

    this.root=new THREE.Group();
    this.root.position.set(1.18,-.03,0);
    this.root.rotation.y=-.16;
    this.scene.add(this.root);

    this.buildLighting();
    this.buildBackdrop();
    this.buildGlass();
    this.buildWater();
    this.buildStream();
    this.buildBubbles();

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
    this.frame=this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  buildLighting(){
    this.scene.add(new THREE.HemisphereLight(0xf2fbff,0x52636a,2.1));

    const key=new THREE.DirectionalLight(0xffffff,5.2);
    key.position.set(-4,6,5);
    key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);
    key.shadow.camera.left=-5;key.shadow.camera.right=5;
    key.shadow.camera.top=5;key.shadow.camera.bottom=-5;
    this.scene.add(key);

    const rim=new THREE.DirectionalLight(0x9bdcf1,2.8);
    rim.position.set(5,2,-2);
    this.scene.add(rim);

    const warm=new THREE.PointLight(0xfff3df,16,12,2);
    warm.position.set(-2.2,1.8,4.5);
    this.scene.add(warm);
  }

  buildBackdrop(){
    const floor=new THREE.Mesh(
      new THREE.PlaneGeometry(18,11),
      new THREE.MeshStandardMaterial({color:0xd8e2e4,roughness:.56,metalness:0})
    );
    floor.rotation.x=-Math.PI/2;
    floor.position.y=-1.93;
    floor.position.z=-.2;
    floor.receiveShadow=true;
    this.scene.add(floor);

    const back=new THREE.Mesh(
      new THREE.PlaneGeometry(18,10),
      new THREE.MeshStandardMaterial({color:0xe9f0f1,roughness:.84,metalness:0})
    );
    back.position.set(0,1,-4.2);
    this.scene.add(back);

    const bright=new THREE.Mesh(
      new THREE.PlaneGeometry(1.25,5.8),
      new THREE.MeshBasicMaterial({color:0xffffff})
    );
    bright.position.set(3.15,1.05,-3.95);
    this.scene.add(bright);

    const cool=new THREE.Mesh(
      new THREE.PlaneGeometry(.22,5.8),
      new THREE.MeshBasicMaterial({color:0x7898a2})
    );
    cool.position.set(4.0,1.05,-3.92);
    this.scene.add(cool);
  }

  buildGlass(){
    this.glassMaterial=new THREE.MeshPhysicalMaterial({
      color:0xffffff,
      roughness:.055,
      metalness:0,
      transmission:1,
      thickness:.22,
      ior:1.50,
      attenuationColor:new THREE.Color(0xd9f6ff),
      attenuationDistance:8,
      transparent:true,
      opacity:1,
      envMapIntensity:1.7,
      clearcoat:.42,
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
        color:0xffffff,
        roughness:.035,
        transmission:1,
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
      color:0x9ed7e6,
      roughness:.055,
      metalness:0,
      transmission:.86,
      thickness:1.35,
      ior:1.333,
      attenuationColor:new THREE.Color(0x78c7dd),
      attenuationDistance:3.8,
      transparent:true,
      opacity:.94,
      envMapIntensity:1.25,
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
      color:0xb8e7f1,
      roughness:.025,
      metalness:0,
      transmission:.88,
      thickness:.32,
      ior:1.333,
      attenuationColor:new THREE.Color(0x8fd8e8),
      attenuationDistance:4,
      transparent:true,
      opacity:.98,
      envMapIntensity:2.2,
      clearcoat:.75,
      clearcoatRoughness:.025,
      side:THREE.DoubleSide,
    });
    this.surface=new THREE.Mesh(this.surfaceGeometry,this.surfaceMaterial);
    this.surface.rotation.x=-Math.PI/2;
    this.surface.position.y=1.17;
    this.root.add(this.surface);

    const meniscus=new THREE.Mesh(
      new THREE.TorusGeometry(1.025,.024,12,128),
      new THREE.MeshPhysicalMaterial({
        color:0xeafcff,
        roughness:.02,
        transmission:.92,
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

  buildStream(){
    this.streamMaterial=new THREE.MeshPhysicalMaterial({
      color:0xcff4fb,
      roughness:.02,
      transmission:.96,
      thickness:.18,
      ior:1.333,
      transparent:true,
      opacity:.97,
      envMapIntensity:2.1,
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
        this.root.rotation.y=-.16+.012*Math.sin(this.time*.32);
      }
      this.renderer.render(this.scene,this.camera);
    }
    requestAnimationFrame(this.frame);
  }
}

document.querySelectorAll('[data-water-hero-canvas]').forEach(canvas=>{
  if(!canvas.__waterHero) canvas.__waterHero=new WaterHero(canvas);
});
