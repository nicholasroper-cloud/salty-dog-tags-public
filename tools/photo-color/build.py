import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tagart import *
from PIL import Image
sys.path.insert(0, '/private/tmp/claude-501/-Users-nick/6ad81fa5-55b6-47c7-84fd-f526aad5c6c2/scratchpad')
from render import render
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'; os.makedirs(OUT, exist_ok=True)
FACES = {k: (np.load(f'{k}_tone.npy'), np.load(f'{k}_alpha.npy')) for k in ('face', 'faceR')}
def laser_curve(t):
    return np.clip((t - 0.06) / 0.86, 0, 1) ** 0.92
Z = lambda: np.zeros((VH * R, VW * R), np.float32)

def face_layer(shape, top, bottom, cx=160, pitch_mm=0.09, vt=-0.779, vb=0.784, face='face'):
    """face image: v=vt (skull top, centre) at y=top, v=vb (neck fade end) at y=bottom"""
    ppm = SHAPES[shape]['px_per_mm']
    k = (bottom - top) / (vb - vt); size = 2 * k
    x0 = cx - k; y0 = top - (1 + vt) * k
    T, A = FACES[face]
    dots, n = dither_photo(laser_curve(T), A, (x0, y0, size, size), pitch_mm * ppm, dot_k=0.60)
    rgb, a = anneal(dots)
    return rgb, a * 0.97, n

def text_layer(lines, box, sizes=None, inks=None, track=0.0, shape='bone', seed=1):
    masks, fs = text_mask(lines, box, sizes=sizes, track=track)
    rgb = np.zeros((VH * R, VW * R, 3), np.float32); a = Z()
    for i, m in enumerate(masks):
        ink = (inks or ['dark'] * len(lines))[i]
        if ink == 'dark': r2, a2 = anneal(m)
        else: r2, a2 = oxide(m, ink, seed=seed + i, ppm=SHAPES[shape]['px_per_mm'])
        rgb, a = over(rgb, a, r2, a2)
    return rgb, a, fs

def save(svg, name, W, H):
    p = f'{OUT}/{name}.svg'; open(p, 'w').write(svg)
    render(p, f'{OUT}/{name}.png', W, H)
    print(name)

if __name__ == '__main__':
    what = sys.argv[2:] or ['bone']
    if 'bone' in what:
        g = SHAPES['bone']
        rgb, a, n = face_layer('bone', 117, 180.5)
        print('bone dots', n)
        front = tag_svg('bone', layer_png(rgb, a), -40, 18, 2.9, 0, cut=(*PAW_CUT[:2], PAW_CUT[2], False))
        # back: cut-out appears on the left lobe; text shifted right
        ar = g['area']; box = (ar['cx'] + ar['w'] * 0.10, ar['cy'] - 1, ar['w'] * 0.62, ar['h'] + 2)
        r2, a2, fs = text_layer(['WHISKY', 'CALL MY MOM', '435-555-0123'], box, sizes=[1.25, 0.8, 1.0])
        back = tag_svg('bone', layer_png(r2, a2), 735, 500, 1.42, 6, cut=(320 - PAW_CUT[0], PAW_CUT[1], PAW_CUT[2], True))
        save(page(1200, 900, [front, back]), 'photo-tag-bone', 1200, 900)

    if 'round' in what:
        g = SHAPES['round']; ar = g['area']
        rgb, a, n = face_layer('round', 89, 89 + 1.563 * 71, face='faceR')
        print('round dots', n)
        front = tag_svg('round', layer_png(rgb, a), -50, 40, 3.0, 0)
        r2, a2, fs = text_layer(['WHISKY', 'CALL MY MOM', '435-555-0123'], (ar['cx'], ar['cy'] - 4, ar['w'] * 0.92, ar['h'] * 0.62), sizes=[1.3, 0.78, 1.0], shape='round')
        back = tag_svg('round', layer_png(r2, a2), 640, 300, 1.85, 8)
        save(page(1200, 900, [front, back]), 'photo-tag-round', 1200, 900)

    if 'cbone' in what:
        ppm = SHAPES['bone']['px_per_mm']; cx, cy, k = PAW_CUT
        rgb = np.zeros((VH * R, VW * R, 3), np.float32); a = Z()
        # purple oxide halo hugging the cut-out
        cutg = path_polys(PAW_D, paw_tf(cx, cy, k))
        halo = cutg.buffer(0.40 * ppm, quad_segs=24).difference(cutg.buffer(0.08 * ppm, quad_segs=24))
        r2, a2 = oxide(geom_mask(halo), 'purple', seed=4, ppm=ppm, angle=60); rgb, a = over(rgb, a, r2, a2)
        # blue oxide paw, engraved (not cut) on the opposite lobe
        bp = path_polys(PAW_D, paw_tf(320 - cx, cy, k, True))
        r2, a2 = oxide(geom_mask(bp), 'blue', seed=7, ppm=ppm, angle=25); rgb, a = over(rgb, a, r2, a2)
        r2, a2, fs = text_layer(['GOOD BOY', '(LEGALLY', 'DISPUTED)'], (160, 144, 118, 52), sizes=[1.18, 1, 1], inks=['gold', 'dark', 'dark'], seed=2)
        rgb, a = over(rgb, a, r2, a2)
        t = tag_svg('bone', layer_png(rgb, a), 72, 22, 3.3, 0, cut=(cx, cy, k, False))
        save(page(1200, 900, [t]), 'color-tag-bone', 1200, 900)
    if 'cmil' in what:
        g = SHAPES['military']; ppm = g['px_per_mm']; h = g['hole']
        rgb = np.zeros((VH * R, VW * R, 3), np.float32); a = Z()
        ring = Point(h['x'], h['y']).buffer(h['r'] + 0.72 * ppm, quad_segs=48).difference(Point(h['x'], h['y']).buffer(h['r'] + 0.14 * ppm, quad_segs=48))
        r2, a2 = oxide(geom_mask(ring), 'purple', seed=4, ppm=ppm, angle=60); rgb, a = over(rgb, a, r2, a2)
        bp = path_polys(PAW_D, paw_tf(279, 116, 1.62))
        r2, a2 = oxide(geom_mask(bp), 'blue', seed=7, ppm=ppm, angle=25); rgb, a = over(rgb, a, r2, a2)
        r2, a2, fs = text_layer(['SALTY DOG.', 'SANDY BUTT.'], (168, 116, 140, 60), sizes=[1.0, 1.0], inks=['gold', 'dark'], seed=2, shape='military')
        rgb, a = over(rgb, a, r2, a2)
        t = tag_svg('military', layer_png(rgb, a), 12, 56, 3.5, 0)
        save(page(1200, 900, [t]), 'color-tag-military', 1200, 900)
    if 'social' in what:
        g = SHAPES['round']; ar = g['area']
        rgb, a, n = face_layer('round', 89, 89 + 1.563 * 71, face='faceR')
        front = tag_svg('round', layer_png(rgb, a), 470 - 160 * 2.6, 680 - 139.8 * 2.6, 2.6, 0)
        r2, a2, fs = text_layer(['WHISKY', 'CALL MY MOM', '435-555-0123'], (ar['cx'], ar['cy'] - 4, ar['w'] * 0.92, ar['h'] * 0.62), sizes=[1.3, 0.78, 1.0], shape='round')
        back = tag_svg('round', layer_png(r2, a2), 870 - 160 * 1.45, 765 - 139.8 * 1.45, 1.45, 9)
        save(page(1080, 1080, [front, back]), 'social-base', 1080, 1080)
