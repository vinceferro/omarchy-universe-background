# Static 5K wallpapers of the real sky, from NASA SVS "Deep Star Maps 2020"
# (public domain; Hipparcos-2, Tycho-2 and Gaia DR2 via ESA/Gaia/DPAC):
#   https://svs.gsfc.nasa.gov/4851  (starmap_2020_16k_gal.exr)
#
# Each view is a true camera (gnomonic) projection centred on a galactic
# longitude/latitude, the galactic plane level, 46 degrees per screen height
# so the 16k map's pixels land 1:1 on a 5120 x 2160 screen.
#
# Usage: python3 -I make_sky_views.py <starmap_2020_16k_gal.exr> <output dir>
# (Omarchy picks up ~/.config/omarchy/backgrounds/<theme>/ in its picker.)
import os
import sys
import numpy as np
import OpenEXR
from PIL import Image

W, H, VFOV = 5120, 2160, 46.0
# name, galactic l, b (degrees); must match the Sky mode's views in Background.qml
VIEWS = [
    ("milky-way-core", 0.0, -1.5),
    ("cygnus-rift", 78.0, 1.0),
    ("aquila-scutum", 28.0, -1.5),
    ("carina-southern-cross", 295.0, -1.0),
    ("magellanic-clouds", 291.0, -38.0),
    ("centaurus-norma", 320.0, -0.5),
    ("scorpius-ophiuchus", 353.0, 16.0),
]
BLACK, WHITE, POWER = 0.0032, 0.06, 1.5  # same tone curve as make_sky.py


def tone(x):
    lum = x.mean(axis=2, keepdims=True) + 1e-9
    y = np.clip((lum - BLACK) / (WHITE - BLACK), 0, None)
    y = np.clip(y / (1 + y) * 1.6, 0, 1) ** POWER
    return np.clip(x / lum * y, 0, 1) ** (1 / 2.2)


src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
sky = np.asarray(OpenEXR.File(src).channels()["RGB"].pixels, dtype=np.float32)
mh, mw, _ = sky.shape

f = 0.5 / np.tan(np.radians(VFOV / 2))  # focal length in screen heights
px = (np.arange(W) + 0.5 - W / 2) / H
py = (np.arange(H) + 0.5 - H / 2) / H
PX, PY = np.meshgrid(px, py)

for i, (name, l0, b0) in enumerate(VIEWS, 1):
    l, b = np.radians(l0), np.radians(b0)
    # heliocentric galactic: x toward l=0, y toward l=90, z north
    fwd = np.array([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.sin(b)])
    right = np.array([np.sin(l), -np.cos(l), 0.0])  # toward smaller l: longitude grows to the left, as on the sky
    up = np.cross(right, fwd)
    d = fwd * f + right * PX[..., None] - up * PY[..., None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    lon = np.arctan2(d[..., 1], d[..., 0])
    lat = np.arcsin(np.clip(d[..., 2], -1, 1))
    # map: centre l = 0, longitude grows to the left, b = +90 at the top
    u = ((0.5 - lon / (2 * np.pi)) % 1.0) * mw - 0.5
    v = (0.5 - lat / np.pi) * mh - 0.5
    # bilinear sample
    x0 = np.floor(u).astype(np.int64)
    y0 = np.clip(np.floor(v).astype(np.int64), 0, mh - 2)
    fx = (u - x0)[..., None]
    fy = (v - y0)[..., None]
    x0 %= mw
    x1 = (x0 + 1) % mw
    img = (sky[y0, x0] * (1 - fx) * (1 - fy) + sky[y0, x1] * fx * (1 - fy)
           + sky[y0 + 1, x0] * (1 - fx) * fy + sky[y0 + 1, x1] * fx * fy)
    rgb = tone(img)
    path = os.path.join(out, f"sky-{i}-{name}.jpg")  # sorts after the theme's own
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(path, quality=92, optimize=True)
    print(path)
