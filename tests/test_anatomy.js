// checks for the anatomy layer (run with node):
//   node tests/test_anatomy.js lib/anatomy.js [Background.qml]
// The table (every body has rows, every row a tag, words that fit and a
// source), the hole's rows against lib/kerr.js, the shapes (a sphere's
// outline is a circle from every angle), the rules (size, chain, scale,
// fold, the six labels, mathematics rows with K only) and the room (lines
// and labels inside the safe rect, out of the HUD's disc and the rail).
// With Background.qml given: every place of the views has a record.
const fs = require("fs"), path = require("path")
const dir = path.dirname(process.argv[2])
const read = f => fs.readFileSync(path.join(dir, f), "utf8").replace(".pragma library", "").replace(/^\.import .*$/mg, "")
const Kerr = new Function(read("kerr.js") + "\nreturn { M, horizons, photonOrbit, polarPhotonOrbit, isco, horizonOmega, gasOmega, ksPoint, ergoRadius, shadowOutline, shadowBasis, shadowClass, impactAt, gasLight }")()
const Lay = new Function(read("layout.js") + "\nreturn { plan, placeLabels, labelBoxAt, hudDisc, railRect, storyRect, textW, intersects, hits, inSafe }")()
const Tx = new Function(read("text.js") + "\nreturn { words, read, hold, HOLD_MAX_S }")()
const Data = new Function("Kerr", read("anatomy-data.js") + "\nreturn { BODIES, LIMITS }")(Kerr)
const A = new Function("Kerr", "Lay", "Data", fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "").replace(/^\.import .*$/mg, "")
  + "\nreturn { MIN_PX, MAX_SCREENS, FOLD_PX, MAX_LABELS, TAGS, KINDS, DASH, records, limits, byId, bySys, byPlace, byAt, chain, labelOf, factOf, drawn, basisOf, project, hull, outline, clip, dash, allowed, compose, composeChain, hit, wordsOf, rowGeometry, holeView, frameKey, demoCam }")(Kerr, Lay, Data)
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }

const SPIN = 0.94 * Kerr.M, RS_KM = A.byId("sgrA").unitKm
const ctx = rec => ({ a: SPIN, rsKpc: 4.11e-10, unitS: rec.unitKm / 299792.458, place: { rh: 29, ell: 0.48, pa: 85 }, t: 0 })
// a screen and its room: the laptop-like 1920x1080 with the cockpit up and a rail standing
const lay = Lay.plan(1920, 1080, [0, 26, 0, 0], 0)
const disc = Lay.hudDisc(lay, [0.03, -0.02]), rail = Lay.railRect(lay, 320)
function env(o) {
  return Object.assign({ W: lay.W, H: lay.H, safe: lay.safe, obstacles: [rail, disc], tok: lay.tok, sides: {}, math: false, lit: "",
                         textW: (t, small) => Lay.textW(t.length, small ? lay.tok.micro : lay.tok.label, 0.11) }, o || {})
}
// a frame: the body at the origin, one unit a world unit, seen from (yaw, pitch) at distance d with the given view height in units
function frame(view, yaw, pitch, o) {
  o = o || {}
  const focal = o.focal || 1, d = view * focal
  const dirv = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
  const C = dirv.map(v => v * d), fwd = dirv.map(v => -v)
  let right = [fwd[1], -fwd[0], 0]; const rl = Math.hypot(right[0], right[1]) || 1; right = right.map(v => v / rl)
  if (rl === 0) right = [1, 0, 0]
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
  return { C: [0, 0, 0], k: 1, basis: A.basisOf(o.axis || [0, 0, 1]), cam: { C: C, right: right, up: up, fwd: fwd, focal: focal, o: o.o || [0, 0] },
           sunDir: o.sunDir === undefined ? [0, 1, 0] : o.sunDir, oneScale: o.oneScale !== false,
           resolve: spec => spec === "sun" ? [0.3 * view, 0.1 * view, 0] : spec.toPlace ? [0.2 * view, 0, 0.05 * view] : spec.place ? [0.25 * view, 0.2 * view, 0] : [0.05 * view, 0.02 * view, 0.03 * view] }
}

