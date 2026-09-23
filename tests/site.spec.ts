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
test('hero motion, keyboard access, dark theme and legacy redirect',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.getByRole('button',{name:'Play animation'})).toBeVisible();
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
