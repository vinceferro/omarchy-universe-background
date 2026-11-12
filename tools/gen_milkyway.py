# Face-on Milky Way maps for the wallpaper's galaxy view.
#
# Spiral arms: Reid et al. 2019 (ApJ 885, 131) Table 2, log spirals with a
# kink: ln(R/Rk) = -(beta - beta_k) tan(psi), beta = 0 toward the Sun and
# increasing with Galactic rotation (clockwise from the NGP), X toward l = 90,
# Y from the Galactic Centre to the Sun, R0 = 8.15 kpc (the table's fit).
# Ranges are extended past the maser data for the visual, kept between the
# bar end (3 kpc) and the stellar edge (~16 kpc).
#
# Output (plugin textures/), covering X, Y in [-16, 16] kpc:
#   milkyway-young.png  young stars along the arms + HII regions (RGB, sqrt-encoded)
#   milkyway-dust.png   dust lanes on the arms' inner edges + diffuse disk dust
import os
import sys
import numpy as np
from PIL import Image

N = int(sys.argv[1]) if len(sys.argv) > 1 else 2048
EXT = 16.0
OUT = os.path.expanduser("~/.config/omarchy/plugins/universe.background/textures/")
rng = np.random.default_rng(1977)

ax = (np.arange(N) + 0.5) / N * 2 * EXT - EXT
X, Yimg = np.meshgrid(ax, ax)
Y = -Yimg               # image row 0 = +Y (the Sun's side at the top)
R = np.hypot(X, Y)
B = np.arctan2(X, Y)    # beta, radians

ARMS = [  # name, beta_k, R_k, psi_before, psi_after, lo, hi, width, weight
    ("3kpc-near", 15, 3.52, -4.2, -4.2, -20, 60, 0.18, 0.35),
    ("3kpc-far", 195, 3.52, -4.2, -4.2, 160, 240, 0.18, 0.30),
    ("Norma", 18, 4.46, -1.0, 19.5, -60, 54, 0.14, 0.75),
    ("Outer", 18, 12.24, 3.0, 9.4, -120, 200, 0.65, 0.55),
    ("Sct-Cen", 23, 4.91, 14.1, 12.1, -230, 150, 0.23, 1.0),
    ("Sgr-Car", 24, 6.04, 17.1, 1.0, -140, 200, 0.27, 0.8),
    ("Local", 9, 8.26, 11.4, 11.4, -35, 60, 0.31, 0.55),
    ("Perseus", 40, 8.87, 10.3, 8.7, -200, 160, 0.35, 1.0),
]


def arm_radius(beta_deg, bk, rk, p1, p2):
    psi = np.where(beta_deg <= bk, p1, p2) * np.pi / 180
    return rk * np.exp(-(beta_deg - bk) * np.pi / 180 * np.tan(psi))


def smooth_edge(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(cells, seed):
    r = np.random.default_rng(seed).random((cells + 1, cells + 1))
    u = (np.arange(N) + 0.5) / N * cells
    i = np.floor(u).astype(int)
    f = u - i
    f = f * f * (3 - 2 * f)
    a = r[np.ix_(i, i)]
    b = r[np.ix_(i, i + 1)]
    c = r[np.ix_(i + 1, i)]
    d = r[np.ix_(i + 1, i + 1)]
    fy, fx = np.meshgrid(f, f, indexing="ij")
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(base, octaves, seed):
    out = np.zeros((N, N))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(base * 2 ** o, seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


def blur(img, sigma_px):
    k = np.fft.fftfreq(N)
    g = np.exp(-2 * (np.pi * sigma_px) ** 2 * (k[:, None] ** 2 + k[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g))


young = np.zeros((N, N))
lane = np.zeros((N, N))
arm_any = np.zeros((N, N))
bdeg = B * 180 / np.pi
for name, bk, rk, p1, p2, lo, hi, w, wt in ARMS:
    for n in range(-2, 3):
        bn = bdeg + 360 * n
        inside = (bn >= lo) & (bn <= hi)
        if not inside.any():
            continue
        Ra = arm_radius(bn, bk, rk, p1, p2)
        ok = inside & (Ra > 2.9) & (Ra < 17)
        # width grows outward (Reid: w + 0.042 (R - Rk)); widened a little to read at galaxy scale
        ww = np.maximum(w + 0.042 * (Ra - rk), 0.10) * 1.05
        fade = smooth_edge(bn, lo, lo + 25) * (1 - smooth_edge(bn, hi - 25, hi)) * smooth_edge(Ra, 2.9, 3.6)
        d = R - Ra
        g = np.exp(-0.5 * (d / ww) ** 2) * fade * wt * np.exp(-(Ra - 6.0) / 5.0)
        young += np.where(ok, g, 0)
        arm_any = np.maximum(arm_any, np.where(ok, g / wt, 0))
        # dust lanes ride the inner (concave) edge of each arm
        gl = np.exp(-0.5 * ((d + ww * 0.9) / (ww * 0.55)) ** 2) * fade * wt
        lane += np.where(ok, gl, 0)

clumps = 0.5 * fbm(20, 4, 11) + 0.5 * fbm(64, 4, 31)
fil = fbm(40, 5, 23)
young *= np.clip(0.30 + 1.9 * (clumps - 0.45), 0, None) ** 1.4
young *= smooth_edge(16.5 - R, 0, 2.5)

# HII regions: pink knots strewn along the arms, more where the arms are strong
pts = []
weights = (young / young.max()).ravel()
idx = rng.choice(N * N, size=1400, p=weights / weights.sum())
hii = np.zeros((N, N))
px = 2 * EXT / N
for k in idx:
    r_, c_ = divmod(k, N)
    s = rng.uniform(0.012, 0.045) / px
    a = rng.uniform(0.2, 1.0) ** 3 * 1.1
    rad = int(s * 3) + 1
    r0, r1 = max(0, r_ - rad), min(N, r_ + rad + 1)
    c0, c1 = max(0, c_ - rad), min(N, c_ + rad + 1)
    yy, xx = np.mgrid[r0:r1, c0:c1]
    hii[r0:r1, c0:c1] += a * np.exp(-((yy - r_) ** 2 + (xx - c_) ** 2) / (2 * s * s))

# young star light: blue-white; HII: hydrogen-alpha pink
young = blur(young, 1.2)
yc = np.stack([0.70 * young + 1.00 * hii * 0.9,
               0.82 * young + 0.38 * hii * 0.9,
               1.00 * young + 0.52 * hii * 0.9], -1)
yc /= np.percentile(yc, 99.9)
yc = np.sqrt(np.clip(yc, 0, 1))
Image.fromarray((yc * 255 + 0.5).astype(np.uint8)).save(OUT + "milkyway-young.png")

# dust: lanes broken into filaments, plus a thin diffuse layer in the inner disk
lane = blur(lane, 1.0) * np.clip(0.2 + 1.8 * (fil - 0.3), 0, None) ** 1.3
diffuse = 0.22 * np.exp(-R / 4.5) * smooth_edge(R, 1.0, 3.0) * np.clip(fil * 1.4 - 0.2, 0, None)
dust = (lane / lane.max() + diffuse) * smooth_edge(15.5 - R, 0, 3)
dust /= np.percentile(dust, 99.9)
dust = np.sqrt(np.clip(dust, 0, 1))
Image.fromarray((dust * 255 + 0.5).astype(np.uint8)).save(OUT + "milkyway-dust.png")
print("ok", N, OUT)
