// numeric checks for dwarfs.js (run with node; strips the QML pragma)
const fs = require("fs")
const path = require("path")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Dw = new Function(src + "\nreturn { SUN, DWARFS, list, find, galactocentric };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = a => Math.hypot(a[0], a[1], a[2])
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// the hotspots in Background.qml: the frame the table must share
const qml = fs.readFileSync(path.join(path.dirname(process.argv[2]), "..", "Background.qml"), "utf8")
const hot = JSON.parse(qml.match(/readonly property var hotspots: (\[[\s\S]*?\}\])\n/)[1])
const hotPos = name => hot.find(h => h.name.startsWith(name)).pos

// 1. the frame: the hotspots' convention, the Sun where gxTarget puts it
check("Sun at (0, 8.15, 0.0208)", Dw.SUN[0] === 0 && Dw.SUN[1] === 8.15 && Dw.SUN[2] === 0.0208)
const m31 = hotPos("Andromeda")
const e31 = len(sub(Dw.galactocentric(121.17, -21.57, 761), m31))
check("M31 (l 121.17, b -21.57, 761 kpc) lands on its hotspot", e31 < 2e-3, e31.toExponential(2))
const e33 = len(sub(Dw.galactocentric(133.61, -31.33, 840), hotPos("Triangulum")))
check("M33 (l 133.61, b -31.33, 840 kpc) lands on its hotspot", e33 < 0.05, e33.toFixed(4))
const eVega = len(sub(Dw.galactocentric(67.448, 19.237, 0.00768), hotPos("Vega")))
check("Vega 7.68 pc lands on its hotspot (the Sun's offset)", eVega < 2e-5, eVega.toExponential(2))

// 2. the table: complete, finite, positions agree with the distances
const all = Dw.list()
check("~75 dwarfs within 1.5 Mpc", all.length >= 60 && all.length <= 90, all.length)
check("all within 1.5 Mpc of the Sun", all.every(d => d.dpc <= 1.5e6))
let worst = 0
for (const d of all) worst = Math.max(worst, Math.abs(len(sub(d.pos, Dw.SUN)) - d.dpc / 1000))
check("|pos - Sun| = dpc (max error, kpc)", worst < 0.01, worst.toFixed(5))
check("every pos finite", all.every(d => d.pos.every(Number.isFinite)))
check("no big spirals in the table", !all.some(d => /^(Andromeda|Triangulum|The Galaxy)$/.test(d.name)))
check("find by name or alias", Dw.find("NGC 205") === Dw.find("M110") && Dw.find("nope") === null)

// 3. known places
const lmc = Dw.find("LMC")
check("LMC ~50 kpc, near its hotspot", Math.abs(lmc.dpc / 1000 - 50) < 2 && len(sub(lmc.pos, hotPos("Large Magellanic"))) < 3, len(sub(lmc.pos, hotPos("Large Magellanic"))).toFixed(2))
check("LMC flagged as a hotspot", lmc.hotspot === "Large Magellanic Cloud")
check("LMC below the plane, toward l ~ 280", lmc.pos[2] < -20 && lmc.pos[0] < -30)
const scl = Dw.find("Sculptor")
check("Sculptor 86 kpc from the Sun", Math.abs(scl.dpc / 1000 - 86) < 0.5, scl.dpc / 1000)
check("Sculptor near the south Galactic pole", scl.b < -82 && Math.abs(len(scl.pos) - 86) < 3, len(scl.pos).toFixed(1))
const sgr = Dw.find("Sagittarius dSph")
check("Sagittarius dSph behind the bulge, near its hotspot", sgr.pos[1] < -10 && len(sub(sgr.pos, hotPos("Sagittarius Dwarf"))) < 2, len(sub(sgr.pos, hotPos("Sagittarius Dwarf"))).toFixed(2))

// 4. M31's ellipticals: on its disk, small, flagged for 3D
const los = sub(m31, Dw.SUN).map(c => c / len(sub(m31, Dw.SUN)))
const proj = p => { const v = sub(p, m31); const a = dot(v, los); return len(sub(v, los.map(c => c * a))) }
const m32 = Dw.find("M32"), m110 = Dw.find("NGC 205")
// M32 is 24 arcmin from M31's nucleus on the sky: 5.4 kpc at 761 kpc
check("M32 ~5.4 kpc from M31, projected", Math.abs(proj(m32.pos) - 5.4) < 0.3, proj(m32.pos).toFixed(2))
check("M32 at M31's distance: 3D = projected", len(sub(m32.pos, m31)) < 6 && Math.abs(len(sub(m32.pos, m31)) - proj(m32.pos)) < 0.2, len(sub(m32.pos, m31)).toFixed(2))
check("NGC 205 ~8 kpc from M31, projected", proj(m110.pos) > 6 && proj(m110.pos) < 11, proj(m110.pos).toFixed(2))
check("M32, NGC 205 flagged ell3d with their structure", [m32, m110].every(d => d.ell3d && d.rh > 0 && d.ell > 0 && d.pa !== null && d.mv < -15))
check("only those two are ell3d", all.filter(d => d.ell3d).length === 2)
const m31sats = all.filter(d => d.group === "M31")
const far = Math.max(...m31sats.map(d => len(sub(d.pos, m31))))
check("M31's satellites within 400 kpc of it", far < 400, far.toFixed(0))

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all ok")
