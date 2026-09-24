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
test('hero lattice network is visible, animated and bounded',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');
 const hero=page.locator('.home-hero');const canvas=hero.locator('.homepage-field canvas');
 await expect(canvas).toBeVisible();await expect(canvas).toHaveAttribute('data-motion','running');
 await expect(canvas).toHaveAttribute('data-lattice','kagome');
 await expect(canvas).toHaveAttribute('data-quiet-zones','1');
 const nodes=Number(await canvas.getAttribute('data-nodes'));
 const edges=Number(await canvas.getAttribute('data-edges'));
 const walkers=Number(await canvas.getAttribute('data-walkers'));
 expect(nodes).toBeGreaterThan(100);expect(nodes).toBeLessThan(5000);
 expect(edges).toBeGreaterThan(nodes);expect(edges).toBeLessThan(12000);
 expect(walkers).toBeGreaterThan(20);expect(walkers).toBeLessThanOrEqual(70);
 expect(await page.locator('.home-section .homepage-field').count()).toBe(0);
 const layer=await page.locator('homepage-background').evaluate((node:HTMLElement)=>Number(getComputedStyle(node).zIndex));
 const contentLayer=await page.locator('.hero-frame').evaluate((node:HTMLElement)=>Number(getComputedStyle(node).zIndex));
 expect(layer).toBeGreaterThanOrEqual(1);expect(contentLayer).toBeGreaterThan(layer);
 const alpha=await canvas.evaluate((node:HTMLCanvasElement)=>{
  const ctx=node.getContext('2d')!;const data=ctx.getImageData(0,0,node.width,node.height).data;
  let nonzero=0;for(let i=3;i<data.length;i+=4)if(data[i]>10)nonzero++;
  return nonzero/(data.length/4);
 });
 expect(alpha).toBeGreaterThan(.005);
 const before=await canvas.evaluate((node:HTMLCanvasElement)=>node.toDataURL());
 await page.waitForTimeout(800);
 const after=await canvas.evaluate((node:HTMLCanvasElement)=>node.toDataURL());
 expect(after).not.toBe(before);
});
test('reduced motion, keyboard access, dark theme and legacy redirect',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 const field=page.locator('.home-hero .homepage-field canvas');await expect(field).toHaveAttribute('data-motion','static');await expect(field).toHaveAttribute('data-lattice','kagome');
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
