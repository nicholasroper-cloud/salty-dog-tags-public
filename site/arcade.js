/* Salty Dog Tags — SALTY MAZE arcade (reskin of Thirsty Maze) */
(function(){
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) return;                       // runner + game are pure flourish

  /* ── the roaming cup ─────────────────────────────── */
  const runner = document.createElement('button');
  runner.className = 'runner';
  runner.setAttribute('aria-label', 'A bulldog got loose — click to catch him');
  runner.innerHTML = `
  <svg viewBox="0 0 40 32" aria-hidden="true">
    <g class="lid"><path d="M8 10 L13 3 L16 10 Z" fill="#2A0B52"/><path d="M32 10 L27 3 L24 10 Z" fill="#2A0B52"/></g>
    <ellipse cx="20" cy="15" rx="12" ry="10" fill="#FFF4FA" stroke="#2A0B52" stroke-width="1.6"/>
    <circle cx="24.5" cy="13" r="3.4" fill="#FFD166" opacity=".9"/>
    <ellipse cx="14" cy="20" rx="5" ry="4.2" fill="#FFF4FA" stroke="#2A0B52" stroke-width="1.6"/>
    <ellipse cx="26" cy="20" rx="5" ry="4.2" fill="#FFF4FA" stroke="#2A0B52" stroke-width="1.6"/>
    <rect x="16" y="21" width="8" height="4" rx="1.6" fill="#FFF4FA" stroke="#2A0B52" stroke-width="1.6"/>
    <rect x="17.5" y="20.4" width="1.6" height="2" fill="#fff" stroke="#2A0B52" stroke-width=".6"/><rect x="21" y="20.4" width="1.6" height="2" fill="#fff" stroke="#2A0B52" stroke-width=".6"/>
    <circle cx="16" cy="13" r="1.7" fill="#2A0B52"/><circle cx="24" cy="13" r="1.7" fill="#2A0B52"/>
    <path d="M18 17 q2 -1.6 4 0 q-1 2 -2 2.2 q-1 -.2 -2 -2.2z" fill="#2A0B52"/>
    <rect class="leg" x="12" y="25" width="3.4" height="6" rx="1.6" fill="#FF3CAC"/>
    <rect class="leg leg--b" x="24.6" y="25" width="3.4" height="6" rx="1.6" fill="#FF3CAC"/>
  </svg>`;
  document.body.appendChild(runner);

  let raf = null;
  const M = 14;                                     // margin from the page edge

  /* safe-area insets (viewport-fit=cover): keep the lap out from under the notch / home bar */
  const inset = (v) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0;

  /* travel the four edges of the viewport, like a lap of the screen */
  function legs(){
    const w = innerWidth, s = 64, T = M + inset('--sat'), h = innerHeight - inset('--sab');
    return [
      { from:[-s, h - s - M],      to:[w - s - M, h - s - M], flip: 1, rot:   0 }, // along the bottom
      { from:[w - s - M, h - s - M], to:[w - s - M, T],       flip: 1, rot: -90 }, // up the right
      { from:[w - s - M, T],       to:[M, T],                 flip:-1, rot:   0 }, // back along the top
      { from:[M, T],               to:[M, h - s - M],         flip: 1, rot:  90 }, // down the left
    ];
  }

  let leg = 0, gen = 0;
  /* CPU (fix/sdt-site): movement is a compositor animation instead of a rAF loop writing four inherited custom
     properties every frame; the legs/lid CSS loops only run while it dashes (.is-running); all of it stops while the
     tab is hidden or the cabinet is open. */
  const setRunning = (on) => runner.classList.toggle('is-running', on);
  let anim = null;
  function dash(){
    if (paused || asleep || away()) return;
    const my = ++gen;
    const L = legs()[leg % 4];
    leg++;
    const dur = 5200 + Math.random() * 2600;
    const stopAt = 0.35 + Math.random() * 0.3;   // where it pauses to show off
    const trick = Math.random() < 0.8;
    cancelAnimationFrame(raf);
    const at = (k) => {
      const x = L.from[0] + (L.to[0] - L.from[0]) * k;
      const y = L.from[1] + (L.to[1] - L.from[1]) * k;
      return `translate3d(${x}px, ${y}px, 0) scaleX(${L.flip}) rotate(${L.rot}deg)`;
    };
    const live = () => !(paused || asleep || held || away() || my !== gen);
    /* each stretch is one compositor animation (Web Animations), so moving costs no per-frame JS or style work */
    const run = (k0, k1, done) => {
      if (!live()) return;
      runner.style.transform = at(k0);
      if (anim) anim.cancel();
      if (!runner.animate) { runner.style.transform = at(k1); done(); return; }
      anim = runner.animate([{ transform: at(k0) }, { transform: at(k1) }], { duration: dur * (k1 - k0), easing: 'linear' });
      anim.onfinish = () => { anim = null; if (!live()) return; runner.style.transform = at(k1); done(); };
    };
    setRunning(true); watchForm(true);
    const finish = () => { setRunning(false); watchForm(false); schedule(); };
    if (trick) run(0, stopAt, () => perform(() => { if (live()) run(stopAt, 1, finish); }));
    else run(0, 1, finish);
  }
  let paused = false, asleep = false, timer = null, held = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { asleep = true; gen++; clearTimeout(timer); cancelAnimationFrame(raf); if (anim) { anim.cancel(); anim = null; } delete runner.dataset.trick; setRunning(false); }
    else if (asleep) { asleep = false; if (!paused) schedule(); }
  });

  /* phones (coarse pointer): the 64px runner kept crossing the roast form and a stray tap opened the arcade.
     So on touch it waits until the visitor has scrolled past #roastForm, ducks out while any form field has
     focus, and is hidden + untappable whenever it would overlap the form box. Desktop is unchanged. */
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const roastForm = document.getElementById('roastForm');
  function dodgeForm(){
    if (!COARSE || !roastForm) return;
    const f = roastForm.getBoundingClientRect(), r = runner.getBoundingClientRect(), pad = 12;
    const hit = r.right > f.left - pad && r.left < f.right + pad && r.bottom > f.top - pad && r.top < f.bottom + pad;
    runner.classList.toggle('runner--away', hit);
  }
  // Movement is a compositor animation now (no per-frame JS), so while it dashes on a phone check the form box a few times a second.
  let formTick = null;
  function watchForm(on){ clearInterval(formTick); formTick = null; if (on && COARSE && roastForm) formTick = setInterval(dodgeForm, 150); }
  const isField = (el) => el && el.matches && el.matches('input, textarea, select, [contenteditable="true"]');
  if (COARSE){
    if (roastForm) { addEventListener('scroll', dodgeForm, { passive: true }); addEventListener('resize', dodgeForm, { passive: true }); }
    addEventListener('focusin', (e) => {
      if (!isField(e.target) || held) return;
      held = true; gen++; clearTimeout(timer); cancelAnimationFrame(raf); if (anim) { anim.cancel(); anim = null; } setRunning(false); watchForm(false); delete runner.dataset.trick; runner.classList.add('runner--away');
    });
    addEventListener('focusout', () => setTimeout(() => {
      if (!held || isField(document.activeElement)) return;
      held = false; runner.classList.remove('runner--away'); if (started && !paused) schedule();
    }, 0));
  }
  let started = false;

  /* little bits it performs when it stops */
  const TRICKS = ['moonwalk','spin','wiggle','peek','trip','breakdance','wave'];
  let lastTrick = -1;

  function perform(after){
    let i; do { i = Math.floor(Math.random()*TRICKS.length); } while (i === lastTrick);
    lastTrick = i;
    const trick = TRICKS[i];
    runner.dataset.trick = trick;
    const ms = trick === 'breakdance' ? 2200 : trick === 'trip' ? 1400 : 1600;
    setTimeout(() => { delete runner.dataset.trick; after && after(); }, ms);
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(() => { if (!paused && !asleep && !held && !away()) dash(); }, 2200 + Math.random() * 3500);
  }
  function pauseRunner(){
    paused = true; gen++; clearTimeout(timer); cancelAnimationFrame(raf); if (anim) { anim.cancel(); anim = null; } setRunning(false);
    delete runner.dataset.trick;
    runner.style.display = 'none';
  }
  function resumeRunner(){
    paused = false; runner.style.display = ''; if (started) schedule();
  }
  /* Extra reason to hold the runner (on top of the arcade cabinet being open): the visitor is on a phone, or the
     builder or checkout is on screen. A bulldog sprinting across a form you are typing in is not charming, and a
     stray tap on it opens the full-screen arcade. */
  const NARROW = matchMedia('(max-width:760px)');
  const watched = new Set();            // #build / #order sections currently on screen
  const away = () => NARROW.matches || watched.size > 0;
  function syncAway(){
    if (away()) { gen++; clearTimeout(timer); cancelAnimationFrame(raf); if (anim) { anim.cancel(); anim = null; } setRunning(false); delete runner.dataset.trick; runner.classList.add('runner--away'); }
    else { runner.classList.remove('runner--away'); if (started && !paused && !held) schedule(); }
  }
  if (NARROW.addEventListener) NARROW.addEventListener('change', syncAway);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { es.forEach((e) => { e.isIntersecting ? watched.add(e.target) : watched.delete(e.target); }); syncAway(); });
    ['build', 'order'].forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }
  syncAway();

  /* first lap shortly after the page settles (touch: only once the roast form has been scrolled past) */
  function begin(){ if (started) return; started = true; setTimeout(() => { if (!paused && !held && !away()) dash(); }, 1800); }
  if (COARSE && roastForm){
    const past = () => { if (roastForm.getBoundingClientRect().bottom < 0){ removeEventListener('scroll', past); begin(); } };
    addEventListener('scroll', past, { passive: true }); past();
  } else begin();

  /* ══ THIRSTY MAZE v2 ═══════════════════════════════
     Eat the tags. Dodge the cat. One maze a day, same for everyone. */

  const DRINKS = [["Red Bone","Bone"],["Royal Bone","Bone"],["Sky Bone","Bone"],["Green Bone","Bone"],["Yellow Bone","Bone"],["Black Bone","Bone"],["Hot Pink Bone","Bone"],["Polished Bone","Stainless"],["Rainbow Bone","Stainless"],["Navy Bone","Stainless"],["Gold Bone","Stainless"],["Bronze Bone","Stainless"],["Black Heart","Heart"],["Red Heart","Heart"],["Pink Heart","Heart"],["Sky Heart","Heart"],["Yellow Heart","Heart"],["Green Heart","Heart"],["Stainless Heart","Stainless"],["Black Round","Round"],["Brass Round","Brass"],["Green Round","Round"],["Hot Pink Round","Round"],["Royal Round","Round"],["Black Military","Military"],["Red Military","Military"],["Sky Military","Military"],["Stainless Military","Stainless"],["Black Paw","Paw"],["Green Paw","Paw"],["Red Paw","Paw"],["Royal Paw","Paw"],["Sky Paw","Paw"],["Yellow Paw","Paw"],["Hot Pink Paw","Paw"]];
  const CATC = { 'Bone':'#FF3CAC','Heart':'#FF5C8A','Round':'#FFD166','Military':'#2AF5E4','Paw':'#B8FF3C','Stainless':'#DADDE1','Brass':'#D2AB5C' };
  const CHAINS = ['The Cat','The Mailman','The Vacuum','Bath Time'];

  /* seasonal skins, picked by today's date */
  function skin(){ return {id:'salty',title:'SALTY MAZE',wall:'#8A3FFC',bg:'#12032E',pellet:'#FFF4FA',pelletName:'big bone',ghost:'#6b6b7b',foot:'eat the tags · big bone = payback time'}; }
  const SK = skin();

  /* seeded random: everyone gets the same maze today */
  const DAY = (d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))(new Date());
  function rng(seed){ let h=1779033703^seed.length; for(let i=0;i<seed.length;i++){h=Math.imul(h^seed.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
    return function(){ h=Math.imul(h^(h>>>16),2246822507); h=Math.imul(h^(h>>>13),3266489909); h^=h>>>16; return (h>>>0)/4294967296; }; }

  const W = 19, H = 19, S = 24;
  /* 0 path·drink  1 wall  2 empty path  3 power */
  function genMaze(seed){
    const R = rng(seed);
    const g = Array.from({length:H},()=>Array(W).fill(1));
    /* carve a spanning tree on the odd cells of the LEFT half (cols 1..9), then mirror */
    const cols = 5, rows = 9;  // odd columns 1,3,5,7,9 ; odd rows 1..17
    const seen = Array.from({length:rows},()=>Array(cols).fill(false));
    const stack=[[0,0]]; seen[0][0]=true; g[1][1]=0;
    while(stack.length){
      const [cx,cy]=stack[stack.length-1];
      const nb=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[cx+dx,cy+dy]).filter(([x,y])=>x>=0&&x<cols&&y>=0&&y<rows&&!seen[y][x]);
      if(!nb.length){ stack.pop(); continue; }
      const [nx,ny]=nb[(R()*nb.length)|0]; seen[ny][nx]=true;
      g[ny*2+1][nx*2+1]=0; g[cy*2+1+(ny-cy)][cx*2+1+(nx-cx)]=0; stack.push([nx,ny]);
    }
    /* open extra walls for loops: a maze with dead ends is no fun with ghosts */
    for(let y=1;y<H-1;y++) for(let x=1;x<=9;x++) if(g[y][x]===1 && ((x%2)^(y%2)) && R()<0.38){
      const a = x%2 ? [g[y-1][x],g[y+1][x]] : [g[y][x-1],g[y][x+1]];
      if(a[0]!==1 && a[1]!==1) g[y][x]=0;
    }
    /* centre lane across the mirror line + ghost pen */
    for(let y=1;y<H-1;y++) if(y%2) g[y][9]=0;
    for(let y=8;y<=10;y++) for(let x=8;x<=10;x++) g[y][x]=2;
    g[7][9]=0; g[11][9]=0;
    /* side tunnel on the middle row */
    g[9][0]=2; g[9][1]=0;
    /* mirror */
    for(let y=0;y<H;y++) for(let x=0;x<9;x++) g[y][W-1-x]=g[y][x];
    /* power pellets in the four inner corners */
    [[1,1],[17,1],[1,17],[17,17]].forEach(([x,y])=>g[y][x]=3);
    return g;
  }

  /* ── overlay ─────────────────────────────────────── */
  const wrap = document.createElement('div');
  wrap.className = 'arcade skin-'+SK.id;
  wrap.innerHTML = `
    <button class="arcade__close" type="button">Esc &middot; Close</button>
    <div class="arcade__box">
      <h2 class="arcade__title">${SK.title}</h2>
      <div class="arcade__hud"><span id="mzScore">Score 0</span><span id="mzBest"></span><span id="mzLives">&#129460;&#129460;&#129460;</span></div>
      <div class="arcade__screen">
        <canvas id="maze" width="${W*S}" height="${H*S}"></canvas>
        <div class="attract" id="mzAttract">
          <div class="attract__logo">${SK.title}</div>
          <div class="attract__sub">EAT THE TAGS &middot; DODGE THE CAT</div>
          <div class="attract__coin">INSERT COIN</div>
          <button class="attract__start" type="button" id="mzStart">PRESS START</button>
          <div class="attract__day">MAZE OF THE DAY &middot; ${DAY}</div>
        </div>
      </div>
      <p class="arcade__drink" id="mzDrink">&nbsp;</p>
      <div class="dpad" id="mzPad" aria-label="Move">
        <button type="button" data-d="0,-1" aria-label="Up">&#9650;</button>
        <button type="button" data-d="-1,0" aria-label="Left">&#9664;</button>
        <button type="button" data-d="1,0" aria-label="Right">&#9654;</button>
        <button type="button" data-d="0,1" aria-label="Down">&#9660;</button>
      </div>
      <p class="arcade__msg" id="mzMsg"></p>
      <div id="mzBoard" class="board"></div>
      <p class="arcade__foot">Arrows / WASD &middot; swipe or D-pad on touch &middot; grab the bonus tag for 300 &middot; ${SK.foot}<br>Break <b>500</b> and win a <b>free upgrade</b> on your next tag &middot; one a day &middot; <button type="button" class="arcade__mute" id="mzMute">sound on</button></p>
    </div>`;
  document.body.appendChild(wrap);

  const canvas = wrap.querySelector('#maze');
  const ctx = canvas.getContext('2d');
  const $ = id => wrap.querySelector('#'+id);

  /* ── 8-bit sound (WebAudio, only after a gesture) ── */
  let AC=null, muted = (()=>{ try{ return localStorage.getItem('sdt-mute')==='1'; }catch(e){ return false; } })();
  function beep(f, ms, type, vol){
    if (muted) return;
    try{
      AC = AC || new (window.AudioContext||window.webkitAudioContext)();
      const o=AC.createOscillator(), g=AC.createGain();
      o.type=type||'square'; o.frequency.value=f; g.gain.value=vol||.05;
      o.connect(g); g.connect(AC.destination); o.start();
      g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime+ms/1000); o.stop(AC.currentTime+ms/1000);
    }catch(e){}
  }
  const sfx = {
    coin(){ beep(988,90); setTimeout(()=>beep(1319,220),90); },
    munch(){ beep(220+Math.random()*60,40,'triangle',.025); },
    power(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,90),i*70)); },
    ghost(){ [1047,784,1047,1319].forEach((f,i)=>setTimeout(()=>beep(f,70),i*60)); },
    die(){ [440,370,311,262,220].forEach((f,i)=>setTimeout(()=>beep(f,140,'sawtooth',.04),i*120)); },
    bonus(){ [784,988,1175,1568].forEach((f,i)=>setTimeout(()=>beep(f,80,'square',.06),i*55)); },
    win(){ [523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>beep(f,120),i*90)); }
  };
  $('mzMute').onclick = () => { muted=!muted; try{localStorage.setItem('sdt-mute',muted?'1':'0');}catch(e){} $('mzMute').textContent = muted?'sound off':'sound on'; };
  $('mzMute').textContent = muted?'sound off':'sound on';

  /* ── state ───────────────────────────────────────── */
  /* Classic maze-chase rules: smooth movement, ghosts a touch slower than you,
     four ghost personalities, scatter/chase cycles, frightened mode, eyes that run home,
     side tunnels, READY! pause, death animation, levels. */
  const TUNNEL_Y = 9, PEN = {x:9, y:9}, DOOR = {x:9, y:7};
  const CORNERS = [[W-2,0],[1,0],[W-2,H-1],[1,H-1]];                 // scatter targets: one corner each
  const GCOL = ['#8A8A99','#6E6E80','#9A9AAE','#7C7C90'];   // the chains: four shades of corporate grey
  const GNAME = CHAINS;
  let MAPSRC, map, dots, dotsEaten, score, lives, level, player, ghosts, playing=false, loopId=null, wallLayer=null;
  let grace, tally, drank, startT, pops, flash = 0, bonus = null, bonusShown, pool = [], sips = 0;
  let mode, modeIdx, modeT, fright, frightFlash, ghostStreak, phase, phaseT, dyingT, nextLifeAt;
  let bonusSpawned = false;

  const LEVELS = [ // player, ghost, fright (tiles/sec), fright seconds, scatter/chase schedule
    {p:5.6, g:4.9, f:2.9, fs:7, sched:[7,20,7,20,5,20,5,1e9]},
    {p:6.0, g:5.4, f:3.2, fs:6, sched:[7,20,7,20,5,1033,.02,1e9]},
    {p:6.3, g:5.8, f:3.4, fs:5, sched:[7,20,7,20,5,1033,.02,1e9]},
    {p:6.6, g:6.2, f:3.6, fs:4, sched:[5,20,5,20,5,1037,.02,1e9]},
  ];
  const LV = () => LEVELS[Math.min(level-1, LEVELS.length-1)];

  function reset(full){
    if (full){
      MAPSRC = genMaze(DAY);
      const R = rng(DAY+':tags'); pool = DRINKS.slice();
      for (let i=pool.length-1;i>0;i--){ const j=(R()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
      window.__pool = pool;
      score = 0; lives = 3; level = 1; tally = {}; drank = []; startT = performance.now(); sips = 0; nextLifeAt = 10000;
      newLevel();
    }
    positions();
  }
  const LEVEL_WALLS = [null, '#2AF5E4', '#FF3CAC', '#FFD166', '#8A3FFC', '#7CFF4F'];
  const wallCol = () => LEVEL_WALLS[(level-1) % LEVEL_WALLS.length] || SK.wall;
  function newLevel(){
    /* a fresh maze every level, still the same for everyone today */
    MAPSRC = genMaze(level === 1 ? DAY : DAY + ':L' + level);
    if (wallLayer) bakeWalls();
    map = MAPSRC.map(r=>r.slice());
    dots = 0; for (const r of map) for (const v of r) if (v===0||v===3) dots++;
    dotsEaten = 0; bonusShown = 0;
  }
  function positions(){
    const ps = open(9,17) ? [9,17] : [9,15];
    player = { x:ps[0]*S+S/2, y:ps[1]*S+S/2, dx:-1, dy:0, nx:-1, ny:0, anim:0, eating:0 };
    ghosts = [
      { n:0, x:9*S+S/2,  y:7*S+S/2, dx:-1, dy:0, state:'out',  col:GCOL[0] },           // Big Chain starts above the pen
      { n:1, x:9*S+S/2,  y:9*S+S/2, dx:0,  dy:-1, state:'pen', col:GCOL[1], free:0 },    // Copycat leaves at once
      { n:2, x:8*S+S/2,  y:9*S+S/2, dx:0,  dy:1,  state:'pen', col:GCOL[2], free:30 },   // Franchise after 30 dots
      { n:3, x:10*S+S/2, y:9*S+S/2, dx:0,  dy:1,  state:'pen', col:GCOL[3], free:60 },   // Knockoff after 60 dots
    ];
    mode = 'scatter'; modeIdx = 0; modeT = LV().sched[0]; fright = 0; ghostStreak = 0; pops = []; flash = 0; bonus = null; bonusSpawned = false;
    phase = 'ready'; phaseT = 2.0; dyingT = 0;
    $('mzDrink').innerHTML = '&nbsp;';
    hud();
  }
  /* a tiny version of the player's bulldog head, for the lives readout (was a leftover drink-cup emoji) */
  const LIFE_ICON = '<svg class="mzLife" viewBox="0 0 20 16" width="15" height="12" aria-hidden="true" style="vertical-align:-2px;margin:0 1px">'
    + '<path d="M3 6 L6 0 L9 5 Z" fill="#2A0B52"/><path d="M17 6 L14 0 L11 5 Z" fill="#2A0B52"/>'
    + '<ellipse cx="10" cy="9" rx="8" ry="6.5" fill="#FFF4FA"/>'
    + '<ellipse cx="6.5" cy="13.2" rx="3.6" ry="2.8" fill="#FFF4FA"/><ellipse cx="13.5" cy="13.2" rx="3.6" ry="2.8" fill="#FFF4FA"/>'
    + '<circle cx="13" cy="7.5" r="2.4" fill="#FFD166"/>'
    + '<circle cx="7" cy="7.5" r="1.2" fill="#2A0B52"/><circle cx="13" cy="7.5" r="1.2" fill="#2A0B52"/>'
    + '<ellipse cx="10" cy="11" rx="1.6" ry="1.1" fill="#2A0B52"/></svg>';
  function hud(){
    $('mzScore').textContent = 'Score ' + score;
    $('mzBest').textContent = (best() ? 'Best ' + best() + ' · ' : '') + 'Level ' + level;
    $('mzLives').innerHTML = LIFE_ICON.repeat(Math.max(0, lives - 1));
  }
  function msg(t){ $('mzMsg').textContent = t; }

  const at = (x, y) => { if (y === TUNNEL_Y && (x < 0 || x >= W)) return 2; return (map[y] && map[y][x] !== undefined) ? map[y][x] : 1; };
  const open = (x, y) => at(x, y) !== 1;
  const tileOf = e => [Math.floor(e.x / S), Math.floor(e.y / S)];
  const centred = e => Math.abs(e.x - (Math.floor(e.x/S)*S + S/2)) < .6 && Math.abs(e.y - (Math.floor(e.y/S)*S + S/2)) < .6;

  /* ── controls ────────────────────────────────────── */
  function dir(dx,dy){ player.nx=dx; player.ny=dy; }
  function tryTurn(e){
    const k = e.key.toLowerCase();
    const m = { arrowup:[0,-1], w:[0,-1], arrowdown:[0,1], s:[0,1], arrowleft:[-1,0], a:[-1,0], arrowright:[1,0], d:[1,0] };
    if (m[k]){ dir(...m[k]); e.preventDefault(); }
    if (k === 'escape') close();
  }
  let tx = 0, ty = 0;
  canvas.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, {passive:true});
  canvas.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx)<8 && Math.abs(dy)<8) return;
    if (Math.abs(dx) > Math.abs(dy)) dir(Math.sign(dx),0); else dir(0,Math.sign(dy));
  }, {passive:true});
  $('mzPad').querySelectorAll('button').forEach(b=>{
    const [dx,dy]=b.dataset.d.split(',').map(Number);
    b.addEventListener('pointerdown', e=>{ e.preventDefault(); dir(dx,dy); });
  });

  /* ── simulation (dt in seconds) ──────────────────── */
  function moveAlong(e, speed, dt, onCentre){
    /* advance along e.dx/e.dy by speed tiles/sec. Every time we reach a tile centre we stop,
       let onCentre() pick a new direction, then carry on with whatever distance is left.
       Stops dead at walls; wraps through the tunnel. */
    let left = speed * S * dt, moved = false, guard = 0;
    while (left > 0 && guard++ < 8){
      const [tx_, ty_] = tileOf(e);
      const cx = tx_*S + S/2, cy = ty_*S + S/2;
      const toC = (e.dx ? (cx - e.x) * e.dx : (cy - e.y) * e.dy);   // signed distance to this tile's centre along travel
      if (toC > 0.001){ const m = Math.min(left, toC); e.x += e.dx*m; e.y += e.dy*m; left -= m; moved = true; if (m === toC){ e.x = cx; e.y = cy; if (onCentre) onCentre(e, tx_, ty_); } continue; }
      if (toC > -0.001){ e.x = cx; e.y = cy; if (!e._decided){ if (onCentre) onCentre(e, tx_, ty_); } }
      e._decided = false;
      /* at centre: can we continue into the next tile? */
      if (!open(tx_ + e.dx, ty_ + e.dy)){ e.x = cx; e.y = cy; return moved; }
      const m = Math.min(left, S);
      e.x += e.dx*m; e.y += e.dy*m; left -= m; moved = true;
      if (e.x < -S/2) e.x += W*S; else if (e.x > W*S + S/2) e.x -= W*S;
    }
    return moved;
  }
  function snapIfCentred(e){ const [tx_,ty_]=tileOf(e); e.x = tx_*S+S/2; e.y = ty_*S+S/2; }

  function stepPlayer(dt){
    const [px, py] = tileOf(player);
    const spd = LV().p * (player.eating > 0 ? .87 : 1);           // nibbling slows you, like the original
    player.eating = Math.max(0, player.eating - dt);
    /* turn whenever the wanted direction is open from the current tile (with pre-turn tolerance) */
    if ((player.nx !== player.dx || player.ny !== player.dy)){
      const cx = px*S+S/2, cy = py*S+S/2;
      const near = Math.abs(player.x-cx) < S*.45 && Math.abs(player.y-cy) < S*.45;
      if (near && open(px+player.nx, py+player.ny)){
        if (player.nx === -player.dx && player.ny === -player.dy){ player.dx = player.nx; player.dy = player.ny; }
        else { player.x = cx; player.y = cy; player.dx = player.nx; player.dy = player.ny; }
      }
    }
    const moved = moveAlong(player, spd, dt, (e, cx_, cy_) => {
      if ((e.nx !== e.dx || e.ny !== e.dy) && open(cx_+e.nx, cy_+e.ny)){ e.dx = e.nx; e.dy = e.ny; }
      e._decided = true;
    });
    player.anim += moved ? dt*14 : 0;
    const [qx, qy] = tileOf(player);
    const t = at(qx, qy);
    if (t === 0 || t === 3){
      map[qy][qx] = 2; dots--; dotsEaten++; sips++; player.eating = .12;
      if (t === 0){ score += 10; sfx.munch(); }
      else { score += 50; sfx.power(); fright = LV().fs; ghostStreak = 0;
             ghosts.forEach(g => { if (g.state==='out'){ g.dx=-g.dx; g.dy=-g.dy; } });
             $('mzDrink').innerHTML = '<i style="background:'+SK.pellet+'"></i>'+SK.pelletName+' <small>+50 · the cat is scared</small>'; }
      if (score >= nextLifeAt){ lives++; nextLifeAt += 10000; pops.push({x:qx,y:qy,t:0,txt:'+1 LIFE'}); sfx.win(); }
      if ((dotsEaten === 70 || dotsEaten === 170) && !bonus) spawnBonus();
      hud();
    }
    if (bonus && Math.hypot(player.x-bonus.px, player.y-bonus.py) < S*.6){
      const pts = 300 * level;
      score += pts; drank.push(bonus.d[0]); tally[bonus.d[1]] = (tally[bonus.d[1]]||0)+1; sfx.bonus(); hud();
      pops.push({x:bonus.x,y:bonus.y,t:0,txt:'+'+pts+' '+bonus.d[0].toUpperCase()});
      $('mzDrink').innerHTML = '<i style="background:'+(CATC[bonus.d[1]]||'#fff')+'"></i>'+bonus.d[0]+' <small>+'+pts+' · '+bonus.d[1]+'</small>';
      bonus = null;
    }
    if (dots <= 0) { phase = 'clear'; phaseT = 1.6; sfx.win(); }
  }
  function spawnBonus(){
    const spots = [[9,11],[9,7],[9,3],[9,15]].filter(([x,y]) => open(x,y));
    const [bx,by] = spots[0] || [9,11];
    const d = pool[(bonusShown++ + level*2) % pool.length];
    bonus = { x:bx, y:by, px:bx*S+S/2, py:by*S+S/2, d, ttl: 9.5 };
    $('mzDrink').innerHTML = '<i style="background:'+(CATC[d[1]]||'#fff')+'"></i>'+d[0]+' <small>is up — grab it for '+(300*level)+'</small>';
  }

  function ghostTarget(g){
    const [px, py] = tileOf(player), [bx, by] = tileOf(ghosts[0]);
    if (g.state === 'eyes') return [DOOR.x, DOOR.y];
    if (mode === 'scatter') return CORNERS[g.n];
    switch (g.n){
      case 0: return [px, py];                                        // Big Chain: straight at you
      case 1: return [px + player.dx*4, py + player.dy*4];            // Copycat: four tiles ahead of you
      case 2: { const ax = px + player.dx*2, ay = py + player.dy*2; return [ax + (ax - bx), ay + (ay - by)]; } // Franchise: doubles Big Chain's line on you
      case 3: return Math.hypot(px - g.x/S, py - g.y/S) > 8 ? [px, py] : CORNERS[3];  // Knockoff: loses its nerve inside 8 tiles
    }
  }
  function stepGhost(g, dt){
    const lv = LV();
    if (g.state === 'pen'){
      /* bob in the pen until released by the dot counter (or a timer if you dawdle) */
      g.bob = (g.bob||0) + dt*3;
      g.y = PEN.y*S + S/2 + Math.sin(g.bob)*3;
      if (dotsEaten >= g.free || (performance.now() - startT) > 4000 * (g.n+1)){ g.state = 'leaving'; }
      return;
    }
    if (g.state === 'leaving'){
      /* slide to the pen centre, then straight up through the door */
      const cx = PEN.x*S + S/2, dy_ = DOOR.y*S + S/2;
      if (Math.abs(g.x - cx) > .5) g.x += Math.sign(cx - g.x) * Math.min(Math.abs(cx-g.x), lv.g*.6*S*dt);
      else { g.x = cx; g.y -= lv.g*.6*S*dt; if (g.y <= dy_){ g.y = dy_; g.state = 'out'; g.dx = Math.random()<.5?-1:1; g.dy = 0; } }
      return;
    }
    if (g.state === 'home'){
      g.y += lv.g*.6*S*dt;
      if (g.y >= PEN.y*S+S/2){ g.y = PEN.y*S+S/2; g.state = 'pen'; g.free = dotsEaten + 7; }
      return;
    }
    const frightened = fright > 0 && g.state === 'out';
    const speed = g.state === 'eyes' ? lv.g*2 : frightened ? lv.f : (tileOf(g)[1] === TUNNEL_Y && (g.x < 2*S || g.x > (W-2)*S)) ? lv.g*.55 : lv.g;
    /* choose a direction at each tile centre: never reverse, pick the option nearest the target */
    moveAlong(g, speed, dt, (e, gx, gy) => {
      if (e.state === 'eyes' && gx === DOOR.x && gy === DOOR.y){ e.state = 'home'; e.dx = 0; e.dy = 1; e._decided = true; return; }
      const opts = [[0,-1],[-1,0],[0,1],[1,0]].filter(([dx,dy]) => open(gx+dx, gy+dy) && !(dx===-e.dx && dy===-e.dy) && !(e.state!=='eyes' && gx+dx===DOOR.x && gy+dy===DOOR.y+1));
      if (opts.length){
        let pick;
        if (frightened) pick = opts[(Math.random()*opts.length)|0];
        else { const [tx_, ty_] = ghostTarget(e); pick = opts.reduce((b,o) => (Math.hypot(gx+o[0]-tx_, gy+o[1]-ty_) < Math.hypot(gx+b[0]-tx_, gy+b[1]-ty_) ? o : b), opts[0]); }
        e.dx = pick[0]; e.dy = pick[1];
      } else { e.dx = -e.dx; e.dy = -e.dy; }
      e._decided = true;
    });
  }

  function collide(){
    ghosts.forEach(g => {
      if (g.state !== 'out') return;
      if (Math.hypot(g.x - player.x, g.y - player.y) < S*.7){
        if (fright > 0){
          ghostStreak++; const pts = 200 * Math.pow(2, ghostStreak-1);
          score += pts; sfx.ghost(); hud(); flash = 6;
          pops.push({x:tileOf(g)[0], y:tileOf(g)[1], t:0, txt:'+'+pts+' '+GNAME[g.n].toUpperCase()+' BOUGHT OUT'});
          $('mzDrink').innerHTML = '<i style="background:#7CFF4F"></i>'+GNAME[g.n]+' chased off <small>+'+pts+'</small>';
          g.state = 'eyes'; snapIfCentred(g); g._decided = false;
          phase = 'pause'; phaseT = .45;
        } else { phase = 'dying'; dyingT = 0; sfx.die(); }
      }
    });
  }

  function tick(dt){
    if (phase === 'ready'){ phaseT -= dt; if (phaseT <= 0){ phase = 'play'; msg(''); } else msg('GET SALTY!'); return; }
    if (phase === 'pause'){ phaseT -= dt; if (phaseT <= 0) phase = 'play'; return; }
    if (phase === 'dying'){
      dyingT += dt;
      if (dyingT > 1.3){
        lives--; hud();
        if (lives <= 0){ playing = false; msg('GAME OVER — ' + score); finish(); }
        else { positions(); }
      }
      return;
    }
    if (phase === 'clear'){
      phaseT -= dt; flash = (phaseT*6|0)%2 ? 3 : 0;
      if (phaseT <= 0){ level++; score += 500; newLevel(); bakeWalls(); positions(); msg('LEVEL '+level+' — NEW MAZE'); }
      return;
    }
    /* scatter / chase clock (paused while frightened, as in the original) */
    if (fright > 0){ fright -= dt; if (fright <= 0){ fright = 0; ghostStreak = 0; } }
    else {
      modeT -= dt;
      if (modeT <= 0){ modeIdx = Math.min(modeIdx+1, LV().sched.length-1); modeT = LV().sched[modeIdx];
        mode = modeIdx % 2 ? 'chase' : 'scatter';
        ghosts.forEach(g => { if (g.state==='out'){ g.dx=-g.dx; g.dy=-g.dy; g._decided=false; } }); }
    }
    if (bonus){ bonus.ttl -= dt; if (bonus.ttl <= 0){ bonus = null; $('mzDrink').innerHTML='&nbsp;'; } }
    stepPlayer(dt);
    ghosts.forEach(g => stepGhost(g, dt));
    collide();
  }

  /* ── drawing ─────────────────────────────────────── */
  function bakeWalls(){
    wallLayer = document.createElement('canvas');
    wallLayer.width = canvas.width; wallLayer.height = canvas.height;
    const w = wallLayer.getContext('2d');
    w.strokeStyle = wallCol(); w.lineWidth = 2; w.shadowColor = wallCol(); w.shadowBlur = 6; w.lineCap = 'round';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (MAPSRC[y][x] === 1){
        const nb=[[0,-1],[1,0],[0,1],[-1,0]];
        nb.forEach(([dx,dy],i)=>{
          const v = (y+dy === TUNNEL_Y && (x+dx < 0 || x+dx >= W)) ? 2 : (MAPSRC[y+dy] && MAPSRC[y+dy][x+dx]);
          if (v===undefined || v===1) return;
          w.beginPath(); const X=x*S,Y=y*S;
          if(i===0){w.moveTo(X+2,Y+3);w.lineTo(X+S-2,Y+3);}
          if(i===1){w.moveTo(X+S-3,Y+2);w.lineTo(X+S-3,Y+S-2);}
          if(i===2){w.moveTo(X+2,Y+S-3);w.lineTo(X+S-2,Y+S-3);}
          if(i===3){w.moveTo(X+3,Y+2);w.lineTo(X+3,Y+S-2);}
          w.stroke();
        });
      }
    /* pen door */
    w.strokeStyle = '#FFB8FF'; w.shadowColor = '#FFB8FF'; w.lineWidth = 3;
    w.beginPath(); w.moveTo(DOOR.x*S+3, (DOOR.y+1)*S); w.lineTo(DOOR.x*S+S-3, (DOOR.y+1)*S); w.stroke();
  }
  function swirl(cx,cy,r,col){
    ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(cx,cy+r*.5,r,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy-r*.1,r*.75,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy-r*.6,r*.5,0,7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx-r*.25,cy-r*.9); ctx.lineTo(cx+r*.15,cy-r*1.5); ctx.lineTo(cx+r*.3,cy-r*.8); ctx.closePath(); ctx.fill();
    ctx.shadowBlur=0;
  }
  function chainCup(g){
    const gx = g.x, gy = g.y;
    if (g.state === 'eyes' || g.state === 'home'){
      ctx.fillStyle = '#F6F1FF';
      ctx.beginPath(); ctx.arc(gx-3,gy-1,2.4,0,7); ctx.fill(); ctx.beginPath(); ctx.arc(gx+3,gy-1,2.4,0,7); ctx.fill();
      ctx.fillStyle = '#2A2AFF';
      ctx.beginPath(); ctx.arc(gx-3+g.dx*1.2,gy-1+g.dy*1.2,1.2,0,7); ctx.fill(); ctx.beginPath(); ctx.arc(gx+3+g.dx*1.2,gy-1+g.dy*1.2,1.2,0,7); ctx.fill();
      return;
    }
    const scared = fright > 0 && g.state === 'out';
    const flashing = scared && fright < 2 && ((fright*5)|0) % 2;
    ctx.fillStyle = scared ? (flashing ? '#F6F1FF' : '#2B2BB8') : g.col;
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    /* a cat: round head with two pointy ears */
    ctx.beginPath(); ctx.moveTo(gx-7,gy-2); ctx.lineTo(gx-6,gy-9); ctx.lineTo(gx-2,gy-5); ctx.lineTo(gx+2,gy-5); ctx.lineTo(gx+6,gy-9); ctx.lineTo(gx+7,gy-2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(gx,gy+1,7,6.5,0,0,7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#08011C';
    if (scared){ ctx.fillRect(gx-3.5,gy-1,2,2); ctx.fillRect(gx+1.5,gy-1,2,2);
      ctx.strokeStyle='#08011C'; ctx.lineWidth=1; ctx.beginPath(); for(let i=-3;i<=3;i++) ctx.lineTo(gx+i, gy+4+(i%2?1.5:0)); ctx.stroke(); }
    else {
      ctx.fillStyle='#F6F1FF'; ctx.beginPath(); ctx.ellipse(gx-2.8,gy,2,1.4,0,0,7); ctx.fill(); ctx.beginPath(); ctx.ellipse(gx+2.8,gy,2,1.4,0,0,7); ctx.fill();
      ctx.fillStyle='#08011C'; ctx.fillRect(gx-3.2+g.dx*.8,gy-1.3,.9,2.6); ctx.fillRect(gx+2.3+g.dx*.8,gy-1.3,.9,2.6);   // slit pupils
      ctx.beginPath(); ctx.moveTo(gx-1,gy+2.5); ctx.lineTo(gx+1,gy+2.5); ctx.lineTo(gx,gy+3.6); ctx.closePath(); ctx.fill();   // nose
      ctx.strokeStyle='rgba(255,255,255,.8)'; ctx.lineWidth=.8; ctx.beginPath(); ctx.moveTo(gx-3,gy+3); ctx.lineTo(gx-8,gy+2); ctx.moveTo(gx-3,gy+4); ctx.lineTo(gx-8,gy+5); ctx.moveTo(gx+3,gy+3); ctx.lineTo(gx+8,gy+2); ctx.moveTo(gx+3,gy+4); ctx.lineTo(gx+8,gy+5); ctx.stroke(); // whiskers
    }
  }
  function draw(){
    ctx.fillStyle = SK.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (wallLayer) ctx.drawImage(wallLayer, 0, 0);
    const blinkP = ((performance.now()/250)|0) % 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const v = map[y][x];
      if (v === 0){ ctx.fillStyle = '#FFD166'; ctx.beginPath(); ctx.arc(x*S+S/2, y*S+S/2, 2, 0, 7); ctx.fill(); }
      else if (v === 3 && blinkP){ swirl(x*S+S/2, y*S+S/2, 4.2, SK.pellet); }
    }
    if (bonus){
      const bx = bonus.px, by = bonus.py, col = CATC[bonus.d[1]]||'#FFD166';
      const pulse = 1 + Math.sin(performance.now()/180)*.08, urgent = bonus.ttl < 2.5 && ((bonus.ttl*5)|0) % 2;
      ctx.save(); ctx.translate(bx,by); ctx.scale(pulse,pulse);
      ctx.shadowColor = col; ctx.shadowBlur = urgent ? 4 : 16;
      ctx.fillStyle = col;
      /* the bonus tag: a dog bone, not the old drink cup */
      ctx.fillRect(-5.5, -2, 11, 4);
      [[-6.5,-2.6],[-6.5,2.6],[6.5,-2.6],[6.5,2.6]].forEach(([ex,ey]) => { ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, 7); ctx.fill(); });
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(-4.5, -1, 9, 1.1);
      ctx.restore();
      ctx.font = 'bold 10px "DM Mono", monospace'; ctx.textAlign='center'; ctx.fillStyle = urgent ? '#FF3CAC' : '#FFF4FA'; ctx.shadowColor='#000'; ctx.shadowBlur=4;
      ctx.fillText(bonus.d[0], Math.min(canvas.width-46, Math.max(46, bx)), by + 20); ctx.shadowBlur=0;
    }
    /* player: chomping cup (or dying spin) */
    const px = player.x, py = player.y;
    if (phase === 'dying'){
      const k = Math.min(1, dyingT/1.1);
      ctx.fillStyle = '#F6F1FF'; ctx.shadowColor='#FF3CAC'; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.moveTo(px,py); ctx.arc(px,py,8*(1-k*.9), -Math.PI/2 + k*Math.PI, -Math.PI/2 - k*Math.PI + Math.PI*2); ctx.closePath(); ctx.fill(); ctx.shadowBlur=0;
    } else if (phase !== 'clear' || flash){
      /* player: a little bulldog, facing the way he runs, jaw chomping */
      const mouth = (Math.sin(player.anim) + 1) * 2.2;
      const flip = player.dx < 0 ? -1 : 1;
      ctx.save(); ctx.translate(px, py); ctx.scale(flip, 1);
      ctx.shadowColor='#FF3CAC'; ctx.shadowBlur=8;
      ctx.fillStyle = '#2A0B52'; ctx.beginPath(); ctx.moveTo(-7,-4); ctx.lineTo(-4,-10); ctx.lineTo(-1,-5); ctx.closePath(); ctx.fill();   // ear
      ctx.beginPath(); ctx.moveTo(7,-4); ctx.lineTo(4,-10); ctx.lineTo(1,-5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFF4FA'; ctx.beginPath(); ctx.ellipse(0,-1,8,6.5,0,0,7); ctx.fill();                  // head
      ctx.shadowBlur=0;
      ctx.fillStyle = '#FFD166'; ctx.beginPath(); ctx.arc(3,-2.5,2.4,0,7); ctx.fill();                       // eye patch
      ctx.fillStyle = '#FFF4FA'; ctx.beginPath(); ctx.ellipse(-3.5,3.2,3.6,2.8,0,0,7); ctx.fill(); ctx.beginPath(); ctx.ellipse(3.5,3.2,3.6,2.8,0,0,7); ctx.fill(); // jowls
      ctx.fillStyle = '#2A0B52'; ctx.beginPath(); ctx.arc(-3,-2.5,1.2,0,7); ctx.fill(); ctx.beginPath(); ctx.arc(3,-2.5,1.2,0,7); ctx.fill(); // eyes
      ctx.beginPath(); ctx.ellipse(0,1,1.6,1.1,0,0,7); ctx.fill();                                                   // nose
      ctx.fillStyle = '#FF2D95'; ctx.fillRect(-2.5, 4.5, 5, 1.2 + mouth);                                            // chomping jaw
      ctx.fillStyle = '#fff'; ctx.fillRect(-2, 4.5, 1.2, 1.4); ctx.fillRect(0.8, 4.5, 1.2, 1.4);                    // underbite teeth
      ctx.restore();
    }
    if (phase !== 'dying' || dyingT < .3) ghosts.forEach(g => { ctx.globalAlpha = g.state==='pen' ? .8 : 1; chainCup(g); ctx.globalAlpha = 1; });
    if (flash > 0){ ctx.fillStyle = 'rgba(124,255,79,'+(flash/6*.35)+')'; ctx.fillRect(0,0,canvas.width,canvas.height); flash--; }
    if (phase === 'ready'){ ctx.font = 'bold 16px "Bungee", sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#FFD166'; ctx.shadowColor='#FFD166'; ctx.shadowBlur=12; ctx.fillText('GET SALTY!', W*S/2, 11*S+S/2+6); ctx.shadowBlur=0; }
    ctx.textAlign='center';
    pops = pops.filter(p => (p.t += 1) < 36);
    pops.forEach(p => { ctx.font = (p.txt.startsWith('+') ? 'bold 12px' : 'bold 9px') + ' "DM Mono", monospace'; ctx.globalAlpha = 1 - p.t/36; ctx.fillStyle = '#FFF4FA'; ctx.shadowColor='#000'; ctx.shadowBlur=4;
      ctx.fillText(p.txt, Math.min(canvas.width-50, Math.max(50, p.x*S+S/2)), p.y*S - p.t*.5); });
    ctx.globalAlpha = 1; ctx.shadowBlur=0;
  }

  /* ── scores, prizes, leaderboard ─────────────────── */
  const API='/api';
  const BEST='sdt-best', DEV='sdt-device', PLAY_CAP=3;
  let playToken = null; // server-issued play token, fetched when a game starts; proves the run took real time
  async function fetchPlayToken(){
    try{ const r = await fetch(API + '/scores'); const d = await r.json(); playToken = (d && d.token) || null; }
    catch(e){ playToken = null; }
  }
  function deviceId(){ let d=null; try{ d=localStorage.getItem(DEV); }catch(e){}
    if(!d){ d=Math.random().toString(36).slice(2)+Date.now().toString(36); try{ localStorage.setItem(DEV,d); }catch(e){} } return d; }
  const CAPPED = !(typeof PRELAUNCH !== 'undefined' && PRELAUNCH);   // no daily cap until we are open
  if (location.hash === '#reset-plays'){ try{ localStorage.removeItem('sdt-plays-'+DAY); }catch(e){} history.replaceState(null,'','#play'); }
  function playsToday(){ const k='sdt-plays-'+DAY; let n=0; try{ n=CAPPED ? Number(localStorage.getItem(k)||0) : 0; }catch(e){}
    return {n, bump(){ try{ localStorage.setItem(k, String(n+1)); }catch(e){} }}; }
  function best(){ let v=0; try{ v=Number(localStorage.getItem(BEST)||0); }catch(e){} return v; }
  function setBest(v){ try{ localStorage.setItem(BEST,String(v)); }catch(e){} }

  function recap(){
    const n = drank.length;
    const fav = Object.entries(tally).sort((a,b)=>b[1]-a[1])[0];
    const secs = Math.round((performance.now()-startT)/1000);
    const pickDrink = drank.length ? drank[(Math.random()*drank.length)|0] : window.__pool[0][0];
    let h = `<p class="board__t">Your tab</p><div class="recap">`;
    h += `<div><b>${n}</b><span>tags caught</span></div>`;
    h += `<div><b>${sips}</b><span>sips</span></div>`;
    h += `<div><b>${secs}s</b><span>on the laser</span></div>`;
    if (fav) h += `<div><b style="color:${CATC[fav[0]]||'#fff'}">${fav[1]}</b><span>${fav[0]}</span></div>`;
    h += `</div>`;
    if (drank.length) h += `<p class="recap__try">You caught ${drank.slice(0,4).map(esc).join(', ')}${drank.length>4?' and more':''}.</p>`;
    h += `<p class="recap__try">Want the real thing? <a href="#build">Build a ${esc(pickDrink)}</a>.</p>`;
    return h;
  }

  /* three-letter initials, arcade style */
  function initials(){
    return new Promise(res=>{
      const b=$('mzBoard'); b.style.display='block';
      const saved = (()=>{ try{ return localStorage.getItem('sdt-who')||'DOG'; }catch(e){ return 'TB'; } })().padEnd(3,'A').slice(0,3).toUpperCase().split('');
      b.innerHTML = `<p class="board__t">Enter your initials</p><div class="initials">${saved.map((c,i)=>`<div class="ini" data-i="${i}"><button type="button" data-up>&#9650;</button><b>${c}</b><button type="button" data-dn>&#9660;</button></div>`).join('')}</div><button class="btn btn--solid" type="button" id="mzOk">LOCK IT IN</button>`;
      const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
      b.querySelectorAll('.ini').forEach(el=>{
        const i=+el.dataset.i, out=el.querySelector('b');
        el.querySelector('[data-up]').onclick=()=>{ saved[i]=A[(A.indexOf(saved[i])+1)%A.length]; out.textContent=saved[i]; beep(660,40); };
        el.querySelector('[data-dn]').onclick=()=>{ saved[i]=A[(A.indexOf(saved[i])+A.length-1)%A.length]; out.textContent=saved[i]; beep(520,40); };
      });
      b.querySelector('#mzOk').onclick=()=>{ const who=saved.join('').trim()||'DOG'; try{localStorage.setItem('sdt-who',who);}catch(e){} res(who); };
    });
  }

  async function finish(){
    const isBest = score > best(); if (isBest) setBest(score);
    msg(isBest ? 'NEW PERSONAL BEST — ' + score : 'GAME OVER — ' + score);
    $('mzPad').style.display='none';
    let top = [], code = null, prize = null;
    if (score >= 500){
      const who = await initials();
      try{
        const payload = { score, who, device: deviceId(), tags: drank.length, sips };
        if (playToken) payload.token = playToken; // omitted gracefully if the token fetch failed
        const r = await fetch(API + '/scores', { method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify(payload) });
        const d = await r.json(); top = d.top || []; code = d.code; prize = d.prize;
      }catch(e){}
    }
    board(top, code, prize);
  }
  function board(top, code, prize){
    const b = $('mzBoard'); b.style.display='block';
    let html = recap();
    if (code){
      html += `<div class="prize"><b>FREE UPGRADE</b><span>${code}</span><small>Enter it at checkout: stainless, polished or brass on us · good 30 days · one use</small></div>`;
    } else if (prize === 'already-claimed'){
      html += `<div class="prize prize--done"><b>ALREADY WON TODAY</b><small>One upgrade a day — come back tomorrow</small></div>`;
    }
    else if (prize === 'no-token') html += `<p class="note">Too quick to count: a run needs about a minute to earn an upgrade code. Play again.</p>`;
    else if (prize === 'sold-out') html += `<p class="note">All of today's upgrade codes are gone. Come back tomorrow.</p>`;
    if (top.length){
      html += '<p class="board__t">Today’s top scores</p><ol class="board__l">' +
        top.map(s=>`<li><span>${esc(s.who)}</span><b>${s.score}</b></li>`).join('') + '</ol>';
    }
    html += `<div class="board__acts"><button class="btn btn--solid" type="button" id="mzAgain">Play again</button><button class="btn btn--ghost" type="button" id="mzShare">Share score</button></div>`;
    b.innerHTML = html;
    $('mzAgain').onclick = () => { b.style.display='none'; startGame(); };
    $('mzShare').onclick = share;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* share card: a PNG with the score, generated on the fly */
  async function share(){
    const c=document.createElement('canvas'); c.width=1080; c.height=1080; const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,0,1080); g.addColorStop(0,'#12032E'); g.addColorStop(1,'#5a1268'); x.fillStyle=g; x.fillRect(0,0,1080,1080);
    x.strokeStyle='rgba(42,245,228,.25)'; x.lineWidth=2; for(let i=0;i<1080;i+=60){ x.beginPath(); x.moveTo(i,640); x.lineTo(540+(i-540)*3,1080); x.stroke(); }
    x.fillStyle='#FFD166'; x.textAlign='center'; x.font='bold 64px "Bungee", sans-serif'; x.fillText(SK.title,540,200);
    x.fillStyle='#FFF4FA'; x.font='bold 220px "Bungee", sans-serif'; x.shadowColor='#FF3CAC'; x.shadowBlur=40; x.fillText(String(score),540,520); x.shadowBlur=0;
    x.fillStyle='#2AF5E4'; x.font='40px "DM Mono", monospace'; x.fillText(drank.length+' TAGS CAUGHT · '+DAY,540,620);
    x.fillStyle='#FF3CAC'; x.font='bold 56px "Bungee", sans-serif'; x.fillText('SALTY DOG TAGS',540,940);
    x.fillStyle='rgba(255,244,250,.7)'; x.font='32px "DM Mono", monospace'; x.fillText('saltydogtags.com/play',540,1000);
    const text = 'I scored '+score+' in '+SK.title+' at Salty Dog Tags. Beat me: https://saltydogtags.com/play';
    try{
      const blob = await new Promise(r=>c.toBlob(r,'image/png'));
      const file = new File([blob],'salty-maze.png',{type:'image/png'});
      if (navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], text}); return; }
      if (navigator.share){ await navigator.share({text}); return; }
    }catch(e){ if (e && e.name==='AbortError') return; }
    try{ await navigator.clipboard.writeText(text); msg('Copied — paste it anywhere'); }catch(e){ prompt('Copy this:', text); }
  }

  /* ── game loop ───────────────────────────────────── */
  let last = 0;
  function loop(t){
    if (!playing) return;
    loopId = requestAnimationFrame(loop);
    let dt = Math.min(t - last, 100) / 1000; last = t;      // ignore huge gaps (tab was hidden)
    /* fixed sub-steps keep collisions honest on slow frames */
    while (dt > 0){ const h = Math.min(dt, 1/120); tick(h); dt -= h; if (!playing) return; }
    draw();
  }

  function startGame(){
    reset(true); bakeWalls(); msg('');
    $('mzAttract').classList.remove('on'); $('mzPad').style.display='';
    playing = true; last = performance.now();
    loopId = requestAnimationFrame(loop);
    playToken = null; fetchPlayToken(); // new token per game; old one would already be stale by the time this run finishes
  }
  function openCabinet(){
    const b=$('mzBoard'); b.style.display='none'; b.innerHTML='';
    reset(true); bakeWalls(); draw(); msg(''); $('mzDrink').innerHTML='&nbsp;';
    pauseRunner();
    document.body.dataset.arcade = '1';
    wrap.classList.add('on');
    $('mzAttract').classList.add('on');
    addEventListener('keydown', tryTurn);
    addEventListener('keydown', startOnKey);
  }
  function startOnKey(e){ if (!playing && $('mzAttract').classList.contains('on') && !e.metaKey && !e.ctrlKey && e.key!=='Escape'){ e.preventDefault(); coinUp(); } }
  function coinUp(){
    const p = playsToday();
    if (p.n >= PLAY_CAP){
      $('mzAttract').classList.remove('on'); $('mzBoard').style.display='block';
      $('mzBoard').innerHTML = `<div class="prize prize--done"><b>THAT'S YOUR THREE</b><small>Three goes a day &mdash; the maze resets tomorrow</small></div>`;
      return;
    }
    p.bump(); sfx.coin(); setTimeout(startGame, 350);
  }
  $('mzStart').onclick = coinUp;
  function close(){
    playing = false; cancelAnimationFrame(loopId);
    removeEventListener('keydown', tryTurn); removeEventListener('keydown', startOnKey);
    wrap.classList.remove('on'); delete document.body.dataset.arcade; resumeRunner();
    if (location.hash === '#play') history.replaceState(null,'',location.pathname);
  }

  runner.addEventListener('click', openCabinet);
  wrap.querySelector('.arcade__close').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.querySelectorAll('[data-play]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openCabinet(); }));
  if (location.hash === '#play') setTimeout(openCabinet, 400);
  addEventListener('hashchange', () => { if (location.hash === '#play') openCabinet(); });
})();
