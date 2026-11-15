// numeric checks for localgroup.js (run with node; strips the QML pragma):
// the photo <-> model hand-off, sky directions against deproject_galaxy.py's
// axes, the photometric scale, the dwarfs as places and their data texture,
// the Magellanic Clouds' frames and the viewpoint from Andromeda.
//   node tests/test_localgroup.js lib/localgroup.js
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const lib = path.dirname(process.argv[2])
const load = (file, names) => new Function(fs.readFileSync(file, "utf8").replace(".pragma library", "") + "\nreturn { " + names + " };")()
const LG = load(process.argv[2], "SUN, NCP, HANDOFF, handoff, viewCos, skyBasis, skyAxis, diskAxes, M31_MV, L31, lum, suns, dwarfPlace, lmcModel, viewFrom, tiltFrom")
const Dw = load(path.join(lib, "dwarfs.js"), "DWARFS, find")
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = a => Math.hypot(a[0], a[1], a[2])
const deg = Math.PI / 180
const close = (a, b, tol) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol

const qml = fs.readFileSync(path.join(lib, "..", "Background.qml"), "utf8")
const hot = JSON.parse(qml.match(/readonly property var hotspots: (\[[\s\S]*?\}\])\n/)[1])
const hotPos = name => hot.find(h => h.name.startsWith(name)).pos
const frag = fs.readFileSync(path.join(lib, "..", "galaxy.frag"), "utf8")

// 1. the hand-off: photo within 14 degrees, model past 32, the same numbers as the shaders
check("hand-off cosines are 14 and 32 degrees", Math.abs(Math.acos(LG.HANDOFF.photo) / deg - 14) < 0.5 && Math.abs(Math.acos(LG.HANDOFF.model) / deg - 32) < 0.5,
  (Math.acos(LG.HANDOFF.photo) / deg).toFixed(1) + " " + (Math.acos(LG.HANDOFF.model) / deg).toFixed(1))
check("photo straight on, model from the side, both sum to 1", LG.handoff(1).photo === 1 && LG.handoff(0).model === 1 && LG.handoff(-1).model === 1
  && Math.abs(LG.handoff(0.91).photo + LG.handoff(0.91).model - 1) < 1e-12)
check("cross-fade: a smooth ramp between", LG.handoff(0.91).photo > 0.4 && LG.handoff(0.91).photo < 0.6 && LG.handoff(0.88).photo < LG.handoff(0.94).photo)
const uf = fs.readFileSync(path.join(lib, "..", "universe.frag"), "utf8")
check("universe.frag's card uses the same two numbers", uf.includes("smoothstep(" + LG.HANDOFF.model + ", " + LG.HANDOFF.photo + ", gxPhoto.w)"))
// viewCos: looking from Earth's side is 1, from the far side -1
const m31 = hotPos("Andromeda")
const s = sub(LG.SUN, m31)
check("viewCos: from Earth's side 1, from behind -1", Math.abs(LG.viewCos(m31.map((c, j) => c + s[j] * 0.1), m31) - 1) < 1e-9
  && Math.abs(LG.viewCos(m31.map((c, j) => c - s[j] * 0.1), m31) + 1) < 1e-9)

// 2. sky directions: the same construction as deproject_galaxy.py gave for M31 and M33
const ax31 = LG.diskAxes(m31, 77.0, 38.0)
const m31Disk = JSON.parse(qml.match(/readonly property var m31Disk: (\{.*\})\n/)[1])
check("M31 disk axes (i 77, PA 38) match m31Disk", close(ax31.major, m31Disk.major, 2e-3) && close(ax31.minor, m31Disk.minor, 2e-3) && close(ax31.normal, m31Disk.normal, 2e-3),
  ax31.major.map(c => c.toFixed(4)).join(" "))