// ---- 1. the table ----
{
  const recs = A.records(), L = A.limits()
  check("the table has every body of the design", recs.length >= 37, recs.length + " records")
  let rows = 0, bad = [], tags = { measured: 0, model: 0, mathematics: 0 }, waiting = 0
  for (const b of recs) {
    if (!b.id || !b.title || !b.unit || !(b.unitKm > 0) || !b.headline || !Array.isArray(b.rows) || b.rows.length === 0) bad.push(b.id + ": record")
    if (Tx.words(b.headline) > L.headlineWords) bad.push(b.id + ": headline too long")
    if (b.parent && !A.byId(b.parent)) bad.push(b.id + ": parent")
    const c = ctx(b)
    for (const r of b.rows) {
      rows++
      const label = A.labelOf(r, c, null), fact = A.factOf(r, c, null)
      if (!r.id || !r.name || !fact || !r.source) bad.push(b.id + "." + r.id + ": name, fact or source missing")
      if (A.KINDS.indexOf(r.kind) < 0) bad.push(b.id + "." + r.id + ": kind " + r.kind)
      if (A.TAGS.indexOf(r.tag) < 0) bad.push(b.id + "." + r.id + ": tag " + r.tag)
      if ((r.tag === "mathematics") !== !!r.math) bad.push(b.id + "." + r.id + ": the mathematics tag and the K flag disagree")
      if (r.name.length > L.name) bad.push(b.id + "." + r.id + ": name too long")
      if (!label || label.length > L.label) bad.push(b.id + "." + r.id + ": label '" + label + "'")
      if (Tx.words(fact) > L.factWords) bad.push(b.id + "." + r.id + ": fact too long")
      // read in the story band, title and all, well inside the longest any caption stands
      if (Tx.read(Tx.words(r.name + " " + fact)) > 10) bad.push(b.id + "." + r.id + ": reading time")
      if (/\bN times\b/.test(fact)) bad.push(b.id + "." + r.id + ": a placeholder in the fact")
      tags[r.tag]++
      if (!r.shape) waiting++
    }
  }
  check("every body has rows; every row a name, a kind, a tag, a label, a fact and a source; words within the limits", bad.length === 0, bad.slice(0, 6).join("; "))
  check("the three tags are all in use", tags.measured > 60 && tags.model > 20 && tags.mathematics === 3 * 1, JSON.stringify(tags) + ", " + rows + " rows, " + waiting + " words only")
  check("a caption's reading time has a ceiling", Tx.read(1000) === Tx.HOLD_MAX_S)
  check("row ids are unique within a body", recs.every(b => new Set(b.rows.map(r => r.id)).size === b.rows.length))
  check("a fold names a row of the same body", recs.every(b => b.rows.every(r => !r.fold || b.rows.some(q => q.id === r.fold))))
}

// ---- 2. every subject of the views has a record ----
{
  const sys = [0, 1, 2, 3, 4, 5, 6, 7].map(i => A.bySys(i))
  check("the Sun, the six planets and the Moon", sys.every(r => !!r), sys.map(r => r && r.id).join(" "))
  check("the Milky Way is the Galaxy view's own, and Sky mode's; it has the Local Group above it", A.byAt("centre").id === "milkyWay" && A.byAt("centre").sky === true && A.chain(A.byAt("centre")).map(r => r.id).join(">") === "milkyWay>localGroup")
  check("the Sun as a place: the Sun's record, then its Galaxy", A.chain(A.byAt("sun")).map(r => r.id).join(">") === "sun>milkyWay>localGroup")
  check("a dwarf galaxy has the dwarfs' record, Segue 1 its own", A.byPlace("Draco", true).id === "dwarf" && A.byPlace("Segue (I)", true).id === "segue1" && A.byPlace("Nowhere", false) === null)
  if (process.argv[3]) {
    const q = fs.readFileSync(process.argv[3], "utf8")
    const m = q.match(/readonly property var hotspots: (\[[\s\S]*?\}\])\n/)
    const hs = JSON.parse(m[1])
    const none = hs.filter(h => !A.byPlace(h.name, false)).map(h => h.name)
    check("every place of the Milky Way view has a record (" + hs.length + " places)", none.length === 0, none.join(", "))
    check("the hole's record is the black hole's place", A.byPlace(hs.find(h => h.kind === "blackhole").name, false).id === "sgrA")
  }
}

