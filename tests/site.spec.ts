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
 const canvas=hero.locator('.homepage-field canvas');
 await expect(canvas).toBeVisible();
 await expect(canvas).toHaveAttribute('data-motion','running');
 await expect(canvas).toHaveAttribute('data-motion-preference','no-preference');
 await expect(canvas).toHaveAttribute('data-motion-override','none');
 await expect(canvas).toHaveAttribute('data-motion-reason','animated');
 await expect(canvas).toHaveAttribute('data-lattice','kagome');
 await expect(canvas).toHaveAttribute('data-layers','base-trail-active');
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

 await page.waitForTimeout(800);

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
 expect(after.lastTransitionTime).toBeGreaterThan(0);
 expect(after.changedRatio).toBeGreaterThan(.0015);

 const quietAlpha=await page.evaluate(()=>{
  const node=document.querySelector<HTMLCanvasElement>('.home-hero .homepage-field canvas')!;
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
test('hero motion override can animate when system preference is reduced',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/?motion=full');
 const canvas=page.locator('.home-hero .homepage-field canvas');
 await expect(canvas).toHaveAttribute('data-motion-preference','reduce');
 await expect(canvas).toHaveAttribute('data-motion-override','full');
 await expect(canvas).toHaveAttribute('data-motion','running');
 await expect(canvas).toHaveAttribute('data-motion-reason','animated');
 const before=Number(await canvas.getAttribute('data-sim-steps'));
 await page.waitForTimeout(500);
 const after=Number(await canvas.getAttribute('data-sim-steps'));
 expect(after).toBeGreaterThan(before+15);
});
test('reduced motion, keyboard access, dark theme and legacy redirect',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 const field=page.locator('.home-hero .homepage-field canvas');await expect(field).toHaveAttribute('data-motion','static');await expect(field).toHaveAttribute('data-motion-preference','reduce');await expect(field).toHaveAttribute('data-motion-override','none');await expect(field).toHaveAttribute('data-motion-reason','system-reduced-motion');await expect(field).toHaveAttribute('data-lattice','kagome');
 expect(await page.getByRole('button',{name:/background/i}).count()).toBe(0);
 const staticFrame=await field.evaluate((node:HTMLCanvasElement)=>node.toDataURL());
 await page.waitForTimeout(350);
 expect(await field.evaluate((node:HTMLCanvasElement)=>node.toDataURL())).toBe(staticFrame);
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
