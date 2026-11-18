#!/usr/bin/env python3
"""Regenerate the 1200x630 Open Graph share images in site/assets/og/.

Usage (from anywhere):
    python3 site/assets/og/make-og.py              # rebuild everything + README.md
    python3 site/assets/og/make-og.py pug utah     # rebuild only these slugs (README still rebuilt)
    python3 site/assets/og/make-og.py --list       # print slug -> headline, render nothing

New breed page? Add the folder site/<breed>-dog-tags/ with an <h1> and saying cards
(class "saycard__text" or "say__name"), then run the script. It picks the folder up by its
name, reads the H1 and the first saying, and writes og/<breed>.jpg. Short display names for
breeds with long H1s live in SHORT_NAMES below.

Needs: python3 + Pillow + numpy, Google Chrome. Fonts (Bungee, Archivo, Archivo Black, DM Mono;
all SIL OFL) are fetched once from jsDelivr into ~/.cache/saltydogtags-og/fonts and embedded as
data: URLs, so nothing outside this folder in the repo is written.
"""
import base64, html, json, os, re, shutil, subprocess, sys, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OG = Path(__file__).resolve().parent            # site/assets/og
SITE = OG.parents[1]                             # site/
ASSETS = SITE / "assets"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT_DIR = Path.home() / ".cache" / "saltydogtags-og" / "fonts"
FONTS = {  # family -> jsDelivr path under google/fonts@main/ofl/
    "Bungee": "bungee/Bungee-Regular.ttf",
    "Archivo": "archivo/Archivo%5Bwdth,wght%5D.ttf",
    "Archivo Black": "archivoblack/ArchivoBlack-Regular.ttf",
    "DM Mono": "dmmono/DMMono-Medium.ttf",
}
W, H = 1200, 630
MAX_BYTES = 150 * 1024

FALLBACK_SUB = {"utah": "From a Lehi bulldog family."}  # pages without saying cards
SHORT_NAMES = {  # folder slug -> name used in "<Name> dog tags"
    "aussie": "Aussie", "bernese": "Bernese", "cavalier": "Cavalier", "doodle": "Doodle",
    "boston-terrier": "Boston Terrier", "utah": "Utah", "st-george": "St. George",
}
# Anodized finishes from app.js FINISHES, cycled across breed pages (alphabetical order).
FINISHES = {
    "hotpink": "#EE5FA6", "sky": "#5CB9EA", "yellow": "#F4C83F", "royal": "#2F5FD8", "green": "#4FC27C",
}
BREED_CYCLE = ["hotpink", "sky", "yellow", "royal", "green"]


# ---------------------------------------------------------------- helpers
def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def smart(s):
    """Typographer's quotes for headline/aside text (tag engraving keeps the builder's straight quotes)."""
    s = re.sub(r'"([^"]*)"', "\u201c\\1\u201d", s)
    return s.replace("'", "\u2019")


def page(path):
    return (SITE / path / "index.html").read_text(encoding="utf-8")


def h1_of(src):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S)
    return strip_tags(m.group(1)) if m else ""


def first_saying(src):
    m = re.search(r'class="(?:saycard__text|say__name)">(.*?)</(?:p|span)>', src, re.S)
    if not m:
        return None
    return [strip_tags(x) for x in re.split(r"<br\s*/?>", m.group(1)) if strip_tags(x)]


def split_title(t):
    """Guide H1 -> (headline, aside). Splits at the first ': ' or '? ', else at ' ('."""
    m = re.match(r"^(.+?[:?])\s+(.+)$", t)
    if m:
        head, rest = m.group(1).rstrip(":"), m.group(2)
    elif " (" in t:
        head, rest = t.split(" (", 1)
        rest = "(" + rest
        close = rest.find(")")
        if 0 < close < len(rest) - 1:          # "X (and Y), more" -> headline "X (and Y)", aside "more"
            head, rest = head + " " + rest[: close + 1], rest[close + 1:].lstrip(" ,;-")
    else:
        return t, ""
    rest = rest.strip()
    if rest.startswith("(") and rest.endswith(")") and rest.count("(") == 1:
        rest = rest[1:-1]
    return head.strip(), rest


