.pragma library
.import "kerr.js" as Kerr
.import "layout.js" as Lay
.import "anatomy-data.js" as Data
// anatomy.js — "what is it made of": one layer of thin lines and short
// labels over whatever body the view is about (key C, IPC `anatomy`). One
// table (lib/anatomy-data.js, generated from the fact-checked rows), one set
// of shapes and one set of rules for every body; Background.qml gives the
// view's frame and draws what compose() returns. Plain JS on numbers,
// checked by tests/test_anatomy.js.
//
// A record: { id, title, unit, unitKm, radius (the body's own, in its unit),
//   where it is (sys: a body of the system view; place: a place of the Milky
//   Way view by its name's start; at: "centre" or "sun"; sky: also seen from
//   inside, in Sky mode; dwarf: any dwarf galaxy), axis ("spin", "sight",
//   "galactic", { v } or { disk }: Background.qml turns it into a basis),
//   parent (the record that takes over when none of this one's rows suits
//   the zoom), headline, rows }.
// A row: { id, name, kind, tag, shape, label, fact, source }.
//   kind   surface  a surface of revolution about the axis: its outline, and
//                   its equator when it is flattened
//          band     a ring, an annulus or a line in the equatorial plane
//          point    a place: a small cross
//          screen   a curve that exists only on the screen (the hole's shadow)
//   tag    measured (a solid line), model (dashed), mathematics (dotted, and
//          drawn only in mathematics mode, K)
//   shape  one of the shapes below, or null: a row whose place has no
//          checked number yet keeps its words and is never drawn
// Any number of a shape, a label and a fact may be a function of the
// context c ({ a: the hole's spin, unitS: the unit in light-seconds, place:
// the chosen place's own table row, ... }) and of g, what the drawing itself
// measured (the shadow's width, the bright side's factor), so a row that
// reads lib/kerr.js stays in step with the render.
//
// The rules, the same for every body:
//   size   a row is drawn when it spans between MIN_PX and MAX_SCREENS
//          screen heights; outside that it waits for the zoom that suits it.
//          A point shows while its body spans MIN_PX
//   chain  when none of the subject's rows suits the zoom, its parent's do
//          (the Sun's from close by, the Milky Way's from 100,000 ly, the
//          Local Group's from further still)
//   scale  where the view exaggerates sizes against distances (the system
//          overview), only rows inside the body are drawn: frame.oneScale
//   fold   a row whose line lies within FOLD_PX of a neighbour's all the way
//          round is not drawn: its name and number join the neighbour's label
//   words  at most MAX_LABELS labels at once, the largest rows first (the
//          row being told always has its label); lib/layout.js places them
//   room   lines and labels stay inside the safe rect and out of the
//          obstacles (the rail, the caption, the HUD's disc, a story caption)
//
// Shapes (lengths in the record's unit, from the body's centre unless
// `centre` says otherwise: "sun", { place }, { toPlace, fraction }, { ra, dec }):
//   ell { a, c, z0 }       an ellipsoid of revolution: equatorial and polar radius
//   shell { r0, r1 }       a thin layer between two spheres
//   lobes { h, w }         two ellipsoids h tall and w wide, standing on the plane, one each side
//   profile { f(c, t) }    a surface given as [distance from the axis, height] for t from 0 (pole) to pi
//   ring { r, z0, turn, pa } a circle in the plane; turn: +1 or -1, which way it goes round the axis; pa: [from, to] degrees, an arc
//   annulus { r0, r1 }     two circles
//   bar { half, dir }      a line through the centre, `half` each way along dir (in the plane)
//   seg { to }             a line from the centre to another place
//   skyEllipse { a, ell, pa } an ellipse on the sky (axis "sight"): half-light radius, flattening, position angle
//   axis { len, turn }     the axis itself, with a curved arrow for the turning
//   pt { at }              a point
//   shadow, shadowEdge { which }, shadowMid, impact { b, about }, limb { side, r }
//                          the black hole's own (lib/kerr.js): the shadow's outline as the render classifies it,
//                          its nearest and farthest point from the centre, the tick from the centre to its
//                          middle, the circle light passing b from the centre draws, the two sides of a ring
//                          where the gas comes toward the camera and goes away

