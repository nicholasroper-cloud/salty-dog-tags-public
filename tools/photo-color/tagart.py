"""Tag mockup kit: template SVG pieces + numpy engraving layers (black anneal, dithered photo, MOPA oxide colours)."""
import re, io, base64, math, json, sys
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from svgelements import Path as SPath, Matrix
sys.path.insert(0, '/private/tmp/claude-501/-Users-nick/6ad81fa5-55b6-47c7-84fd-f526aad5c6c2/scratchpad/pc')
from dither import jjn, resize

SITE = '/Users/nick/Clover API TB/saltydogtags/site'
FONTS = '/private/tmp/claude-501/-Users-nick/6ad81fa5-55b6-47c7-84fd-f526aad5c6c2/scratchpad/fonts'
SHAPES = json.load(open(f'{SITE}/assets/shapes/shapes.json'))['shapes']
NS = {'s': 'http://www.w3.org/2000/svg'}
ET.register_namespace('', 'http://www.w3.org/2000/svg'); ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
R = 4                      # engraving layer px per template unit
VW, VH = 320, 240
PAW_D = 'M12 13c-2.8 0-6 2.2-6 5 0 1.7 1.3 2.5 2.6 2.5 1.2 0 2-.6 3.4-.6s2.2.6 3.4.6c1.3 0 2.6-.8 2.6-2.5 0-2.8-3.2-5-6-5zM5.5 7a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zm13 0a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zM9 3.5a2 3 0 1 0 0 6 2 3 0 1 0 0-6zm6 0a2 3 0 1 0 0 6 2 3 0 1 0 0-6z'
PAW_CUT = (236.8, 172.6, 1.756)      # site's polished-bone cut-out placement (centre x, y, scale of the 24u icon)

def blur(a, s):
    if s <= 0: return a
    k = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi ** 2) * (s ** 2) * k)))

# ---------------- template pieces ----------------
def template(shape):
    t = ET.parse(f'{SITE}/assets/shapes/{shape}.svg').getroot()
    out = {}
    defs = t.find('s:defs', NS)
    out['defs'] = ''.join(ET.tostring(c, encoding='unicode') for c in defs)
    for el in t:
        i = el.get('id')
        if i: out[i] = ET.tostring(el, encoding='unicode')
    out['body_d'] = t.find(".//*[@id='body']").get('d')
    # strip the xmlns noise ElementTree adds on fragments
    for k in out: out[k] = re.sub(r' xmlns(:\w+)?="[^"]+"', '', out[k])
    # filter regions as % of a thin stroke's bbox clip the blur into a box: use a fixed user-space region instead
    out['defs'] = re.sub(r'<filter id="([^"]+)"[^>]*>', lambda m: f'<filter id="{m.group(1)}" filterUnits="userSpaceOnUse" x="-60" y="-60" width="440" height="360">', out['defs'])
    out['geo'] = SHAPES[shape]
    return out

# ---------------- rasterising vector bits into the layer ----------------
def path_mask(d, transform='', scale=R, size=(VW * R, VH * R), ss=2):
    """rasterise an SVG path (template units) into a float mask at layer resolution"""
    p = SPath(d)
    if transform: p = p * Matrix(transform)
    p = p * Matrix(f'scale({scale * ss})'); p.reify()
    im = Image.new('L', (size[0] * ss, size[1] * ss), 0); dr = ImageDraw.Draw(im)
    for sub in p.as_subpaths():
        sp = SPath(sub)
        L = sp.length(error=1e-3)
        n = max(16, int(L / 1.5))
        pts = [sp.point(i / n) for i in range(n)]
        dr.polygon([(q.x, q.y) for q in pts], fill=255)
    im = im.resize(size, Image.LANCZOS)
    return np.asarray(im, np.float32) / 255