def ensure_fonts():
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    css = []
    for fam, rel in FONTS.items():
        f = FONT_DIR / (fam.replace(" ", "") + ".ttf")
        if not f.exists():
            urllib.request.urlretrieve("https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/" + rel, f)
        b64 = base64.b64encode(f.read_bytes()).decode()
        weight = "100 900" if fam == "Archivo" else ("500" if fam == "DM Mono" else "400")
        css.append(f"@font-face{{font-family:'{fam}';src:url(data:font/ttf;base64,{b64}) format('truetype');font-weight:{weight};font-style:normal}}")
    return "\n".join(css)


def tag_cutout(dst):
    """Cut the real polished bone tag (whisky-tag-real.jpg) off its dark fabric.
    Top/sides: luminance threshold (bright steel vs dark cloth). Bottom: the bevel reflects the
    black cloth, so its outline is hand-traced in photo pixels. Exterior = flood fill from a corner;
    the ring hole and paw cut-outs keep their (near-black) photo pixels, which read as holes on void."""
    im = Image.open(ASSETS / "whisky-tag-real.jpg").convert("RGB")
    L = np.asarray(im.convert("L"))
    m = Image.fromarray(((L > 70) * 255).astype("uint8"))
    bottom = [(40, 240), (42, 282), (50, 297), (70, 317), (95, 328), (120, 329.5), (152, 329), (160, 327.5),
              (170, 322.5), (182, 315), (195, 306), (205, 294), (212, 288), (245, 286.5), (320, 287.5),
              (370, 289), (400, 292.5), (410, 296), (425, 310), (437, 321), (450, 329), (470, 332.5),
              (495, 336), (510, 337), (525, 334), (540, 327.5), (555, 315), (567, 300), (577, 282),
              (582, 265), (584, 250), (584, 238), (420, 200), (120, 200)]
    ImageDraw.Draw(m).polygon(bottom, fill=255)
    m = m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))   # close pinholes on the rim
    ff = m.copy()
    ImageDraw.floodfill(ff, (0, 0), 128)
    mask = Image.fromarray(np.where(np.asarray(ff) == 128, 0, 255).astype("uint8"))
    mask = mask.filter(ImageFilter.MinFilter(3))                                 # eat the 1px cloth fringe
    mask = mask.filter(ImageFilter.GaussianBlur(1.6)).point(lambda v: 255 if v > 128 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(0.7))                            # antialiased edge
    bbox = mask.getbbox()
    out = im.convert("RGBA")
    out.putalpha(mask)
    out.crop(bbox).save(dst)


