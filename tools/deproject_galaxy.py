# A galaxy's face-on map from its real photo, for the 3D galaxy view.
#
# A disk galaxy tilted by inclination i, its major axis at position angle PA
# (north through east), is a circle squashed by cos(i) along the minor axis.
# Stretching the photo back along the minor axis by 1/cos(i) recovers an
# approximate face-on view of its real arms and dust lanes (thin-disk
# approximation; a bulge is thick, so galaxy.frag adds it separately).
# Foreground Milky Way stars are filtered out first so they are not smeared
# into the disk.
#
# Also prints the disk's in-plane axes in the Galactocentric frame (X toward
# l = 90, Y Galactic Centre -> Sun, Z north) with the minor axis signed to
# match the photo, for Background.qml (m31Disk, m33Disk).
#
# Presets (any option overrides them):
#   m31  textures/photos/andromeda-galaxy.jpg (north up, east left, made by
#        make_atlas.py) -> textures/m31-faceon.jpg. 761 kpc, i 77, PA 38.
#   m33  ESO's VST photo eso1424a (raw download, north 90 degrees left of
#        vertical, 68.01 arcmin wide; credit ESO, CC BY 4.0, see
#        textures/CREDITS.md) -> textures/m33-faceon.jpg. Distance 840 kpc
#        (Cepheids, Freedman et al. 2001, ApJ 553, 47); i 55.08, PA 201.12,
#        i.e. the axis at 21.1 (H I kinematics, Koch et al. 2018, MNRAS 479,
#        2505, Table 2). Its photo only reaches ~8 kpc along the major axis,
#        so the map is +-9 kpc; M33 has no real bulge, so the centre stays.
#
# Usage: python3 -I deproject_galaxy.py m31
#        python3 -I deproject_galaxy.py m33 --src /path/to/eso1424a.jpg
#        python3 -I deproject_galaxy.py --src X --out Y --dist KPC --pa DEG --inc DEG --l DEG --b DEG --fov ARCMIN ...
import argparse
import math
import os
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "..", "textures")
PRESETS = {
    "m31": dict(name="m31Disk", src=os.path.join(TEX, "photos", "andromeda-galaxy.jpg"), out=os.path.join(TEX, "m31-faceon.jpg"),
                dist=761.0, fov=169.915, north=0.0, pa=38.0, inc=77.0, l=121.17, b=-21.57,
                ext=24.0, edge=24.0, soft=4.0, core=1.5, work=0, black=False, median=7),
    "m33": dict(name="m33Disk", src=None, out=os.path.join(TEX, "m33-faceon.jpg"),
                dist=840.0, fov=68.01, north=-90.0, pa=21.12, inc=55.08, l=133.61, b=-31.33,
                ext=9.0, edge=8.5, soft=2.5, core=0.0, work=2048, black=True, median=11),
}

ap = argparse.ArgumentParser(description="unfold a galaxy photo face-on")
ap.add_argument("preset", nargs="?", choices=sorted(PRESETS))
ap.add_argument("--src", help="the photo")
ap.add_argument("--out", help="the face-on map (jpg)")
ap.add_argument("--name", help="the Background.qml property printed with the axes")
ap.add_argument("--dist", type=float, help="distance, kpc")
ap.add_argument("--fov", type=float, help="width of the photo as given, arcmin")
ap.add_argument("--north", type=float, help="north's angle in the photo, degrees clockwise from up (negative = left)")
ap.add_argument("--pa", type=float, help="major axis position angle, degrees north through east")
ap.add_argument("--inc", type=float, help="inclination, degrees (0 = face-on)")
ap.add_argument("--l", type=float, help="galactic longitude, degrees")
ap.add_argument("--b", type=float, help="galactic latitude, degrees")
ap.add_argument("--ext", type=float, help="the map covers +-ext kpc")
ap.add_argument("--edge", type=float, help="the disk fades out by this radius, kpc")
ap.add_argument("--soft", type=float, help="... over this width, kpc")
ap.add_argument("--core", type=float, help="fade the centre inside this radius (+3 kpc), kpc; 0 keeps it")
ap.add_argument("--work", type=int, help="shrink the photo's long side to this many px first (0: as is)")
ap.add_argument("--black", action="store_true", default=None, help="black-level a raw photo (as make_atlas.py does)")
ap.add_argument("--median", type=int, help="median filter size against foreground stars, px (odd)")
ap.add_argument("--size", type=int, default=2048, help="map size, px")
args = ap.parse_args()
P = dict(PRESETS[args.preset]) if args.preset else {}
for k, v in vars(args).items():
    if v is not None and k != "preset":
        P[k] = v