const MIN_PX = 24, MAX_SCREENS = 1.5, FOLD_PX = 3, MAX_LABELS = 6
const TAGS = ["measured", "model", "mathematics"]
const DASH = { measured: null, model: [7, 5], mathematics: [1.5, 4.5] }   // pixels on, pixels off
const KINDS = ["surface", "band", "point", "screen"]
const N_RING = 96, N_LAT = 24, N_LON = 48

// ---- the table ----------------------------------------------------------------
function records() { return Data.BODIES }
function limits() { return Data.LIMITS }
function byId(id) { return Data.BODIES.find(b => b.id === id) || null }
function bySys(i) { return Data.BODIES.find(b => b.sys === i) || null }
// a place of the Milky Way view by its name; a dwarf galaxy without a record of its own has the dwarfs'
function byPlace(name, dwarf) {
  return Data.BODIES.find(b => b.place && String(name).indexOf(b.place) === 0) || (dwarf ? Data.BODIES.find(b => b.dwarf) || null : null)
}
function byAt(at) { return Data.BODIES.find(b => b.at === at && b.sys === undefined) || Data.BODIES.find(b => b.at === at) || null }
function chain(rec) { const out = []; for (let r = rec, n = 0; r && n < 6; r = byId(r.parent), n++) out.push(r); return out }
function val(v, c, g) { return typeof v === "function" ? v(c, g) : v }
function labelOf(row, c, g) { return String(val(row.label, c, g) || "") }
function factOf(row, c, g) { return String(val(row.fact, c, g) || "") }
function drawn(row, math) { return !!row.shape && (row.tag !== "mathematics" || !!math) }

// ---- vectors --------------------------------------------------------------------
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
// a right-handed basis [ex, ey, ez] about the axis ez; ex as near `toward` as the axis allows
function basisOf(ez, toward) {
  ez = norm(ez)
  let t = toward || [1, 0, 0]
  let ex = sub(t, mul(ez, dot(t, ez)))
  if (Math.hypot(ex[0], ex[1], ex[2]) < 1e-6) { t = Math.abs(ez[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; ex = sub(t, mul(ez, dot(t, ez))) }
  ex = norm(ex)
  return [ex, cross(ez, ex), ez]
}

// ---- the frame ------------------------------------------------------------------
// frame: { C: the body's centre in the view's world, k: world lengths per
// unit, basis: [ex, ey, ez], cam: { C, right, up, fwd, focal, o: [x, y] },
// sunDir: from the body toward the Sun or null, oneScale, resolve(spec):
// another place's centre in the world, or null }
// A world point on the screen of env ({ W, H }), in pixels, or null behind the eye.
function project(cam, P, env) {
  const v = sub(P, cam.C), z = dot(v, cam.fwd)
  if (!(z > 1e-12 * (Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])) && z > 0)) return null
  const k = cam.focal / z
  return [env.W / 2 + (dot(v, cam.right) * k + cam.o[0]) * env.H, (-dot(v, cam.up) * k + cam.o[1] + 0.5) * env.H]
}
// a direction from the eye on the screen (the hole's shadow is a set of directions)
function projectDir(cam, d, env) {
  const z = dot(d, cam.fwd)
  if (!(z > 1e-6)) return null
  const k = cam.focal / z
  return [env.W / 2 + (dot(d, cam.right) * k + cam.o[0]) * env.H, (-dot(d, cam.up) * k + cam.o[1] + 0.5) * env.H]
}
function local(frame, centre, x, y, z) {
  const b = frame.basis, k = frame.k
  return [centre[0] + k * (x * b[0][0] + y * b[1][0] + z * b[2][0]), centre[1] + k * (x * b[0][1] + y * b[1][1] + z * b[2][1]), centre[2] + k * (x * b[0][2] + y * b[1][2] + z * b[2][2])]
}
// the camera in the body's own frame, in its unit (the hole: in Rs, the spin along +z)
function camLocal(frame) {
  const v = sub(frame.cam.C, frame.C), b = frame.basis
  return [dot(v, b[0]) / frame.k, dot(v, b[1]) / frame.k, dot(v, b[2]) / frame.k]
}
function dirWorld(frame, v) { const b = frame.basis; return [0, 1, 2].map(i => v[0] * b[0][i] + v[1] * b[1][i] + v[2] * b[2][i]) }
function centreOf(frame, shape) {
  if (shape.centre === undefined || shape.centre === "body") return frame.C
  return frame.resolve ? frame.resolve(shape.centre) : null
}

