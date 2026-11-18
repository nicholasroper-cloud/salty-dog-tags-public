#!/usr/bin/env python3
"""Draw each feed saying onto its tag blank -> site/assets/feed/s<N>.jpg (800x800, white background),
and each breed page's lead saying card -> site/assets/feed/b-<slug>.jpg (the breed page's Product image).

Inputs: tools/out/feed-items.json (node tools/build-merchant-feed.mjs) and tools/out/breed-images.json (node tools/build-breeds.mjs).
Only images whose saying, shape, finish or ink changed are redrawn (tools/out/image-sigs.json); --all redraws everything.
The blank photos are the same ones the builder uses (site/assets/blanks/<shape>-<finish>.png); the text is
drawn in the engraving tone for that finish (light marks on dark anodized, dark marks on stainless/brass).
Needs Pillow and Poppins Bold (the font every existing image uses; set SDT_FONT=/path/to/Poppins-Bold.ttf on a Mac,
it is OFL at github.com/google/fonts/tree/main/ofl/poppins). It refuses to fall back to another face, so the set stays consistent.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'site', 'assets', 'feed')
FONTS = [os.environ.get('SDT_FONT', ''), '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
         os.path.expanduser('~/Library/Fonts/Poppins-Bold.ttf')]
FONT = next((f for f in FONTS if f and os.path.exists(f)), None)
# Engravable area per shape, as fractions of the tag's bounding box: (cx, cy, w, h)
AREA = {'bone': (0.5, 0.5, 0.62, 0.5), 'heart': (0.5, 0.44, 0.58, 0.40), 'round': (0.5, 0.52, 0.66, 0.50),
        'military': (0.53, 0.5, 0.68, 0.56), 'paw': (0.5, 0.74, 0.5, 0.24)}
INK = {'light': (236, 238, 240), 'dark': (38, 40, 44)}


def fit_font(draw, lines, w, h):
    for size in range(64, 10, -1):
        f = ImageFont.truetype(FONT, size)
        lh = f.getbbox('Ag')[3] * 1.12
        widest = max(draw.textlength(l, font=f) for l in lines)
        if widest <= w and lh * len(lines) <= h:
            return f, lh
    f = ImageFont.truetype(FONT, 10)
    return f, f.getbbox('Ag')[3] * 1.12


def render(item):
    blank = Image.open(os.path.join(ROOT, 'site', 'assets', 'blanks', f"{item['shape']}-{item['finish']}.png")).convert('RGBA')
    tag = blank.crop(blank.getbbox())
    scale = 640 / max(tag.size)
    tag = tag.resize((round(tag.width * scale), round(tag.height * scale)), Image.LANCZOS)
    cx, cy, fw, fh = AREA.get(item['shape'], (0.5, 0.5, 0.6, 0.5))
    # engraving layer, clipped to the tag
    layer = Image.new('RGBA', tag.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    lines = [l for l in item['lines'] if l.strip()]
    font, lh = fit_font(d, lines, tag.width * fw, tag.height * fh)
    top = tag.height * cy - lh * len(lines) / 2
    ink = INK[item['ink']]
    for k, line in enumerate(lines):
        y = top + k * lh
        if item['shape'] == 'paw':   # glitter pad texture: a faint halo keeps the words legible
            halo = (255, 255, 255, 200) if item['ink'] == 'dark' else (20, 20, 22, 200)
            d.text((tag.width * cx, y), line, font=font, fill=ink + (255,), anchor='ma', stroke_width=3, stroke_fill=halo)
        else:
            d.text((tag.width * cx, y), line, font=font, fill=ink + (235,), anchor='ma')
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', tag.size, 0), tag.getchannel('A')))
    soft = layer.filter(ImageFilter.GaussianBlur(0.6))          # laser marks have soft edges
    tag = Image.alpha_composite(tag, soft)
    canvas = Image.new('RGB', (800, 800), (255, 255, 255))
    shadow = Image.new('RGBA', (800, 800), (0, 0, 0, 0))
    sh = Image.new('RGBA', tag.size, (0, 0, 0, 60)); sh.putalpha(tag.getchannel('A').point(lambda a: a * 60 // 255))
    pos = ((800 - tag.width) // 2, (800 - tag.height) // 2)
    shadow.paste(sh, (pos[0] + 8, pos[1] + 14), sh)
    canvas.paste(shadow.filter(ImageFilter.GaussianBlur(14)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.paste(tag, pos, tag)
    canvas.save(os.path.join(OUT, item['file']), quality=86, optimize=True, progressive=True)


def sig(item):
    return '|'.join([item['shape'], item['finish'], item['ink'], '/'.join(item['lines'])])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    out_dir = os.path.join(ROOT, 'tools', 'out')
    items = json.load(open(os.path.join(out_dir, 'feed-items.json')))
    for it in items:
        it.setdefault('file', f"s{it['i']}.jpg")
    breeds = os.path.join(out_dir, 'breed-images.json')
    if os.path.exists(breeds):
        items += json.load(open(breeds))
    sig_path = os.path.join(out_dir, 'image-sigs.json')
    sigs = json.load(open(sig_path)) if os.path.exists(sig_path) else {}
    todo = [it for it in items if '--all' in sys.argv or sigs.get(it['file']) != sig(it) or not os.path.exists(os.path.join(OUT, it['file']))]
    if todo and not FONT:
        sys.exit('render-feed-images: Poppins Bold not found; set SDT_FONT=/path/to/Poppins-Bold.ttf')
    for it in todo:
        render(it)
        sigs[it['file']] = sig(it)
    json.dump(dict(sorted(sigs.items())), open(sig_path, 'w'), indent=1)
    print(f'rendered {len(todo)} of {len(items)} images -> site/assets/feed/')
