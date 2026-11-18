// node --test tools/test/
// A committed merge-conflict marker in a generated page ships junk to visitors (it forces <body> to start inside <head> and duplicates og tags).
// Fails if any text file under site/ or functions/ carries one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/appdata.mjs';

const TEXT = /\.(html|md|txt|xml|js|mjs|json|css|svg|toml)$/i;
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules' && e !== '.git') walk(p, out); } else if (TEXT.test(e)) out.push(p);
  }
  return out;
};

test('no file under site/ or functions/ contains a merge-conflict marker', () => {
  const bad = [];
  for (const dir of ['site', 'functions']) {
    for (const f of walk(join(ROOT, dir))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      const hit = lines.findIndex((l) => /^<<<<<<< ?/.test(l) || /^>>>>>>> ?/.test(l));
      if (hit !== -1) bad.push(`${f.slice(ROOT.length + 1)}:${hit + 1}`);
    }
  }
  assert.deepEqual(bad, [], 'conflict markers found: ' + bad.join(', '));
});

test('a guide page has exactly one set of share tags and one styles.css link', () => {
  const h = readFileSync(join(ROOT, 'site/guides/bulldog-names/index.html'), 'utf8');
  assert.equal([...h.matchAll(/<meta property="og:image" /g)].length, 1);
  assert.equal([...h.matchAll(/<link rel="stylesheet" href="\/styles\.css/g)].length, 1);
});
