// checks for the anatomy layer (run with node):
//   node tests/test_anatomy.js lib/anatomy.js [Background.qml]
// The table (every body has rows, every row a tag, words that fit and a
// source), the hole's rows against lib/kerr.js, the shapes (a sphere's
// outline is a circle from every angle), the rules (size, chain, scale,
// fold, the six labels, mathematics rows with K only), the room (lines and
// labels inside the safe rect, out of the HUD's disc and the rail), where a
// body is drawn (on itself from 18% of the screen's height, else in the
// lens, with the labels' column beside either) and what a pass depends on
// (a view that moved by less than a pixel draws the same).
// With Background.qml given: every place of the views has a record.
const fs = require("fs"), path = require("path")
const dir = path.dirname(process.argv[2])
const read = f => fs.readFileSync(path.join(dir, f), "utf8").replace(".pragma library", "").replace(/^\.import .*$/mg, "")
const Kerr = new Function(read("kerr.js") + "\nreturn { M, horizons, photonOrbit, polarPhotonOrbit, isco, horizonOmega, gasOmega, ksPoint, ergoRadius, shadowOutline, shadowBasis, shadowClass, impactAt, gasLight }")()
const Lay = new Function(read("layout.js") + "\nreturn { plan, placeLabels, labelBoxAt, hudDisc, hudExtent, hudAt, railRect, storyRect, textW, intersects, hits, inSafe }")()
const Tx = new Function(read("text.js") + "\nreturn { words, read, hold, HOLD_MAX_S }")()
const Data = new Function("Kerr", read("anatomy-data.js") + "\nreturn { BODIES, LIMITS }")(Kerr)
const A = new Function("Kerr", "Lay", "Data", fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "").replace(/^\.import .*$/mg, "")
  + "\nreturn { MIN_PX, MAX_SCREENS, FOLD_PX, MAX_LABELS, TAGS, KINDS, DASH, records, limits, byId, bySys, byPlace, byAt, chain, labelOf, factOf, drawn, basisOf, project, hull, outline, clip, allowed, compose, callouts, hit, wordsOf, rowGeometry, holeView, probe, probeMoved, reachOf, stageSpan, onStage, choose, lensPower, LENS_POWER, lensSpan, lensFrame, lensEnv, draw, STAGE_ON, STAGE_OFF, LENS_IN }")(Kerr, Lay, Data)
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }

