/**
 * preview.js
 * markdown-it render module with footnote + katex plugins.
 * Exposes: render(markdownString) → HTML string
 */

import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItKatex from 'markdown-it-katex';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})
  .use(markdownItFootnote)
  .use(markdownItKatex);

/**
 * Render markdown string to HTML.
 * @param {string} markdownString
 * @returns {string} HTML string
 */
export function render(markdownString) {
  return md.render(markdownString);
}
