// St. George / Washington County local pages: the move switch and placeholder filling.
//
// MOVE DAY: the one switch is SHIP_FROM in site/app.js (and its twin in functions/api/_lib.js, a test keeps them equal).
// While it says 'Lehi, UT', the local pages use tools/data/st-george.json move.before ("moving to St. George", engraved in Lehi).
// Set both to 'St. George, UT' after the laser has moved, run `npm run build` + `python3 tools/build-agent-files.py`,
// and the local pages switch to move.after. The rest of the site's Lehi wording is a separate checklist in tools/README.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './appdata.mjs';

export const SG = () => JSON.parse(readFileSync(join(ROOT, 'tools/data/st-george.json'), 'utf8'));
export const shipFrom = () => /const SHIP_FROM = '([^']+)'/.exec(readFileSync(join(ROOT, 'site/app.js'), 'utf8'))[1];
export const moved = (from = shipFrom()) => /^St\.? George\b/i.test(from);

// The placeholder values for the current state of the move (or the state asked for, for tests).
export function moveVars(sg = SG(), isMoved = moved()) {
  return { ...(isMoved ? sg.move.after : sg.move.before), CHECKED: sg.checked };
}

// Replace every {{KEY}}; an unknown key is a build error, never a literal "{{KEY}}" on a live page.
export function fill(text, vars) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`local page placeholder {{${k}}} has no value`);
    return vars[k];
  });
}