const SPIN = 0.94 * Kerr.M, RS_KM = A.byId("sgrA").unitKm
const ctx = rec => ({ a: SPIN, rsKpc: 4.11e-10, unitS: rec.unitKm / 299792.458, place: { rh: 29, ell: 0.48, pa: 85 }, t: 0 })
// a screen and its room: the laptop-like 1920x1080 with the cockpit up and a rail standing
const lay = Lay.plan(1920, 1080, [0, 26, 0, 0], 0)
const disc = Lay.hudDisc(lay, [0.03, -0.02]), rail = Lay.railRect(lay, 320)
function tokOf(l) { return { name: l.tok.anat, num: l.tok.anatNum, gap: l.tok.gap, row: l.tok.row } }
function env(o) {
  return Object.assign({ W: lay.W, H: lay.H, safe: lay.safe, obstacles: [rail, disc], avoid: [], tok: tokOf(lay), math: false, lit: "",
                         textW: (t, small) => Lay.textW(t.length, small ? lay.tok.anatNum : lay.tok.anat, 0.11) }, o || {})
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
    // the picture's rings (universe.frag's ringPattern, in globe radii) against the table's, in km
    const rp = fs.readFileSync(path.join(path.dirname(process.argv[3]), "universe.frag"), "utf8").match(/float ringPattern[\s\S]*?smoothstep\(([\d.]+), ([\d.]+), re\)\)\s*\* \(1\.0 - 0\.85 \* smoothstep\(([\d.]+), ([\d.]+), re\) \* \(1\.0 - smoothstep\(([\d.]+), ([\d.]+), re\)/).slice(1).map(Number)
    const sat = A.byId("saturn"), km = (id, k) => sat.rows.find(r => r.id === id).shape[k] / sat.radius
    check("Saturn as drawn: the Cassini Division and the A ring's edge lie where the table's lines do", Math.abs((rp[2] + rp[3]) / 2 - km("cassini", "r0")) < 0.005 && Math.abs((rp[4] + rp[5]) / 2 - km("cassini", "r1")) < 0.005 && Math.abs((rp[0] + rp[1]) / 2 - km("ringA", "r1")) < 0.012,
          [(rp[2] + rp[3]) / 2, km("cassini", "r0"), (rp[4] + rp[5]) / 2, km("cassini", "r1"), (rp[0] + rp[1]) / 2, km("ringA", "r1")].map(v => v.toFixed(3)).join(" "))
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
  // dashes: the pass hands whole lines over, each with its tag's pattern for the renderer to cut
  const hl = A.compose(A.byId("sgrA"), frame(20, 0.4, 0), ctx(A.byId("sgrA")), env({ obstacles: [], math: true }))
  check("measured is a solid line, a model dashed, mathematics dotted: the pattern rides the row, the line stays whole",
        hl.rows.every(r => r.dash === A.DASH[r.tag]) && A.DASH.measured === null && A.DASH.model.join() === "7,5" && A.DASH.mathematics.join() === "1.5,4.5" && hl.rows.find(r => r.id === "noSpin").segs.length === 1,
        hl.rows.reduce((n, r) => n + r.segs.length + r.marks.length, 0) + " strokes for " + hl.rows.length + " rows")
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
  const pick = of => { const sel = A.choose(sun, of, e, null); return sel ? A.draw(sel, of, e, A.lensEnv(e, 400, null)) : null }
  const near = pick(r => r.id === "sun" ? { frame: frame(8, 0.6, 0.3), c: ctx(sun) } : null)
  check("beside the Sun: the Sun's rows", near.id === "sun" && !near.lens && near.rows.map(r => r.id).join(" ") === "photosphere tachocline core", near.rows.map(r => r.id).join(" "))
  const out = pick(r => r.id === "sun" ? { frame: frame(1e9, 0.6, 0.9), c: ctx(sun) } : r.id === "milkyWay" ? { frame: frame(34, 0.6, 0.9), c: ctx(sun) } : null)
  check("from 34 kpc: none of the Sun's rows suits, the Milky Way's do", out.id === "milkyWay" && !out.lens && out.rows.some(r => r.id === "fermi") && out.rows.some(r => r.id === "sunOrbit") && out.rows.some(r => r.id === "bar"), out.rows.map(r => r.id).join(" "))
  check("and from nowhere at all, nothing", A.choose(sun, r => null, e, null) === null)
}

// ---- 6. every row that has a place can be drawn at some zoom, in its room ----
// on the three screens: the 1920x1080 above, the box (5120x2160) and the laptop (1728x1117 under its notch)
const SCREENS = [["1920x1080", lay, disc, rail]].concat([["the box, 5120x2160", Lay.plan(5120, 2160, [0, 43, 0, 0], 0)], ["the laptop, 1728x1117 with its notch", Lay.plan(1728, 1117, [0, 32, 0, 0], 32)]]
  .map(([n, l]) => [n, l, Lay.hudDisc(l, [0.03, -0.02]), Lay.railRect(l, 0.3 * l.H)]))
for (const [screen, lay, disc, rail] of SCREENS) {
  const e = { W: lay.W, H: lay.H, safe: lay.safe, obstacles: [rail, disc], avoid: [Lay.hudExtent(lay)], tok: tokOf(lay), math: true, lit: "", textW: (t, small) => Lay.textW(t.length, small ? lay.tok.anatNum : lay.tok.anat, 0.11) }
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
        if (!r.lead || r.lab.h < 12 * 1.5 || lay.tok.anatNum < 12) stacked.push(rec.id + "." + r.id + " (leader or size)")
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
  // the probe: what a pass depends on, in pixels
  const E = env(), p0 = A.probe(f, c, E)
  const creep = frame(17 * (1 + 2e-4), 1.1, 0.3), turn = frame(17, 1.1 + 2 / lay.H, 0.3), zoom = frame(17 * 1.004, 1.1, 0.3)
  check("the same view probes the same; a camera creeping in by a fifth of a pixel is not a move", !A.probeMoved(p0, A.probe(frame(17, 1.1, 0.3), c, E), 0.75) && !A.probeMoved(p0, A.probe(creep, c, E), 0.75))
  check("a turn of two pixels is a move, and so is a zoom of two", A.probeMoved(p0, A.probe(turn, c, E), 0.75) && A.probeMoved(p0, A.probe(zoom, c, E), 0.75) && A.probeMoved(null, p0, 0.75))
  // a view the probe calls the same draws the same lines, to the pixel
  let worst = 0
  { const a = A.compose(rec, f, c, env({ obstacles: [] })), b = A.compose(rec, creep, c, env({ obstacles: [] }))
    a.rows.forEach((r, i) => r.segs.forEach((s, j) => s.forEach((q, k) => { const w = b.rows[i].segs[j][k]; worst = Math.max(worst, Math.hypot(q[0] - w[0], q[1] - w[1])) }))) }
  check("and a view within the probe's pixel draws its lines within a pixel", worst < 1, worst.toFixed(2) + " px")
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
  const lab = plain.rows.filter(r => r.lab.show)
  check("six labels, the largest rows", lab.length === 6 && plain.rows.slice(0, 6).every(r => r.lab.show) && plain.rows.every((r, i) => i === 0 || r.size <= plain.rows[i - 1].size), lab.map(r => r.id).join(" "))
  // the column: beside the drawing, outside it, one row a label, each with a leader from its own line
  const all = plain.rows.flatMap(r => r.seen), x1 = Math.max(...all.map(q => q[0]))
  check("the labels stand in one column outside the drawing, none on another, each led from its own line",
        lab.every(r => r.lab.side === lab[0].lab.side && r.lab.x > x1 && r.lead && (r.at ? r.lead[0][0] === r.at[0] : r.seen.some(q => q[0] === r.lead[0][0] && q[1] === r.lead[0][1])))
        && lab.every(r => lab.every(q => q === r || !Lay.intersects(q.lab, r.lab))), "x " + lab.map(r => Math.round(r.lab.x)).join(" ") + ", drawing to " + Math.round(x1))
  const ys = lab.slice().sort((a, b) => a.lab.y - b.lab.y)
  check("in the order of their anchors, so leaders do not cross", ys.every((r, i) => i === 0 || r.lead[0][1] >= ys[i - 1].lead[0][1]))
  const told = A.compose(rec, f, c, env({ obstacles: [], lit: last.id }))
  check("the row being told has its label too", told.rows.find(r => r.id === last.id).lab.show, last.id)
  // pointing at a line
  const sh = plain.rows.find(r => r.id === "shadow"), p = sh.segs[0][0]
  check("pointing at a line finds its row; pointing at nothing finds none", A.hit(plain, p[0] + 1, p[1] + 1, 6) !== "" && A.hit(plain, 3, 3, 6) === "" && A.hit(null, 0, 0, 6) === "")
  check("the words on screen, for the idle clock", Tx.words(A.wordsOf(plain)) > 6 && A.wordsOf(null) === "")
}

// ---- 8. where a body is drawn: on itself, or in the lens ----
{
  const big = Lay.plan(5120, 2160, [0, 43, 0, 0], 0)
  const e = { W: big.W, H: big.H, lensD: 2 * 0.232 * big.hud.s * big.H, safe: big.safe, obstacles: [], avoid: [Lay.hudExtent(big)], tok: tokOf(big), math: false, lit: "", textW: (t, small) => Lay.textW(t.length, small ? big.tok.anatNum : big.tok.anat, 0.11) }
  check("the stage from 18% of the screen's height, kept down to 15%", A.onStage(0.18 * 2160, 2160, false) && !A.onStage(0.17 * 2160, 2160, false) && A.onStage(0.16 * 2160, 2160, true) && !A.onStage(0.14 * 2160, 2160, true))
  // the estimate the choice reads is the size the drawing has, wherever the choice is made (from 8% to 40% of the height)
  const off = []
  let nEst = 0
  for (const rec of A.records()) for (let lg = 0; lg <= 5; lg += 0.1) {
    if (rec.axis === "sight" || rec.rows.some(r => r.shape && r.shape.s === "seg")) continue   // (their frames here are not the view's: an ellipse on the sky seen askew, a bridge to a made-up place)
    const c = ctx(rec), R = typeof rec.radius === "function" ? rec.radius(c) : rec.radius, f = frame(R * Math.pow(10, lg), 0.6, 0.35)
    const est = A.stageSpan(rec, f, c, e)
    if (est < 0.08 * e.H || est > 0.4 * e.H) continue
    const o = A.compose(rec, f, c, e), got = o ? Math.max(...o.rows.map(r => r.size)) : 0
    if (got > 1.2 * e.H) continue   // (a row at the edge of the size rule, 1.5 screens: the estimate may drop it a step sooner)
    nEst++
    if (Math.abs(est - got) > 0.12 * Math.max(est, got, 1)) off.push(rec.id + "@" + lg.toFixed(1) + " " + Math.round(est) + "/" + Math.round(got))
  }
  check("the size the choice reads is the drawing's largest row, within 12% (" + nEst + " views)", off.length === 0, off.slice(0, 8).join(", "))
  // Earth: pinned small it goes to the lens, large it is drawn on itself; a held record takes the stage first
  const earth = A.byId("earth"), ce = ctx(earth)
  const at = (px, oneScale) => r => r.id === "earth" ? { frame: frame(6371 * 2 * big.H / px, 0.6, 0.35, { oneScale: oneScale }), c: ce } : null
  const small = A.choose(earth, at(120, false), e, null), large = A.choose(earth, at(700, false), e, null), mid = at(0.165 * 2160, false)
  check("Earth 120 px across in the squeezed overview: the lens; 700 px across: on the body", small.lens && small.id === "earth" && !large.lens && large.id === "earth", Math.round(small.span) + " px, " + Math.round(large.span) + " px")
  check("between 15% and 18% the choice stays what it was", A.choose(earth, mid, e, null).lens && !A.choose(earth, mid, e, { id: "earth", lens: false }).lens)
  const sun = A.byAt("sun"), home = r => r.id === "sun" ? { frame: frame(1e9, 0.6, 0.9), c: ctx(sun) } : r.id === "milkyWay" ? { frame: frame(34, 0.6, 0.9), c: ctx(sun) } : null
  check("the Sun from 34 kpc is beyond the lens: its Galaxy answers, on the stage", (s => !s.lens && s.id === "milkyWay")(A.choose(sun, home, e, null)) && A.lensPower(sun, frame(1e9, 0.6, 0.9), ctx(sun), e) > A.LENS_POWER)
  const star = lg => r => r.id === "sun" ? { frame: frame(Math.pow(10, lg), 0.6, 0.9), c: ctx(sun) } : r.id === "milkyWay" ? { frame: frame(Math.pow(10, lg) * 2.25e-11, 0.6, 0.9), c: ctx(sun) } : null
  check("a star from a hundredth of a parsec: the star itself, in the lens, though its Galaxy has a line on the screen", (s => s.lens && s.id === "sun")(A.choose(sun, star(5.6), e, null)), "x" + A.lensPower(sun, frame(Math.pow(10, 5.6), 0.6, 0.9), ctx(sun), e).toExponential(1))
  check("a drawing that came out empty stands aside: the next answer", (s => s && s.lens && s.id === "earth")(A.choose(earth, at(700, false), e, null, { "earth|S": true })) && A.choose(earth, at(700, false), e, null, { "earth|S": true, "earth|L": true }) === null)
  // the lens: the same eye through a telescope, the body in the middle, to scale, inside the rim
  const D = 2 * 0.232 * big.hud.s * big.H, h0 = Lay.hudAt(big, [0, 0]), to = [big.W / 2 - h0.cx + D / 2, big.H / 2 - h0.cy + D / 2]
  const bad = [], spans = []
  for (const rec of A.records()) {
    const c = ctx(rec)
    if (rec.id === "sgrDwarf") c.place = { rh: 2587, ell: 0.64, pa: 102 }
    const R = typeof rec.radius === "function" ? rec.radius(c) : rec.radius
    const f = frame(R * 300, 0.6, 0.35)
    f.resolve = spec => spec === "sun" || spec.place || spec.toPlace ? null : [0.3 * R, 0.2 * R, 0.1 * R]   // a place of its own inside the body
    const lf = A.lensFrame(rec, f, c, false), le = A.lensEnv(e, D, to)
    const o = A.compose(rec, lf, c, le), mid = A.project(lf.cam, f.C, le)
    if (lf.cam.C !== f.cam.C || Math.abs(mid[0] - D / 2) > 1e-6 || Math.abs(mid[1] - D / 2) > 1e-6) bad.push(rec.id + " (not the same eye, or the body is off the middle)")
    if (!rec.rows.some(r => r.shape)) continue
    if (!o) { bad.push(rec.id + " (nothing in the lens)"); continue }
    if (!o.lens) bad.push(rec.id + " (not marked)")
    spans.push(rec.id + " " + (A.lensSpan(rec, c, false) / R).toFixed(1))
    for (const r of o.rows) {
      for (const s of r.segs.concat(r.marks)) for (const q of s) if (Math.hypot(q[0] - D / 2, q[1] - D / 2) > A.LENS_IN * D / 2 + 0.01) bad.push(rec.id + "." + r.id + " (outside the rim)")
      if (!r.lab.show) continue
      // the label: outside the rim, on the subject's side, off the leader to the subject
      const nx = Math.max(r.lab.x, Math.min(r.lab.x + r.lab.w, D / 2)), ny = Math.max(r.lab.y, Math.min(r.lab.y + r.lab.h, D / 2))
      if (Math.hypot(nx - D / 2, ny - D / 2) < D / 2 + 2 * e.tok.gap || r.lab.side !== (to[0] > D / 2 ? 1 : -1)) bad.push(rec.id + "." + r.id + " (label in the lens or on the far side)")
      const m = (to[1] - D / 2) / (to[0] - D / 2)
      for (const x of [r.lab.x, r.lab.x + r.lab.w]) { const y = D / 2 + m * (x - D / 2); if ((x - to[0]) * (x - D / 2) < 0 && y > r.lab.y && y < r.lab.y + r.lab.h) bad.push(rec.id + "." + r.id + " (label on the leader)") }
      for (const q of o.rows) if (q !== r && q.lab.show && Lay.intersects(q.lab, r.lab)) bad.push(rec.id + "." + r.id + " (labels stacked)")
    }
  }
  check("every body in the lens: the same eye, the body in the middle, lines inside the rim, labels in a column outside it, clear of the leader", bad.length === 0, [...new Set(bad)].slice(0, 6).join(", "))
  // the column keeps to the real screen: with the subject on the side where the screen ends, it stands on the other (the box, the laptop under its notch, 4:3)
  {
    const off = []
    for (const l of [big, Lay.plan(1728, 1117, [0, 32, 0, 0], 32), Lay.plan(1600, 1200, [0, 26, 0, 0], 0)]) {
      const d = 2 * 0.232 * l.hud.s * l.H, h = Lay.hudAt(l, [0, 0]), x0 = h.cx - d / 2, sway = l.hud.driftX * l.H
      const el = Object.assign({}, e, { W: l.W, H: l.H, lensD: d, safe: l.safe, tok: tokOf(l), math: true, textW: (t, small) => Lay.textW(t.length, small ? l.tok.anatNum : l.tok.anat, 0.11) })
      for (const aim of [[l.W / 2, l.H / 2], [l.W - 40, l.H / 2], null]) for (const rec of A.records()) {
        const c = ctx(rec), R = typeof rec.radius === "function" ? rec.radius(c) : rec.radius
        const o = A.compose(rec, A.lensFrame(rec, frame(R * 300, 0.6, 0.35), c, true), c, A.lensEnv(el, d, aim ? [aim[0] - x0, aim[1] - h.cy + d / 2] : null, { x0: l.safe.x0 - x0 + sway, x1: l.safe.x1 - x0 - sway }))
        for (const r of o ? o.rows : []) if (r.lab.show && !(r.lab.x + x0 - sway >= l.safe.x0 && r.lab.x + r.lab.w + x0 + sway <= l.safe.x1 && r.lab.y + h.cy - d / 2 >= l.safe.y0 && r.lab.y + r.lab.h + h.cy - d / 2 <= l.safe.y1)) off.push(l.W + "x" + l.H + " " + rec.id + "." + r.id)
      }
    }
    check("the lens's labels stay on the screen wherever the subject is and wherever the HUD drifts, on the box, the laptop and 4:3", off.length === 0, [...new Set(off)].slice(0, 5).join(", "))
  }
  const earthL = A.compose(earth, A.lensFrame(earth, frame(6371 * 300, 0.6, 0.35), ce, false), ce, A.lensEnv(e, D, to)), ids = earthL.rows.map(r => r.id)
  const crust = earthL.rows.find(r => r.id === "crust") || earthL.rows.find(r => r.id === "mantle")
  check("Earth in the lens, to scale: cores, mantle and the inner belt, the surface a third of the way to the rim's line", ["innerCore", "outerCore", "mantle", "innerBelt"].every(i => ids.includes(i)) && Math.abs(crust.size / D - 6371 * 0.8 / 19371) < 0.02, ids.join(" ") + "; Earth " + Math.round(crust.size) + " px of " + Math.round(D))
  console.log("     the lens shows, in radii across: " + spans.join(", "))
  // on the body, a planet's own surface lies on the limb the picture has (a ball of its mean radius); the lens shows the true flattening
  {
    const sat = A.byId("saturn"), cs = ctx(sat), fs = frame(58232 * 6, 0.6, 0.0, { focal: 1 }); fs.limb = sat.radius
    const span = pts => [Math.max(...pts.map(q => q[0])) - Math.min(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1])) - Math.min(...pts.map(q => q[1]))]
    const on = span(A.rowGeometry(sat.rows.find(r => r.id === "cloudTops"), fs, cs, e).curves[0].pts), R = 2 * 58232 / Math.sqrt(36 * 58232 * 58232 - 58232 * 58232) * e.H
    const inL = span(A.rowGeometry(sat.rows.find(r => r.id === "cloudTops"), A.lensFrame(sat, fs, cs, false), cs, A.lensEnv(e, D, to)).curves[0].pts)
    check("Saturn's cloud tops on the body: the rendered ball's limb, to the pixel; in the lens: flattened by a tenth", Math.abs(on[0] - R) < 1 && Math.abs(on[1] - R) < 1 && Math.abs(inL[1] / inL[0] - 54364 / 60268) < 0.01, on.map(v => v.toFixed(1)).join(" x ") + " for " + R.toFixed(1) + "; lens " + (inL[1] / inL[0]).toFixed(3))
  }
  // and it stays the body's own line where the view squeezes distances (the overview's scale): only what is outside the ball waits
  {
    for (const id of ["jupiter", "saturn"]) {
      const rec = A.byId(id), c = ctx(rec), f = frame(rec.radius * 4, 0.6, 0.2, { oneScale: false }); f.limb = rec.radius
      const o = A.compose(rec, f, c, e), ids = o ? o.rows.map(r => r.id) : [], top = o ? o.rows.find(r => r.id === "cloudTops") : null
      check(id + " in a squeezed view: its cloud tops are drawn, on the limb, and are the size the choice reads; nothing outside the ball is",
            !!top && Math.abs(A.stageSpan(rec, f, c, e) - top.size) < 0.02 * top.size && !ids.some(i => /ring|torus|magnetopause/i.test(i)), ids.join(" ") + "; " + (top ? Math.round(top.size) : 0) + " px, read " + Math.round(A.stageSpan(rec, f, c, e)))
    }
  }
  // the hole through the telescope: the shadow this eye sees, magnified
  const hole = A.byId("sgrA"), ch = ctx(hole), fh = frame(400, 1.1, 0.3), oh = A.compose(hole, A.lensFrame(hole, fh, ch, false), ch, A.lensEnv(e, D, to))
  check("the hole from 400 Rs in the lens: its shadow, horizon and spin axis", !!oh && ["shadow", "horizon", "spinAxis"].every(i => oh.rows.some(r => r.id === i)), oh ? oh.rows.map(r => r.id).join(" ") : "")
}

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