const m33 = hotPos("Triangulum")
// the tool's preset gives the axis as 21.12 (Koch et al. 2018 quote 201.12: the
// same line on the sky; the construction's normal flips with the other end)
const ax33 = LG.diskAxes(m33, 55.08, 21.12)
const m33Disk = JSON.parse(qml.match(/readonly property var m33Disk: (\{.*\})\n/)[1])
check("M33 disk axes (i 55.08, PA 21.12) match m33Disk",close(ax33.major, m33Disk.major, 2e-3) && close(ax33.minor, m33Disk.minor, 2e-3) && close(ax33.normal, m33Disk.normal, 2e-3),
  ax33.normal.map(c => c.toFixed(4)).join(" "))
check("galaxy.frag draws M33 from its own map at true scale", frag.includes("m33Tex") && qml.includes('gxGalaxy("Triangulum", 1.0)'))
const b = LG.skyBasis(m31)
check("sky basis is orthonormal, east = north x toward", Math.abs(dot(b.s, b.n)) < 1e-9 && Math.abs(dot(b.n, b.e)) < 1e-9 && Math.abs(len(b.e) - 1) < 1e-9)
check("north on the sky points toward the celestial pole", dot(b.n, LG.NCP) > 0.3)
check("PA 0 is north, PA 90 east", close(LG.skyAxis(m31, 0), b.n, 1e-9) && close(LG.skyAxis(m31, 90), b.e, 1e-9))
// galaxy.frag's constants are the library's
check("galaxy.frag shares SUN and NCP", frag.includes("vec3(0.0, 8.15, 0.0208)") && frag.includes("vec3(0.74698, 0.48383, 0.45599)"))

// 3. light: Andromeda is the unit, the others follow their magnitudes
check("lum(M31) = L31, 2.5 mag = 10x", Math.abs(LG.lum(LG.M31_MV) - LG.L31) < 1e-9 && Math.abs(LG.lum(LG.M31_MV + 2.5) * 10 - LG.L31) < 1e-6)
check("galaxy.frag has the same L31 and M31_MV", frag.includes("const float L31 = " + LG.L31 + ".0") && frag.includes("(mv + " + (-LG.M31_MV).toFixed(1) + ")"))
check("the LMC is ~17x fainter than M31, the SMC ~57x", Math.abs(LG.L31 / LG.lum(-18.1) - 17.4) < 0.5 && Math.abs(LG.L31 / LG.lum(-16.8) - 57.5) < 1.5)
check("the Sun is one Sun", Math.abs(LG.suns(4.83) - 1) < 1e-9)

// 4. the dwarfs as places: the hotspots' shape, the three hotspots hidden
const places = Dw.DWARFS.map(d => LG.dwarfPlace(d))
check("every dwarf becomes a place with name, pos, dpc, size, color, label, blurb",
  places.every(p => p.name && p.pos.length === 3 && p.dpc > 0 && p.size > 0 && /^#[0-9a-f]{6}$/.test(p.color) && p.label && p.blurb && p.kind === "galaxy" && p.dwarf))
check("the LMC, SMC and Sagittarius are hidden (hotspots already)", places.filter(p => p.hidden).length === 3 && places.find(p => p.name === "LMC").hidden)
const scl = places.find(p => p.name === "Sculptor")
check("Sculptor: 1.1 kpc across (4 rh), 2.4 million Suns in the blurb", scl.size === 4 * 283 && scl.blurb.includes("2.4 million Suns") && scl.label.includes("Milky Way satellite"), scl.blurb)
check("a dwarf with no half-light radius still has a size", places.find(p => p.name === "Bootes III").size === 800)
check("irregulars are blue, spheroidals warm", places.find(p => p.name === "IC 1613").color === "#cfdcff" && scl.color === "#ffe4c0")

// 5. the data texture matches the table, to its precision (a small PNG reader: 8-bit RGB, filters 0-4)
function readPng(file) {
  const buf = fs.readFileSync(file)
  let p = 8, w = 0, h = 0, idat = []
  while (p < buf.length) {
    const n = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8)
    if (type === "IHDR") { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); if (buf[p + 16] !== 8 || buf[p + 17] !== 2) throw new Error("not 8-bit RGB") }
    if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + n))
    p += 12 + n
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 3, stride = w * bpp
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let pr = 0
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[y * stride + x] = (row[x] + pr) & 255
    }
  }
  return { w, h, px: (x, y) => [0, 1, 2].map(k => out[y * stride + x * bpp + k]) }
}
const tex = readPng(path.join(lib, "..", "textures", "dwarfs.png"))
check("dwarfs.png is 128 x 4 RGB", tex.w === 128 && tex.h === 4)
let worstPos = 0, worstRh = 0, worstMv = 0, kinds = true
Dw.DWARFS.forEach((d, i) => {
  const hi = tex.px(i, 0), lo = tex.px(i, 1), r2 = tex.px(i, 2), r3 = tex.px(i, 3)
  const pos = [0, 1, 2].map(k => (hi[k] * 256 + lo[k]) / 65535 * 3200 - 1600)
  worstPos = Math.max(worstPos, len(sub(pos, d.pos)))
  worstRh = Math.max(worstRh, Math.abs((r2[0] * 256 + r2[1]) / 65535 * 4000 - (d.rh || 200)))
  worstMv = Math.max(worstMv, Math.abs(r3[0] / 255 * 20 - 20 - d.mv))
  const kind = d.hotspot || d.ell3d ? 0 : d.type.includes("Irr") ? 2 : 1
  if (r2[2] !== kind) kinds = false
})
check("positions to 0.05 kpc", worstPos < 0.05, worstPos.toFixed(4))
check("half-light radii to 0.1 pc", worstRh < 0.1, worstRh.toFixed(3))
check("magnitudes to 0.04", worstMv < 0.04, worstMv.toFixed(3))
check("type bytes: hotspots and ellipticals 0, spheroidal 1, irregular 2", kinds)
check("columns past the table are empty", tex.px(Dw.DWARFS.length, 2)[2] === 0)