def text_mask(lines, box, font='ArchivoBlack-Regular.ttf', lh=1.20, sizes=None, max_px=None, track=0.0):
    """lines centred in box=(cx,cy,w,h) in template units -> list of per-line masks (so lines can get different inks)"""
    cx, cy, w, h = [q * R for q in box]
    F = f'{FONTS}/{font}'
    rel = sizes or [1.0] * len(lines)
    fs = int(max_px or h)
    def measure(fs):
        ws = [];
        for l, k in zip(lines, rel):
            f = ImageFont.truetype(F, max(4, int(fs * k)))
            ws.append(f.getbbox(l)[2] - f.getbbox(l)[0] + track * fs * k * max(0, len(l) - 1))
        hs = sum(fs * k * lh for k in rel) - fs * rel[-1] * (lh - 1)
        return ws, hs
    while fs > 8:
        ws, hs = measure(fs)
        if max(ws) <= w and hs <= h: break
        fs -= 1
    ws, hs = measure(fs)
    masks = []; y = cy - hs / 2
    for l, k, wl in zip(lines, rel, ws):
        f = ImageFont.truetype(F, max(4, int(fs * k)))
        im = Image.new('L', (VW * R, VH * R), 0); dr = ImageDraw.Draw(im)
        asc, desc = f.getmetrics(); cap = f.getbbox('H')
        x = cx - wl / 2
        if track:
            for ch in l:
                dr.text((x, y - cap[1]), ch, font=f, fill=255); x += f.getlength(ch) + track * fs * k
        else:
            dr.text((x - f.getbbox(l)[0], y - cap[1]), l, font=f, fill=255)
        masks.append(np.asarray(im, np.float32) / 255)
        y += fs * k * lh
    return masks, fs / R

# ---------------- surface treatments ----------------
rng = np.random.default_rng(11)
YY, XX = np.mgrid[0:VH * R, 0:VW * R].astype(np.float32)

def lowfreq(s, seed):
    g = np.random.default_rng(seed).standard_normal((VH * R, VW * R)); g = blur(g, s); return g / g.std()

def anneal(mask, base=(30, 30, 38)):
    """black-anneal mark: near-black, faint blue-brown drift, satin"""
    n = lowfreq(18 * R, 3)
    rgb = np.stack([np.full_like(mask, c) for c in base], -1)
    rgb[..., 2] += 6 * n; rgb[..., 0] += 3 * -n
    return rgb, mask * 0.94

def ramp(t, stops):
    t = np.clip(t, 0, 1); xs = [s[0] for s in stops]
    return np.stack([np.interp(t, xs, [s[1][i] for s in stops]) for i in range(3)], -1)

OXIDE = {
    # thin-film colours: position along the ramp drifts with "view angle" + local heat, so hue shifts like real MOPA marks
    'gold':   [(0, (132, 84, 30)), (.28, (186, 130, 44)), (.52, (216, 170, 70)), (.74, (200, 146, 58)), (1, (160, 100, 56))],
    'blue':   [(0, (22, 30, 112)), (.30, (28, 58, 168)), (.55, (34, 92, 198)), (.75, (38, 124, 186)), (1, (72, 58, 168))],
    'purple': [(0, (62, 28, 112)), (.35, (102, 40, 160)), (.60, (138, 60, 182)), (.82, (96, 58, 186)), (1, (66, 46, 150))],
}

def oxide(mask, kind, seed=1, angle=35, hatch_mm=0.10, ppm=7.3, strength=1.0):
    """MOPA oxide colour fill: hue drift across the mark (iridescence), hatch striations, darker heat-tinted edge."""
    a = math.radians(angle)
    sweep = ((XX * math.cos(a) + YY * math.sin(a)) / (VW * R))          # 0..~1 across the tag
    t = 0.10 + 0.85 * ((sweep - sweep.min()) / (sweep.max() - sweep.min())) + 0.16 * lowfreq(9 * R, seed) + 0.05 * lowfreq(2.5 * R, seed + 5)
    rgb = ramp(t, OXIDE[kind])
    # hatch lines (laser fill passes), very faint
    pitch = max(2.4, hatch_mm * ppm * R)
    h = 0.5 + 0.5 * np.sin(2 * np.pi * (YY * math.cos(0.12) + XX * math.sin(0.12)) / pitch)
    rgb *= (0.93 + 0.07 * h)[..., None]
    # edge: marks cool at the border -> slightly darker, warmer rim
    inner = np.clip(blur(mask, 0.35 * R) * 1.0, 0, 1)
    edge = np.clip(mask - blur(mask, 1.2 * R), 0, 1) * 1.6
    rgb = rgb * (1 - 0.22 * edge[..., None])
    # micro sparkle
    sp = (np.random.default_rng(seed + 9).random(mask.shape) > 0.9985).astype(np.float32)
    rgb += 70 * blur(sp, 0.6)[..., None]
    return np.clip(rgb, 0, 255), mask * 0.97 * strength