P.setdefault("name", "disk")
for k, v in (("north", 0.0), ("core", 0.0), ("work", 0), ("black", False), ("median", 7)):
    P.setdefault(k, v)
P.setdefault("edge", P.get("ext"))
P.setdefault("soft", 4.0)
missing = [k for k in ("src", "out", "dist", "fov", "pa", "inc", "l", "b", "ext") if P.get(k) is None]
if missing:
    ap.error("missing: " + ", ".join("--" + k for k in missing))

DIST_KPC = P["dist"]
PA, INC = P["pa"], P["inc"]
L, B = P["l"], P["b"]
EXT = P["ext"]
N = P["size"]

img = Image.open(P["src"]).convert("RGB")
if P["work"] and max(img.size) > P["work"]:
    k = P["work"] / max(img.size)
    img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
fov_px = img.width                  # the photo's width before turning it north-up
# north up: PIL turns counter-clockwise, north sits `north` clockwise of up
if abs(P["north"]) > 0.05:
    img = img.rotate(P["north"], resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
# foreground stars out: a median removes points, keeps the smooth disk
img = img.filter(ImageFilter.MedianFilter(P["median"]))
a = np.asarray(img).astype(np.float32) / 255.0
if P["black"]:
    # the darkest sky in the frame goes to true black
    floor = np.percentile(a.reshape(-1, 3), 4, axis=0)
    a = np.clip((a - floor) / np.maximum(1 - floor, 1e-3), 0, 1)
a = a ** 2.0                                                  # to linear light
H, W = a.shape[0], a.shape[1]
kpc_per_px = DIST_KPC * math.radians(P["fov"] / 60.0) / fov_px

# the nucleus: the photo is not framed exactly on it; the brightest point of
# a heavily smoothed copy is
lum = np.asarray(Image.fromarray((np.clip(a.mean(axis=2), 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(W, H) * 0.01))).astype(np.float32)
cy, cx = np.unravel_index(np.argmax(lum), lum.shape)
cx, cy = cx + 0.5, cy + 0.5
print("nucleus at", round(cx), round(cy), "of", W, "x", H)

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
inside = (px >= 0) & (px < W - 1) & (py >= 0) & (py < H - 1)
x0 = np.clip(np.floor(px).astype(int), 0, W - 2)
y0 = np.clip(np.floor(py).astype(int), 0, H - 2)
fx = (px - x0)[..., None]
fy = (py - y0)[..., None]
face = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
        + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)
face *= inside[..., None]
# the disk is face-on now, so its surface brightness drops by cos(i): undo
face *= math.cos(inc)
# keep the disk only: soft edge (the photo's frame edges smear beyond it),
# and, for a galaxy with a bulge, fade the centre, where the round bulge was
# smeared into a bar by unfolding it as if flat (galaxy.frag draws it in 3D)
R = np.hypot(U, V)
edge = np.clip((P["edge"] - R) / P["soft"], 0, 1)
core = 0.12 + 0.88 * np.clip((R - P["core"]) / 3.0, 0, 1) if P["core"] > 0 else 1.0
face *= (edge * edge * (3 - 2 * edge) * core)[..., None]
face /= max(np.percentile(face, 99.9), 1e-6)
Image.fromarray((np.clip(face, 0, 1) ** (1 / 2.0) * 255 + 0.5).astype(np.uint8)).save(P["out"], quality=90)
print("wrote", P["out"], "kpc/px photo", round(kpc_per_px, 4))


# in-plane axes in the Galactocentric frame, signed like the photo
def gal(l, b):
    l, b = math.radians(l), math.radians(b)
    x, y, z = math.cos(b) * math.cos(l), math.cos(b) * math.sin(l), math.sin(b)
    return np.array([y, -x, z])


s = gal(L, B)                                   # toward the galaxy
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
print(P["name"] + ': {"major": ' + fmt(major) + ', "minor": ' + fmt(minor) + ', "normal": ' + fmt(normal) + "}")
