# Authoring and maintenance

Content examples below describe interfaces, not publishable scientific material. Replace example values with your own. Existing identity, CV and scientific prose were retained from the original repository; review them before using the site for applications.

## Install, preview, validate, deploy

Use Node 24 (`nvm use` if using nvm), then `npm ci` and `npm run dev`. Run `npm run validate` before committing: it checks types, builds, checks the original URLs and checks all generated HTML internal links, fragments, landmarks and image alternatives. `npm run preview` serves the production build.

For browser checks, run `npx playwright install chromium --only-shell`, then `npm run test:browser`. Linux CI uses `--with-deps` as well. The suite temporarily creates explicitly labelled component fixtures, exercises the real production build at mobile/desktop widths with axe accessibility checks, and removes the fixtures and rebuilds before returning. Never interrupt it intentionally; after an abrupt process kill, remove only the labelled `component-test.mdx` and `public/__test.*` fixtures before building. Automated accessibility checks supplement keyboard, screen-reader and visual review.

Create a feature branch, edit, validate, inspect `git diff`, commit and push. Open a pull request against `main`. GitHub Actions validates branches and pull requests; only `main` deploys. Set Settings → Pages → Source to **GitHub Actions**. Merge after review to publish. Check the Actions deployment and live URLs. Revert a merged commit to roll back. No hosting service or application server is needed. The legacy `push_to_repo.sh` predates this workflow; use ordinary Git commands instead.

## Content conventions

- Collections live under `src/content/`. Use `.md` for ordinary prose and `.mdx` when importing components. Never edit route files to add normal entries.
- All collections default to `draft: true`. Set `draft: false` to publish. Drafts are omitted from routes, indexes, feeds and sitemap; they are still validated. A draft course also suppresses its chapters.
- IDs come from relative filenames without extensions or trailing `/index`. Use lowercase letters, digits and hyphens. An explicit `slug` overrides the ID; chapter slugs must include `course-id/`. Pick stable IDs, independent of titles and order. References use IDs, not URLs.
- Shared fields: `title`, `description`, `subtitle`, `slug`, `draft`, `tags`, `topics`, `updated`, `image`, `imageAlt`, `aliases`, `resources`. Unknown frontmatter fields fail the build. Dates use `YYYY-MM-DD`; `updated` cannot precede `date`.
- Use root-relative links such as `/courses/course-id/chapter-id/`. Add `aliases: ["/old/path/"]` when deliberately moving a page. Aliases create static redirect pages with a visible fallback link. Preserve the existing `/course/` and `/project/` compatibility routes.
- Tags and topics feed the same topic index. Keep spelling/capitalisation consistent: conflicting normalised topic IDs fail validation.
- Resources are objects with `label`, `href`, and optional `kind` (`code`, `data`, `slides`, `paper`, `download`, `other`). Use local absolute paths or HTTP(S) URLs. Broken local links fail final validation; optional missing legacy downloads are displayed as unavailable.

## Add a post

Create `src/content/post/your-post.mdx`:

```yaml
---
title: Your title
description: Your summary
date: 2026-01-01
draft: true
tags: []
---
```

Write your prose below the frontmatter. Set `draft: false` when ready. The URL is `/posts/your-post/`. Optional `series: your-series` and positive integer `seriesOrder: 1` must be supplied together. Related posts use `related: [other-post-id]`; research links use `projects: [project-id]`. Dates determine post ordering; series order determines series navigation. Posts automatically enter RSS.

## Add a course and chapter

Create `src/content/course/your-course/index.md` with `title`, `description`, `course: your-course`, and `draft: true`. Optional fields: `level`, string arrays `prerequisites` and `objectives`, and `status` (`developing`, `complete`, `archived`). Write the course overview below the frontmatter.

Create `src/content/course/your-course/your-chapter.mdx` with:

```yaml
---
title: Your chapter title
course: your-course
order: 10
draft: true
---
```

Navigation and previous/next links update automatically. Leave gaps in order values for future insertion; filenames need not contain numbers. Publish both overview and chapter. The chapter URL is `/courses/your-course/your-chapter/`.

For a section, add `kind: section`, `parent: your-course/your-chapter` and a sibling `order`. The hierarchy intentionally supports chapters and one level of sections. For deeper subdivisions use headings within the section. Appendices use `kind: appendix`; they appear after chapters. Orders must be unique within their sibling group. Optional chapter `date` and `objectives` are supported. Headings at levels 2–3 populate the on-page contents automatically. Use Exercise for optional exercises/solutions.

## Add a research project

