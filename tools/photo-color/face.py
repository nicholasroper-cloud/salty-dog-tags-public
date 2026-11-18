"""Procedural English bulldog portrait (front view) -> grayscale tone image + silhouette alpha.
Heightfield of smooth bumps and creases, lit with a key light, albedo map for patch/nose/eyes,
fine fur grain. Output is meant to be dithered for laser marking, so it is tuned for tone, not detail.
"""
import numpy as np, sys
from PIL import Image

N = int(sys.argv[2]) if len(sys.argv) > 2 else 900
OUT = sys.argv[1] if len(sys.argv) > 1 else 'face'
rng = np.random.default_rng(7)
ys, xs = np.mgrid[0:N, 0:N]
u = (xs + .5) / N * 2 - 1          # -1..1, left->right (viewer)
v = (ys + .5) / N * 2 - 1          # -1..1, top->bottom
px = 2.0 / N

def blur(a, s):
    if s <= 0: return a
    p = int(3 * s + 2)
    if p < a.shape[0] // 2:
        return _blur(np.pad(a, p, mode='edge'), s)[p:-p, p:-p]
    return _blur(a, s)

def _blur(a, s):
    k = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi ** 2) * (s ** 2) * k)))

def rot(cx, cy, a):
    c, s = np.cos(np.radians(a)), np.sin(np.radians(a))
    du, dv = u - cx, v - cy
    return du * c + dv * s, -du * s + dv * c

def dome(cx, cy, rx, ry, h, a=0, p=0.5):
    du, dv = rot(cx, cy, a)
    d = 1 - (du / rx) ** 2 - (dv / ry) ** 2
    return h * np.clip(d, 0, None) ** p

def sdome(cx, cy, rx, ry, h, e=2.6, p=0.5):
    du, dv = u - cx, v - cy
    d = 1 - np.abs(du / rx) ** e - np.abs(dv / ry) ** e
    return h * np.clip(d, 0, None) ** p

def ellmask(cx, cy, rx, ry, a=0, soft=0.0):
    du, dv = rot(cx, cy, a)
    d = np.sqrt((du / rx) ** 2 + (dv / ry) ** 2)
    if soft <= 0: return (d <= 1).astype(float)
    return np.clip((1 + soft - d) / (2 * soft), 0, 1)

def smax(a, b, k=0.08):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0, 1)
    return a * h + b * (1 - h) + k * h * (1 - h)

def seg_dist(pts):
    pts = np.asarray(pts, float); best = np.full(u.shape, 9.0); tpar = np.zeros(u.shape)
    L = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0; l2 = dx * dx + dy * dy
        t = np.clip(((u - x0) * dx + (v - y0) * dy) / l2, 0, 1)
        d = np.hypot(u - (x0 + t * dx), v - (y0 + t * dy))
        m = d < best; best = np.where(m, d, best); tpar = np.where(m, (L[i] + t * np.sqrt(l2)) / L[-1], tpar)
    return best, tpar

