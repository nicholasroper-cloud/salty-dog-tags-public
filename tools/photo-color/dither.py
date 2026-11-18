import numpy as np
from PIL import Image
def resize(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), Image.LANCZOS))
def jjn(img):
    """Jarvis-Judice-Ninke error diffusion, serpentine. img 0..1 (1 = bare metal). returns bool mark mask (True = laser fires)."""
    a = img.astype(np.float64).copy(); h, w = a.shape
    a = np.pad(a, ((0, 2), (2, 2)), constant_values=1.0)
    out = np.zeros((h, w), bool)
    K = [(0, 1, 7), (0, 2, 5), (1, -2, 3), (1, -1, 5), (1, 0, 7), (1, 1, 5), (1, 2, 3), (2, -2, 1), (2, -1, 3), (2, 0, 5), (2, 1, 3), (2, 2, 1)]
    for y in range(h):
        rng_ = range(w) if y % 2 == 0 else range(w - 1, -1, -1); d = 1 if y % 2 == 0 else -1
        row0, row1, row2 = a[y], a[y + 1], a[y + 2]; rows = (row0, row1, row2)
        for x in rng_:
            X = x + 2; old = row0[X]; new = 1.0 if old >= 0.5 else 0.0
            out[y, x] = new == 0.0; e = (old - new) / 48.0
            if e:
                for dy, dx, k in K: rows[dy][X + dx * d] += e * k
    return out
