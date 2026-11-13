# Photo atlas for the galaxy view: real images of the places you can fly to,
# each turned north-up, black-levelled, squared and soft-edged into a 4 x 4
# grid of 1024 px tiles (textures/photos.jpg), plus the tile list with each
# tile's field of view (textures/photos.json) used to show it at true size.
#
# Usage: python3 -I make_atlas.py <download dir with img1.jpg ...>
# Sources, licences and credits: textures/CREDITS.md (all CC BY 4.0 or public
# domain; URLs verified 2026-11-13).
import json
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "textures")
TILE = 1024
GRID = 4
HI = 2048  # each place also gets its own 2048 px image for close-ups (textures/photos/)

# file, hotspot name, image width on the sky (arcmin), north's angle
# (degrees, clockwise from up; negative = left of vertical)
PHOTOS = [
    ("img1.jpg", "Orion Nebula", 35.49, 0.0),
    ("img2.jpg", "Carina Nebula", 61.82, 0.0),
    ("img3.jpg", "Eagle Nebula", 32.08, 0.0),
    ("img4.jpg", "Lagoon Nebula", 93.49, 0.0),
    ("img5.jpg", "Rosette Nebula", 94.75, 0.0),
    ("img7.jpg", "Crab Nebula", 6.41, 0.0),
    ("img8.jpg", "Ring Nebula", 2.10, -11.7),
    ("img9.jpg", "Helix Nebula", 26.64, -0.4),
    ("img10.jpg", "Pleiades", 68.68, 90.7),
    ("img11.jpg", "Omega Centauri", 31.88, 0.0),
    ("img12.jpg", "47 Tucanae", 42.0, 0.1),
    ("img13.jpg", "Westerlund 1", 5.76, 284.3),
    ("img15.jpg", "Large Magellanic Cloud", 242.21, 0.3),
    ("img16.jpg", "Small Magellanic Cloud", 318.69, -30.1),
    ("img17.jpg", "Andromeda Galaxy", 162.24, 120.3),
]

atlas = np.zeros((TILE * GRID, TILE * GRID, 3), np.float32)
meta = []
for k, (fn, name, fov, north) in enumerate(PHOTOS):
    im = Image.open(os.path.join(SRC, fn)).convert("RGB")
    w0 = im.width
    # shrink first (fast), keeping enough pixels for the rotation
    scale = min(1.0, 3000 / max(im.size))
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    arcmin_per_px = fov / im.width
    cover = Image.new("L", im.size, 255)  # where the photo has pixels
    # north up: PIL turns counter-clockwise, north sits `north` clockwise of up
    if abs(north) > 0.05:
        im = im.rotate(north, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
        cover = cover.rotate(north, resample=Image.BICUBIC, expand=True, fillcolor=0)
    a = np.asarray(im).astype(np.float32) / 255.0
    # black level: the darkest sky in the frame goes to true black
    floor = np.percentile(a.reshape(-1, 3), 4, axis=0)
    a = np.clip((a - floor) / np.maximum(1 - floor, 1e-3), 0, 1)
    # square canvas around the centre, padded with black
    side = max(a.shape[0], a.shape[1])
    sq = np.zeros((side, side, 3), np.float32)
    y0 = (side - a.shape[0]) // 2
    x0 = (side - a.shape[1]) // 2
    sq[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = a
    cv = Image.new("L", (side, side), 0)
    cv.paste(cover, (x0, y0))
    def finish(size):
        out = np.asarray(Image.fromarray((sq * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)).astype(np.float32) / 255
        # the photo's own edges fade out too (rotated or non-square frames)
        m = np.asarray(cv.resize((size, size), Image.BILINEAR).filter(ImageFilter.GaussianBlur(size * 0.03))).astype(np.float32) / 255
        m = np.clip(m * 2 - 1, 0, 1)
        out *= (m * m * (3 - 2 * m))[..., None]
        # soft round edge, so the photo melts into the sky around it
        yy, xx = np.mgrid[0:size, 0:size]
        r = np.hypot(xx - size / 2 + 0.5, yy - size / 2 + 0.5) / (size / 2)
        t = np.clip((r - 0.80) / 0.20, 0, 1)
        return out * (1 - t * t * (3 - 2 * t))[..., None]
    tile = finish(TILE)
    slug = name.lower().replace(" ", "-")
    hi = finish(HI) if sq.shape[0] >= HI * 0.9 else finish(min(HI, sq.shape[0]))
    os.makedirs(os.path.join(OUT, "photos"), exist_ok=True)
    Image.fromarray((hi * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "photos", slug + ".jpg"), quality=90, optimize=True)
    gx, gy = k % GRID, k // GRID
    atlas[gy * TILE:(gy + 1) * TILE, gx * TILE:(gx + 1) * TILE] = tile
    meta.append({"name": name, "tile": k, "fovArcmin": round(side * arcmin_per_px, 3), "file": "photos/" + slug + ".jpg", "hiPx": hi.shape[0]})
    print(name, "tile", k, "fov", round(side * arcmin_per_px, 2), "arcmin")

Image.fromarray((atlas * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "photos.jpg"), quality=90, optimize=True)
json.dump(meta, open(os.path.join(OUT, "photos.json"), "w"), indent=1)
print("ok")