// ---- 3. the hole's numbers are lib/kerr.js's, at the live spin ----
{
  const rec = A.byId("sgrA"), c = ctx(rec), row = id => rec.rows.find(r => r.id === id), h = Kerr.horizons(SPIN)
  const lab = id => A.labelOf(row(id), c, null)
  check("event horizon: " + lab("horizon"), lab("horizon") === h.rPlus.toFixed(2) + " Rs" && lab("horizon") === "0.67 Rs")
  check("inner horizon: " + lab("innerHorizon"), lab("innerHorizon") === "0.33 Rs")
  check("photon shell: " + lab("photonShell"), lab("photonShell") === "0.71 to 1.97 Rs")
  check("inner edge of the gas: " + lab("isco"), lab("isco") === "1.01 Rs, 8.2 min orbit")
  check("spin axis: " + lab("spinAxis"), lab("spinAxis") === "one turn in 6.1 min")
  check("ring: " + lab("ring"), lab("ring") === "0.47 Rs")
  check("the unit is lib/fall.js's Schwarzschild radius (4.15 million Suns: Rs/c = 40.88 s)", Math.abs(c.unitS - 40.88) < 0.01, c.unitS.toFixed(3))
  check("a spin of 0.5 changes every one of them", A.labelOf(row("horizon"), Object.assign({}, c, { a: 0.25 }), null) === "0.93 Rs")
  // the drawing's own measurements, from the side at 20 Rs: the D
  const f = frame(20, 0.4, 0.35), hv = A.holeView(frame(20, 0.4, 0), c, true)
  check("from the side at 20 Rs the drawing measures the D as the sources have it: 1.32, 3.45, 4.77 wide, 1.06 off centre", Math.abs(hv.g.near - 1.3208) < 0.005 && Math.abs(hv.g.far - 3.4498) < 0.005 && Math.abs(hv.g.width - 4.7706) < 0.005 && Math.abs(hv.g.offset - 1.0645) < 0.005, JSON.stringify(Object.keys(hv.g).map(k => k + " " + hv.g[k].toFixed(2))))
  check("the bright side is several times brighter than the far side", hv.g.bright > 3 && hv.g.bright < 1000, hv.g.bright.toFixed(1))
  const out = A.compose(rec, f, c, env({ obstacles: [] }))
  const ids = out.rows.map(r => r.id)
  check("at 20 Rs: the shadow, both edges, the horizon, the ergosphere, the photon shell, the gas's edge and its two sides", ["shadow", "flatEdge", "roundEdge", "horizon", "ergosphere", "photonShell", "isco", "brightSide", "dimSide", "noSpin", "offset", "spinAxis", "ehtRing"].every(i => ids.indexOf(i) >= 0), ids.join(" "))
  const bright = out.rows.find(r => r.id === "brightSide")
  check("the bright side's label and fact carry the live figure", /^\d+ times brighter$/.test(bright.num) && /: \d+ times brighter than the far side\.$/.test(A.factOf(row("brightSide"), c, out.g)), bright.num)
  check("the shadow's label is what was measured", out.rows.find(r => r.id === "shadow").num === out.g.width.toFixed(2) + " Rs wide")
  // the flat edge and the bright side are on the same side of the hole's centre
  const mid = out.rows.find(r => r.id === "offset").at, fe = out.rows.find(r => r.id === "flatEdge").at, re = out.rows.find(r => r.id === "roundEdge").at
  check("the flat edge and the bright side lie on the same side", (fe[0] - mid[0]) * (bright.at[0] - mid[0]) + (fe[1] - mid[1]) * (bright.at[1] - mid[1]) > 0 && (re[0] - mid[0]) * (bright.at[0] - mid[0]) + (re[1] - mid[1]) * (bright.at[1] - mid[1]) < 0)
  // from the pole: round, no edges and no sides to name
  const pole = A.compose(rec, frame(20, 0, Math.PI / 2 - 1e-4), c, env({ obstacles: [] })).rows.map(r => r.id)
  check("from the pole the shadow is round: no flat edge, no brighter side", pole.indexOf("shadow") >= 0 && pole.indexOf("flatEdge") < 0 && pole.indexOf("brightSide") < 0, pole.join(" "))
  // K
  const math = ["innerHorizon", "ring", "farSheet"]
  check("mathematics rows are not drawn without K", math.every(i => ids.indexOf(i) < 0))
  const outK = A.compose(rec, frame(8, 0.4, 0.5), c, env({ obstacles: [], math: true }))
  const idsK = outK.rows.map(r => r.id).concat(...outK.rows.map(r => r.folded))
  check("with K they are, dotted (the far sheet folded into the ring it lies in)", math.every(i => idsK.indexOf(i) >= 0) && outK.rows.find(r => r.id === "ring").folded.indexOf("farSheet") >= 0 && /FAR SHEET through the ring/.test(outK.rows.find(r => r.id === "ring").num), idsK.join(" "))
  check("K gates by the tag for every body", A.records().every(b => b.rows.every(r => A.drawn(r, false) === (!!r.shape && r.tag !== "mathematics") && A.drawn(r, true) === !!r.shape)))
  // far out the hole's own rows wait and the star S2's pass shows
  const far = A.compose(rec, frame(4000, 0.4, 0.3), c, env({ obstacles: [] })).rows.map(r => r.id)
  check("from 4,000 Rs: the star S2's closest pass, not the shadow", far.join(" ") === "s2", far.join(" "))
}

