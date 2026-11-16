.pragma library
// localgroup.js — the Local Group's geometry for the galaxy view, as plain
// functions so tests/test_localgroup.js can check them: the photo <-> model
// hand-off by view angle, directions on the sky at a galaxy (north, east, a
// position angle as a 3D axis, a tilted disk's axes), the photometric scale
// the galaxies share with galaxy.frag, the dwarf table as places to fly to,
// the Magellanic Clouds' shapes, and named viewpoints. Frame: the hotspots'
// (kpc, Galactocentric: X toward l = 90, Y Galactic Centre -> Sun, Z north),
// the Sun at SUN.

const SUN = [0, 8.15, 0.0208]
const NCP = [0.74698, 0.48383, 0.45599]   // the celestial north pole (l 122.932, b 27.128)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = a => Math.hypot(a[0], a[1], a[2])
const unit = a => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l] }
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// ---- photo <-> model hand-off ----
// A galaxy with a real photo is the photo where we look along Earth's line
// of sight to it, its 3D model from the side, and a cross-fade between: by
// the cosine of the angle between our view and Earth's, the photo within 14
// degrees (cos 0.97), the model past 32 (cos 0.85). galaxy.frag's fades and
// universe.frag's photo card (kind 7, smoothstep(0.85, 0.97)) use the same
// two numbers; Andromeda's m31Fade had the rule first.
const HANDOFF = { photo: 0.97, model: 0.85 }
function handoff(cosA) {
  const photo = smoothstep(HANDOFF.model, HANDOFF.photo, cosA)
  return { photo: photo, model: 1 - photo }
}
// cosine of our view against Earth's, for a camera and a galaxy (the Sun may be elsewhere in the time-lapse)
function viewCos(cam, pos, sun) {
  const a = sub(cam, pos), s = sub(sun || SUN, pos)
  return Math.max(-1, Math.min(1, dot(a, s) / Math.max(1e-12, len(a) * len(s))))
}

// ---- directions on the sky at a galaxy, seen from the Sun ----
// s toward it, n north and e east on the sky (tools/deproject_galaxy.py's convention)
function skyBasis(pos) {
  const s = unit(sub(pos, SUN))
  const k = dot(NCP, s)
  const n = unit([NCP[0] - s[0] * k, NCP[1] - s[1] * k, NCP[2] - s[2] * k])
  return { s: s, n: n, e: cross(n, s) }
}
// a position angle (degrees, north through east) as a unit vector in space
function skyAxis(pos, paDeg) {
  const b = skyBasis(pos), pa = paDeg * Math.PI / 180
  return [0, 1, 2].map(j => Math.cos(pa) * b.n[j] + Math.sin(pa) * b.e[j])
}
// a disk's in-plane axes and normal from its inclination and the position angle
// of its major axis (line of nodes), the minor axis signed toward the sky's
// minor direction: the same construction as deproject_galaxy.py, so a face-on
// map made by it lands the right way round
function diskAxes(pos, incDeg, paDeg) {
  const b = skyBasis(pos), pa = paDeg * Math.PI / 180, inc = incDeg * Math.PI / 180
  const major = skyAxis(pos, paDeg)
  const minorSky = [0, 1, 2].map(j => Math.cos(pa) * b.e[j] - Math.sin(pa) * b.n[j])
  const w = unit(cross(b.s, major))
  const normal0 = [0, 1, 2].map(j => Math.cos(inc) * b.s[j] + Math.sin(inc) * w[j])
  let minor = cross(normal0, major)
  if (dot(minor, minorSky) < 0) minor = minor.map(c => -c)
  return { major: major, minor: minor, normal: cross(major, minor) }
}

// ---- light ----
// galaxy.frag's unit of light is Andromeda: its drawn total (the face-on map,
// 1.4 c^2 over 0.70 kpc of thickness, plus the bulge) sums to L31, for its
// absolute magnitude M31_MV (V = 3.4, (m-M)0 = 24.47, A_V ~ 0.2). Every other
// galaxy's light follows from its own M_V so the group keeps its real
// contrasts (McConnachie 2012: LMC -18.1, SMC -16.8, M33 -18.8, M32 -16.4).
const M31_MV = -21.2
const L31 = 219
function lum(mv) { return L31 * Math.pow(10, -0.4 * (mv - M31_MV)) }
const SUN_MV = 4.83
function suns(mv) { return Math.pow(10, -0.4 * (mv - SUN_MV)) }

// ---- the dwarfs as places ----
const TYPES = { dSph: "dwarf spheroidal galaxy", "dSph?": "probable dwarf spheroidal galaxy", dIrr: "dwarf irregular galaxy",
  "dIrr/dSph": "transition dwarf galaxy (irregular / spheroidal)", "dE/dSph": "dwarf elliptical galaxy", cE: "compact elliptical galaxy", Irr: "irregular galaxy" }
// where a dwarf belongs: the card's sub-head, and how its blurb says it
const GROUPS = { MW: ["Milky Way satellite", "that orbits the Milky Way"], M31: ["Andromeda satellite", "that orbits Andromeda"],
  Rest: ["roams the Local Group on its own", "that roams the Local Group on its own"],
  Edge: ["at the edge of the Local Group", "at the edge of the Local Group"] }
