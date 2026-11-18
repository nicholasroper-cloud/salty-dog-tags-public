// A static engraving preview for the single-saying pages: the same vector tag the builder draws as its fallback renderer
// (site/app.js tagSVGVector, no photo-blank art), using the builder's own shape outlines and finish colours.
// Archivo 700 is already loaded on every page, so the text needs no extra font.
import { appData } from './appdata.mjs';
import { esc } from './shell.mjs';

const d = appData();
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const rgb = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (c, t, amt) => rgb(hex(c).map((v, i) => v + (hex(t)[i] - v) * amt));

export function tagSvg({ shape, finish, lines, id, label }) {
  const f = d.FINISHES[finish]; const sp = d.shapeSpec(shape); const { body, area, hole } = sp;
  const L = lines.filter(Boolean).slice(0, 4);
  const maxLen = Math.max(1, ...L.map((l) => l.length)); const n = Math.max(1, L.length);
  const fs = Math.max(11, Math.floor(Math.min(30, area.w / (maxLen * 0.64), area.h / (n * 1.2))));
  const lh = fs * 1.18; const top = area.cy - ((n - 1) * lh) / 2 + fs * 0.36;
  const text = L.map((l, i) => `<text x="${area.cx}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${fs}">${esc(l.toUpperCase())}</text>`).join('');
  const fill = f.kind === 'stainless' ? '#C9CED4' : f.kind === 'brass' ? '#D2AB5C' : f.c;
  const edge = f.kind === 'stainless' ? '#7F868F' : f.kind === 'brass' ? '#8A6A2A' : mix(f.c, '#000000', 0.4);
  const ink = f.ink === 'light' ? '#EDEFF2' : '#26292E';
  const inkShadow = f.ink === 'light' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
  const hi = f.kind === 'anodized' ? mix(f.c, '#ffffff', 0.25) : '#FFFFFF';
  return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label || `Engraving preview: ${L.join(' ')}`)}">
<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}" stop-opacity=".55"/><stop offset=".45" stop-color="${hi}" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient><clipPath id="${id}c">${body}</clipPath></defs>
<ellipse cx="160" cy="224" rx="110" ry="9" fill="#000" opacity=".25"/>
<g fill="${fill}" stroke="${edge}" stroke-width="2" stroke-linejoin="round">${body}</g>
<g clip-path="url(#${id}c)"><rect width="320" height="240" fill="url(#${id}g)"/></g>
<circle cx="${hole.x}" cy="${hole.y}" r="6.5" fill="#FFFBF2" stroke="${edge}" stroke-width="1.6"/>
<g font-family="Archivo,'Helvetica Neue',Arial,sans-serif" font-weight="700" style="letter-spacing:.015em"><g fill="${inkShadow}" transform="translate(0,${f.ink === 'light' ? 1 : -0.8})">${text}</g><g fill="${ink}">${text}</g></g>
</svg>`;
}
