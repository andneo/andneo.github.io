# Academic website

Static Astro website deployed to GitHub Pages.

## Local development

Use Node 24 LTS (see `.nvmrc`). From a clean clone:

```sh
npm ci
npm run dev
```

Validate the production build:

```sh
npm run validate
npm run preview
```

`npm ci` installs the exact dependency lockfile. Do not commit `node_modules`, `.astro`, or `dist`.

## Contributing and deployment

Work on a feature branch, review the diff, and open a pull request. CI builds pull requests and redesign branches. Only a successful build on `main` can deploy through the GitHub Pages environment. In repository Settings → Pages, the source must be GitHub Actions.

Pushing a feature branch does not publish the site. Merging into `main` publishes it. Roll back by reverting a merged change and allowing CI to rebuild.

## Authoring

See [authoring and maintenance](docs/authoring.md) for posts, courses, chapters, research, publications, scientific media, interactive components and deployment. See [component interfaces](docs/components.md) for MDX props. Run `npx playwright install chromium --only-shell` followed by `npm run test:browser` for browser checks.

## Baseline

The unmodified commit `c6c3d53e2361fb25fb6361d999434a1b6ac561dc` installed cleanly and built 14 pages on Node 24.19.0. `scripts/baseline-routes.json` preserves those URL targets through the redesign. Existing missing downloads and template identity/content are pre-existing; scientific prose is not changed by the infrastructure migration.
