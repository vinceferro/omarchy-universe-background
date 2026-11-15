# The Local Group's dwarf galaxies for the galaxy view: lib/dwarfs.js.
#
# From McConnachie 2012 (AJ 144, 4), "The observed properties of dwarf
# galaxies in and around the Local Group", tables 1-5 as one catalogue on
# VizieR (J/AJ/144/4/catalog), downloaded as tab-separated text:
#   https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/AJ/144/4&-out.all&-out.max=200
# Kept: everything within 1.5 Mpc of the Sun but the three spirals (the Galaxy,
# M31, M33 are drawn whole) and Canis Major (an overdensity in our own disk,
# "MW disk substructure?" in the catalogue). The LMC, SMC and Sagittarius are
# hotspots already; they are kept and flagged so they are not drawn twice.
# M32 and NGC 205 (M110) are flagged `ell3d`: M31's ellipticals, drawn as
# small 3D ellipsoids rather than glows.
#
# Positions: the catalogue's RA/Dec (l, b computed from them: its own l, b are
# rounded to 0.1 deg), heliocentric distance D, into the hotspots' frame
# (kpc, Galactocentric: X toward l = 90, Y Galactic Centre -> Sun, Z north):
#   X = D cos b sin l,  Y = R0 - D cos b cos l,  Z = z0 + D sin b
# with the Sun at (0, R0 = 8.15, z0 = 0.0208), as in Background.qml
# (sunPosAt(0), gxTarget) and deproject_galaxy.py's gal(); the existing
# hotspots' "pos" follow it to 1e-4 kpc (M31: l 121.17, b -21.57, 761 kpc).
#
# M31's satellites are scaled to M31's distance here: the catalogue has M31
# at 783 kpc, the hotspot (and m31-faceon.jpg's kpc) at 761, so each M31
# subgroup member's distance is multiplied by 761/783 to keep it where it
# belongs relative to M31's disk (`dpcCat` keeps the catalogue's). M32 and
# NGC 205 sit at M31's own distance: their offsets along the line of sight
# (805, 824 vs 783 kpc) are within the errors (+-25-35 kpc) and would put
# them 40-60 kpc behind a disk they are seen against.
#
# The same table goes to textures/dwarfs.png for galaxy.frag, which draws the
# dwarfs as glows: one column per galaxy in the table's order, 8-bit RGB (no
# alpha: Qt would premultiply it), read with nearest sampling:
#   rows 0-2   X, Y, Z: high, middle and low bytes of (v + 1600) / 3200 * 16777215
#              (kpc; 0.2 pc steps: two bytes would be 49 pc, a quarter of the
#              smallest dwarfs' size, and their glow would sit off their marker)
#   row 3      half-light radius: high and low bytes of rh / 4 kpc * 65535;
#              B: 0 not drawn there (a hotspot, or ell3d: drawn on its own),
#              1 spheroidal, 2 irregular or transition type
#   row 4      R: (M_V + 20) / 20 * 255 (0.08 mag steps); G: ellipticity * 255;
#              B: position angle / 360 * 255
#
# Usage: python3 -I gen_dwarfs.py <catalogue.tsv>
import json
import math
import os
import sys
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib", "dwarfs.js")
TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "textures", "dwarfs.png")
TEXW = 128
R0, Z0 = 8.15, 0.0208
DMAX = 1500.0
SKIP = {"The Galaxy", "Andromeda", "Triangulum", "Canis Major"}
HOTSPOT = {"LMC": "Large Magellanic Cloud", "SMC": "Small Magellanic Cloud", "Sagittarius dSph": "Sagittarius Dwarf Spheroidal"}
ELL3D = {"M32", "NGC 205"}
M31_KPC = 761.0                         # Andromeda's hotspot distance, Background.qml
# equatorial axes in galactic coordinates (rows), J2000: as galToEq in Background.qml
T = [[-0.0548755604, 0.4941094279, -0.8676661490], [-0.8734370902, -0.4448296300, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]]


def num(s, f=float):
    s = s.strip()
    return f(s) if s else None