# ---------------------------------------------------------------- jobs
def jobs():
    J = []
    J.append(dict(slug="home", page="/", kind="photo", headline="Funny dog tags. Laser engraved.",
                  sub="", foot="Engraved in Lehi, Utah", eyebrow="From $12. Name and number on the back."))
    J.append(dict(slug="sayings", page="/sayings/", kind="fan", headline="181 sayings your dog would say.",
                  sub="", foot="Laser engraved in Utah", eyebrow="Funny dog tag sayings",
                  tags=[(["Built like", "a loaf."], "hotpink"), (["Drool", "happens."], "sky"),
                        (["Runs on naps", "and spite."], "yellow")]))
    J.append(dict(slug="wall", page="/wall/", kind="wall", headline="Wall of Shame.",
                  sub="Your dog could be first.", foot="Real dogs. Real tags.", eyebrow="Customer dogs"))

    breeds = sorted(p.name for p in SITE.iterdir() if p.is_dir() and p.name.endswith("-dog-tags"))
    # City pages share the "-dog-tags" folder pattern but are not breeds: they take a fixed finish and stay out of the
    # cycle and the breed count, so adding one never recolors the breed cards after it.
    LOCAL = {"st-george-dog-tags": "yellow"}
    hub_tags = []
    i = -1
    for folder in breeds:
        if folder not in LOCAL:
            i += 1
        slug = folder[: -len("-dog-tags")]
        src = page(folder)
        h1 = h1_of(src)
        name = SHORT_NAMES.get(slug) or re.sub(r"(?i)^funny\s+|\s+dog tags$", "", h1).strip()
        saying = first_saying(src)
        fin = LOCAL.get(folder) or BREED_CYCLE[i % len(BREED_CYCLE)]
        if saying:
            J.append(dict(slug=slug, page=f"/{folder}/", kind="tag", headline=f"{name} dog tags",
                          saying=saying, finish=fin, foot="Laser engraved in Utah", eyebrow="Funny engraved tags"))
            if slug in ("pug", "corgi", "husky"):
                hub_tags.append((saying, fin))
        else:  # no saying cards on the page (e.g. utah): real tag photo + the page's own tagline
            tagline = FALLBACK_SUB.get(slug) or (h1[h1.index(" From ") + 1:] if " From " in h1 else "")
            J.append(dict(slug=slug, page=f"/{folder}/", kind="photo", headline=f"{name} dog tags",
                          sub=tagline, foot="Laser engraved in Utah", eyebrow="Funny engraved tags"))
    if (SITE / "dog-tags-by-breed" / "index.html").exists():
        J.append(dict(slug="dog-tags-by-breed", page="/dog-tags-by-breed/", kind="fan",
                      headline=h1_of(page("dog-tags-by-breed")), sub="Every breed has its own crimes.",
                      foot="Laser engraved in Utah", eyebrow=f"{len(breeds) - 1 - len(LOCAL.keys() & set(breeds))} breeds and counting",
                      tags=[(s, "hotpink" if k == 0 else ("sky" if k == 1 else "yellow")) for k, (s, f) in enumerate(hub_tags)]))

    gdir = SITE / "guides"
    if (gdir / "index.html").exists():
        J.append(dict(slug="guides", page="/guides/", kind="photo", headline=h1_of(page("guides")),
                      sub="From a house with seven bulldogs.", foot="saltydogtags.com/guides", eyebrow="Guides"))
    for g in sorted(p for p in gdir.iterdir() if p.is_dir() and (p / "index.html").exists()):
        h1 = h1_of(page(f"guides/{g.name}"))
        head, aside = split_title(h1)
        J.append(dict(slug=g.name, page=f"/guides/{g.name}/", kind="photo", guide=True, headline=head,
                      sub=aside, h1=h1, foot="saltydogtags.com/guides", eyebrow="Guide"))
    return J