// 6. the LMC's frame: the disk normal 34.7 degrees from our line of sight, the bar and offsets in the plane
const lmcPos = hotPos("Large Magellanic")
const L = LG.lmcModel(lmcPos)
const los = sub(lmcPos, LG.SUN).map(c => c / len(sub(lmcPos, LG.SUN)))
check("LMC normal 34.7 degrees from the line of sight", Math.abs(Math.acos(Math.abs(dot(L.normal, los))) / deg - 34.7) < 0.05)
check("LMC frame orthonormal", Math.abs(dot(L.major, L.minor)) < 1e-9 && Math.abs(dot(L.major, L.normal)) < 1e-9 && Math.abs(len(L.minor) - 1) < 1e-9)
check("LMC major axis is the line of nodes: in the sky plane", Math.abs(dot(L.major, los)) < 1e-9)
check("bar direction unit, half-length 1.5 kpc; disk offset 0.3 kpc", Math.abs(Math.hypot(L.bar[0], L.bar[1]) - 1) < 1e-9 && L.bar[2] === 1.5 && Math.abs(Math.hypot(L.off[0], L.off[1]) - 0.3) < 1e-9)
const heavy3 = [0, 1, 2].map(j => L.major[j] * L.off[2] + L.minor[j] * L.off[3])   // the heavy side, back in space
check("the heavy side (30 Dor) is east of the bar's centre", dot(heavy3, LG.skyBasis(lmcPos).e) > 0.5)

// 7. the viewpoint: from Andromeda, the Milky Way 21 degrees from edge-on, seen from the south
const v = LG.viewFrom(m31, [0, 0, 0])
const cp = Math.cos(v.pitch)
const cam = [cp * Math.sin(v.yaw) * v.dist, cp * Math.cos(v.yaw) * v.dist, Math.sin(v.pitch) * v.dist]
check("viewFrom puts the camera at Andromeda", close(cam, m31, 1e-6), cam.map(c => c.toFixed(2)).join(" "))
check("765 kpc away", Math.abs(v.dist - len(m31)) < 1e-9, v.dist.toFixed(1))
check("21 degrees from edge-on, from the south (pitch < 0)", Math.abs(LG.tiltFrom(m31) - 21.4) < 0.3 && v.pitch < 0, LG.tiltFrom(m31).toFixed(2))
check("the Milky Way's 34 kpc span ~2.5 degrees from there", Math.abs(34 / v.dist / deg - 2.5) < 0.1, (34 / v.dist / deg).toFixed(2))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
