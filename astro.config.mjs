import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypePrettyCode from 'rehype-pretty-code';

export default defineConfig({
  site: 'https://andneo.github.io', // ← UPDATE THIS
  integrations: [mdx(), sitemap()],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      rehypeKatex,
      [rehypePrettyCode, {
        theme: { light: 'github-light', dark: 'github-dark' },
        keepBackground: true,
      }],
    ],
    syntaxHighlight: false,
  },
});