// ---- outlines -------------------------------------------------------------------
// the convex hull of screen points (Andrew's chain), counterclockwise in screen coordinates; each point keeps its index
function hull(pts) {
  const p = pts.map((q, i) => [q[0], q[1], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], up = []
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  lo.pop(); up.pop()
  return lo.concat(up)
}
// The outline of a surface of revolution given by its profile f(t) = [rho, z]
// (t: 0 at one pole to pi at the other): its points on the screen, and the
// hull of them. null when any of it is behind the eye (the eye is inside it,
// or it wraps the screen). toward: a world direction; only the half of the
// outline on that side is kept (a shield that exists on the day side only).
function outline(frame, centre, f, env, toward) {
  const pts = [], P3 = []
  for (let i = 0; i <= N_LAT; i++) {
    const q = f(Math.PI * i / N_LAT), nLon = i === 0 || i === N_LAT ? 1 : N_LON
    for (let j = 0; j < nLon; j++) {
      const ph = 2 * Math.PI * j / nLon
      const P = local(frame, centre, q[0] * Math.cos(ph), q[0] * Math.sin(ph), q[1])
      const s = project(frame.cam, P, env)
      if (!s) return null
      pts.push(s); P3.push(P)
    }
  }
  const h = hull(pts)
  if (!toward) return { pts: h.map(q => [q[0], q[1]]), closed: true }
  // the longest run of the outline on the side of `toward`
  const on = h.map(q => dot(sub(P3[q[2]], centre), toward) > 0)
  if (on.every(v => v)) return { pts: h.map(q => [q[0], q[1]]), closed: true }
  let best = [], n = h.length
  for (let s = 0; s < n; s++) {
    if (!on[s] || on[(s + n - 1) % n]) continue
    const run = []
    for (let i = s; on[i % n] && run.length < n; i++) run.push([h[i % n][0], h[i % n][1]])
    if (run.length > best.length) best = run
  }
  return best.length >= 2 ? { pts: best, closed: false } : null
}
// world points on the screen as one line, or null when any is behind the eye
function line(frame, P3, env, closed) {
  const pts = []
  for (const P of P3) { const s = project(frame.cam, P, env); if (!s) return null; pts.push(s) }
  return { pts: pts, closed: !!closed }
}
function ringPts(frame, centre, r, z0, a0, a1) {
  const out = [], arc = a0 !== undefined, n = arc ? Math.max(8, Math.ceil(N_RING * Math.abs(a1 - a0) / (2 * Math.PI))) : N_RING
  for (let i = 0; i < (arc ? n + 1 : n); i++) {
    const ph = arc ? a0 + (a1 - a0) * i / n : 2 * Math.PI * i / n
    out.push(local(frame, centre, r * Math.cos(ph), r * Math.sin(ph), z0 || 0))
  }
  return out
}
// an arrowhead on a ring at angle ph, pointing the way it turns
function arrowPts(frame, centre, r, z0, ph, turn) {
  const d = 0.11 * turn, e = 0.07
  const at = (p, rr) => local(frame, centre, rr * Math.cos(p), rr * Math.sin(p), z0 || 0)
  return [at(ph - d, r * (1 + e)), at(ph, r), at(ph - d, r * (1 - e))]
}

// ---- the black hole's own shapes -------------------------------------------------
// The shadow as the camera sees it, kept for the camera's place (it does not
// depend on where the camera looks): the outline's directions, its nearest
// and farthest point from the centre, and what they measure in Rs.
const holeMemo = { key: "", v: null }
function holeView(frame, c) {
  const x = camLocal(frame)
  const key = x.map(v => v.toPrecision(6)).join(",") + "," + c.a
  if (holeMemo.key === key) return holeMemo.v
  let v = null
  const o = Kerr.shadowOutline(x, c.a, N_RING)
  if (o) {
    const d = Math.hypot(x[0], x[1], x[2])
    let near = o.pts[0], far = o.pts[0]
    for (const p of o.pts) { if (p.theta < near.theta) near = p; if (p.theta > far.theta) far = p }
    // along the equator's line on the screen (e2): how wide, and how far its middle is from the centre
    let lo = Infinity, hi = -Infinity
    for (const p of o.pts) { const s = Kerr.impactAt(d, p.theta) * Math.sin(p.psi); lo = Math.min(lo, s); hi = Math.max(hi, s) }
    v = { o: o, d: d, near: near, far: far, x: x,
          g: { width: hi - lo, near: Kerr.impactAt(d, near.theta), far: Kerr.impactAt(d, far.theta), offset: Math.abs(hi + lo) / 2 } }
    // from the pole the shadow is round: no flat edge, no brighter side
    v.round = (far.theta - near.theta) / far.theta < 0.02
    v.mid = norm(add(near.v, far.v))
    // how much brighter the picture is just outside the flat edge than just
    // outside the round one: the gas's light along those two rays, as the
    // shader adds it up
    const beside = p => { const th = p.theta * 1.12; return Kerr.gasLight(x, c.a, [0, 1, 2].map(i => Math.cos(th) * o.c[i] + Math.sin(th) * (Math.cos(p.psi) * o.e1[i] + Math.sin(p.psi) * o.e2[i]))) }
    const In = v.round ? 0 : beside(near), If = v.round ? 0 : beside(far)
    v.g.bright = In > 0 && If > 0 ? In / If : 0
  }
  holeMemo.key = key; holeMemo.v = v
  return v
}

// ---- a row's lines ----------------------------------------------------------------
// Returns { curves: [{ pts, closed }], at: [x, y] (a point's own place), size
// (pixels: the span, a point's body's), ext (how far it reaches from the
// body's centre, in units; Infinity for a shape with a centre of its own) },
// or null when it cannot be drawn in this frame (behind the eye, no such
// place here, nothing to measure).
function rowGeometry(row, frame, c, env) {
  const sh = row.shape, v = k => val(sh[k], c)
  const centre = centreOf(frame, sh)
  if (!centre) return null
  const own = sh.centre !== undefined && sh.centre !== "body"
  const curves = []
  let at = null, ext = own ? Infinity : 0
  const push = cu => { if (!cu) return false; curves.push(cu); return true }
  const cross = s => { curves.push({ pts: [[s[0] - 5, s[1]], [s[0] + 5, s[1]]], closed: false, mark: true }, { pts: [[s[0], s[1] - 5], [s[0], s[1] + 5]], closed: false, mark: true }) }
  const ring = (r, turn, pa) => {
    const rad = Math.PI / 180
    if (!push(line(frame, ringPts(frame, centre, r, v("z0") || 0, pa ? pa[0] * rad : undefined, pa ? pa[1] * rad : undefined), env, !pa))) return false
    if (turn) {
      // two arrowheads, where the ring passes nearest the eye and opposite
      const x = camLocal(frame), ph0 = Math.atan2(x[1], x[0])
      for (const ph of [ph0 + 0.5, ph0 + 0.5 + Math.PI]) { const a = line(frame, arrowPts(frame, centre, r, v("z0") || 0, ph, turn), env, false); if (a) { a.mark = true; curves.push(a) } }
    }
    return true
  }
  const surface = f => {
    if (!push(outline(frame, centre, f, env, sh.toward === "sun" ? frame.sunDir : null))) return false
    const eq = f(Math.PI / 2), pole = f(0)
    if (!sh.toward && Math.abs(eq[1]) < 1e-9 * eq[0] && Math.abs(Math.abs(pole[1]) - eq[0]) > 0.02 * eq[0]) push(line(frame, ringPts(frame, centre, eq[0], 0), env, true))
    return true
  }
  if (sh.toward === "sun" && !frame.sunDir) return null
  if (sh.s === "ell") {
    const a = v("a"), cc = v("c"), z0 = v("z0") || 0
    if (!own) ext = Math.max(a, Math.abs(z0) + cc)
    if (!surface(t => [a * Math.sin(t), z0 + cc * Math.cos(t)])) return null
  } else if (sh.s === "shell") {
    const r0 = v("r0"), r1 = v("r1")
    if (!own) ext = r1
    if (!surface(t => [r1 * Math.sin(t), r1 * Math.cos(t)])) return null
    // its inner face too, once the two can be told apart
    const o1 = curves[0], w = span(o1.pts)
    if (w * (1 - r0 / r1) / 2 >= FOLD_PX) surface(t => [r0 * Math.sin(t), r0 * Math.cos(t)])
  } else if (sh.s === "lobes") {
    const h = v("h"), w = v("w")
    if (!own) ext = h
    for (const sg of [1, -1]) if (!surface(t => [w / 2 * Math.sin(t), sg * (h / 2 + h / 2 * Math.cos(t))])) return null
  } else if (sh.s === "profile") {
    const f = t => sh.f(c, t)
    if (!own) for (let i = 0; i <= 8; i++) { const q = f(Math.PI * i / 8); ext = Math.max(ext, Math.hypot(q[0], q[1])) }
    if (!surface(f)) return null
  } else if (sh.s === "ring") {
    const r = v("r")
    if (!own) ext = r
    if (!ring(r, sh.turn, sh.pa)) return null
  } else if (sh.s === "annulus") {
    const r0 = v("r0"), r1 = v("r1")
    if (!own) ext = r1
    if (!ring(r1) || !ring(r0)) return null
  } else if (sh.s === "bar") {
    const h = v("half"), d = sh.dir
    if (!own) ext = h
    if (!push(line(frame, [local(frame, centre, -h * d[0], -h * d[1], 0), local(frame, centre, h * d[0], h * d[1], 0)], env, false))) return null
  } else if (sh.s === "seg") {
    const to = frame.resolve ? frame.resolve(sh.to) : null
    ext = Infinity
    if (!to || !push(line(frame, [centre, to], env, false))) return null
  } else if (sh.s === "skyEllipse") {
    const a = v("a"), b = a * (1 - (v("ell") || 0)), pa = (v("pa") || 0) * Math.PI / 180, P = []
    if (!(a > 0)) return null
    if (!own) ext = a
    // basis "sight": ex is north on the sky and ey east; the long axis lies at the position angle
    for (let i = 0; i < N_RING; i++) {
      const t = 2 * Math.PI * i / N_RING, u = a * Math.cos(t), w = b * Math.sin(t)
      P.push(local(frame, centre, u * Math.cos(pa) - w * Math.sin(pa), u * Math.sin(pa) + w * Math.cos(pa), 0))
    }
    if (!push(line(frame, P, env, true))) return null
  } else if (sh.s === "axis") {
    const len = v("len")
    if (!own) ext = len
    if (!push(line(frame, [local(frame, centre, 0, 0, -len), local(frame, centre, 0, 0, len)], env, false))) return null
    if (sh.turn) {
      const r = 0.16 * len, z = 0.8 * len, a1 = sh.turn * 1.6 * Math.PI
      const arc = line(frame, ringPts(frame, centre, r, z, 0, a1), env, false)
      const head = line(frame, arrowPts(frame, centre, r, z, a1, sh.turn), env, false)
      if (arc) { arc.mark = true; curves.push(arc) }
      if (head) { head.mark = true; curves.push(head) }
    }
  } else if (sh.s === "pt") {
    const a = sh.at || [0, 0, 0]
    const s = project(frame.cam, local(frame, centre, a[0], a[1], a[2]), env)
    if (!s) return null
    if (!own) ext = Math.hypot(a[0], a[1], a[2])
    at = s; cross(s)
  } else if (sh.s === "limb") {
    // where the ring's gas moves straight at the eye (side 1) or straight away (side -1); the ring turns about +z
    const x = camLocal(frame), r = v("r"), ph = -Math.atan2(x[0], x[1]) + (sh.side < 0 ? Math.PI : 0)
    const hv = c.a !== undefined ? holeView(frame, c) : null
    if (hv && hv.round) return null
    const s = project(frame.cam, local(frame, centre, r * Math.cos(ph), r * Math.sin(ph), 0), env)
    if (!s) return null
    if (!own) ext = r
    at = s; cross(s)
  } else {
    // the shadow's own shapes
    const hv = c.a !== undefined ? holeView(frame, c) : null
    if (!hv) return null
    const scr = d => projectDir(frame.cam, dirWorld(frame, d), env)
    ext = 0
    if (sh.s === "shadow") {
      const pts = []
      for (const p of hv.o.pts) { const s = scr(p.v); if (!s) return null; pts.push(s) }
      curves.push({ pts: pts, closed: true })
    } else if (sh.s === "shadowEdge") {
      if (hv.round) return null
      const s = scr(sh.which === "near" ? hv.near.v : hv.far.v)
      if (!s) return null
      at = s; cross(s)
    } else if (sh.s === "shadowMid") {
      const s0 = scr(hv.o.c), s1 = scr(hv.mid)
      if (!s0 || !s1) return null
      at = s0; cross(s0)
      if (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) > 6) curves.push({ pts: [s0, s1], closed: false })
    } else if (sh.s === "impact") {
      // the circle of directions whose light passes b from the centre
      const b = v("b"), sn = b * Math.sqrt(Math.max(1 - 1 / hv.d, 0)) / hv.d
      if (!(sn < 1)) return null
      const th = Math.asin(sn), ax = sh.about === "shadowMid" ? hv.mid : hv.o.c, B = basisOf(ax, hv.o.e1), pts = []
      for (let i = 0; i < N_RING; i++) {
        const ps = 2 * Math.PI * i / N_RING
        const s = scr([0, 1, 2].map(j => Math.cos(th) * ax[j] + Math.sin(th) * (Math.cos(ps) * B[0][j] + Math.sin(ps) * B[1][j])))
        if (!s) return null
        pts.push(s)
      }
      curves.push({ pts: pts, closed: true })
    } else return null
  }
  let size = 0
  for (const cu of curves) if (!cu.mark) size = Math.max(size, span(cu.pts))
  return { curves: curves, at: at, size: size, ext: ext }
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
  return { x0: x0, y0: y0, x1: x1, y1: y1 }
}
// how far the line `a` strays from the line `b` at most, in pixels
function apart(a, b) {
  let worst = 0
  for (const p of a) {
    let best = Infinity
    for (let i = 0; i < b.length; i++) {
      const u = b[i], w = b[(i + 1) % b.length], dx = w[0] - u[0], dy = w[1] - u[1], l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(p[0] - u[0] - dx * t, p[1] - u[1] - dy * t))
    }
    worst = Math.max(worst, best)
    if (worst >= FOLD_PX) break
  }
  return worst
}
function span(pts) { const b = bbox(pts); return Math.max(b.x1 - b.x0, b.y1 - b.y0) }