// ---- 4. shapes ----
{
  // a sphere's outline is a circle on the sky from every angle: every point of it at asin(R / d) from the centre
  let worst = 0, n = 0
  const sph = { id: "t", name: "T", kind: "surface", tag: "measured", shape: { s: "ell", a: 1, c: 1 }, label: "1", fact: "x", source: "y" }
  for (const [yaw, pitch, view, o] of [[0, 0, 6, [0, 0]], [1, 0.7, 4, [0.2, -0.1]], [2.5, -1.2, 9, [-0.5, 0.2]], [4, Math.PI / 2, 5, [0, 0]], [5.5, 0.01, 12, [0.3, 0.3]]]) {
    const f = frame(view, yaw, pitch, { o: o }), e = env({ obstacles: [], safe: { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 } })
    const geo = A.rowGeometry(sph, f, {}, e), d = view
    for (const p of geo.curves[0].pts) {
      // back to a direction from the eye
      const x = (p[0] - e.W / 2) / e.H - f.cam.o[0], y = p[1] / e.H - 0.5 - f.cam.o[1]
      const v = [0, 1, 2].map(i => f.cam.fwd[i] + x * f.cam.right[i] - y * f.cam.up[i]), vl = Math.hypot(...v)
      const ang = Math.acos(-(v[0] * f.cam.C[0] + v[1] * f.cam.C[1] + v[2] * f.cam.C[2]) / (vl * d))
      worst = Math.max(worst, Math.abs(ang / Math.asin(1 / d) - 1)); n++
    }
    if (geo.curves.length !== 1) worst = 1   // and no equator: a sphere has no flattening to show
  }
  check("a sphere's outline is a circle from every angle (" + n + " points)", worst < 1e-9, (worst * 100).toExponential(1) + "% off at worst")
  // a flattened surface shows its equator, and from the side its outline is as flat as it is
  const obl = { id: "t", name: "T", kind: "surface", tag: "measured", shape: { s: "ell", a: 60268, c: 54364 }, label: "1", fact: "x", source: "y" }
  const fs_ = frame(60268 * 3, 0, 0, { focal: 100 }), es = env({ obstacles: [] })
  const geo = A.rowGeometry(obl, fs_, {}, es), xs = geo.curves[0].pts.map(p => p[0]), ys = geo.curves[0].pts.map(p => p[1])
  const ratio = (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))
  check("Saturn's outline from the side is 9.8% flattened, with its equator drawn", geo.curves.length === 2 && Math.abs(ratio - 54364 / 60268) < 0.004, ratio.toFixed(4))
  // any other surface of revolution goes by the hull of its points: a sphere given as a profile is the same circle to 1%
  const prof = { id: "t", name: "T", kind: "surface", tag: "model", shape: { s: "profile", f: (c, t) => [Math.sin(t), Math.cos(t)] }, label: "1", fact: "x", source: "y" }
  const fp = frame(5, 1, 0.7), gp = A.rowGeometry(prof, fp, {}, es), ge = A.rowGeometry(sph, fp, {}, es)
  check("a profile's outline (the hull of its points) agrees with the exact one", Math.abs(gp.size / ge.size - 1) < 0.01 && A.rowGeometry(A.byId("sgrA").rows.find(r => r.id === "ergosphere"), frame(8, 1, 0.2), ctx(A.byId("sgrA")), es).curves.length === 2, (gp.size / ge.size).toFixed(4))
  // the eye inside a surface: nothing (it has no outline from there)
  check("no outline from inside a surface", A.rowGeometry(sph, frame(0.5, 0, 0), {}, env()) === null)
  // a day-side shield: an open arc on the Sun's side only
  const shield = { id: "t", name: "T", kind: "surface", tag: "measured", shape: { s: "ell", a: 1, c: 1, toward: "sun" }, label: "1", fact: "x", source: "y" }
  const f2 = frame(6, 0, 0.3, { sunDir: [0, 1, 0] }), g2 = A.rowGeometry(shield, f2, {}, env({ obstacles: [] }))
  const sunSide = A.project(f2.cam, [0, 1, 0], env())[0] > lay.W / 2 ? 1 : -1   // (the frame's basis here is the world's)
  check("a day-side shield is an open arc on the Sun's side", !g2.curves[0].closed && g2.curves[0].pts.every(p => (p[0] - lay.W / 2) * sunSide > -3), g2.curves[0].pts.length + " points")
  check("and waits where the view has no Sun direction", A.rowGeometry(shield, frame(6, 0, 0.3, { sunDir: null }), {}, env()) === null)
  // the hull
  const h = A.hull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1], [1, 0.5]])
  check("the hull keeps the corners and drops what is inside", h.length === 4)
  // dashes
  const ln = []; for (let i = 0; i <= 100; i++) ln.push([i * 3, 0])
  const dm = A.dash(ln, A.DASH.model), dd = A.dash(ln, A.DASH.mathematics)
  check("measured is a solid line, a model dashed, mathematics dotted", A.dash(ln, A.DASH.measured).length === 1 && dm.length === 25 && dm.every(s => Math.abs(s[s.length - 1][0] - s[0][0] - 7) < 1e-6) && dd.length === 50 && dd.every(s => Math.abs(s[s.length - 1][0] - s[0][0] - 1.5) < 1e-6), dm.length + " dashes, " + dd.length + " dots in 300 px")
}

