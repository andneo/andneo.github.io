import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const path = z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/);
const href = z.string().refine(v => /^https?:\/\//.test(v) || /^\/(?!\/)/.test(v), 'Use an https URL or an absolute site path');
const resource = z.object({ label: z.string().min(1), href, kind: z.enum(['code', 'data', 'slides', 'paper', 'download', 'other']).default('other') });
const common = {
  title: z.string().min(1), description: z.string().optional(), subtitle: z.string().optional(),
  slug: path.optional(), tags: z.array(z.string().min(1)).default([]), topics: z.array(z.string().min(1)).default([]),
  draft: z.boolean().default(true), updated: z.coerce.date().optional(), image: z.string().optional(),
  imageAlt: z.string().optional(), aliases: z.array(z.string().regex(/^\/(?!\/).*\/$/)).default([]),
  resources: z.array(resource).default([]),
};
const loader = (base: string, pattern: string | string[] = '**/*.{md,mdx}') => glob({ base, pattern,
  generateId: ({ entry, data }) => String(data.slug ?? entry.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '')),
});
const post = defineCollection({ loader: loader('./src/content/post'), schema: z.object({ ...common,
  date: z.coerce.date(), readingTime: z.number().positive().optional(),
  series: slug.optional(), seriesOrder: z.number().int().positive().optional(),
  related: z.array(path).default([]), projects: z.array(path).default([]),
}).strict().refine(v => Boolean(v.series) === Boolean(v.seriesOrder), 'series and seriesOrder must be supplied together') });
const courses = defineCollection({ loader: loader('./src/content/course', '*/index.{md,mdx}'), schema: z.object({ ...common,
  course: slug, level: z.string().optional(), prerequisites: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]), status: z.enum(['developing','complete','archived']).default('developing'),
}).strict() });
const chapters = defineCollection({ loader: loader('./src/content/course', ['**/*.{md,mdx}', '!*/index.{md,mdx}']), schema: z.object({ ...common,
  course: slug, order: z.number().int().positive(), kind: z.enum(['chapter','section','appendix']).default('chapter'),
  parent: path.optional(), date: z.coerce.date().optional(), objectives: z.array(z.string()).default([]),
}).strict().refine(v => (v.kind === 'section') === Boolean(v.parent), 'Only sections require a parent chapter ID') });
const project = defineCollection({ loader: loader('./src/content/project'), schema: z.object({ ...common,
  description: z.string().min(1), question: z.string().optional(), contribution: z.string().optional(), role: z.string().optional(),
  status: z.enum(['ongoing','completed','archived']).default('ongoing'), methods: z.array(z.string()).default([]),
  publications: z.array(path).default([]), links: z.array(resource).default([]),
  date: z.coerce.date().optional(), order: z.number().int().default(99),
}).strict() });
const publications = defineCollection({ loader: loader('./src/content/publications'), schema: z.object({ ...common,
  authors: z.array(z.string().min(1)).min(1), year: z.number().int().min(1800).max(2200),
  journal: z.string().optional(), status: z.enum(['published','working-paper','forthcoming']).default('published'),
  type: z.enum(['article','conference','preprint','thesis','chapter','other']).default('article'),
  pdf: href.optional(), slides: href.optional(), arxiv: z.string().optional(), doi: z.string().optional(), repo: href.optional(),
  abstract: z.string().optional(), featured: z.boolean().default(false),
}).strict() });
export const collections = { post, courses, chapters, project, publications };
