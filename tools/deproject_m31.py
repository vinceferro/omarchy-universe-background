# Andromeda's face-on map from its real photo, for the 3D galaxy view.
#
# The photo (textures/photos/andromeda-galaxy.jpg, north up, east left, made
# by make_atlas.py) shows M31 tilted 77 degrees with its major axis at
# position angle 38 degrees (north through east). Stretching the image back
# along the minor axis by 1/cos(77) recovers an approximate face-on view of
# its real arms and dust lanes (thin-disk approximation; the bulge is thick,
# so galaxy.frag adds it separately). Foreground Milky Way stars are filtered
# out first so they are not smeared into the disk.
#
# Also prints the disk's in-plane axes in the Galactocentric frame (X toward
# l = 90, Y Galactic Centre -> Sun, Z north) with the minor axis signed to
# match the photo, for Background.qml (m31Disk).
#
# Usage: python3 -I deproject_m31.py
import math
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "textures", "photos", "andromeda-galaxy.jpg")
OUT = os.path.join(HERE, "..", "textures", "m31-faceon.jpg")
DIST_KPC = 761.0
FOV_ARCMIN = 169.915        # width of the (square, north-up) photo
PA, INC = 38.0, 77.0         # position angle, inclination (degrees)
L, B = 121.17, -21.57        # galactic longitude, latitude
EXT = 24.0                   # face-on map covers +-24 kpc
N = 2048

img = Image.open(SRC).convert("RGB")
# foreground stars out: a median removes points, keeps the smooth disk
img = img.filter(ImageFilter.MedianFilter(7))
a = (np.asarray(img).astype(np.float32) / 255.0) ** 2.0     # to linear light
S = a.shape[0]
kpc_per_px = DIST_KPC * math.radians(FOV_ARCMIN / 60.0) / S

# the nucleus: the photo is not framed exactly on it; the brightest point of
# a heavily smoothed copy is
lum = np.asarray(Image.fromarray((np.clip(a.mean(axis=2), 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(S * 0.01))).astype(np.float32)
cy, cx = np.unravel_index(np.argmax(lum), lum.shape)
cx, cy = cx + 0.5, cy + 0.5
print("nucleus at", round(cx), round(cy), "of", S)

pa, inc = math.radians(PA), math.radians(INC)
# image axes: x right (= west), y down (= south). Major axis: from north
# toward east (left) by PA; minor axis: 90 degrees from it on the sky.
m_img = np.array([-math.sin(pa), -math.cos(pa)])
n_img = np.array([math.cos(pa), -math.sin(pa)])

ax = (np.arange(N) + 0.5) / N * 2 * EXT - EXT
U, V = np.meshgrid(ax, ax)          # U along the major axis, V along the minor (kpc, in the disk)
V = -V                              # image row 0 = +V
px = cx + (U * m_img[0] + V * math.cos(inc) * n_img[0]) / kpc_per_px
py = cy + (U * m_img[1] + V * math.cos(inc) * n_img[1]) / kpc_per_px
inside = (px >= 0) & (px < S - 1) & (py >= 0) & (py < S - 1)
x0 = np.clip(np.floor(px).astype(int), 0, S - 2)
y0 = np.clip(np.floor(py).astype(int), 0, S - 2)
fx = (px - x0)[..., None]
fy = (py - y0)[..., None]
face = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
        + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)
face *= inside[..., None]
# the disk is face-on now, so its surface brightness drops by cos(i): undo
face *= math.cos(inc)
# keep the disk only: soft edge at ~22 kpc (the photo's frame edges smear
# beyond it), and fade the centre, where the round bulge was smeared into a
# bar by unfolding it as if flat (galaxy.frag draws the bulge in 3D)
R = np.hypot(U, V)
edge = np.clip((24.0 - R) / 4.0, 0, 1)
core = 0.12 + 0.88 * np.clip((R - 1.5) / 3.0, 0, 1)
face *= (edge * edge * (3 - 2 * edge) * core)[..., None]
face /= max(np.percentile(face, 99.9), 1e-6)
Image.fromarray((np.clip(face, 0, 1) ** (1 / 2.0) * 255 + 0.5).astype(np.uint8)).save(OUT, quality=90)
print("wrote", OUT, "kpc/px photo", round(kpc_per_px, 4))


# in-plane axes in the Galactocentric frame, signed like the photo
def gal(l, b):
    l, b = math.radians(l), math.radians(b)
    x, y, z = math.cos(b) * math.cos(l), math.cos(b) * math.sin(l), math.sin(b)
    return np.array([y, -x, z])


s = gal(L, B)                                   # toward M31
ncp = gal(122.93192, 27.12835)
Nn = ncp - np.dot(ncp, s) * s
Nn /= np.linalg.norm(Nn)                        # north on the sky
E = np.cross(Nn, s)                             # east on the sky
major = math.cos(pa) * Nn + math.sin(pa) * E
minor_sky = math.cos(pa) * E - math.sin(pa) * Nn  # n_img on the sky (right = -E, down = -N)
w = np.cross(s, major)
w /= np.linalg.norm(w)
normal = math.cos(inc) * s + math.sin(inc) * w
minor = np.cross(normal, major)
if np.dot(minor, minor_sky) < 0:
    minor = -minor
normal = np.cross(major, minor)
fmt = lambda v: "[" + ", ".join(f"{c:.5f}" for c in v) + "]"
print('m31Disk: {"major": ' + fmt(major) + ', "minor": ' + fmt(minor) + ', "normal": ' + fmt(normal) + "}")
