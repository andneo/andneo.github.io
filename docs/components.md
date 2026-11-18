# Scientific MDX components

Import only what you use, for example:

```mdx
import Figure from '@/components/content/Figure.astro';
import plot from './figures/plot.png';

<Figure src={plot} alt="Describe the plotted relationship" caption="Explain the figure and units." />
```

These are interface examples, not scientific content. Ordinary Markdown supports fenced code, `$inline$` and `$$display$$` mathematics, footnotes, lists, tables and images without components.

| Component | Required props | Optional props / content |
|---|---|---|
| Figure | src (imported image or URL), alt | caption, id, width, height, background="light"; caption slot |
| FigureGrid | — | columns=2 or 3; Figure children |
| Video | src (MP4), poster, caption | webm, width, height, captions (VTT), transcript (URL) |
| CodeExample | code | lang, title, download |
| Callout | title | kind=note/warning/definition; content slot |
| Download | href, label | format, size |
| Citation | id, label | Links to matching Reference |
| Reference | id | href; formatted reference in slot |
| Equation | id | label; mathematical content in slot |
| Exercise | title | id; default problem slot, named solution slot |
| InteractivePlot | title, description, series, xLabel, yLabel | download |
| Simulation | title, description, src, poster | renderer="trajectory" |

`CodeExample` can receive actual source through `import code from './example.py?raw'`. Plain fenced blocks remain preferable for short inline examples.

`InteractivePlot` accepts `series=[{label: 'Name', points: [[x,y], ...]}]`. It renders a static SVG and data table without JS. Checkboxes progressively add series visibility. Use small datasets (hundreds of points); large data belongs in a dedicated Canvas renderer, not a giant HTML table.

`Simulation` reads JSON `{ "fps": 24, "frames": [[[0.1,0.2],[0.4,0.5]], ...] }`. Each frame contains normalised x/y pairs. Supply your own exported trajectory and poster. Loading and playback require explicit actions; playback pauses offscreen/inactive. No physics is calculated or implied. Keep exports small. New live models belong in `src/interactive/`, isolated from content.

Citations are intentionally explicit static references; this release does not parse BibTeX or implement citation styles. Use unique reference/equation IDs per page. Links are checked after build.

For URL images provide intrinsic width and height to reserve space. Imported images are processed by Astro. Provide meaningful alt text, captions/units and static explanations; never rely on an interactive alone to convey a result.