def bez(p0, p1, p2, n=24):
    t = np.linspace(0, 1, n)[:, None]; p0, p1, p2 = map(np.array, (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2

def crease(pts, w, depth, taper=True):
    d, t = seg_dist(pts)
    amp = np.sin(np.pi * np.clip(t, 0, 1)) ** 0.6 if taper else 1
    return -depth * amp * np.exp(-(d / w) ** 2)

def ridge(pts, w, h, taper=True):
    return -crease(pts, w, h, taper)

# ---------------- heightfield ----------------
SIL=[]
def M(d): SIL.append(d > 0); return d
EY, EX = -0.12, 0.35                                        # eye centre
H = M(sdome(0, -0.10, 0.76, 0.68, 0.55, e=2.5))              # skull / face mass, broad flat top
H = smax(H, M(dome(0, 0.20, 0.88, 0.50, 0.55)), 0.10)        # broad cheeks
for s in (-1, 1):
    H = smax(H, M(dome(s * 0.52, 0.30, 0.40, 0.40, 0.62)), 0.08)   # jowls
    H = smax(H, M(dome(s * 0.24, 0.40, 0.30, 0.25, 0.80)), 0.06)   # flews (upper lips)
H = smax(H, M(dome(0, 0.56, 0.24, 0.15, 0.86)), 0.04)               # underbite lower jaw / chin
H = smax(H, dome(0, 0.12, 0.23, 0.12, 0.99, p=0.6), 0.03)           # nose pad
H += dome(0, -0.42, 0.55, 0.28, 0.10)                               # forehead swell
for s in (-1, 1):
    H += dome(s * EX, EY - 0.17, 0.21, 0.10, 0.09)                  # heavy brows
    H -= dome(s * EX, EY + 0.005, 0.13, 0.10, 0.17, p=1)             # eye sockets
    H += 0.10 * ellmask(s * EX, EY, 0.072, 0.060, soft=0.25)        # eyeballs
# nose roll (over-nose wrinkle), thick rope arched over the nose
H += ridge(bez((-0.32, 0.05), (0, -0.09), (0.32, 0.05)), 0.050, 0.11)
H += crease(bez((-0.34, 0.09), (0, -0.02), (0.34, 0.09)), 0.020, 0.08)
H += crease(bez((-0.30, -0.01), (0, -0.14), (0.30, -0.01)), 0.018, 0.06)
H += ridge(bez((-0.24, -0.06), (0, -0.20), (0.24, -0.06)), 0.03, 0.03)
# stop: vertical furrow between the eyes
H += crease([(0, -0.58), (0, -0.30), (0, -0.12)], 0.032, 0.10)
# forehead wrinkles (sagging folds)
for k, (y0, amp) in enumerate([(-0.31, 0.045), (-0.41, 0.038), (-0.50, 0.030), (-0.58, 0.020)]):
    for s in (-1, 1):
        H += crease(bez((s * 0.04, y0 + 0.04), (s * 0.20, y0 - 0.05 + 0.01 * k), (s * (0.42 - 0.03 * k), y0 + 0.03)), 0.019, amp)
# folds around the muzzle and cheeks
for s in (-1, 1):
    H += crease(bez((s * 0.20, 0.06), (s * 0.40, 0.20), (s * 0.40, 0.50)), 0.030, 0.09)
    H += crease(bez((s * 0.48, -0.04), (s * 0.62, 0.14), (s * 0.64, 0.40)), 0.030, 0.05)
    H += crease(bez((s * 0.20, EY + 0.10), (s * 0.34, EY + 0.17), (s * 0.50, EY + 0.08)), 0.020, 0.05)   # under-eye bag
    H += crease(bez((s * 0.22, EY - 0.08), (s * 0.35, EY - 0.12), (s * 0.48, EY - 0.06)), 0.016, 0.05)   # upper lid fold
# philtrum
H += crease([(0, 0.22), (0, 0.38)], 0.016, 0.05, taper=False)
# mouth: dark gap between upper lip and the jutting lower lip, flews draping down at the sides
MOUTH = ellmask(0, 0.450, 0.20, 0.048, soft=0.10)
H -= 0.10 * MOUTH
H += ridge(bez((-0.21, 0.49), (0, 0.515), (0.21, 0.49)), 0.022, 0.05, taper=False)      # lower lip
mouth = np.r_[bez((-0.47, 0.50), (-0.36, 0.64), (-0.20, 0.46)), bez((0.20, 0.46), (0.36, 0.64), (0.47, 0.50))]
for s in (-1, 1):
    H += crease(bez((s * 0.47, 0.50), (s * 0.36, 0.64), (s * 0.20, 0.46)), 0.020, 0.10, taper=False)
    H += crease(bez((s * 0.20, 0.46), (s * 0.12, 0.40), (0, 0.405)), 0.014, 0.05, taper=False)
# ears: rose ears, small triangular flaps folded back at the upper corners of the skull
def polydist(poly):
    poly = np.asarray(poly, float); d, _ = seg_dist(np.r_[poly, poly[:1]])
    inside = np.zeros(u.shape, bool); n = len(poly)
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        c = ((y0 > v) != (y1 > v)) & (u < (x1 - x0) * (v - y0) / (y1 - y0 + 1e-12) + x0)
        inside ^= c
    return np.where(inside, d, -d)
EARS = []; EARCAV = []
for s in (-1, 1):
    # flap: a curled petal hugging the skull corner, tip turned out and slightly down
    dd = np.maximum.reduce([
        1 - np.hypot(*[q / r for q, r in zip(rot(s * 0.62, -0.68, s * 28), (0.20, 0.105))]),
        1 - np.hypot(*[q / r for q, r in zip(rot(s * 0.80, -0.60, s * -10), (0.095, 0.085))]),
        1 - np.hypot(*[q / r for q, r in zip(rot(s * 0.47, -0.70, s * 10), (0.12, 0.08))]),
    ])
    dd = blur(dd, 5 * N / 900)
    e = M(0.36 * np.clip(dd / 0.12, 0, 1) ** 0.35 * (dd > 0))
    rim = ridge(bez((s * 0.44, -0.78), (s * 0.64, -0.80), (s * 0.86, -0.66)), 0.030, 0.05) * (e > 0)
    cav = dome(s * 0.60, -0.645, 0.13, 0.045, 0.10, a=s * 22, p=1)
    H = smax(H, e + rim - cav, 0.04)
    EARCAV.append(np.clip(cav / 0.05, 0, 1))
    em = np.clip(dd / 0.06, 0, 1)
    EARS.append(em)
# neck / chest below the jaw, fades out
H = smax(H, M(dome(0, 0.95, 0.95, 0.40, 0.35)), 0.10)

# ---------------- silhouette ----------------
sil = blur(np.any(SIL, axis=0).astype(float), 1.0 * N / 900)
FADE0, FADE1 = (float(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '0.70,0.84').split(','))
fade = np.clip((FADE1 - v) / (FADE1 - FADE0), 0, 1) ** 1.3                  # neck fades into bare metal
alpha = sil * fade

# ---------------- albedo ----------------
noise = blur(rng.standard_normal((N, N)), 1.0 * N / 900)
grain = blur(rng.standard_normal((N, N)), 0.6 * N / 900)
alb = np.full((N, N), 0.88) + 0.025 * noise / noise.std()
# fawn piebald patch over the dog's left eye (viewer right) and both ears, like the logo's patch
pw = blur(np.random.default_rng(23).standard_normal((N, N)), 45 * N / 900); pw /= pw.std()
pw2 = blur(np.random.default_rng(5).standard_normal((N, N)), 12 * N / 900); pw2 /= pw2.std()
patch = np.clip((1 - np.hypot((u - 0.42) / 0.32, (v + 0.22) / 0.34) + 0.22 * pw + 0.05 * pw2) / 0.03, 0, 1)
patch *= np.clip((u - 0.07) / 0.05, 0, 1)                 # keep the stop/nose roll white
bw = blur(rng.standard_normal((N, N)), 5 * N / 900); bw /= bw.std()
brind = 0.5 + 0.5 * np.sin(((u * 0.35 + v) * 55) + 1.6 * bw)
fawn = 0.60 - 0.10 * brind
for em in EARS:
    patch = np.maximum(patch, em)
alb = alb * (1 - patch) + fawn * patch
for s in (-1, 1):  # inner ear burr darker
    alb -= 0.30 * EARCAV[(s + 1) // 2]
# pigmented lip edges, whisker dots
alb -= 0.40 * np.exp(-(seg_dist(mouth)[0] / 0.022) ** 2)
for s in (-1, 1):
    for i in range(12):
        cx = s * (0.09 + 0.20 * rng.random()); cy = 0.26 + 0.12 * rng.random()
        alb -= 0.30 * np.exp(-(((u - cx) ** 2 + (v - cy) ** 2) / (0.007 ** 2)))
# nose: black leather, upturned, comma nostrils
nose = ellmask(0, 0.13, 0.235, 0.125, soft=0.07)
alb = alb * (1 - nose) + 0.12 * nose
NOS = np.zeros((N, N))
for s in (-1, 1):
    NOS = np.maximum(NOS, ellmask(s * 0.095, 0.155, 0.060, 0.026, a=s * 28, soft=0.25))
alb -= 0.10 * NOS * nose
H -= 0.05 * NOS
H -= 0.02 * crease([(0, 0.04), (0, 0.24)], 0.010, 1.0, taper=False) * -1 * 0 + 0.0
# eyes: dark, almond, narrow pigmented rims, a hint of red haw under each
for s in (-1, 1):
    eye = ellmask(s * EX, EY, 0.072, 0.060, soft=0.08)
    rim = np.clip(ellmask(s * EX, EY, 0.088, 0.074, soft=0.08) - eye, 0, 1)
    alb = alb * (1 - rim) + 0.20 * rim
    alb = alb * (1 - eye) + 0.10 * eye
    alb += 0.08 * ellmask(s * EX, EY + 0.055, 0.055, 0.016, soft=0.3)
# mouth gap + teeth (two lower canines and small incisors over the jutting lower lip)
alb = alb * (1 - MOUTH) + 0.06 * MOUTH
TEETH = np.zeros((N, N))
for s in (-1, 1):
    TEETH = np.maximum(TEETH, ellmask(s * 0.13, 0.440, 0.032, 0.062, a=s * -14, soft=0.10) * (v < 0.488))
alb = alb * (1 - TEETH) + 0.92 * TEETH
alb = np.clip(alb + 0.03 * grain / grain.std() * (1 - nose), 0.02, 1)

# ---------------- lighting ----------------
Hs = blur(H, 1.2 * N / 900) + 0.0010 * grain / grain.std()      # fur bumps in the normals
Hs = Hs + 0.035 * TEETH
gy, gx = np.gradient(Hs, px)
k = 0.9
nx, ny, nz = -gx * k, -gy * k, np.ones_like(H)
nn = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2); nx /= nn; ny /= nn; nz /= nn
L = np.array([-0.45, -0.55, 0.70]); L /= np.linalg.norm(L)
diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
fill = np.clip(nx * 0.5 + ny * -0.1 + nz * 0.85, 0, 1)
ao = np.clip(1 - 2.6 * np.clip(blur(H, 14 * N / 900) - H, 0, None), 0.25, 1)
ao *= np.clip(1 - 3.5 * np.clip(blur(H, 4 * N / 900) - H, 0, None), 0.3, 1)
shade = (0.18 + 0.78 * diff + 0.16 * fill) * ao
# specular on wet nose and eyes, catchlights
Hh = np.array([L[0], L[1], L[2] + 1]); Hh /= np.linalg.norm(Hh)
spec = np.clip(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0, 1)
tone = alb * shade
tone += nose * 0.45 * spec ** 30
for s in (-1, 1):
    eye = ellmask(s * EX, EY, 0.072, 0.060)
    tone += eye * 1.0 * ellmask(s * EX - 0.022, EY - 0.022, 0.018, 0.014, soft=0.3)
tone = np.clip(tone, 0, 1)
# tone curve + light unsharp mask (laser photo prep)
tone = np.clip((tone ** 0.80 - 0.04) * 1.10, 0, 1)
tone = np.clip(tone + 0.6 * (tone - blur(tone, 3 * N / 900)), 0, 1)
np.save(OUT + '_tone.npy', tone.astype(np.float32)); np.save(OUT + '_alpha.npy', alpha.astype(np.float32))
view = tone * alpha + 1 * (1 - alpha)
Image.fromarray((view * 255).astype(np.uint8)).save(OUT + '_tone.png')
print('ok', tone.min(), tone.max())