# ---------------------------------------------------------------- html
TEMPLATE = r"""<!doctype html><html><head><meta charset="utf-8"><style>
__FONTS__
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#09010F}
.og{position:relative;width:1200px;height:630px;overflow:hidden;color:#FFF4FA;font-family:'Archivo',sans-serif;
  background:radial-gradient(900px 620px at 8% 0%,#1A0B33 0%,rgba(26,11,51,0) 60%),#09010F}
.glow{position:absolute;left:560px;top:-20px;width:680px;height:680px;border-radius:50%;
  background:radial-gradient(closest-side,var(--glow) 0%,rgba(0,0,0,0) 100%);opacity:.32}
.logo{position:absolute;left:64px;top:52px;height:52px}
.copy{position:absolute;left:64px;top:140px;width:var(--cw);height:360px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-family:'DM Mono',monospace;font-weight:500;font-size:17px;letter-spacing:.2em;text-transform:uppercase;color:#2AF5E4;margin-bottom:22px}
h1{font-family:'Bungee',sans-serif;font-weight:400;line-height:1.02;letter-spacing:-.005em;color:#FFF4FA;
  text-shadow:.06em .06em 0 #FF2E97;text-wrap:balance;font-size:84px}
.sub{font-weight:600;font-size:30px;line-height:1.22;color:#CFC3DD;margin-top:24px;text-wrap:balance;letter-spacing:-.005em}
.foot{position:absolute;left:64px;bottom:54px;display:flex;align-items:center;gap:16px;
  font-family:'DM Mono',monospace;font-weight:500;font-size:18px;letter-spacing:.18em;text-transform:uppercase;color:#FFF4FA}
.foot i{display:block;width:44px;height:3px;border-radius:2px;background:#00E5FF;box-shadow:0 0 10px rgba(0,229,255,.8)}
.url{position:absolute;right:64px;bottom:54px;font-family:'DM Mono',monospace;font-weight:500;font-size:16px;letter-spacing:.18em;text-transform:uppercase;color:#A496B8}
.art{position:absolute;left:var(--ax);top:20px;width:calc(1200px - var(--ax) - 30px);height:560px;display:flex;align-items:center;justify-content:center}
.photo{width:var(--pw);transform:rotate(-7deg);filter:drop-shadow(0 26px 28px rgba(0,0,0,.75)) drop-shadow(0 0 1px rgba(255,255,255,.25))}
.tag{position:absolute;filter:drop-shadow(0 22px 26px rgba(0,0,0,.6))}
/* wall: mugshot height board */
.board{position:relative;width:430px;height:470px;border-radius:14px;overflow:hidden;transform:rotate(3deg);
  background:repeating-linear-gradient(to bottom,rgba(255,244,250,.0) 0 39px,rgba(255,244,250,.16) 39px 41px),#1A0B33;
  box-shadow:0 30px 50px -10px rgba(0,0,0,.8),inset 0 0 0 2px rgba(255,244,250,.08)}
.board .n{position:absolute;right:16px;font-family:'DM Mono',monospace;font-size:14px;letter-spacing:.1em;color:rgba(255,244,250,.45)}
.board .q{position:absolute;left:0;right:0;top:36px;text-align:center;font-family:'Bungee',sans-serif;font-size:230px;line-height:1;color:transparent;
  -webkit-text-stroke:3px rgba(255,244,250,.35)}
.plac{position:absolute;left:50px;right:50px;bottom:34px;padding:16px 18px 14px;border-radius:8px;background:#FFF4FA;color:#09010F;text-align:center;
  box-shadow:0 10px 20px rgba(0,0,0,.5)}
.plac b{display:block;font-family:'Bungee',sans-serif;font-weight:400;font-size:34px;line-height:1;color:#09010F}
.plac span{display:block;font-family:'DM Mono',monospace;font-weight:500;font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#FF2E97;margin-bottom:8px}
.plac em{display:block;font-style:normal;font-family:'DM Mono',monospace;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#4A3B5E;margin-top:8px}
</style></head><body>
<div class="og" id="og"></div>
<script>
const D = __DATA__;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SHARED = '<linearGradient id="sdt-en" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBFCFE"/><stop offset=".55" stop-color="#C9CED6"/><stop offset="1" stop-color="#EDF0F4"/></linearGradient>';
const cv = document.createElement('canvas').getContext('2d');
const textW = (s, px) => { cv.font = px + "px 'Archivo Black'"; return cv.measureText(s).width; };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299*(n>>16) + 0.587*((n>>8)&255) + 0.114*(n&255)) / 255; };
// Same layout + engraving as app.js tagSVGTemplate (bone, anodized, Block font).
function tagSVG(lines, base, w) {
  const a = D.area, LH = 1.18, L = lines.map((l) => l.toUpperCase()), n = L.length;
  let fs = 24; for (; fs > 11; fs--) if (L.every((l) => textW(l, fs) <= a.w) && n * fs * LH <= a.h) break;
  const lh = fs * LH, top = a.cy - ((n - 1) * lh) / 2 + fs * 0.36;
  const t = L.map((l, i) => `<text x="${a.cx}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${fs}">${esc(l)}</text>`).join('');
  const ink = lum(base) < 0.5
    ? `<g fill="rgba(0,0,0,.55)" transform="translate(0,-1)">${t}</g><g fill="rgba(255,255,255,.35)" transform="translate(0,1)">${t}</g><g fill="url(#sdt-en)">${t}</g>`
    : `<g fill="rgba(255,255,255,.5)" transform="translate(0,0.9)">${t}</g><g fill="#1F2327">${t}</g>`;
  return `<svg viewBox="0 0 320 240" width="${w}" height="${w*0.75}" xmlns="http://www.w3.org/2000/svg" style="color:${base}"><defs>${SHARED}</defs>${D.bone}<g font-family="'Archivo Black',sans-serif" style="letter-spacing:.01em">${ink}</g></svg>`;
}
function build() {
  const j = D.job, og = document.getElementById('og');
  const photoish = j.kind === 'photo';
  const cw = j.guide ? 640 : (j.kind === 'wall' ? 560 : (j.kind === 'fan' ? 490 : 520));
  const ax = j.guide ? 730 : (j.kind === 'wall' ? 640 : 590);
  og.style.setProperty('--cw', cw + 'px'); og.style.setProperty('--ax', ax + 'px');
  og.style.setProperty('--pw', (j.guide ? 420 : 560) + 'px');
  og.style.setProperty('--glow', j.finish ? D.fin[j.finish] : (j.kind === 'wall' ? '#FF2E97' : '#00E5FF'));
  let art = '';
  if (photoish) art = `<img class="photo" src="${D.photo}" alt="">`;
  if (j.kind === 'tag') art = `<div class="tag" style="transform:rotate(-6deg)">${tagSVG(j.saying, D.fin[j.finish], 600)}</div>`;
  if (j.kind === 'fan') {
    const pos = [[-60, -150, -7], [125, 0, 6], [-125, 152, -4]];
    art = j.tags.map(([lines, f], i) => `<div class="tag" style="transform:translate(${pos[i][0]}px,${pos[i][1]}px) rotate(${pos[i][2]}deg)">${tagSVG(lines, D.fin[f], 335)}</div>`).join('');
  }
  if (j.kind === 'wall') {
    let ticks = ''; for (let k = 0; k < 12; k++) ticks += `<span class="n" style="top:${k*40 + 30}px">${(11 - k) * 2}"</span>`;
    art = `<div class="board">${ticks}<div class="q">?</div><div class="plac"><span>Salty Dog Dept.</span><b>YOUR DOG</b><em>No. 001 &middot; Booked: pending</em></div></div>`;
  }
  og.innerHTML = `<div class="glow"></div><img class="logo" src="${D.logo}" alt="">
    <div class="copy">${j.eyebrow ? `<p class="eyebrow">${esc(j.eyebrow)}</p>` : ''}<h1>${esc(j.headline).replace(/ dog tags$/i, (m) => m.replace(/ tags$/i, '\u00a0tags'))}</h1>${j.sub ? `<p class="sub">${esc(j.sub)}</p>` : ''}</div>
    <div class="foot"><i></i>${esc(j.foot)}</div>
    ${j.foot.toLowerCase().includes('saltydogtags') ? '' : '<div class="url">saltydogtags.com</div>'}
    <div class="art">${art}</div>`;
  // fit the headline: biggest size where no word overflows and the copy block fits its box
  const copy = og.querySelector('.copy'), h = og.querySelector('h1'), sub = og.querySelector('.sub');
  const maxH = copy.clientHeight;
  for (let fs = j.guide ? 72 : 88; fs >= 34; fs -= 2) {
    h.style.fontSize = fs + 'px';
    if (sub) sub.style.fontSize = Math.max(22, Math.min(32, Math.round(fs * 0.46))) + 'px';
    let used = 0; for (const c of copy.children) used += c.offsetHeight + parseFloat(getComputedStyle(c).marginTop);
    if (h.scrollWidth <= cw + 1 && used <= maxH) break;
  }
  document.title = 'ready';
}
document.fonts.ready.then(() => Promise.all(["400 20px Bungee","700 20px Archivo","400 20px 'Archivo Black'","500 20px 'DM Mono'"].map((f) => document.fonts.load(f)))).then(build);
</script></body></html>"""


