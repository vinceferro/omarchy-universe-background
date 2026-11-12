# Real-sky textures from NASA SVS "Deep Star Maps 2020" (public domain; built
# from Hipparcos-2, Tycho-2 and Gaia DR2, ESA/Gaia/DPAC):
#   https://svs.gsfc.nasa.gov/4851  (starmap_2020_16k_gal.exr)
#
# The map is galactic, plate carree: centre l = 0, longitude increasing to the
# left, b = +90 at the top; linear HDR. Run with -I, the EXR path as argument.
#
# Writes textures/sky-full.jpg: the whole sky at 8192 x 4096, for Sky mode and
# the galaxy view near the Sun (the 5K static views: make_sky_views.py)
import os
import sys
import numpy as np
import OpenEXR
from PIL import Image

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "textures")
a = np.asarray(OpenEXR.File(src).channels()["RGB"].pixels, dtype=np.float32)
h, w, _ = a.shape
print("map", w, h, "median", float(np.median(a)), "p99.9", float(np.percentile(a, 99.9)))

# OLED-first tone curve on luminance (colour kept as a ratio): a black point
# above the faint diffuse floor so empty sky is true black, a soft shoulder so
# the bulge never clips, and a contrast power like a dark-sky site at night
BLACK, WHITE, POWER = 0.0032, 0.06, 1.5


def tone(x, gain=None):
    lum = x.mean(axis=2, keepdims=True) + 1e-9
    y = np.clip((lum - BLACK) / (WHITE - BLACK), 0, None)
    y = np.clip(y / (1 + y) * 1.6, 0, 1) ** POWER
    return np.clip(x / lum * y, 0, 1) ** (1 / 2.2)


gain = None

# the full sky at 8k (box-filtered by 2 in linear light before the curve)
if w >= 16384:
    a2 = a.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
else:
    a2 = a
full = tone(a2, gain)
Image.fromarray((full * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "sky-full.jpg"), quality=88, optimize=True)
print("sky-full", full.shape)