Create `src/content/project/your-project.mdx` with `title`, required `description`, and `draft: true`. Optional `question`, `contribution`, `role`, `methods` (string array), `status` (`ongoing`, `completed`, `archived`), `date`, `order`, `publications` (publication IDs), and `resources` add structured context. The MDX body contains your narrative, figures and methods. `/research/your-project/` is generated automatically. Publications link back to projects; posts using `projects` appear as related reading. Nothing requires inventing a project status or personal contribution.

## Add a publication

Create `src/content/publications/your-paper.mdx` with `title`, `authors: ["Author One", "Author Two"]`, integer `year`, and `draft: true`. Optional fields include `journal`, `abstract`, `doi` (bare DOI), `arxiv` (identifier), `pdf`, `slides`, `repo`, `featured`, `status` (`published`, `working-paper`, `forthcoming`) and `type` (`article`, `conference`, `preprint`, `thesis`, `chapter`, `other`). Set status explicitly for unpublished work. The optional body can explain the paper. The record generates `/publications/your-paper/`, its index entry, citation metadata and an entry in `/publications.bib`.

## Images, files and scientific source

Keep article-specific images next to the content, e.g. `src/content/post/figures/your-post/plot.png`, and import them into Figure in MDX for build-time optimisation. Use SVG for suitable vector figures and PNG/WebP for raster figures. Supply meaningful alternative text and captions. Imported dimensions avoid layout shift. Shared static assets and downloads live in `public/`, exposed at the same root-relative path: `public/downloads/project/data.csv` becomes `/downloads/project/data.csv`. Provide file format and size with Download. Prefer stable, descriptive names.

Keep reproducible Python/Fortran/C/C++/shell sources in a clearly named project folder such as `scientific/your-project/`, with instructions and a separate environment manifest. This folder is for optional offline authoring; it does not run in the website build. Do not commit virtual environments, compiler outputs, caches, raw simulation dumps or credentials. Small curated source/data can be copied into `public/downloads/`; large datasets belong in an appropriate archive/repository linked through resources. Inspect size and licensing before committing binary media.

## Code, video, plots and simulations

Plain fenced code supports language highlighting; `$...$` and `$$...$$` render mathematics at build time. For downloadable or imported source use CodeExample with `import code from './example.py?raw'`. See [component interfaces](components.md) for every prop and example.

Render Blender work offline. Export compressed WebM and MP4 with a poster image; place them under `public/media/project/` and use Video. Supply VTT captions and/or a transcript when sound communicates content. Video never autoplays. Keep `.blend` files and large originals outside the site; link their archive if needed.

InteractivePlot accepts small arrays of labelled x/y series and always renders SVG plus a data table. No plotting framework or network load is required. For larger plots, export a static Python-generated figure with downloads first. The inherited orbital Plotly example is explicitly loaded by the reader from its existing pinned CDN; it is isolated from the reusable plot component.

Simulation takes a poster and a URL to precomputed normalised particle trajectories. It fetches only after an explicit load action and pauses when hidden. See the JSON contract in [components](components.md). Offline computation remains the default. WebGL, Three.js/GLB viewers, WebGPU and Pyodide are not dependencies of this release; add a separate renderer only when a specific scientific interaction justifies it, with a static fallback.

## Shared presentation and hero

Identity, site URL, navigation, social links and hero selection are in `src/data/site.json`; CV data is in `src/data/cv.json`. Do not duplicate these in pages. Set the canonical site URL before deploying elsewhere. Design tokens and reading styles live in `src/styles/global.css`; layouts do not belong in content files.

The hero shell is `src/components/HeroSim.astro`; lifecycle and renderer registry are in `src/interactive/hero/controller.ts`. The existing decorative particle model is in `particles.js`. A replacement renderer implements `resize`, `step`, `draw`, `dispose` and registers a key selected through `HERO.renderer`. The shell owns pause, visibility, reduced-motion and failure behaviour. Keep scientific interpretation in authored content, not in the decorative renderer. `HERO.enabled: false` disables its enhancement while retaining the static illustration.

## Known limits and manual checks

Search, automatic BibTeX citation styles, arbitrary-depth textbook sections and interactive 3-D are deferred. Explicit references work today. Static GitHub Pages redirects are HTML redirects, not HTTP 301 responses. External URLs are not automatically fetched; verify DOI, repositories and archives manually. The inherited template identity and missing CV/project downloads require the author's actual material, and were not fabricated during migration.

Before a release, review keyboard focus, light/dark contrast, small screens, 200% zoom, reduced motion, media descriptions and the deployed Pages URL. Automated axe and link checks cannot establish complete accessibility or scientific accuracy.