def render(job, ctx, tmp):
    data = dict(job=job, area=ctx["area"], bone=ctx["bone"], fin=FINISHES, logo=ctx["logo"], photo=ctx["photo"])
    htmlf = tmp / f"{job['slug']}.html"
    htmlf.write_text(TEMPLATE.replace("__FONTS__", ctx["fonts"]).replace("__DATA__", json.dumps(data)), encoding="utf-8")
    png = tmp / f"{job['slug']}.png"
    prof = tmp / f"prof-{job['slug']}"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--no-first-run", "--no-default-browser-check", f"--user-data-dir={prof}",
                    "--virtual-time-budget=6000", f"--window-size={W},{H}", f"--screenshot={png}", htmlf.as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    im = Image.open(png).convert("RGB")
    if im.size != (W, H):
        im = im.crop((0, 0, W, H))
    dst = OG / f"{job['slug']}.jpg"
    for q, sub in ((82, 0), (82, 2), (76, 2), (70, 2), (62, 2)):   # 4:4:4 first: keeps pink type edges clean
        im.save(dst, "JPEG", quality=q, subsampling=sub, optimize=True, progressive=True)
        if dst.stat().st_size <= MAX_BYTES:
            break
    return job["slug"], dst.stat().st_size, q, sub


def write_readme(J):
    rows = []
    for j in J:
        extra = ""
        if j["kind"] == "tag":
            extra = " / ".join(j["saying"])
        elif j.get("sub"):
            extra = j["sub"]
        elif j["kind"] == "fan":
            extra = "; ".join(" / ".join(s) for s, _ in j["tags"])
        rows.append(f"| `{j['slug']}.jpg` | `{j['page']}` | {j['headline']} | {extra.replace('|', '/')} |")
    (OG / "README.md").write_text(
        "# Open Graph share images (1200 x 630)\n\n"
        "Generated by `make-og.py` in this folder. Do not hand-edit the JPEGs; change the page or the script and rerun:\n\n"
        "```\npython3 site/assets/og/make-og.py            # everything\npython3 site/assets/og/make-og.py boxer      # one slug\n"
        "python3 site/assets/og/make-og.py --list     # dry run\n```\n\n"
        "A new `site/<breed>-dog-tags/` folder is picked up automatically: headline `<Breed> dog tags` from its H1 "
        "(short names in `SHORT_NAMES`), first saying card engraved on a bone tag using the same layout as the site builder, "
        "anodized colour cycled hot pink / sky / yellow / royal / green. Guides use their H1, split at the first `:`/`?` or `(` "
        "into headline + aside. JPEG q82 4:4:4, stepped down only if a file would pass 150 KB.\n\n"
        "Wire-up (not done here): `<meta property=\"og:image\" content=\"https://saltydogtags.com/assets/og/<slug>.jpg\">` "
        "with `og:image:width` 1200 and `og:image:height` 630, plus `twitter:card` `summary_large_image`.\n\n"
        "| File | Page | Headline | Saying / aside |\n|---|---|---|---|\n" + "\n".join(rows) + "\n",
        encoding="utf-8")