def eq_to_gal(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    e = [math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]
    g = [sum(T[j][i] * e[j] for j in range(3)) for i in range(3)]  # g = T^T e
    l = math.degrees(math.atan2(g[1], g[0])) % 360
    return l, math.degrees(math.asin(max(-1, min(1, g[2]))))


def galactocentric(l, b, d):
    l, b = math.radians(l), math.radians(b)
    return [d * math.cos(b) * math.sin(l), R0 - d * math.cos(b) * math.cos(l), Z0 + d * math.sin(b)]


rows, head = [], None
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("#") or not line.strip():
        continue
    f = line.rstrip("\n").split("\t")
    if head is None:
        head = f
        continue
    if len(f) != len(head) or not f[0].strip().isdigit():
        continue                                    # the units and dashes rows
    rows.append(dict(zip(head, f)))

m31_cat = next(num(r["D"]) for r in rows if r["Name"].strip() == "Andromeda")
out = []
for r in rows:
    name, dist = r["Name"].strip(), num(r["D"])
    if name in SKIP or dist is None or dist > DMAX:
        continue
    h, m, s = (float(x) for x in r["RAJ2000"].split())
    dd, dm, ds = r["DEJ2000"].split()
    sign = -1 if dd.startswith("-") else 1
    ra = 15 * (h + m / 60 + s / 3600)
    dec = sign * (abs(float(dd)) + float(dm) / 60 + float(ds) / 3600)
    l, b = eq_to_gal(ra, dec)
    dcat = dist
    if r["SubG"].strip() == "M31":
        dist = M31_KPC if name in ELL3D else dist * M31_KPC / m31_cat
    pos = galactocentric(l, b, dist)
    d = {"name": name, "alt": r["OName"].strip().split(",")[0], "type": r["MType"].strip(),
         "group": r["SubG"].strip(), "ra": round(ra, 5), "dec": round(dec, 5), "l": round(l, 4), "b": round(b, 4),
         "dpc": round(dist * 1000), "dpcCat": round(dcat * 1000), "pos": [round(c, 4) for c in pos],
         "rh": num(r["R2"], int), "rhArcmin": num(r["R1"]), "mv": num(r["VMag"]),
         "ell": num(r["Ell"]), "pa": num(r["PA"], int)}
    if name in HOTSPOT:
        d["hotspot"] = HOTSPOT[name]
    if name in ELL3D:
        d["ell3d"] = True
    out.append(d)
    # the catalogue's own Galactocentric distance (its R0 is 8 kpc) as a check
    dmw = num(r["D(MW)"]) if dist == dcat else None
    if dmw is not None and abs(math.hypot(*pos) - dmw) > max(2.0, 0.03 * dmw):
        print("check", name, round(math.hypot(*pos)), "vs D(MW)", dmw)

out.sort(key=lambda d: d["dpc"])
missing = ELL3D - {d["name"] for d in out}
if missing:
    sys.exit("missing: " + ", ".join(sorted(missing)))

lines = ",\n  ".join(json.dumps(d, ensure_ascii=False) for d in out)
js = f""".pragma library
// dwarfs.js — the Local Group's dwarf galaxies, for the galaxy view. Made by
// tools/gen_dwarfs.py from McConnachie 2012 (AJ 144, 4; VizieR J/AJ/144/4):
// every dwarf within 1.5 Mpc of the Sun. Plain JS, like camera.js.
//
// Frame: the hotspots' (kpc, Galactocentric: X toward l = 90, Y Galactic
// Centre -> Sun, Z north), the Sun at SUN. Per galaxy:
//   pos       [X, Y, Z] kpc, from RA/Dec and the heliocentric distance
//   dpc       heliocentric distance, pc (like a hotspot's); M31's satellites
//             scaled to M31's 761 kpc (catalogue: 783), M32 and NGC 205 at
//             it; dpcCat the catalogue's
//   ra, dec   J2000 degrees; l, b galactic degrees
//   rh        half-light radius, pc (on the major axis); rhArcmin on the sky
//   mv        absolute V magnitude
//   ell, pa   ellipticity 1 - b/a and the major axis' position angle (deg,
//             north through east), where measured; null otherwise
//   group     MW, M31 or Rest (the catalogue's subgroup); type its Hubble type
//   hotspot   already a hotspot (by this name): do not draw twice
//   ell3d     M31's ellipticals M32 and NGC 205: small 3D ellipsoids

const SUN = [0, {R0}, {Z0}]

const DWARFS = [
  {lines}
]

function list() {{ return DWARFS }}
function find(name) {{ return DWARFS.find(d => d.name === name || d.alt === name) || null }}
// (l, b) degrees and distance kpc from the Sun -> the Galactocentric frame
function galactocentric(lDeg, bDeg, dKpc) {{
  const l = lDeg * Math.PI / 180, b = bDeg * Math.PI / 180
  return [dKpc * Math.cos(b) * Math.sin(l), SUN[1] - dKpc * Math.cos(b) * Math.cos(l), SUN[2] + dKpc * Math.sin(b)]
}}
"""
open(OUT, "w", encoding="utf-8").write(js)

# the texture
assert len(out) <= TEXW
px = np.zeros((5, TEXW, 3), np.uint8)


def two(frac):
    v = int(round(max(0.0, min(1.0, frac)) * 65535))
    return v >> 8, v & 255


def three(frac):
    v = int(round(max(0.0, min(1.0, frac)) * 16777215))
    return v >> 16, (v >> 8) & 255, v & 255


for i, d in enumerate(out):
    hi, mid, lo = zip(*(three((c + 1600.0) / 3200.0) for c in d["pos"]))
    px[0, i] = hi
    px[1, i] = mid
    px[2, i] = lo
    rh = (d["rh"] or 200) / 1000.0
    kind = 0 if d.get("hotspot") or d.get("ell3d") else 2 if "Irr" in d["type"] else 1
    px[3, i] = two(rh / 4.0) + (kind,)
    px[4, i] = (int(round(max(0.0, min(1.0, (d["mv"] + 20.0) / 20.0)) * 255)),
                int(round((d["ell"] or 0.0) * 255)), int(round(((d["pa"] or 0) % 360) / 360.0 * 255)))
Image.fromarray(px, "RGB").save(TEX, optimize=True)
print("wrote", TEX)
print("wrote", OUT, len(out), "dwarfs,", sum(1 for d in out if d["group"] == "MW"), "MW,",
      sum(1 for d in out if d["group"] == "M31"), "M31,", sum(1 for d in out if d["group"] == "Rest"), "other")
