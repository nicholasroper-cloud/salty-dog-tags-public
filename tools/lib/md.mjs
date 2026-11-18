// A deliberately tiny Markdown subset for the long-form pages (privacy, policies, Utah). No dependencies.
//   ## Heading {#anchor}     paragraphs     - bullets     1. numbered     **bold**  *italic*  [text](url)
//   a line that starts with "<" passes through untouched (used for <!--markers--> and the odd bit of HTML)
// Everything else is HTML-escaped, so a stray "<" or "&" in the copy can never break the page.
import { esc } from './shell.mjs';

export function inline(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${/^https?:/.test(u) ? ' rel="noopener"' : ''}>${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  return s;
}

export function renderMd(src, { h2Class = '' } = {}) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = []; let para = []; let list = null; let ordered = false;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${ordered ? 'ol' : 'ul'}>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    let m;
    if ((m = /^## (.+?)(?:\s*\{#([\w-]+)\})?$/.exec(line))) { flushPara(); flushList(); out.push(`<h2${m[2] ? ` id="${m[2]}"` : ''}${h2Class ? ` class="${h2Class}"` : ''}>${inline(m[1])}</h2>`); continue; }
    if (line.startsWith('# ')) continue; // the page template owns the H1
    if (line.startsWith('<')) { flushPara(); flushList(); out.push(line); continue; }
    if ((m = /^- (.+)$/.exec(line))) { flushPara(); if (!list || ordered) { flushList(); list = []; ordered = false; } list.push(m[1]); continue; }
    if ((m = /^\d+\. (.+)$/.exec(line))) { flushPara(); if (!list || !ordered) { flushList(); list = []; ordered = true; } list.push(m[1]); continue; }
    if (list && /^\s+\S/.test(raw)) { list[list.length - 1] += ' ' + line.trim(); continue; } // wrapped list item
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}