// ---- 5. the rules, on Earth at three zooms ----
{
  const rec = A.byId("earth"), c = ctx(rec), e = env({ obstacles: [] })
  const at = view => { const o = A.compose(rec, frame(view, 0.6, 0.35, { focal: 23.8 }), c, e); return o ? o.rows : [] }
  // far: Earth 20 px across: only the surroundings are big enough (the belts and the shield)
  const far = at(6371 * 2 * lay.H / 20).map(r => r.id)
  check("Earth 20 px across: the belts and the shield, nothing inside", far.join(" ") === "magnetopause outerBelt innerBelt", far.join(" "))
  // middle: Earth 500 px across: the cores and the mantle; the crust is under 3 px from the mantle and joins its label
  const mid = at(6371 * 2 * lay.H / 500)
  const mantle = mid.find(r => r.id === "mantle")
  check("Earth 500 px across: inner core, outer core, mantle, inner belt; the crust folded into the mantle's label",
        mid.map(r => r.id).join(" ") === "innerBelt mantle outerCore innerCore" && mantle.folded.join() === "crust" && mantle.num === "2,900 km thick  ·  CRUST AND OCEAN 30 km on land, 5 at sea", mid.map(r => r.id).join(" ") + " | " + (mantle ? mantle.num : ""))
  // close: Earth 1,500 px across: the crust has its own line
  const close = at(6371 * 2 * lay.H / 1500).map(r => r.id)
  check("Earth 1,500 px across: the crust has its own line", close.join(" ") === "crust mantle outerCore innerCore", close.join(" "))
  // too close: Earth wider than 1.5 screens waits; too far: nothing, and the chain has no parent here
  check("nothing of a body 1 px across", at(6371 * 2 * lay.H / 1).length === 0)
  // scale: in the squeezed overview only what is inside the body is drawn
  const sq = A.compose(rec, frame(6371 * 2 * lay.H / 20, 0.6, 0.35, { oneScale: false, focal: 23.8 }), c, e)
  check("where sizes are exaggerated, nothing outside the body is drawn", sq === null)
  const sq2 = A.compose(rec, frame(6371 * 2 * lay.H / 500, 0.6, 0.35, { oneScale: false, focal: 23.8 }), c, e).rows.map(r => r.id)
  check("and what is inside still is", sq2.join(" ") === "mantle outerCore innerCore", sq2.join(" "))
  // the chain: the Sun as a place seen from across the Galaxy: its Galaxy's rows
  const sun = A.byAt("sun")
  const frameOf = view => r => ({ frame: frame(view * (r.id === "sun" ? 1 : r.id === "milkyWay" ? 1 / 5e-11 : 1e30), 0.6, 0.9, { axis: [0, 0, 1] }) })
  // (a frame per record: the same eye, each record in its own unit; here only the Sun's and the Galaxy's zoom are set)
  const near = A.composeChain(sun, r => r.id === "sun" ? { frame: frame(8, 0.6, 0.3) } : null, ctx(sun), e)
  check("beside the Sun: the Sun's rows", near.id === "sun" && near.rows.map(r => r.id).join(" ") === "photosphere tachocline core", near.rows.map(r => r.id).join(" "))
  const out = A.composeChain(sun, r => r.id === "sun" ? { frame: frame(1e9, 0.6, 0.9) } : r.id === "milkyWay" ? { frame: frame(34, 0.6, 0.9) } : null, ctx(sun), e)
  check("from 34 kpc: none of the Sun's rows suits, the Milky Way's do", out.id === "milkyWay" && out.rows.some(r => r.id === "fermi") && out.rows.some(r => r.id === "sunOrbit") && out.rows.some(r => r.id === "bar"), out.rows.map(r => r.id).join(" "))
  check("and from nowhere at all, nothing", A.composeChain(sun, r => null, ctx(sun), e) === null)
}