def main(argv):
    J = jobs()
    if "--list" in argv:
        for j in J:
            print(f"{j['slug']:45} {j['kind']:6} {j['headline']}  ||  {' / '.join(j.get('saying') or []) or j.get('sub','')}")
        return
    only = {a for a in argv if not a.startswith("-")}
    todo = [j for j in J if not only or j["slug"] in only]
    for j in todo:
        j["headline"], j["sub"] = smart(j["headline"]), smart(j.get("sub", ""))
    tmp = Path(tempfile.mkdtemp(prefix="sdt-og-"))
    try:
        tag_cutout(tmp / "tag-cutout.png")
        bone = (ASSETS / "shapes" / "bone.svg").read_text(encoding="utf-8")
        bone = bone[bone.index(">", bone.index("<svg")) + 1: bone.rindex("</svg>")]
        bone = re.sub(r"<title>.*?</title>", "", bone, flags=re.S)
        ctx = dict(fonts=ensure_fonts(), bone=bone,
                   area=json.loads((ASSETS / "shapes" / "shapes.json").read_text())["shapes"]["bone"]["area"],
                   logo=(ASSETS / "logo" / "logo-final-horizontal-dark.svg").as_uri(),
                   photo=(tmp / "tag-cutout.png").as_uri())
        with ThreadPoolExecutor(6) as ex:
            for slug, size, q, sub in ex.map(lambda j: render(j, ctx, tmp), todo):
                print(f"{slug + '.jpg':50} {size/1024:6.1f} KB  q{q} {'4:4:4' if sub == 0 else '4:2:0'}")
        write_readme(J)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main(sys.argv[1:])
