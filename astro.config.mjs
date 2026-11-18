import site from './src/data/site.json' with { type: 'json' };
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypePrettyCode from 'rehype-pretty-code';

export default defineConfig({
  site: site.SITE_URL,
  integrations: [mdx()],
  output: 'static',
  compressHTML: true,
  trailingSlash: 'always',
  markdown: {
    processor: unified({
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      rehypeKatex,
      [rehypePrettyCode, {
        theme: { light: 'github-light', dark: 'github-dark' },
        keepBackground: true,
      }],
    ],
    }),
    syntaxHighlight: false,
  },
});