// ---- room: lines keep to the safe rect and out of the obstacles ----------------------
function allowed(x, y, safe, obstacles) {
  if (x < safe.x0 || x > safe.x1 || y < safe.y0 || y > safe.y1) return false
  for (const o of obstacles) {
    if (o.r !== undefined) { if (Math.hypot(x - o.cx, y - o.cy) < o.r) return false }
    else if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return false
  }
  return true
}
// the parts of a line that are allowed: walked in steps of CLIP_STEP pixels
// (so a long stroke across an obstacle is cut too), cut where it crosses an
// edge (found by bisection); only the line's own points and the cuts are kept
const CLIP_STEP = 3
function clip(pts, closed, safe, obstacles) {
  const ok = p => allowed(p[0], p[1], safe, obstacles)
  const edge = (a, b) => {   // a allowed, b not: the last allowed point toward b
    let lo = 0, hi = 1
    for (let i = 0; i < 12; i++) { const m = 0.5 * (lo + hi); if (ok([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m])) lo = m; else hi = m }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo]
  }
  const seq = closed && pts.length > 2 ? pts.concat([pts[0]]) : pts
  const out = []
  let cur = null, cut = false
  let q = seq[0], inQ = ok(q)
  if (inQ) cur = [q]
  for (let i = 1; i < seq.length; i++) {
    const b = seq[i], a = seq[i - 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CLIP_STEP))
    for (let k = 1; k <= n; k++) {
      const p = k === n ? b : [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], inP = ok(p)
      if (inQ && !inP) { cur.push(edge(q, p)); out.push(cur); cur = null; cut = true }
      else if (!inQ && inP) { cur = [edge(p, q)]; cut = true }
      if (inP && k === n) cur.push(p)
      q = p; inQ = inP
    }
  }
  if (cur) out.push(cur)
  // a closed line cut somewhere is not closed: its last part runs on into its first
  if (closed && cut && out.length > 1 && ok(seq[0])) { const last = out.pop(); out[0] = last.concat(out[0].slice(1)) }
  return out.filter(s => s.length >= 2)
}
// a line as dashes: [on, off] pixels along it (null: solid)
function dash(pts, pattern) {
  if (!pattern) return [pts]
  const out = []
  let on = true, left = pattern[0], cur = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]
    const b = pts[i]
    let d = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (d > left) {
      const t = left / d, m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (on) { cur.push(m); out.push(cur) }
      cur = [m]
      a = m; d -= left; on = !on; left = pattern[on ? 0 : 1]
    }
    left -= d
    if (on) cur.push(b); else cur = [b]
  }
  if (on && cur.length >= 2) out.push(cur)
  return out
}

