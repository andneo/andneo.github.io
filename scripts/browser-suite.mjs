import {writeFileSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Temporary UI test material only. Never committed or included in deployment output.
const fixtures={
 'src/content/post/component-test.mdx':`---
title: Component interface test
description: Temporary non-scientific UI fixture
date: 2026-01-01
draft: false
---
import Figure from '../../components/content/Figure.astro';
import FigureGrid from '../../components/content/FigureGrid.astro';
import Video from '../../components/content/Video.astro';
import CodeExample from '../../components/content/CodeExample.astro';
import Callout from '../../components/content/Callout.astro';
import Download from '../../components/content/Download.astro';
import Citation from '../../components/content/Citation.astro';
import Reference from '../../components/content/Reference.astro';
import Equation from '../../components/content/Equation.astro';
import Exercise from '../../components/content/Exercise.astro';
import InteractivePlot from '../../components/content/InteractivePlot.astro';
import Simulation from '../../components/content/Simulation.astro';

## Components

<FigureGrid><Figure src="/__test.svg" alt="Test circle" caption="UI fixture" width={100} height={100}/><Figure src="/__test.svg" alt="Test circle" width={100} height={100}/></FigureGrid>
<Callout title="Fixture">Interface test only.</Callout>
<CodeExample code="print(1)" lang="python" title="test.py"/>
<Video src="/__test.mp4" poster="/__test.svg" caption="Silent UI fixture"/>
<Download href="/__test.json" label="Fixture data"/>
<Citation id="fixture" label="1"/><Reference id="fixture">Test reference.</Reference>
<Equation id="eq-test" label="1">$x=1$</Equation>
<Exercise title="UI exercise"><p>Test prompt.</p><div slot="solution">Test answer.</div></Exercise>
<InteractivePlot title="Test plot" description="UI fixture" xLabel="x" yLabel="y" series={[{label:'A',points:[[0,0],[1,1]]}]}/>
<InteractivePlot title="Second test plot" description="UI fixture" xLabel="x" yLabel="y" series={[{label:'B',points:[[0,1],[1,0]]}]}/>
<Simulation title="Playback fixture" description="Two test points" src="/__test.json" poster="/__test.svg"/>
`,
 'public/__test.svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>',
 'public/__test.json':JSON.stringify({fps:5,frames:[[[.2,.3],[.4,.5]],[[.3,.3],[.4,.6]]]}),
 'public/__test.mp4':'',
};
for(const name of Object.keys(fixtures))if(existsSync(name))throw new Error(`Refusing to overwrite ${name}`);
const run=(args)=>spawnSync('npm',args,{stdio:'inherit'}).status??1;
let status=1;
try{for(const [name,body] of Object.entries(fixtures))writeFileSync(name,body);status=run(['run','build']);if(!status)status=run(['exec','playwright','test']);}
finally{for(const name of Object.keys(fixtures))rmSync(name,{force:true});if(Object.keys(fixtures).some(existsSync))throw new Error('Fixture cleanup failed');const production=run(['run','build']);if(!status)status=production;if(Object.keys(fixtures).some(existsSync)||existsSync('dist/posts/component-test'))throw new Error('Test fixtures remain after production rebuild; do not deploy');}
process.exit(status);
