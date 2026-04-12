import { defineCollection, z } from 'astro:content';

// Blog / tutorial posts
const post = defineCollection({
  type: 'content',
  schema: z.object({
    title:       z.string(),
    subtitle:    z.string().optional(),
    description: z.string().optional(),
    date:        z.coerce.date(),
    tags:        z.array(z.string()).default([]),
    draft:       z.boolean().default(false),
    // Optional thumbnail — place images in /public/images/posts/
    image:       z.string().optional(),
    // Approximate reading time in minutes; auto-computed if omitted
    readingTime: z.number().optional(),
  }),
});

// Publications (what was "newsletter" in the reference — your papers)
const publications = defineCollection({
  type: 'content',
  schema: z.object({
    title:       z.string(),
    authors:     z.array(z.string()),          // Your name will be bolded
    journal:     z.string().optional(),        // Journal/conference name
    year:        z.number(),
    status:      z.enum(['published', 'working-paper', 'forthcoming']).default('published'),
    // Links
    pdf:         z.string().optional(),        // path like /files/paper.pdf
    slides:      z.string().optional(),
    arxiv:       z.string().optional(),        // arXiv ID, e.g. "2401.12345"
    doi:         z.string().optional(),
    repo:        z.string().optional(),        // GitHub URL
    // Optional featured image shown in card
    image:       z.string().optional(),
    abstract:    z.string().optional(),
    tags:        z.array(z.string()).default([]),
    draft:       z.boolean().default(false),
    featured:    z.boolean().default(false),
  }),
});

// Research projects (shown in the Research section)
const project = defineCollection({
  type: 'content',
  schema: z.object({
    title:       z.string(),
    description: z.string(),
    image:       z.string().optional(),
    tags:        z.array(z.string()).default([]),
    links: z.array(z.object({
      label: z.string(),
      href:  z.string(),
    })).default([]),
    date:        z.coerce.date().optional(),
    draft:       z.boolean().default(false),
    order:       z.number().default(99),       // lower = shown first
  }),
});

// Lecture note courses — each course is a folder; chapters are MDX files inside
const course = defineCollection({
  type: 'content',
  schema: z.object({
    title:       z.string(),
    subtitle:    z.string().optional(),
    description: z.string().optional(),
    // For course index pages (chapter: 0) and chapter pages (chapter: 1, 2, …)
    chapter:     z.number().default(0),
    course:      z.string(),                   // slug, e.g. "stellar-dynamics"
    tags:        z.array(z.string()).default([]),
    date:        z.coerce.date().optional(),
    draft:       z.boolean().default(false),
  }),
});

export const collections = { post, publications, project, course };
