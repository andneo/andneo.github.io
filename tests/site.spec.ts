import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const paths=['/','/posts/nbody-integrators/','/courses/numerical-methods/01-odes/','/research/dwarf-galaxies/','/publications/smith2023/','/cv/'];
for(const width of [390,1440])for(const path of paths)test(`${width}px ${path}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(path);await expect(page.locator('main h1')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 expect(report.violations).toEqual([]);expect(errors).toEqual([]);
});
test('navigation and mathematical content work without JavaScript',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:800}});const page=await context.newPage();
 await page.goto('http://127.0.0.1:4321/courses/numerical-methods/01-odes/');
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Course chapters'})).toBeVisible();
 await expect(page.locator('.katex').first()).toBeVisible();await context.close();
});
test('hero lattice network has human-scale motion on real graph edges',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('/');

 const hero=page.locator('.home-hero');
 const canvas=hero.locator('.homepage-field__dynamic');
 await expect(canvas).toBeVisible();
 await expect(canvas).toHaveAttribute('data-motion','running');
 await expect(canvas).toHaveAttribute('data-motion-preference','no-preference');
 await expect(canvas).toHaveAttribute('data-motion-policy','always-animated');
 await expect(canvas).toHaveAttribute('data-motion-reason','animated');
 await expect(canvas).toHaveAttribute('data-lattice','kagome');
 await expect(canvas).toHaveAttribute('data-field-mode','global');
 await expect(canvas).toHaveAttribute('data-layers','base-dynamic');
 await expect(canvas).toHaveAttribute('data-canvas-buffers','2');
 await expect(canvas).toHaveAttribute('data-active-overlay','vector');
 await expect(canvas).toHaveAttribute('data-diagnostics-hz','4');
 await expect(canvas).toHaveAttribute('data-quiet-zones','1');

 const nodes=Number(await canvas.getAttribute('data-nodes'));
 const edges=Number(await canvas.getAttribute('data-edges'));
 const walkers=Number(await canvas.getAttribute('data-walkers'));
 expect(nodes).toBeGreaterThan(100);expect(nodes).toBeLessThanOrEqual(4800);
 expect(edges).toBeGreaterThan(nodes);expect(edges).toBeLessThanOrEqual(11000);
 expect(walkers).toBeGreaterThan(20);expect(walkers).toBeLessThanOrEqual(60);
 expect(await page.locator('.home-section .homepage-field').count()).toBe(0);

 const layer=await page.locator('homepage-background').evaluate((node:HTMLElement)=>Number(getComputedStyle(node).zIndex));
 const contentLayer=await page.locator('.hero-frame').evaluate((node:HTMLElement)=>Number(getComputedStyle(node).zIndex));
 expect(layer).toBeGreaterThanOrEqual(1);expect(contentLayer).toBeGreaterThan(layer);

 const before=await canvas.evaluate((node:HTMLCanvasElement)=>{
  const ctx=node.getContext('2d')!;
  const data=ctx.getImageData(0,0,node.width,node.height).data;
  let covered=0,samples=0;
  for(let i=3;i<data.length;i+=64){if(data[i]>10)covered++;samples++;}
  (node as HTMLCanvasElement&{__networkSnapshot?:Uint8ClampedArray}).__networkSnapshot=data.slice();
  return{
   coverage:covered/samples,
   transitions:Number(node.dataset.transitions||0),
   simSteps:Number(node.dataset.simSteps||0),
   probeTravel:Number(node.dataset.probeTravel||0),
  };
 });
 expect(before.coverage).toBeGreaterThan(.001);

 await page.waitForTimeout(1200);

 const after=await canvas.evaluate((node:HTMLCanvasElement&{__networkSnapshot?:Uint8ClampedArray})=>{
  const ctx=node.getContext('2d')!;
  const data=ctx.getImageData(0,0,node.width,node.height).data;
  const previous=node.__networkSnapshot;
  let changed=0,samples=0;
  if(previous){
   for(let i=0;i<data.length;i+=64){
    const delta=Math.abs(data[i]-previous[i])+Math.abs(data[i+1]-previous[i+1])+Math.abs(data[i+2]-previous[i+2])+Math.abs(data[i+3]-previous[i+3]);
    if(delta>32)changed++;
    samples++;
   }
  }
  delete node.__networkSnapshot;
  return{
   transitions:Number(node.dataset.transitions||0),
   simSteps:Number(node.dataset.simSteps||0),
   probeTravel:Number(node.dataset.probeTravel||0),
   activeWalkers:Number(node.dataset.activeWalkers||0),
   activeEdges:Number(node.dataset.activeEdges||0),
   meanTravel:Number(node.dataset.meanTravel||0),
   maxTravel:Number(node.dataset.maxTravel||0),
   walkerBins:Number(node.dataset.walkerBins||0),
   explorerBins:Number(node.dataset.explorerBins||0),
   activityBins:Number(node.dataset.activityBins||0),
   nearBoxWalkers:Number(node.dataset.nearBoxWalkers||0),
   focusWalkers:Number(node.dataset.focusWalkers||0),
   explorerWalkers:Number(node.dataset.explorerWalkers||0),
   walkerSpanX:Number(node.dataset.walkerSpanX||0),
   walkerSpanY:Number(node.dataset.walkerSpanY||0),
   lastTransitionTime:Number(node.dataset.lastTransitionTime||0),
   changedRatio:samples?changed/samples:0,
  };
 });

 expect(after.simSteps-before.simSteps).toBeGreaterThan(30);
 expect(after.transitions-before.transitions).toBeGreaterThan(20);
 expect(after.probeTravel-before.probeTravel).toBeGreaterThan(12);
 expect(after.activeWalkers).toBeGreaterThan(4);
 expect(after.activeEdges).toBeGreaterThan(4);
 expect(after.meanTravel).toBeGreaterThan(1.5);
 expect(after.maxTravel).toBeGreaterThan(4);
 // The active simulation must occupy the hero, not collapse into the annulus
 // surrounding the text exclusion rectangle.
 expect(after.focusWalkers/walkers).toBeGreaterThan(.32);
 expect(after.focusWalkers/walkers).toBeLessThan(.44);
 expect(after.explorerWalkers).toBeGreaterThan(after.focusWalkers);
 // Explorer traffic must remain distributed across most of the hero while a
 // separate focus population keeps the text perimeter visually active.
 expect(after.walkerBins).toBeGreaterThanOrEqual(13);
 expect(after.explorerBins).toBeGreaterThanOrEqual(9);
 expect(after.activityBins).toBeGreaterThanOrEqual(14);
 expect(after.nearBoxWalkers).toBeGreaterThanOrEqual(10);
 expect(after.walkerSpanX).toBeGreaterThan(.72);
 expect(after.walkerSpanY).toBeGreaterThan(.66);
 expect(after.lastTransitionTime).toBeGreaterThan(0);
 expect(after.changedRatio).toBeGreaterThan(.0015);

 const quietAlpha=await page.evaluate(()=>{
  const node=document.querySelector<HTMLCanvasElement>('.home-hero .homepage-field__dynamic')!;
  const quiet=document.querySelector<HTMLElement>('.home-hero [data-field-quiet]')!;
  const ctx=node.getContext('2d')!;
  const cr=node.getBoundingClientRect();
  const qr=quiet.getBoundingClientRect();
  const sx=node.width/cr.width,sy=node.height/cr.height;
  const inset=Math.min(24,qr.width*.15,qr.height*.15);
  const x=Math.max(0,Math.floor((qr.left-cr.left+inset)*sx));
  const y=Math.max(0,Math.floor((qr.top-cr.top+inset)*sy));
  const w=Math.max(1,Math.floor((qr.width-inset*2)*sx));
  const h=Math.max(1,Math.floor((qr.height-inset*2)*sy));
  const data=ctx.getImageData(x,y,Math.min(w,node.width-x),Math.min(h,node.height-y)).data;
  let visible=0;for(let i=3;i<data.length;i+=4)if(data[i]>8)visible++;
  return visible/(data.length/4);
 });
 expect(quietAlpha).toBeLessThan(.002);
 expect(errors).toEqual([]);
});
test('hero lattice stays registered after responsive resize',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/');
 const field=page.locator('.homepage-field');
 const base=page.locator('.homepage-field__base');
 const dynamic=page.locator('.homepage-field__dynamic');
 const active=page.locator('.homepage-field__active');

 const assertRegistered=async()=>{
  await page.waitForTimeout(180);
  const geometry=await page.evaluate(()=>{
   const field=document.querySelector<HTMLElement>('.homepage-field')!;
   const base=document.querySelector<HTMLCanvasElement>('.homepage-field__base')!;
   const dynamic=document.querySelector<HTMLCanvasElement>('.homepage-field__dynamic')!;
   const active=document.querySelector<SVGSVGElement>('.homepage-field__active')!;
   const fr=field.getBoundingClientRect();
   const br=base.getBoundingClientRect();
   const dr=dynamic.getBoundingClientRect();
   const ar=active.getBoundingClientRect();
   const vb=active.viewBox.baseVal;
   return{
    field:[fr.width,fr.height],
    base:[br.width,br.height],
    dynamic:[dr.width,dr.height],
    active:[ar.width,ar.height],
    viewBox:[vb.width,vb.height],
    render:[Number(dynamic.dataset.renderWidth),Number(dynamic.dataset.renderHeight)],
    inlineWidth:dynamic.style.width,
    inlineHeight:dynamic.style.height,
   };
  });
  for(const dims of [geometry.base,geometry.dynamic,geometry.active]){
   expect(Math.abs(dims[0]-geometry.field[0])).toBeLessThan(1);
   expect(Math.abs(dims[1]-geometry.field[1])).toBeLessThan(1);
  }
  expect(Math.abs(geometry.viewBox[0]-geometry.field[0])).toBeLessThan(1);
  expect(Math.abs(geometry.viewBox[1]-geometry.field[1])).toBeLessThan(1);
  expect(Math.abs(geometry.render[0]-geometry.field[0])).toBeLessThan(1);
  expect(Math.abs(geometry.render[1]-geometry.field[1])).toBeLessThan(1);
  expect(geometry.inlineWidth).toBe('');
  expect(geometry.inlineHeight).toBe('');
 };

 await assertRegistered();
 const before=Number(await dynamic.getAttribute('data-sim-steps'));

 await page.setViewportSize({width:820,height:780});
 await assertRegistered();
 const mid=Number(await dynamic.getAttribute('data-sim-steps'));
 expect(mid).toBeGreaterThan(before);

 await page.setViewportSize({width:1600,height:960});
 await assertRegistered();
 const after=Number(await dynamic.getAttribute('data-sim-steps'));
 expect(after).toBeGreaterThan(mid);

 await expect(field).toBeVisible();
 await expect(base).toBeVisible();
 await expect(dynamic).toBeVisible();
 await expect(active).toBeVisible();
});

test('hero animation is universal and pauses only when offscreen',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');
 const canvas=page.locator('.home-hero .homepage-field__dynamic');
 await expect(canvas).toHaveAttribute('data-motion-preference','reduce');
 await expect(canvas).toHaveAttribute('data-motion-policy','always-animated');
 await expect(canvas).toHaveAttribute('data-motion','running');
 await expect(canvas).toHaveAttribute('data-motion-reason','animated');
 const before=Number(await canvas.getAttribute('data-sim-steps'));
 await page.waitForTimeout(600);
 const animated=Number(await canvas.getAttribute('data-sim-steps'));
 expect(animated).toBeGreaterThan(before+20);

 await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
 await expect(canvas).toHaveAttribute('data-motion','paused');
 await expect(canvas).toHaveAttribute('data-motion-reason','offscreen');
 await page.waitForTimeout(300);
 const paused=Number(await canvas.getAttribute('data-sim-steps'));
 await page.waitForTimeout(500);
 expect(Number(await canvas.getAttribute('data-sim-steps'))).toBe(paused);

 await page.evaluate(()=>scrollTo(0,0));
 await expect(canvas).toHaveAttribute('data-motion','running');
 await page.waitForTimeout(500);
 expect(Number(await canvas.getAttribute('data-sim-steps'))).toBeGreaterThan(paused+15);
});
test('keyboard access, dark theme and legacy redirect remain intact',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 const field=page.locator('.home-hero .homepage-field__dynamic');
 await expect(field).toHaveAttribute('data-motion','running');
 await expect(field).toHaveAttribute('data-motion-policy','always-animated');
 expect(await page.getByRole('button',{name:/background/i}).count()).toBe(0);
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
 await page.getByRole('button',{name:'Dark theme'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.goto('/course/numerical-methods/01-odes/#euler-method');await expect(page).toHaveURL(/\/courses\/numerical-methods\/01-odes\/#euler-method$/);
});
test('MDX components render and independent enhancements operate',async({page})=>{
 await page.goto('/posts/component-test/');
 await expect(page.locator('scientific-plot')).toHaveCount(2);
 const first=page.locator('scientific-plot').first();await first.locator('input').uncheck();
 await expect(first.locator('polyline')).toHaveAttribute('visibility','hidden');
 await expect(page.locator('scientific-plot').last().locator('polyline')).not.toHaveAttribute('visibility','hidden');
 const sim=page.locator('scientific-simulation').first();await sim.getByRole('button').click();await expect(sim.getByRole('button')).toHaveText('Play playback');
 await sim.getByRole('button').click();await expect(sim.getByRole('button')).toHaveText('Pause playback');await sim.getByRole('button').click();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('homepage hero is centered, expanded and stripped of redundant metadata',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');
 const hero=page.locator('.home-hero');
 const identity=hero.locator('.hero-identity');
 await expect(hero.locator('.homepage-field canvas')).toHaveCount(2);
 await expect(hero.locator('.homepage-field__active')).toHaveCount(1);
 await expect(identity).toBeVisible();
 await expect(hero.locator('.hero-actions')).toHaveCount(0);
 await expect(hero.locator('.hero-details')).toHaveCount(0);
 const geometry=await page.evaluate(()=>{
  const hero=document.querySelector<HTMLElement>('.home-hero')!;
  const box=document.querySelector<HTMLElement>('.hero-identity')!;
  const heading=box.querySelector<HTMLElement>('h1')!;
  const hr=hero.getBoundingClientRect();
  const br=box.getBoundingClientRect();
  return{
   centreOffset:Math.abs((br.left+br.width/2)-(hr.left+hr.width/2)),
   widthRatio:br.width/hr.width,
   height:br.height,
   headingSize:Number.parseFloat(getComputedStyle(heading).fontSize),
  };
 });
 expect(geometry.centreOffset).toBeLessThan(12);
 expect(geometry.widthRatio).toBeGreaterThan(.65);
 expect(geometry.height).toBeGreaterThan(330);
 expect(geometry.headingSize).toBeLessThan(72);
 expect(geometry.headingSize).toBeGreaterThan(38);
});

test('homepage navigation, section order and card labels use the revised UI typography',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/');

 const navLabels=await page.locator('.site-nav a').allTextContents();
 expect(navLabels.slice(0,4)).toEqual(['Research','Blog','Publications','Lecture Notes']);

 const sectionOrder=await page.locator('.homepage-content > section').evaluateAll(nodes=>
  nodes.map(node=>node.id).filter(id=>['research','posts','publications','courses'].includes(id))
 );
 expect(sectionOrder).toEqual(['research','posts','publications','courses']);
 await expect(page.locator('#posts .section-header h2')).toHaveText('Blog posts');
 await expect(page.locator('#publications .section-header h2')).toHaveText('Publications');
 await expect(page.locator('#publications .section-header > a')).toContainText('View all');

 const typography=await page.evaluate(()=>{
  const nav=document.querySelector<HTMLElement>('.site-nav')!;
  const bio=document.querySelector<HTMLElement>('.hero-bio')!;
  const viewAll=document.querySelector<HTMLElement>('#research .section-header > a')!;
  const label=document.querySelector<HTMLElement>('.card-label')!;
  const labelStyle=getComputedStyle(label);
  return{
    navSize:Number.parseFloat(getComputedStyle(nav).fontSize),
    bioFamily:getComputedStyle(bio).fontFamily,
    labelFamily:labelStyle.fontFamily,
    labelDisplay:labelStyle.display,
    labelAlign:labelStyle.alignItems,
    labelLineHeight:Number.parseFloat(labelStyle.lineHeight),
    viewAllSize:Number.parseFloat(getComputedStyle(viewAll).fontSize),
  };
 });
 expect(typography.navSize).toBeGreaterThanOrEqual(13);
 expect(typography.viewAllSize).toBeGreaterThanOrEqual(13);
 expect(typography.labelFamily).toBe(typography.bioFamily);
 expect(['flex','inline-flex']).toContain(typography.labelDisplay);
 expect(typography.labelAlign).toBe('center');
 expect(typography.labelLineHeight).toBeLessThanOrEqual(11);

 const labelStyle=await page.locator('.card-label').first().evaluate(node=>{
   const style=getComputedStyle(node);
   return{textTransform:style.textTransform,fontWeight:Number(style.fontWeight)};
 });
 expect(labelStyle.textTransform).toBe('lowercase');
 expect(labelStyle.fontWeight).toBeLessThanOrEqual(450);

 const metadata=await page.locator('.card-foot span:first-child').evaluateAll(nodes=>nodes.map(node=>{
   const style=getComputedStyle(node);
   return{color:style.color,textTransform:style.textTransform,fontWeight:Number(style.fontWeight)};
 }));
 const signalColor=await page.evaluate(()=>{
   const probe=document.createElement('span');
   probe.style.color=getComputedStyle(document.documentElement).getPropertyValue('--signal').trim();
   document.body.append(probe);
   const color=getComputedStyle(probe).color;
   probe.remove();
   return color;
 });
 expect(metadata.length).toBeGreaterThan(0);
 for(const item of metadata){
   expect(item.color).toBe(signalColor);
   expect(item.textTransform).toBe('lowercase');
   expect(item.fontWeight).toBeLessThanOrEqual(450);
 }
});

test('hero copy, typing roles and footer reflect the revised personal profile',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/');

 await expect(page.locator('.home-contact')).toHaveCount(0);
 await expect(page.locator('.hero-identity h1')).toHaveText('Andreas Neophytou');
 await expect(page.locator('.hero-bio')).toContainText('networked matter');
 await expect(page.locator('.hero-bio')).toContainText('inverse materials design');
 await expect(page.locator('.hero-themes li')).toHaveCount(4);

 const typed=page.locator('[data-hero-typed]');
 await expect(typed).toHaveAttribute('data-roles',/computational scientist/);
 await page.waitForTimeout(420);
 expect((await typed.textContent())?.length).toBeGreaterThan(2);
 await expect(page.locator('.hero-typed-cursor')).toHaveText('▍');

 const sizes=await page.evaluate(()=>{
   const name=document.querySelector<HTMLElement>('.hero-identity h1')!;
   const footer=document.querySelector<HTMLElement>('.site-footer')!;
   return{
     nameSize:Number.parseFloat(getComputedStyle(name).fontSize),
     bodyBg:getComputedStyle(document.body).backgroundColor,
     footerBg:getComputedStyle(footer).backgroundColor,
   };
 });
 expect(sizes.nameSize).toBeLessThan(65);
 expect(sizes.footerBg).not.toBe(sizes.bodyBg);

 await expect(page.locator('.site-footer a[href="mailto:andreas.neophytou@uniroma1.it"]')).toBeVisible();
});


test('header expands at the top and compacts after scroll without overflow',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/');
 const header=page.locator('[data-header]');const track=page.locator('[data-header-track]');
 await expect(header).toHaveAttribute('data-shrunk','false');
 const wide=await track.evaluate((node:HTMLElement)=>node.getBoundingClientRect().width);
 await page.evaluate(()=>scrollTo(0,500));await expect(header).toHaveAttribute('data-shrunk','true');
 await page.waitForTimeout(500);
 const compact=await track.evaluate((node:HTMLElement)=>node.getBoundingClientRect().width);
 expect(compact).toBeLessThan(wide);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.setViewportSize({width:390,height:800});await page.evaluate(()=>scrollTo(0,500));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('homepage cards keep symmetric equal-height rows at desktop width',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');
 for(const selector of ['.research-grid','.course-grid','.publication-grid']){
  const heights=await page.locator(`${selector} > li`).evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().height)));
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(2);
 }
});
