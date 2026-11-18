#!/usr/bin/env node
// Burns Anthropic credit on useful content. Usage: node credit-jobs.mjs [--only sayings|breeds|drinks] [--dry]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/nick/Clover API TB';
const OUT = `${ROOT}/saltydogtags/tools/out/credit-jobs`;
const ROAST = `${ROOT}/saltydogtags/functions/api/roast.js`;
const MODEL = 'claude-opus-5-5';
const PRICE_IN = 15, PRICE_OUT = 75; // $/M tokens
const CONC = 3;
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const oi = args.indexOf('--only');
const ONLY = oi >= 0 ? args[oi + 1] : null;
if (ONLY && !['sayings', 'breeds', 'drinks', 'articles', 'roast-eval', 'tb-ops'].includes(ONLY)) { console.log('--only must be sayings|breeds|drinks|articles|roast-eval|tb-ops'); process.exit(1); }
import { execFileSync } from 'node:child_process';
// Key comes from the env, or from the macOS Keychain item "anthropic-api" (never printed).
function keychainKey() {
  try { return execFileSync('security', ['find-generic-password', '-s', 'anthropic-api', '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}
const KEY = process.env.ANTHROPIC_API_KEY || keychainKey();
if (!DRY && !KEY) { console.log('No API key: set ANTHROPIC_API_KEY or add Keychain item "anthropic-api".'); process.exit(1); }

const BREEDS = ['bulldog','frenchie','pug','golden','lab','husky','corgi','dachshund','chihuahua','beagle','boxer','pit bull','german shepherd','rottweiler','doberman','great dane','poodle','doodle','shih tzu','yorkie','pomeranian','aussie','border collie','cattle dog','bernese','newfoundland','basset','greyhound','mutt','cat'];
const slug = (s) => s.replace(/\s+/g, '-');
const CATS = ['adult', 'attitude', 'beach', 'bulldog', 'cute', 'family', 'lost', 'breed'];
const LIM = [24, 28, 28, 24];

// ---- context ----
const appjs = fs.readFileSync(`${ROOT}/saltydogtags/site/app.js`, 'utf8');
const sayBlock = appjs.slice(appjs.indexOf('const SAYINGS = ['));
const existing = [...sayBlock.slice(0, sayBlock.indexOf('\n  ];')).matchAll(/\{ c: '(\w+)'(, x: true)?, l: \[([^\]]*)\]/g)]
  .map((m) => `${m[1]}${m[2] ? '/18+' : ''}: ${m[3]}`);
const sample = existing.filter((_, i) => i % 3 === 0).slice(0, 45).join('\n');
const bulldogPage = fs.readFileSync(`${ROOT}/saltydogtags/site/bulldog-dog-tags/index.html`, 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
const recipes = JSON.parse(fs.readFileSync(`${ROOT}/ThirstyBeaches-Kiosk-Drive/recipes.json`, 'utf8')).recipes;
const drinks = Object.entries(recipes).map(([name, r]) => ({ name, category: r.c, ingredients: r.i, note: r.note || '' }));

const VOICE = `Salty Dog Tags: laser-engraved funny dog tags, 80s synthwave brand, witty, dry, salty voice, run by a family with seven English bulldogs. Short punchy lines, a setup then a punch. Existing catalog samples (category[/18+]: lines):\n${sample}\n`;
const LIMITS = `Front-of-tag line limits: line 1 max 24 chars, line 2 max 28, line 3 max 28, line 4 max 24. Use 2-3 lines typically. Categories allowed: adult (18+ only), attitude, beach, bulldog (bulldog only), cute, family, lost, breed (breed-specific humor for non-bulldog breeds).`;

// ---- jobs ----
const jobs = [];

const sayingsPrompt = (breed, n, general) => `${VOICE}\n${LIMITS}\n\n` + (general
  ? `Write ${n} UNIVERSAL sayings that fit any dog or cat: food obsession, couch ownership, chaos, drama, velcro clinginess, escape-artist/lost vibes. Half clean, half 18+ (x:true, crude humor welcome, never hateful).`
  : `Write ${n} sayings specific to the ${breed}: real breed quirks, stereotypes owners recognize. Exactly half clean, half 18+ (x:true, crude humor welcome, never hateful).`) +
  `\nReturn ONLY a JSON array of objects: {"lines":["..",".."],"c":"category","x":false|true,"why":"one-line comedic angle"}. Clean ones omit nothing: x must be false. 18+ ones use c:"adult" or any fitting category with x:true. No duplicates, no markdown fences.`;
const checkSayings = (arr) => {
  if (!Array.isArray(arr)) throw new Error('not array');
  return arr.filter((s) => s && Array.isArray(s.lines) && s.lines.length >= 1 && s.lines.length <= 4 &&
    s.lines.every((l, i) => typeof l === 'string' && l.length <= LIM[i]) && CATS.includes(s.c))
    .map((s) => ({ lines: s.lines, c: s.c, x: !!s.x, why: String(s.why || '') }));
};
for (const b of BREEDS) jobs.push({ group: 'sayings', file: `sayings/${slug(b)}.json`, label: `sayings ${b}`,
  prompt: sayingsPrompt(b, 24, false), parse: (t) => checkSayings(parseJSON(t)), min: 14 });
jobs.push({ group: 'sayings', file: 'sayings/_general.json', label: 'sayings _general', prompt: sayingsPrompt('', 72, true), parse: (t) => checkSayings(parseJSON(t)), min: 40 });

for (const b of BREEDS.slice(1, 20 + 1)) jobs.push({ group: 'breeds', file: `breeds/${slug(b)}.md`, label: `breed page ${b}`,
  prompt: `${VOICE}\nExisting bulldog landing page text for structure/tone reference:\n${bulldogPage}\n\nWrite a draft landing page for "${b} dog tags" in the same structure, as Markdown:\n- First lines: "Meta title:" (max 60 chars) and "Meta description:" (max 155 chars), then a rule.\n- "# H1"\n- Intro paragraph (2-3 sentences, breed-specific, funny, Florida-first phrasing where natural, include the phrase "funny ${b} dog tags" naturally once)\n- 3 short H2 sections (breed-specific tag durability/size/humor angles, no invented facts about our shop beyond: laser engraved in Lehi Utah, from $12, name and number on the back)\n- "## 8 ${b} sayings" with 8 breed-specific sayings (lines separated by " / ", respecting limits 24/28/28/24 chars, clean only)\n- "## FAQ" with 4 Q&As\nOutput only the Markdown.`,
  parse: (t) => { const m = /Meta title:\s*(.+)/i.exec(t), d = /Meta description:\s*(.+)/i.exec(t);
    if (!m || !d) throw new Error('missing meta'); return t.trim() + '\n'; }, text: true });

for (let i = 0; i < drinks.length; i += 15) {
  const batch = drinks.slice(i, i + 15), n = i / 15 + 1;
  jobs.push({ group: 'drinks', file: `drinks/_batch-${String(n).padStart(2, '0')}.json`, label: `drinks batch ${n} (${batch.length})`, batch,
    prompt: `Thirsty Beaches: dirty soda and soft-serve trailer on Florida's Gulf Coast, playful beach voice, opening soon. For each drink below write menu copy. Return ONLY a JSON array, one object per drink in the same order, using the exact drink name: {"name":"","one_liner":"<=90 chars, playful","taste":"<=140 chars, what it tastes like","allergen_flags":["dairy"|"nuts"|"caffeine"] or ["none"],"kid_safe":bool}. Infer allergens from ingredients (sweet cream, ice cream, soft-serve, milk = dairy; coconut cream/almond/pistachio etc = nuts only if a real nut; coffee, espresso, energy, cola, Dr Pepper, tea = caffeine). kid_safe false if caffeine-heavy (coffee/energy/espresso) or alcohol-like. Don't claim health benefits.\n\nDrinks:\n${JSON.stringify(batch)}`,
    parse: (t) => { const a = parseJSON(t); if (!Array.isArray(a) || a.length < batch.length) throw new Error('short');
      return a.map((d) => ({ name: d.name, one_liner: String(d.one_liner).slice(0, 90), taste: String(d.taste).slice(0, 140),
        allergen_flags: Array.isArray(d.allergen_flags) && d.allergen_flags.length ? d.allergen_flags : ['none'], kid_safe: !!d.kid_safe })); } });
}

function parseJSON(t) {
  t = t.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  return JSON.parse(t.slice(a, b + 1));
}

// ---- extra jobs (articles, roast-eval, tb-ops) ----
const TB_VOICE = `Thirsty Beaches: dirty soda and soft-serve trailer on Florida's Gulf Coast, playful beach voice, opening soon (do not invent dates, locations, stats or awards).`;
const wc = (t) => t.split(/\s+/).length;
const ARTICLES = [
  ['what-to-put-on-a-dog-tag', 'What to put on a dog tag'],
  ['funny-dog-tag-sayings-2026', 'Funny dog tag sayings 2026 (100 ideas, clean first, then a clearly labelled 18+ section)'],
  ['dog-tag-size-guide-by-breed', 'Dog tag size guide by breed (sizes: small 1 inch $12, medium 1.5 inch $14, large; use only these facts)'],
  ['stainless-vs-aluminum-vs-brass-dog-tags', 'Stainless vs aluminum vs brass dog tags'],
  ['do-dog-tags-wear-off', 'Do dog tags wear off? Engraving vs printing, what lasts'],
  ['florida-dog-id-law-tag-requirements', 'Florida dog ID law and what a dog tag must say. Be careful: state that rules vary by county/city, point readers to their county animal services and rabies tag requirements, do not invent statutes, and note this is not legal advice'],
  ['bulldog-names', 'Bulldog names (100, grouped by theme, with a one-line joke where it helps)'],
  ['french-bulldog-names', 'Frenchie names (100, grouped by theme)'],
  ['best-dog-beaches-florida-gulf-coast', 'Best dog beaches on the Florida Gulf Coast. Only name places you are confident are real dog-friendly beaches (e.g. Fort De Soto Paw Playground, Honeymoon Island dog beach) and tell readers to check current rules; tie in a light mention of Thirsty Beaches as a post-beach drink stop without inventing locations'],
  ['dog-birthday-ideas', 'Dog birthday ideas'],
  ['gifts-for-bulldog-owners', 'Gifts for bulldog owners (include a custom engraved tag naturally, not as the only idea)'],
  ['cat-tags-vs-dog-tags', 'Cat tags vs dog tags: what differs (breakaway collars, size, text)'],
];
for (const [slg, topic] of ARTICLES) jobs.push({ group: 'articles', file: `articles/${slg}.md`, label: `article ${slg}`,
  prompt: `${VOICE}\nWrite a long-form SEO article for saltydogtags.com on: ${topic}.\nRequirements: 1200-1800 words, Markdown. Start with "Meta title:" (max 60 chars) and "Meta description:" (max 155 chars), a rule, then "# H1", intro, multiple H2 sections, a "## FAQ" with 4-5 Q&As, and a short closing line linking naturally to saltydogtags.com. Site voice: witty, dry, salty, affectionate, bulldog-family authenticity (seven English bulldogs in Lehi, Utah; laser engraving). Florida-first phrasing where natural. NO fake statistics, no invented studies, no made-up quotes or reviews. Output only the Markdown.`,
  parse: (t) => { if (!/Meta title:/i.test(t) || !/Meta description:/i.test(t)) throw new Error('missing meta'); if (wc(t) < 900) throw new Error('too short'); return t.trim() + '\n'; }, text: true });

const DOGS = (() => {
  const base = [
    ['Whisky','English bulldog','couch','snores like a chainsaw, steals socks, licks himself mid-conversation'],
    ['Tater','French bulldog','food','screams at the fridge, eats drywall, hates stairs'],
    ['Luna','Husky','escape','opened the gate twice, howls at the Roomba, sheds a second dog weekly'],
    ['Biscuit','Golden retriever','velcro','follows you into the bathroom, carries a shoe everywhere, cries when the mailman leaves'],
    ['Diesel','Pit bull','chaos','zoomies at 3am, 70 lbs lap dog, afraid of the cat'],
    ['Peanut','Chihuahua','drama','growls at wind, bites ankles, sleeps under the covers'],
    ['Moose','Great Dane','couch','takes the whole couch, farts silently, leans on strangers'],
    ['Pickles','Dachshund','food','steals from toddlers, barks at nothing, refuses rain'],
    ['Ruby','Corgi','chaos','herds the kids, screams for dinner, butt wiggle'],
    ['Gus','Pug','couch','snorts, wheezes, sleeps 20 hours, judges you'],
    ['Nala','Lab','food','ate a couch cushion, swims in puddles, counter surfer'],
    ['Bear','Bernese','velcro','110 lbs of anxiety, sits on feet, drools on guests'],
    ['Zeus','German shepherd','drama','barks at the TV, protects the vacuum, dramatic sighs'],
    ['Olive','Mutt','escape','digs under fences, returns smelling like a swamp'],
    ['Frank','Basset hound','couch','ears in the water bowl, howls at sirens, immovable'],
    ['Mochi','Shih tzu','drama','refuses to walk on wet grass, demands carrying, side-eye'],
    ['Rocky','Boxer','chaos','jumps on grandma, eats bees, zero chill'],
    ['Daisy','Beagle','food','nose never off the ground, howls at squirrels, trash raider'],
    ['Kona','Aussie','escape','needs a job, herds the car, stares holes in you'],
    ['Waffles','Doodle','velcro','matted, hugs strangers, eats socks whole'],
  ];
  const vibes = ['funny','sweet','savage','kid','adult','couch','chaos','food','drama','velcro','escape','adult'];
  const out = [];
  for (let i = 0; i < 40; i++) { const b = base[i % base.length]; out.push({ name: b[0], breed: b[1], vibe: i < 20 ? b[2] : vibes[i % vibes.length], notes: b[3] }); }
  return out;
})();
async function roastEval() {
  const src = fs.readFileSync(ROAST, 'utf8');
  const a = src.indexOf('const claudeSystem = `') + 'const claudeSystem = `'.length;
  const tpl = src.slice(a, src.indexOf('`;\n\n    const claudeUserParts'));
  const vt = src.indexOf('const vibeTone = '), vtEnd = src.indexOf('let provider =', vt);
  const { SAYINGS } = await import(`${ROOT}/saltydogtags/functions/api/_sayings.js`);
  const pre = src.slice(src.indexOf('const VIBES ='), src.indexOf('const VIBE_CATEGORY')).replace(/^const FULL_CATALOG[\s\S]*?(?=\/\/ Style anchors)/m, (m) => m)
    .replace(/^import .*$/gm, '');
  const mk = new Function('SAYINGS', `${pre}
    return (vibe, adult) => {
      const catalogForPrompt = adult ? FULL_CATALOG_FOR_PROMPT : CLEAN_CATALOG_FOR_PROMPT;
      ${src.slice(vt, vtEnd).replace(/\blet\b/g, 'let')}
      return { system: \`${tpl.replace(/\\/g, '\\\\').replace(/\$\{(?!STYLE_ANCHORS|catalogForPrompt|SHAPE_ENUM|FINISH_ENUM)/g, '\\${')}\`, vibeTone, adultClause };
    };`);
  const build = mk(SAYINGS);
  const results = [];
  const q = DOGS.map((d, i) => ({ d, i }));
  await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) { const { d, i } = q.shift();
    try {
      const adult = d.vibe === 'adult'; const vibe = adult ? 'funny' : d.vibe;
      const { system, vibeTone, adultClause } = build(vibe, adult);
      const user = [`Tone: ${vibeTone}.`, adultClause, `Dog's name: ${d.name}`, `Owner notes: ${d.notes}`,
        'No photo: work from the name and notes only, and write as specifically as those allow.', 'Return the JSON now.'].join('\n');
      const out = await call(user, system);
      let roast; try { roast = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { roast = { raw: out }; }
      const catalog = SAYINGS.filter((s) => adult || !s.x).map((s) => s.l.join(' / ')).slice(0, 400).join('\n');
      const judge = await call(`You are a harsh comedy editor evaluating an AI-written dog tag roast.\nDog: ${JSON.stringify(d)} (adult mode: ${adult})\nOutput under test:\n${JSON.stringify(roast)}\n\nExisting catalog sample (custom lines must be genuinely NEW, not catalog-like):\n${catalog}\n\nScore 1-10 each: funniness, specificity (to THIS dog), novelty (custom sayings genuinely new vs catalog-like). Return ONLY JSON: {"funniness":n,"specificity":n,"novelty":n,"fix":"one-line suggestion to improve the PROMPT"}`,
        'You return only JSON.');
      let score; try { score = JSON.parse(judge.slice(judge.indexOf('{'), judge.lastIndexOf('}') + 1)); } catch { score = null; }
      results[i] = { dog: d, roast, score };
      console.log(`  roast-eval ${i + 1}/${DOGS.length} ${d.name} ${score ? [score.funniness, score.specificity, score.novelty].join('/') : 'unscored'}`);
    } catch (e) { results[i] = { dog: d, error: e.message }; console.log(`  roast-eval ${i + 1} FAIL ${e.message}`); } } }));
  const ok = results.filter((r) => r && r.score);
  if (ok.length < 20) throw new Error(`only ${ok.length} scored`);
  const avg = (k) => (ok.reduce((s, r) => s + (+r.score[k] || 0), 0) / ok.length).toFixed(2);
  const tot = (r) => r.score.funniness + r.score.specificity + r.score.novelty;
  const sorted = [...ok].sort((x, y) => tot(x) - tot(y));
  const fmt = (r) => `- ${r.dog.name} (${r.dog.breed}, ${r.dog.vibe}) ${r.score.funniness}/${r.score.specificity}/${r.score.novelty}: ${JSON.stringify(r.roast.custom || r.roast.raw || '').slice(0, 220)}\n  fix: ${r.score.fix}`;
  const fixes = ok.map((r) => r.score.fix).join('\n');
  const synth = await call(`Here are one-line prompt fix suggestions from scoring 40 outputs of a dog-tag roast prompt. Cluster them and give the TOP 5 suggested prompt changes, ranked, each with a concrete wording to add. Markdown list only.\n\n${fixes}`, 'You are a prompt engineer.');
  fs.mkdirSync(path.join(OUT, 'roast-eval'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'roast-eval/results.json'), JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'roast-eval/summary.md'), `# Roast prompt eval\n\nScored ${ok.length}/${DOGS.length}. Means: funniness ${avg('funniness')}, specificity ${avg('specificity')}, novelty ${avg('novelty')}.\n\n## Worst 5\n${sorted.slice(0, 5).map(fmt).join('\n')}\n\n## Top 5\n${sorted.slice(-5).reverse().map(fmt).join('\n')}\n\n## Top 5 suggested prompt changes\n${synth}\n`);
  return null;
}
jobs.push({ group: 'roast-eval', file: 'roast-eval/summary.md', label: 'roast-eval (40 dogs x 2 calls)', exec: roastEval });

// tb-ops
const recipeText = drinks.map((d) => `${d.name} [${d.category}]: ${d.ingredients.join(', ')}${d.note ? ' (' + d.note + ')' : ''}`).join('\n');
jobs.push({ group: 'tb-ops', file: 'tb-ops/event-pitch-templates.md', label: 'tb-ops event pitch templates',
  prompt: `${TB_VOICE}\nWrite 6 booking outreach emails (subject + body, 120-180 words each, with [BRACKET] placeholders for names/dates/prices) for: 1 beach/park-district, 2 brewery, 3 school event, 4 church event, 5 festival organizer, 6 private party. Pitch dirty soda plus soft-serve, simple setup, self-contained trailer, no invented credentials or stats. Add a one-line follow-up note under each. Markdown only.`,
  parse: (t) => t.trim() + '\n', text: true });
jobs.push({ group: 'tb-ops', file: 'tb-ops/training-drills.md', label: 'tb-ops training drills',
  prompt: `${TB_VOICE}\nUsing ONLY these real recipes, write 10 drink-build drills for new window/make-station staff. Each drill: name, drinks involved (exact names), the build order step by step with ingredients from the list (no invented quantities), a speed target left as [TARGET], and one common mistake. Progress from easy to hard (include soft-serve floats if present in the list). Markdown only.\n\nRecipes:\n${recipeText}`,
  parse: (t) => t.trim() + '\n', text: true });
for (let n = 1; n <= 3; n++) jobs.push({ group: 'tb-ops', file: `tb-ops/_social-${n}.json`, label: `tb-ops social days ${(n - 1) * 30 + 1}-${n * 30}`,
  prompt: `${TB_VOICE}\nWrite 30 daily social post ideas for days ${(n - 1) * 30 + 1}-${n * 30} of a 90-day pre-launch-to-summer plan (arc: tease, menu reveals, behind the scenes, launch, community, seasonal). Use real drinks from this list where relevant: ${drinks.map((d) => d.name).join(', ')}. Return ONLY a JSON array of 30 objects: {"day":N,"hook":"first line","caption":"max 220 chars, no hashtag spam","format":"reel|carousel|photo|story|text","platform":"instagram|tiktok|facebook"}. No invented prices or dates.`,
  parse: (t) => { const a = parseJSON(t); if (a.length < 25) throw new Error('short'); return a; } });

const selected = jobs.filter((j) => !ONLY || j.group === ONLY);
const dest = (j) => path.join(OUT, j.file);
const FINAL_DRINKS = path.join(OUT, 'drinks/menu-copy.json');

if (DRY) {
  console.log(`model ${MODEL}; out ${OUT}; ${selected.length} jobs, ${CONC} concurrent`);
  for (const j of selected) console.log(`${fs.existsSync(dest(j)) ? 'SKIP' : 'RUN '} ${j.label} -> ${j.file}`);
  console.log(`drinks found: ${drinks.length}`);
  process.exit(0);
}

let tin = 0, tout = 0, done = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(prompt, system) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] }) });
    } catch { await sleep(2000 * 2 ** attempt); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(60000, 3000 * 2 ** attempt)); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${j?.error?.message || ''}`.slice(0, 200));
    tin += j.usage?.input_tokens || 0; tout += j.usage?.output_tokens || 0;
    return j.content.map((c) => c.text || '').join('');
  }
  throw new Error('retries exhausted');
}

async function run(j) {
  const p = dest(j);
  if (fs.existsSync(p)) { done++; console.log(`[${done + failed}/${selected.length}] skip ${j.label} (exists)`); return; }
  try {
    let out;
    if (j.exec) { await j.exec(); done++; console.log(`[${done + failed}/${selected.length}] ok ${j.label}`); return; }
    for (let t = 0; t < 2; t++) {
      try { out = j.parse(await call(j.prompt)); if (j.min && out.length < j.min) throw new Error(`only ${out.length} valid`); break; }
      catch (e) { if (t) throw e; }
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, j.text ? out : JSON.stringify(out, null, 2) + '\n');
    done++; console.log(`[${done + failed}/${selected.length}] ok ${j.label}${Array.isArray(out) ? ` (${out.length})` : ''}`);
  } catch (e) { failed++; console.log(`[${done + failed}/${selected.length}] FAIL ${j.label}: ${e.message}`); }
}

const queue = [...selected];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await run(queue.shift()); }));

function merge(group, prefix, final, label) {
  const bs = jobs.filter((j) => j.group === group && j.file.includes(prefix));
  if (selected.some((j) => bs.includes(j)) && bs.every((j) => fs.existsSync(dest(j)))) {
    const all = bs.flatMap((j) => JSON.parse(fs.readFileSync(dest(j), "utf8")));
    fs.writeFileSync(path.join(OUT, final), JSON.stringify(all, null, 2) + "\n"); console.log(`wrote ${final} (${all.length} ${label})`);
  }
}
merge("drinks", "_batch-", "drinks/menu-copy.json", "drinks");
merge("tb-ops", "_social-", "tb-ops/social-90-days.json", "posts");
const cost = (tin * PRICE_IN + tout * PRICE_OUT) / 1e6;
console.log(`done ${done}, failed ${failed}; tokens in ${tin} out ${tout}; est cost $${cost.toFixed(2)}`);
process.exit(failed ? 2 : 0);