// ---- 6. every row that has a place can be drawn at some zoom, in its room ----
// on the three screens: the 1920x1080 above, the box (5120x2160) and the laptop (1728x1117 under its notch)
const SCREENS = [["1920x1080", lay, disc, rail]].concat([["the box, 5120x2160", Lay.plan(5120, 2160, [0, 43, 0, 0], 0)], ["the laptop, 1728x1117 with its notch", Lay.plan(1728, 1117, [0, 32, 0, 0], 32)]]
  .map(([n, l]) => [n, l, Lay.hudDisc(l, [0.03, -0.02]), Lay.railRect(l, 0.3 * l.H)]))
for (const [screen, lay, disc, rail] of SCREENS) {
  const e = { W: lay.W, H: lay.H, safe: lay.safe, obstacles: [rail, disc], tok: lay.tok, sides: {}, math: true, lit: "", textW: (t, small) => Lay.textW(t.length, small ? lay.tok.micro : lay.tok.label, 0.11) }
  const never = [], outside = [], stacked = [], many = []
  let nRows = 0, nSegs = 0, nLabels = 0
  for (const rec of A.records()) {
    const c = ctx(rec), seen = {}
    for (let lg = -3; lg <= 9.01; lg += 0.25) for (const pose of [[0.6, 0.35], [2.2, -0.2]]) {
      const out = A.compose(rec, frame(Math.pow(10, lg), pose[0], pose[1], { o: [0.25, 0.05] }), c, e)
      if (!out) continue
      const shown = out.rows.filter(r => r.lab.show)
      if (shown.length > A.MAX_LABELS) many.push(rec.id)
      for (const r of out.rows) {
        seen[r.id] = true; r.folded.forEach(f => seen[f] = true)
        for (const s of r.segs) { nSegs++; for (const p of s) if (!A.allowed(p[0], p[1], { x0: e.safe.x0 - 0.01, y0: e.safe.y0 - 0.01, x1: e.safe.x1 + 0.01, y1: e.safe.y1 + 0.01 }, [{ cx: disc.cx, cy: disc.cy, r: disc.r - 1.5 }, { x: rail.x + 1.5, y: rail.y + 1.5, w: rail.w - 3, h: rail.h - 3 }])) outside.push(rec.id + "." + r.id) }
        if (!r.lab.show) continue
        nLabels++
        if (!Lay.inSafe(r.lab, e.safe) || Lay.hits(r.lab, disc) || Lay.hits(r.lab, rail)) outside.push(rec.id + "." + r.id + " (label)")
        for (const q of shown) if (q !== r && Lay.intersects(q.lab, r.lab)) stacked.push(rec.id + "." + r.id)
      }
    }
    for (const r of rec.rows) { if (r.shape) { nRows++; if (!seen[r.id]) never.push(rec.id + "." + r.id) } }
  }
  check(screen + ": every row with a place is drawn at some zoom (" + nRows + " rows)", never.length === 0, never.join(", "))
  check(screen + ": every line stays inside the safe rect and out of the HUD's disc and the rail (" + nSegs + " strokes)", outside.filter(s => !/label/.test(s)).length === 0, [...new Set(outside)].slice(0, 5).join(", "))
  check(screen + ": every label stays inside the safe rect, out of the disc and the rail, and off every other label (" + nLabels + " labels)", outside.filter(s => /label/.test(s)).length === 0 && stacked.length === 0, [...new Set(outside.concat(stacked))].slice(0, 5).join(", "))
  check(screen + ": never more than six labels at once", many.length === 0, [...new Set(many)].join(" "))
}