def dither_photo(tone, alpha, box, pitch_units, dot_k=0.62, seed=0):
    """place a tone image (1 = bare metal) inside box=(x0,y0,w,h) units, JJN-dither at pitch_units, return dot mask at layer res"""
    x0, y0, w, h = box
    nx, ny = int(round(w / pitch_units)), int(round(h / pitch_units))
    img = tone * alpha + (1 - alpha)
    small = np.clip(resize(img, nx, ny), 0, 1)
    m = jjn(small)
    pp = pitch_units * R
    imp = np.zeros((VH * R, VW * R), np.float32)
    ys, xs = np.nonzero(m)
    jit = np.random.default_rng(seed).normal(0, 0.06 * pp, (2, len(xs)))
    X = np.round(x0 * R + (xs + 0.5) * pp + jit[0]).astype(int); Y = np.round(y0 * R + (ys + 0.5) * pp + jit[1]).astype(int)
    ok = (X >= 0) & (X < VW * R) & (Y >= 0) & (Y < VH * R)
    np.add.at(imp, (Y[ok], X[ok]), 1.0)
    # disc kernel of radius dot_k*pitch, soft edge
    r = dot_k * pp
    K = int(math.ceil(r + 2)); ky, kx = np.mgrid[-K:K + 1, -K:K + 1]
    disc = np.clip(r + 0.5 - np.hypot(kx, ky), 0, 1).astype(np.float32)
    pad = np.zeros_like(imp); pad[:disc.shape[0], :disc.shape[1]] = disc
    pad = np.roll(np.roll(pad, -K, 0), -K, 1)
    dots = np.real(np.fft.ifft2(np.fft.fft2(imp) * np.fft.fft2(pad)))
    return np.clip(dots, 0, 1).astype(np.float32), (nx, ny)

def layer_png(rgb, a):
    rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8)
    b = io.BytesIO(); Image.fromarray(rgba, 'RGBA').save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

def over(dst_rgb, dst_a, rgb, a):
    a3 = a[..., None]; out_a = a + dst_a * (1 - a)
    out = (rgb * a3 + dst_rgb * dst_a[..., None] * (1 - a3)) / np.maximum(out_a, 1e-6)[..., None]
    return out, out_a

# ---------------- tag assembly (SVG) ----------------
_uid = [0]
def paw_tf(cx, cy, k, mirror=False):
    return f'translate({cx} {cy}) scale({-k if mirror else k} {k}) translate(-12 -12)'