// the NGC 3109 association, 1.3 to 1.4 Mpc out: at or past the group's edge, not inside it
const EDGE = ["NGC 3109", "Antlia", "Sextans A", "Sextans B"]
function groupOf(d) { return GROUPS[EDGE.indexOf(d.name) >= 0 ? "Edge" : d.group] || [d.group, "of the " + d.group] }
function fmtSuns(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + " billion" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + " million"
       : n >= 1e3 ? Math.round(n / 1e3) + ",000" : Math.round(n).toString()
}
// a dwarf from lib/dwarfs.js in the hotspots' shape, so the HUD card, the
// flight and the labels treat it like any place: `size` is a diameter in pc
// (four half-light radii hold most of the light), `dwarf` marks it (galaxy.frag
// draws it in 3D, so universe.frag draws no card), `hidden` the three that are
// hotspots already
function dwarfPlace(d) {
  const rh = d.rh || 200   // three have no half-light radius (the catalogue): a typical dwarf's
  const irr = d.type.indexOf("Irr") >= 0 || d.type === "Irr"
  const type = TYPES[d.type] || d.type, g = groupOf(d)
  // the half-light radius in light-years, to two figures (every other card speaks in light-years)
  const rhLy = d.rh ? Number((d.rh * 3.26156).toPrecision(2)).toLocaleString("en-US") : ""
  return { name: d.name, kind: "galaxy", dwarf: true, hidden: !!d.hotspot, type: d.type, mv: d.mv,
    label: type + " · " + g[0], pos: d.pos, dpc: d.dpc, size: 4 * rh,
    color: irr ? "#cfdcff" : "#ffe4c0",
    blurb: (/^[aeiou]/.test(type) ? "An " : "A ") + type + " " + g[1] + ". All its stars together shine like " + fmtSuns(suns(d.mv)) + " Suns"
         + (d.rh ? ", half of that light from within " + rhLy + " light-years of its centre" : "") + "."
         + (d.alt ? " Also known as " + d.alt + "." : "") + " Data: McConnachie 2012." }
}

// ---- the Magellanic Clouds' shapes, for galaxy.frag ----
// The LMC is a disk inclined 34.7 degrees with its line of nodes at position
// angle 122.5 (van der Marel & Cioni 2001, AJ 122, 1807; from near-infrared
// star counts). Its hotspot is the bar's centre (the optical centre, RA
// 5h23.6m, Dec -69d45'); the outer disk's centre is the HI kinematic centre
// at RA 5h17.6m, Dec -69d02' (Kim et al. 1998, ApJ 503, 674): 0.91 degrees
// away at position angle 325, 0.79 kpc on the sky at 49.6 kpc. The bar runs
// at position angle ~120 on the sky, about 3 kpc long; the disk is lopsided
// toward 30 Doradus (RA 5h38.6m, Dec -69d06', position angle ~63 from the
// bar's centre), the Cloud's star-forming side. Sky directions are
// deprojected into the disk plane: the major axis lies in the sky, the minor
// axis's sky projection is cos i of it, so a sky vector d is u = d.major,
// v = d.minor / cos^2 i in the plane (one cos i for the projected axis's
// length, one for the foreshortening of the in-plane length).
const LMC_OFF_PA = 325, LMC_OFF_KPC = 0.79
function lmcModel(pos) {
  const ax = diskAxes(pos, 34.7, 122.5)
  const ci = Math.cos(34.7 * Math.PI / 180)
  // a length on the sky along a position angle, as it lies in the disk plane
  const inPlane = paDeg => { const d = skyAxis(pos, paDeg); return [dot(d, ax.major), dot(d, ax.minor) / (ci * ci)] }
  const unitIn = paDeg => { const p = inPlane(paDeg), l = Math.hypot(p[0], p[1]); return [p[0] / l, p[1] / l] }
  const off = inPlane(LMC_OFF_PA).map(c => c * LMC_OFF_KPC), bar = unitIn(120), lop = unitIn(63)
  return { major: ax.major, minor: ax.minor, normal: ax.normal,
    bar: [bar[0], bar[1], 1.5, 0],              // in-plane direction, half-length (kpc)
    off: [off[0], off[1], lop[0], lop[1]] }     // the disk's centre from the bar's (kpc, in the plane), the heavy side
}

// ---- named viewpoints ----
// stand at `from` (or `standoff` kpc short of it, toward `at`) and look at
// `at`: the orbit camera's yaw, pitch and distance (Background.qml: cam =
// target + [cos p sin y, cos p cos y, sin p] * dist)
function viewFrom(from, at, standoff) {
  const o = sub(from, at), d = len(o)
  return { yaw: Math.atan2(o[0], o[1]), pitch: Math.asin(Math.max(-1, Math.min(1, o[2] / d))), dist: d - (standoff || 0) }
}
// how far from edge-on a disk in the xy plane looks from a point (degrees)
function tiltFrom(from) { return Math.asin(Math.abs(from[2]) / len(from)) * 180 / Math.PI }