// ---- 6b. what takes long waits for the camera to rest; a frame's key; the frame of its own ----
{
  const rec = A.byId("sgrA"), c = ctx(rec), f = frame(17, 1.1, 0.3)
  A.holeView(f, Object.assign({}, c, { a: 0.2 }), false)   // another hole: nothing remembered
  const moving = A.compose(rec, f, c, env({ obstacles: [], still: false }))
  check("while the camera moves the bright side has no figure yet", moving.rows.find(r => r.id === "brightSide").num === "the brighter side" && moving.g.bright === 0)
  const rest = A.compose(rec, f, c, env({ obstacles: [], still: true }))
  check("at rest it has", /times brighter/.test(rest.rows.find(r => r.id === "brightSide").num), rest.rows.find(r => r.id === "brightSide").num)
  const f2 = frame(17.2, 1.12, 0.3), glide = A.compose(rec, f2, c, env({ obstacles: [], still: false }))
  check("and keeps the last one while it glides on", glide.g.bright === rest.g.bright)
  // between two workings-out the last shape serves, scaled with the distance: the width it measures barely moves
  check("while it glides the last shape serves, scaled with the distance", Math.abs(glide.g.width - rest.g.width) < 0.02 && Math.abs(glide.rows.find(r => r.id === "shadow").size / rest.rows.find(r => r.id === "shadow").size - 17 / 17.2) < 0.01, glide.g.width.toFixed(3) + " " + rest.g.width.toFixed(3))
  check("a frame's key: the same for the same view, another for another", A.frameKey(rec, f, c) === A.frameKey(rec, frame(17, 1.1, 0.3), c) && A.frameKey(rec, f, c) !== A.frameKey(rec, f2, c) && A.frameKey(rec, f, c) !== A.frameKey(rec, f, Object.assign({}, c, { a: 0.2 })))
  const fd = frame(1, 0, 0); fd.cam = A.demoCam(fd, 12)
  const demo = A.compose(rec, fd, c, env({ obstacles: [] }))
  check("a frame of its own: the body in the middle of the screen, 12 units to the screen's height", !!demo && Math.abs(A.project(fd.cam, [0, 0, 0], env())[0] - lay.W / 2) < 1e-6 && Math.abs(Math.hypot(...fd.cam.C) - 12) < 1e-9, demo.rows.map(r => r.id).join(" "))
}