def tag_svg(shape, layer_uri, x, y, scale, rot=0, cut=None, finish='#D7DBE1'):
    """cut = (cx, cy, k, mirror) paw cut-out through the plate, or None"""
    T = template(shape); _uid[0] += 1; u = f'{shape}{_uid[0]}'
    body_clip = f'url(#{shape}-clip)'
    defs = [T['defs'] if _uid[0] not in () else '']
    mask_attr = shadow_mask = ''; rim = ''
    if cut:
        cx, cy, k, mir = cut; tf = paw_tf(cx, cy, k, mir)
        defs.append(f'<mask id="{u}-cut" maskUnits="userSpaceOnUse" x="-50" y="-50" width="420" height="340"><rect x="-50" y="-50" width="420" height="340" fill="#fff"/><path d="{PAW_D}" transform="{tf}" fill="#000"/></mask>')
        defs.append(f'<mask id="{u}-scut" maskUnits="userSpaceOnUse" x="-50" y="-50" width="420" height="340"><rect x="-50" y="-50" width="420" height="340" fill="#fff"/><path d="{PAW_D}" transform="translate(2.9 9.5) {tf}" fill="#000" filter="url(#{shape}-soft)"/></mask>')
        mask_attr = f' mask="url(#{u}-cut)"'; shadow_mask = f' mask="url(#{u}-scut)"'
        # the cut wall: dark lower-right wall, bright upper-left lip
        rim = (f'<path d="{PAW_D}" transform="{tf}" fill="none" stroke="#14161B" stroke-opacity=".75" stroke-width="{1.5 / k:.3f}"/>'
               f'<g transform="translate(0.7 0.9)"><path d="{PAW_D}" transform="{tf}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="{0.55 / k:.3f}"/></g>')
    defs.append(f'''<linearGradient id="{u}-mir" gradientUnits="userSpaceOnUse" x1="20" y1="30" x2="300" y2="225">
      <stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".16" stop-color="#fff" stop-opacity=".30"/>
      <stop offset=".27" stop-color="#7d8594" stop-opacity=".40"/><stop offset=".36" stop-color="#fff" stop-opacity=".55"/>
      <stop offset=".52" stop-color="#fff" stop-opacity=".12"/><stop offset=".66" stop-color="#9aa1ad" stop-opacity=".30"/>
      <stop offset=".80" stop-color="#5f6573" stop-opacity=".45"/><stop offset=".90" stop-color="#e9ecf1" stop-opacity=".35"/>
      <stop offset="1" stop-color="#6c7180" stop-opacity=".55"/></linearGradient>
    <linearGradient id="{u}-env" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7B2CFF" stop-opacity="0"/><stop offset=".72" stop-color="#7B2CFF" stop-opacity="0"/>
      <stop offset="1" stop-color="#C13CFF" stop-opacity=".20"/></linearGradient>
    <linearGradient id="{u}-gloss" gradientUnits="userSpaceOnUse" x1="20" y1="30" x2="300" y2="225">
      <stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".22" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".36" stop-color="#fff" stop-opacity=".18"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>''')
    g = f'''<g transform="translate({x:.1f} {y:.1f}) scale({scale:.4f}) rotate({rot} 160 120)" style="color:{finish}">
  <g{shadow_mask}>{T['shadow']}</g>
  {T['ring-back']}
  <g{mask_attr}>
    {T['edge']}
    {T['body']}
    <g clip-path="{body_clip}">
      <rect x="0" y="0" width="320" height="240" fill="url(#{u}-mir)"/>
      <rect x="0" y="0" width="320" height="240" fill="url(#{u}-env)"/>
      <image x="0" y="0" width="320" height="240" preserveAspectRatio="none" href="{layer_uri}"/>
      <rect x="0" y="0" width="320" height="240" fill="url(#{u}-gloss)"/>
    </g>
    {T['hole']}
    {T['bevel']}
  </g>
  {rim}
  {T['ring-front']}
</g>'''
    return ''.join(defs), g

SPOT = '''<radialGradient id="spot" cx="50%" cy="40%" r="80%" fx="50%" fy="40%" gradientTransform="translate(0.5 0.4) scale(1 0.875) translate(-0.5 -0.4)">
  <stop offset="0" stop-color="#2A1150"/><stop offset=".60" stop-color="#170833"/><stop offset="1" stop-color="#0D0221"/></radialGradient>'''

def page(W, H, parts, extra_defs='', bg=True, overlay=''):
    defs = ''.join(p[0] for p in parts); body = ''.join(p[1] for p in parts)
    spot = SPOT
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>{spot}{extra_defs}{defs}</defs>
{'<rect width="%d" height="%d" fill="url(#spot)"/>' % (W, H) if bg else ''}
{body}
{overlay}
</svg>'''

# ---------------- shapely helpers for rims ----------------
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from shapely import affinity as _aff
def path_polys(d, transform=''):
    p = SPath(d)
    if transform: p = p * Matrix(transform)
    p.reify()
    polys = []
    for sub in p.as_subpaths():
        sp = SPath(sub); n = max(24, int(sp.length(error=1e-3) / 0.3))
        polys.append(Polygon([(sp.point(i / n).x, sp.point(i / n).y) for i in range(n)]).buffer(0))
    return unary_union(polys)

def geom_mask(g):
    im = Image.new('L', (VW * R * 2, VH * R * 2), 0); dr = ImageDraw.Draw(im)
    gs = getattr(g, 'geoms', [g])
    for q in gs:
        dr.polygon([(x * R * 2, y * R * 2) for x, y in q.exterior.coords], fill=255)
        for h in q.interiors: dr.polygon([(x * R * 2, y * R * 2) for x, y in h.coords], fill=0)
    return np.asarray(im.resize((VW * R, VH * R), Image.LANCZOS), np.float32) / 255