// ---- one record in one frame ---------------------------------------------------------
// env: { W, H, safe, obstacles, textW(text, small): pixels, tok: { label,
// micro, gap }, sides: the label pass's memory, math: mathematics mode, lit:
// the row being told }. Returns null when the record has no row to draw
// here, else { id, title, g, rows: [...] } with the rows largest first, each
// { id, name, label, tag, soft, size, segs: [[[x, y], ...], ...] (its lines,
// clipped and dashed), ax, ay (where its label points), text, num, lab: {
// show, side, x, y, w, h } (its label's box), folded: [ids] }.
function compose(rec, frame, c, env) {
  const body = project(frame.cam, frame.C, env)
  const depth = dot(sub(frame.C, frame.cam.C), frame.cam.fwd)
  const radius = val(rec.radius, c) || 0
  const bodyPx = depth > 0 ? 2 * radius * frame.k * frame.cam.focal / depth * env.H : 0
  let g = null
  const rows = []
  for (const row of rec.rows) {
    if (!drawn(row, env.math)) continue
    const geo = rowGeometry(row, frame, c, env)
    if (!geo) continue
    if (!frame.oneScale && geo.ext > radius * 1.001) continue
    const isPoint = geo.size === 0
    if (isPoint ? bodyPx < MIN_PX : (geo.size < MIN_PX || geo.size > MAX_SCREENS * env.H)) continue
    rows.push({ row: row, geo: geo, size: isPoint ? Math.min(bodyPx, MAX_SCREENS * env.H) : geo.size, point: isPoint, folded: [] })
  }
  if (c.a !== undefined && rec.rows.some(r => r.shape && /^shadow|^impact|^limb/.test(r.shape.s))) { const hv = holeView(frame, c); g = hv ? hv.g : null }
  // fold: a line that lies within FOLD_PX of a neighbour's all the way round joins its label
  const lines = rows.filter(r => !r.point)
  const gone = {}
  for (let i = 0; i < lines.length; i++) for (let j = 0; j < i; j++) {
    const a = lines[i], b = lines[j]
    if (gone[a.row.id] || gone[b.row.id] || Math.abs(a.size - b.size) / 2 >= FOLD_PX) continue
    if (apart(a.geo.curves[0].pts, b.geo.curves[0].pts) >= FOLD_PX || apart(b.geo.curves[0].pts, a.geo.curves[0].pts) >= FOLD_PX) continue
    // the one that names its host folds; else the later of the two in the table
    const lose = b.row.fold === a.row.id ? b : a, keep = lose === a ? b : a
    gone[lose.row.id] = true
    keep.folded.push(lose)
  }
  const kept = rows.filter(r => !gone[r.row.id]).sort((a, b) => b.size - a.size)
  if (kept.length === 0) return null
  // lines: clipped to the room there is, dashed by tag
  const out = kept.map(r => {
    const segs = []
    let seen = []
    for (const cu of r.geo.curves) for (const part of clip(cu.pts, cu.closed, env.safe, env.obstacles)) {
      if (!cu.mark) seen = seen.concat(part)
      for (const d of dash(part, cu.mark ? null : DASH[r.row.tag])) segs.push(d)
    }
    const num = [labelOf(r.row, c, g)].concat(r.folded.map(f => f.row.name.toUpperCase() + " " + labelOf(f.row, c, g))).join("  ·  ")
    return { id: r.row.id, name: r.row.name, text: r.row.name.toUpperCase(), num: num, tag: r.row.tag, soft: !!r.row.shape.soft, size: r.size, point: r.point,
             segs: segs, seen: seen, at: r.geo.at, folded: r.folded.map(f => f.row.id), lab: { show: false, side: 1, x: 0, y: 0, w: 0, h: 0 } }
  }).filter(r => r.segs.length > 0)
  if (out.length === 0) return null
  // labels: the largest MAX_LABELS rows and the one being told; each points at
  // its own line, fanned from the upper right downward so nested rings' names do not stack
  const tok = env.tok, items = [], put = []
  out.forEach((r, n) => {
    if (n >= MAX_LABELS && r.id !== env.lit) return
    let ax, ay
    if (r.at && allowed(r.at[0], r.at[1], env.safe, env.obstacles)) { ax = r.at[0]; ay = r.at[1] }
    else if (r.seen.length > 0) {
      const b = bbox(r.seen), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ang = (-50 + 25 * Math.min(n, 5)) * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang)
      let best = -Infinity
      for (const p of r.seen) { const s = (p[0] - cx) * ux + (p[1] - cy) * uy; if (s > best) { best = s; ax = p[0]; ay = p[1] } }
    } else return
    r.ax = ax; r.ay = ay
    const w = env.textW(r.text, false) + (r.num ? tok.gap + env.textW(r.num, true) : 0)
    items.push({ id: "a-" + rec.id + "-" + r.id, x: ax, y: ay, r: tok.gap + (r.point ? 5 : 0), w: w, h: tok.label * 1.5, pin: r.id === env.lit })
    put.push(r)
  })
  // the row being told is placed first: it always has its label
  const order = items.map((_, i) => i).sort((a, b) => (put[b].id === env.lit) - (put[a].id === env.lit) || a - b)
  const res = Lay.placeLabels(order.map(i => items[i]), env.obstacles, env.safe, env.sides)
  order.forEach((i, n) => {
    const it = items[i], b = Lay.labelBoxAt(it, res[n].side)
    put[i].lab = { show: res[n].show, side: res[n].side, x: b.x, y: b.y, w: b.w, h: b.h }
  })
  return { id: rec.id, title: rec.title, g: g, rows: out }
}
// The subject and the records that hold it, each with its frame (frameOf(rec):
// the view's frame for a record, or null when it has no place in this view):
// the first of them with a row that suits the zoom is the one drawn.
function composeChain(rec, frameOf, c, env) {
  for (const r of chain(rec)) {
    const f = frameOf(r)
    if (!f) continue
    const out = compose(r, f.frame, f.c || c, env)
    if (out) return out
  }
  return null
}
// the row whose line passes within tol pixels of (x, y), the nearest; "" for none
function hit(out, x, y, tol) {
  let best = "", bd = tol
  if (!out) return best
  for (const r of out.rows) for (const s of r.segs) for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0
    const d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)
    if (d < bd) { bd = d; best = r.id }
  }
  return best
}
// the words a drawing puts on the screen (for the idle clock's reading time)
function wordsOf(out) { return out ? out.rows.filter(r => r.lab.show).map(r => r.text + " " + r.num).join(" ") : "" }