// ---- 7. clipping, the row being told, pointing ----
{
  // a circle through the disc: cut at its rim, to the pixel
  const c0 = []; for (let i = 0; i < 64; i++) c0.push([disc.cx + disc.r * Math.cos(i / 64 * 2 * Math.PI), disc.cy + disc.r * 0.2 + disc.r * Math.sin(i / 64 * 2 * Math.PI)])
  const parts = A.clip(c0, true, lay.safe, [disc])
  const ends = parts.map(p => [p[0], p[p.length - 1]]).flat().map(p => Math.hypot(p[0] - disc.cx, p[1] - disc.cy) - disc.r)
  check("a line is cut where it meets the disc, to the pixel", parts.length === 1 && ends.every(d => d >= 0 && d < 0.5), ends.map(d => d.toFixed(2)).join(" "))
  check("a closed line nothing touches stays whole and closed", (() => { const p = A.clip([[700, 300], [800, 300], [800, 400]], true, lay.safe, []); return p.length === 1 && p[0].length === 4 && p[0][3][0] === 700 })())
  check("a line outside the safe rect is gone", A.clip([[-50, -50], [-10, -20]], false, lay.safe, []).length === 0)
  // the row being told always has its label, beyond the six
  const rec = A.byId("sgrA"), c = ctx(rec), f = frame(20, 0.4, 0)
  const plain = A.compose(rec, f, c, env({ obstacles: [] }))
  const last = plain.rows[plain.rows.length - 1]
  check("six labels, the largest rows that find room", plain.rows.filter(r => r.lab.show).length === 6 && plain.rows[0].lab.show && plain.rows.every((r, i) => i === 0 || r.size <= plain.rows[i - 1].size), plain.rows.filter(r => r.lab.show).map(r => r.id).join(" "))
  const told = A.compose(rec, f, c, env({ obstacles: [], lit: last.id }))
  check("the row being told has its label too", told.rows.find(r => r.id === last.id).lab.show, last.id)
  // pointing at a line
  const sh = plain.rows.find(r => r.id === "shadow"), p = sh.segs[0][0]
  check("pointing at a line finds its row; pointing at nothing finds none", A.hit(plain, p[0] + 1, p[1] + 1, 6) !== "" && A.hit(plain, 3, 3, 6) === "" && A.hit(null, 0, 0, 6) === "")
  check("the words on screen, for the idle clock", Tx.words(A.wordsOf(plain)) > 6 && A.wordsOf(null) === "")
}

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
