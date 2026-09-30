# Recovery checkpoint — 23 September 2026

Recovery found local commits for milestones A–E and uncommitted milestone F work on `redesign/scientific-site`. Both remote branches still pointed to `c6c3d53`; no redesign work was on `main`. The starting build succeeded. Original scientific Markdown/MDX bodies and original public assets were preserved.

F repairs corrected resource URL handling, BibTeX escaping and Node type configuration before committing the research system. G isolated the inherited decorative particle renderer behind lifecycle controls and a static fallback. It does not claim to be a new scientific model or an author-supplied precomputed trajectory.

| Milestone | Verified state |
|---|---|
| A | Generated dependencies removed from tracking; reproducible lockfile, Node version, Pages workflow and baseline route checks |
| B | Strict frontmatter schemas, cross-reference/order validation, drafts and automatic discovery |
| C | Shared responsive shell, central configuration, design tokens, theme control, focus styles and metadata |
| D | Documented scientific MDX components, native static plots and optional trajectory playback; browser interactions pass in CI |
| E | Automatic post/course routes, textbook order/hierarchy, previous/next, contents, series/topics and compatibility redirects |
| F | Research narratives, connected publication metadata, resources/backlinks and BibTeX export |
| G | Modular landing renderer with pause, reduced-motion, visibility and static fallback; automated browser checks pass in CI |
| H | Author docs, HTML/link/hygiene checks, feeds/sitemap, browser suite and CI gates added; automated browser checks pass; manual visual review and deployed-site verification outstanding |

## Validation evidence

- `npm run validate`: Astro type checking passes; production build passes with 43 HTML pages; all 14 baseline routes pass; internal links, fragments, IDs, landmarks, image alternatives and generated-file tracking checks pass.
- All eight original scientific Markdown/MDX bodies compare unchanged against `c6c3d53` after frontmatter. Existing publication alias changes metadata only.
- The temporary MDX component fixture builds successfully. Fixtures were removed and the production build rechecked.
- Chromium and headless-shell downloads both returned invalid/truncated archives in the execution environment. The browser suite subsequently reached browser launch and failed because the executable was absent. Local browser execution remained blocked. GitHub Actions subsequently installed Chromium and passed the complete 15-test browser suite, including responsive overflow, axe, no-JavaScript, keyboard/theme, redirects and component controls.
- Astro 7's agent-triggered preview backgrounding required the documented `--ignore-lock` foreground option for Playwright. Test fixtures are explicitly forbidden by final production validation.

## Remaining release work

GitHub Actions run [35911967539](https://github.com/andneo/andneo.github.io/actions/runs/35911967539) passed the clean install, validation, browser suite and final production check on commit `f9c30a6`. Deployment was correctly skipped on the redesign branch. Manually inspect visual composition, keyboard/screen-reader usability and media before merging. Merge and live Pages deployment remain separate review actions. Existing template identity and unavailable legacy downloads require the author's own material; external scientific references were not verified or rewritten. Search, a citation processor, a 3-D viewer and new scientific hero models remain optional future work.
