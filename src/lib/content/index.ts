import { getCollection, type CollectionEntry, type CollectionKey } from 'astro:content';

export const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, 'en');
export const topicSlug = (topic: string) => topic.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const topicsOf = (entry: { data: { tags: string[]; topics: string[] } }) => [...new Set([...entry.data.tags, ...entry.data.topics])].sort();
export async function published<C extends CollectionKey>(collection: C) {
  return (await getCollection(collection)).filter(entry => !entry.data.draft).sort(byId);
}
export const url = (kind: 'post' | 'project' | 'publications' | 'courses' | 'chapters', id: string) =>
  `/${({ post: 'posts', project: 'research', publications: 'publications', courses: 'courses', chapters: 'courses' } as const)[kind]}/${id}/`;

export function orderChapters(entries: CollectionEntry<'chapters'>[]) {
  const compare = (a: CollectionEntry<'chapters'>, b: CollectionEntry<'chapters'>) => a.data.order - b.data.order || byId(a,b);
  const roots = entries.filter(e => !e.data.parent).sort((a,b) => Number(a.data.kind === 'appendix') - Number(b.data.kind === 'appendix') || compare(a,b));
  return roots.flatMap(root => [root, ...entries.filter(e => e.data.parent === root.id).sort(compare)]);
}
export async function courseChapters(course: string) {
  const overview = (await published('courses')).find(e => e.id === course);
  return overview ? orderChapters((await published('chapters')).filter(e => e.data.course === course)) : [];
}

/** Validate the entire graph, including drafts, before rendering any public page. */
export async function validateContent() {
  const [posts, courses, chapters, projects, publications] = await Promise.all([
    getCollection('post'), getCollection('courses'), getCollection('chapters'), getCollection('project'), getCollection('publications'),
  ]);
  const requireRef = (id: string, entries: {id: string; data: {draft: boolean}}[], source: {id: string; data: {draft: boolean}}) => {
    const target = entries.find(e => e.id === id);
    if (!target) throw new Error(`${source.id}: unknown reference ${id}`);
    if (!source.data.draft && target.data.draft) throw new Error(`${source.id}: public entry references draft ${id}`);
  };
  const seen = new Set<string>();
  const unique = (key: string) => { if (seen.has(key)) throw new Error(`Duplicate content key: ${key}`); seen.add(key); };
  for (const course of courses) {
    if (course.id !== course.data.course) throw new Error(`${course.id}: course ID must match course field`);
  }
  for (const chapter of chapters) {
    // Draft course suppresses its public children; it is valid to prepare them together.
    if (!courses.some(c => c.id === chapter.data.course)) throw new Error(`${chapter.id}: missing course overview`);
    if (!chapter.id.startsWith(chapter.data.course + '/')) throw new Error(`${chapter.id}: chapter ID must start with course/`);
    unique(`chapter:${chapter.data.course}:${chapter.data.parent ?? chapter.data.kind}:${chapter.data.order}`);
    if (chapter.data.parent) {
      requireRef(chapter.data.parent, chapters, chapter);
      const parent = chapters.find(p => p.id === chapter.data.parent)!;
      if (parent.data.kind !== 'chapter' || parent.data.course !== chapter.data.course) throw new Error(`${chapter.id}: invalid section parent`);
    }
  }
  for (const post of posts) {
    post.data.projects.forEach(id => requireRef(id, projects, post));
    post.data.related.forEach(id => requireRef(id, posts, post));
    if (post.data.series) unique(`series:${post.data.series}:${post.data.seriesOrder}`);
  }
  projects.forEach(project => project.data.publications.forEach(id => requireRef(id, publications, project)));
  for (const [kind, entries] of Object.entries({ post: posts, courses, chapters, project: projects, publications })) {
    for (const entry of entries) {
      if (entry.data.updated && 'date' in entry.data && entry.data.date && entry.data.updated < entry.data.date) throw new Error(`${entry.id}: updated precedes publication`);
      unique(`route:${url(kind as Parameters<typeof url>[0], entry.id)}`);
      entry.data.aliases.forEach(alias => unique(`route:${alias}`));
    }
  }
}
