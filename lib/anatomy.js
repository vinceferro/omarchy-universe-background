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
//   words  at most MAX_LABELS labels at once: the row being told, then the
//          largest rows that find room; lib/layout.js places them
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
const N_RING = 72, N_SIL = 64, N_LAT = 14, N_LON = 28

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

// what a drawing depends on, as text: the eye and the basis seen from the
// body, the scale, the context. Two frames with the same key draw the same
// (digits: how finely; 3 tells a camera at rest from one still gliding in).
function frameKey(rec, frame, c, digits) {
  const cam = frame.cam, v = sub(frame.C, cam.C), d = Math.hypot(v[0], v[1], v[2]) || 1, n = []
  // every term is of order one (the direction to the body, the basis, the log of the distance), rounded to `digits` places
  for (const e of [cam.right, cam.up, cam.fwd]) { n.push(dot(v, e) / d); for (const b of frame.basis) n.push(dot(b, e)) }
  n.push(Math.log(d / frame.k), Math.log(cam.focal), cam.o[0], cam.o[1], c.a || 0, c.t || 0)
  if (frame.sunDir) n.push(dot(frame.sunDir, cam.right), dot(frame.sunDir, cam.up))
  const q = Math.pow(10, digits || 6)
  return rec.id + (frame.oneScale ? "|1|" : "|0|") + n.map(x => Math.round(x * q)).join(",")
}
// the eye of a frame of its own (IPC anatomyDemo): looking at the body from
// 20 degrees above its equator, `span` units of it filling the screen's height
function demoCam(frame, span) {
  const b = frame.basis, yaw = 0.6, pitch = 0.35
  const d = [0, 1, 2].map(i => Math.cos(pitch) * (Math.cos(yaw) * b[0][i] + Math.sin(yaw) * b[1][i]) + Math.sin(pitch) * b[2][i])
  const fwd = mul(d, -1), right = norm(cross(fwd, b[2])), up = cross(right, fwd)
  return { C: add(frame.C, mul(d, span * frame.k)), right: right, up: up, fwd: fwd, focal: 1, o: [0, 0] }
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
// A point given in a centre's own frame (x, y, z in units along the basis)
// on the screen, as one function for that centre: the hot path of every
// line (a dozen multiplications a point). null behind the eye.
function projector(frame, centre, env) {
  const cam = frame.cam, b = frame.basis, k = frame.k, v = sub(centre, cam.C)
  const x0 = dot(v, cam.right), y0 = dot(v, cam.up), z0 = dot(v, cam.fwd)
  const xx = k * dot(b[0], cam.right), xy = k * dot(b[1], cam.right), xz = k * dot(b[2], cam.right)
  const yx = k * dot(b[0], cam.up), yy = k * dot(b[1], cam.up), yz = k * dot(b[2], cam.up)
  const zx = k * dot(b[0], cam.fwd), zy = k * dot(b[1], cam.fwd), zz = k * dot(b[2], cam.fwd)
  const near = 1e-9 * (Math.abs(x0) + Math.abs(y0) + Math.abs(z0) + k), f = cam.focal * env.H, cx = env.W / 2 + cam.o[0] * env.H, cy = (cam.o[1] + 0.5) * env.H
  return (x, y, z) => {
    const Z = z0 + x * zx + y * zy + z * zz
    if (!(Z > near)) return null
    const q = f / Z
    return [cx + (x0 + x * xx + y * xy + z * xz) * q, cy - (y0 + x * yx + y * yy + z * yz) * q]
  }
}
// The outline of a surface of revolution given by its profile f(t) = [rho, z]
// (t: 0 at one pole to pi at the other): the hull of its points on the
// screen. null when any of it is behind the eye (the eye is inside it, or it
// wraps the screen). toward: a direction in the centre's frame; only the
// half of the outline on that side is kept (a shield that exists on the day
// side only).
function outline(pj, f, toward) {
  const pts = [], side = []
  for (let i = 0; i <= N_LAT; i++) {
    const q = f(Math.PI * i / N_LAT), nLon = i === 0 || i === N_LAT ? 1 : N_LON
    for (let j = 0; j < nLon; j++) {
      const ph = 2 * Math.PI * j / nLon, x = q[0] * Math.cos(ph), y = q[0] * Math.sin(ph)
      const s = pj(x, y, q[1])
      if (!s) return null
      pts.push(s)
      if (toward) side.push(x * toward[0] + y * toward[1] + q[1] * toward[2] > 0)
    }
  }
  const h = hull(pts)
  return runOn(h.map(q => [q[0], q[1]]), toward ? h.map(q => side[q[2]]) : null)
}
// a closed line, or the longest run of it where `on` says so (null: all of it)
function runOn(pts, on) {
  if (!on || on.every(v => v)) return { pts: pts, closed: true }
  const n = pts.length
  let best = []
  for (let s0 = 0; s0 < n; s0++) {
    if (!on[s0] || on[(s0 + n - 1) % n]) continue
    const run = []
    for (let i = s0; on[i % n] && run.length < n; i++) run.push(pts[i % n])
    if (run.length > best.length) best = run
  }
  return best.length >= 2 ? { pts: best, closed: false } : null
}
// The outline of an ellipsoid of revolution (equatorial radius a, polar c,
// its centre z0 up the axis), exactly: seen from a point it is a plane
// curve, the circle of a unit sphere's outline stretched back. null from
// inside it or when any of it is behind the eye.
function ellOutline(frame, centre, pj, a, c, z0, toward) {
  const b = frame.basis, v = sub(frame.cam.C, centre), k = frame.k
  const e = [dot(v, b[0]) / (k * a), dot(v, b[1]) / (k * a), (dot(v, b[2]) / k - z0) / c]
  const d2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2]
  if (!(d2 > 1.0001)) return null
  const B = basisOf(e), rho = Math.sqrt(1 - 1 / d2), pts = [], side = []
  for (let i = 0; i < N_SIL; i++) {
    const t = 2 * Math.PI * i / N_SIL, cs = rho * Math.cos(t), sn = rho * Math.sin(t)
    const x = a * (e[0] / d2 + cs * B[0][0] + sn * B[1][0]), y = a * (e[1] / d2 + cs * B[0][1] + sn * B[1][1]), z = c * (e[2] / d2 + cs * B[0][2] + sn * B[1][2])
    const s = pj(x, y, z0 + z)
    if (!s) return null
    pts.push(s)
    if (toward) side.push(x * toward[0] + y * toward[1] + (z0 + z) * toward[2] > 0)
  }
  return runOn(pts, toward ? side : null)
}
// points of a centre's frame on the screen as one line, or null when any is behind the eye
function line(pj, L, closed) {
  const pts = []
  for (const q of L) { const s = pj(q[0], q[1], q[2]); if (!s) return null; pts.push(s) }
  return { pts: pts, closed: !!closed }
}
function ringPts(r, z0, a0, a1) {
  const out = [], arc = a0 !== undefined, n = arc ? Math.max(8, Math.ceil(N_RING * Math.abs(a1 - a0) / (2 * Math.PI))) : N_RING
  for (let i = 0; i < (arc ? n + 1 : n); i++) {
    const ph = arc ? a0 + (a1 - a0) * i / n : 2 * Math.PI * i / n
    out.push([r * Math.cos(ph), r * Math.sin(ph), z0 || 0])
  }
  return out
}
// an arrowhead on a ring at angle ph, pointing the way it turns
function arrowPts(r, z0, ph, turn) {
  const d = 0.11 * turn, e = 0.07
  const at = (p, rr) => [rr * Math.cos(p), rr * Math.sin(p), z0 || 0]
  return [at(ph - d, r * (1 + e)), at(ph, r), at(ph - d, r * (1 - e))]
}

// ---- the black hole's own shapes -------------------------------------------------
// The shadow as the camera sees it. Its shape (the edge's angle from the
// centre, direction by direction) depends on where the camera is, not on
// where it looks, and takes a few milliseconds: it is worked out again when
// the camera has moved by a ten-thousandth, at most every HOLE_MS while it
// moves (the last shape, scaled with the distance, serves in between) and
// exactly once it rests. The gas's light beside the two edges (the bright
// side's factor) is two marches: worked out at rest, kept while it moves.
const N_SHADOW = 48, HOLE_MS = 60
const holeMemo = { key: "", a: -1, at: 0, shape: null, fine: "", view: null }
function holeView(frame, c, still) {
  const x = camLocal(frame), M = holeMemo
  const fine = x.join(",") + "," + c.a + (still === false ? "m" : "s")
  if (M.fine === fine) return M.view
  M.fine = fine
  const key = x.map(v => v.toPrecision(4)).join(",") + "," + c.a, now = Date.now()
  const d = Math.hypot(x[0], x[1], x[2])
  if (M.key !== key && (still !== false || !M.shape || M.a !== c.a || now - M.at >= HOLE_MS)) {
    const was = M.shape && M.a === c.a ? M.shape : null
    const o = Kerr.shadowOutline(x, c.a, N_SHADOW, was ? was.o : null)
    M.shape = o ? { o: o, d: d, x: x, pending: true, bright: was ? was.bright : 0 } : null
    M.key = key; M.a = c.a; M.at = now
  }
  const S = M.shape
  if (!S || M.a !== c.a) { M.view = null; return null }
  if (S.pending && still !== false && M.key === key) {
    // how much brighter the picture is just outside the flat edge than just
    // outside the round one: the gas's light along those two rays, as the
    // shader adds it up
    const o = S.o
    let near = o.pts[0], far = o.pts[0]
    for (const p of o.pts) { if (p.theta < near.theta) near = p; if (p.theta > far.theta) far = p }
    const beside = p => { const th = p.theta * 1.12; return Kerr.gasLight(S.x, c.a, [0, 1, 2].map(i => Math.cos(th) * o.c[i] + Math.sin(th) * (Math.cos(p.psi) * o.e1[i] + Math.sin(p.psi) * o.e2[i]))) }
    const round = (far.theta - near.theta) / far.theta < 0.02
    const In = round ? 0 : beside(near), If = round ? 0 : beside(far)
    S.bright = In > 0 && If > 0 ? In / If : 0
    S.pending = false
  }
  // the shape as seen from exactly here: the same angles about this place's own directions
  const B = Kerr.shadowBasis(x), k = S.d / d
  const pts = S.o.pts.map(p => {
    const th = p.theta * k, cs = Math.cos(th), sn = Math.sin(th), cp = Math.cos(p.psi), sp = Math.sin(p.psi)
    return { psi: p.psi, theta: th, b: p.b, v: [0, 1, 2].map(i => cs * B.c[i] + sn * (cp * B.e1[i] + sp * B.e2[i])) }
  })
  let near = pts[0], far = pts[0], lo = Infinity, hi = -Infinity
  for (const p of pts) {
    if (p.theta < near.theta) near = p
    if (p.theta > far.theta) far = p
    // along the equator's line on the screen (e2): how wide, and how far its middle is from the centre
    // (p.b: how far from the centre the edge's light passes, the hole's own number at any distance)
    const s = p.b * Math.sin(p.psi); lo = Math.min(lo, s); hi = Math.max(hi, s)
  }
  M.view = { o: { c: B.c, e1: B.e1, e2: B.e2, pts: pts }, d: d, near: near, far: far, mid: norm(add(near.v, far.v)),
             // from the pole the shadow is round: no flat edge, no brighter side
             round: (far.theta - near.theta) / far.theta < 0.02,
             g: { width: hi - lo, near: near.b, far: far.b, offset: Math.abs(hi + lo) / 2, bright: S.bright } }
  return M.view
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
  if (sh.toward === "sun" && !frame.sunDir) return null
  const own = sh.centre !== undefined && sh.centre !== "body"
  // how far it reaches from its centre, in units: what the scale rule asks, and whether it can suit this zoom at all
  let reach = 0
  if (sh.s === "ell") reach = Math.max(v("a"), Math.abs(v("z0") || 0) + v("c"))
  else if (sh.s === "shell" || sh.s === "annulus") reach = v("r1")
  else if (sh.s === "lobes") reach = v("h")
  else if (sh.s === "profile") { for (let i = 0; i <= 4; i++) { const q = sh.f(c, Math.PI * i / 4); reach = Math.max(reach, Math.hypot(q[0], q[1])) } }
  else if (sh.s === "ring") reach = Math.hypot(v("r"), v("z0") || 0)
  else if (sh.s === "bar") reach = v("half")
  else if (sh.s === "skyEllipse") reach = v("a") || 0
  else if (sh.s === "axis") reach = v("len")
  else if (sh.s === "pt") reach = sh.at ? Math.hypot(sh.at[0], sh.at[1], sh.at[2]) : 0
  else if (sh.s === "limb") reach = v("r")
  if (reach > 0 && sh.s !== "pt" && sh.s !== "limb") {
    // far too small or far too large from here: it waits, and nothing more is worked out
    const depth = dot(sub(centre, frame.cam.C), frame.cam.fwd), dist = Math.hypot(centre[0] - frame.cam.C[0], centre[1] - frame.cam.C[1], centre[2] - frame.cam.C[2])
    const est = 2 * reach * frame.k * frame.cam.focal / Math.max(dist, 1e-300) * env.H
    if (est < 0.5 * MIN_PX || (est > 6 * MAX_SCREENS * env.H && depth > 0 && dist > reach * frame.k)) return null
  }
  const curves = [], pj = projector(frame, centre, env)
  let at = null, ext = own || sh.s === "seg" ? Infinity : reach
  const push = cu => { if (!cu) return false; curves.push(cu); return true }
  const cross = s => { curves.push({ pts: [[s[0] - 5, s[1]], [s[0] + 5, s[1]]], closed: false, mark: true }, { pts: [[s[0], s[1] - 5], [s[0], s[1] + 5]], closed: false, mark: true }) }
  const ring = (r, turn, pa) => {
    const rad = Math.PI / 180
    if (!push(line(pj, ringPts(r, v("z0") || 0, pa ? pa[0] * rad : undefined, pa ? pa[1] * rad : undefined), !pa))) return false
    if (turn) {
      // two arrowheads, where the ring passes nearest the eye and opposite
      const x = camLocal(frame), ph0 = Math.atan2(x[1], x[0])
      for (const ph of [ph0 + 0.5, ph0 + 0.5 + Math.PI]) { const a = line(pj, arrowPts(r, v("z0") || 0, ph, turn), false); if (a) { a.mark = true; curves.push(a) } }
    }
    return true
  }
  // the Sun's direction in the body's own frame
  const toward = sh.toward === "sun" ? [dot(frame.sunDir, frame.basis[0]), dot(frame.sunDir, frame.basis[1]), dot(frame.sunDir, frame.basis[2])] : null
  // an ellipsoid: its outline, and its equator when it is flattened
  const ell = (a, cc, z0) => {
    if (!push(ellOutline(frame, centre, pj, a, cc, z0, toward))) return false
    if (!toward && z0 === 0 && Math.abs(cc - a) > 0.02 * a) push(line(pj, ringPts(a, 0), true))
    return true
  }
  if (sh.s === "ell") {
    if (!ell(v("a"), v("c"), v("z0") || 0)) return null
  } else if (sh.s === "shell") {
    const r0 = v("r0"), r1 = v("r1")
    if (!ell(r1, r1, 0)) return null
    // its inner face too, once the two can be told apart
    if (span(curves[0].pts) * (1 - r0 / r1) / 2 >= FOLD_PX) ell(r0, r0, 0)
  } else if (sh.s === "lobes") {
    const h = v("h"), w = v("w")
    for (const sg of [1, -1]) if (!ell(w / 2, h / 2, sg * h / 2)) return null
  } else if (sh.s === "profile") {
    // any other surface of revolution: the hull of its points, and its equator when it is flattened
    const f = t => sh.f(c, t)
    if (!push(outline(pj, f, toward))) return null
    const eq = f(Math.PI / 2), pole = f(0)
    if (!toward && Math.abs(eq[1]) < 1e-9 * eq[0] && Math.abs(Math.abs(pole[1]) - eq[0]) > 0.02 * eq[0]) push(line(pj, ringPts(eq[0], 0), true))
  } else if (sh.s === "ring") {
    if (!ring(v("r"), sh.turn, sh.pa)) return null
  } else if (sh.s === "annulus") {
    if (!ring(v("r1")) || !ring(v("r0"))) return null
  } else if (sh.s === "bar") {
    const h = v("half"), d = sh.dir
    if (!push(line(pj, [[-h * d[0], -h * d[1], 0], [h * d[0], h * d[1], 0]], false))) return null
  } else if (sh.s === "seg") {
    const to = frame.resolve ? frame.resolve(sh.to) : null
    const s0 = pj(0, 0, 0), s1 = to ? project(frame.cam, to, env) : null
    if (!s0 || !s1) return null
    curves.push({ pts: [s0, s1], closed: false })
  } else if (sh.s === "skyEllipse") {
    const a = v("a"), b = a * (1 - (v("ell") || 0)), pa = (v("pa") || 0) * Math.PI / 180, P = []
    if (!(a > 0)) return null
    // basis "sight": ex is north on the sky and ey east; the long axis lies at the position angle
    for (let i = 0; i < N_RING; i++) {
      const t = 2 * Math.PI * i / N_RING, u = a * Math.cos(t), w = b * Math.sin(t)
      P.push([u * Math.cos(pa) - w * Math.sin(pa), u * Math.sin(pa) + w * Math.cos(pa), 0])
    }
    if (!push(line(pj, P, true))) return null
  } else if (sh.s === "axis") {
    const len = v("len")
    if (!push(line(pj, [[0, 0, -len], [0, 0, len]], false))) return null
    if (sh.turn) {
      const r = 0.16 * len, z = 0.8 * len, a1 = sh.turn * 1.6 * Math.PI
      const arc = line(pj, ringPts(r, z, 0, a1), false)
      const head = line(pj, arrowPts(r, z, a1, sh.turn), false)
      if (arc) { arc.mark = true; curves.push(arc) }
      if (head) { head.mark = true; curves.push(head) }
    }
  } else if (sh.s === "pt") {
    const a = sh.at || [0, 0, 0]
    const s = pj(a[0], a[1], a[2])
    if (!s) return null
    at = s; cross(s)
  } else if (sh.s === "limb") {
    // where the ring's gas moves straight at the eye (side 1) or straight away (side -1); the ring turns about +z
    const x = camLocal(frame), r = v("r"), ph = -Math.atan2(x[0], x[1]) + (sh.side < 0 ? Math.PI : 0)
    const hv = c.a !== undefined ? holeView(frame, c, env.still) : null
    if (hv && hv.round) return null
    const s = pj(r * Math.cos(ph), r * Math.sin(ph), 0)
    if (!s) return null
    at = s; cross(s)
  } else {
    // the shadow's own shapes
    const hv = c.a !== undefined ? holeView(frame, c, env.still) : null
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
// do two closed lines lie within tol pixels of each other all the way round?
// Their boxes first, then sixteen points of each against the other
function together(a, b, tol) {
  const A = bbox(a), B = bbox(b)
  if (Math.abs(A.x0 - B.x0) >= tol || Math.abs(A.x1 - B.x1) >= tol || Math.abs(A.y0 - B.y0) >= tol || Math.abs(A.y1 - B.y1) >= tol) return false
  const near = (p, l) => {
    for (let i = 0; i < l.length; i++) {
      const u = l[i], w = l[(i + 1) % l.length], dx = w[0] - u[0], dy = w[1] - u[1], l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0
      if (Math.hypot(p[0] - u[0] - dx * t, p[1] - u[1] - dy * t) < tol) return true
    }
    return false
  }
  for (const [p, q] of [[a, b], [b, a]]) for (let i = 0; i < 16; i++) if (!near(p[Math.floor(i * p.length / 16)], q)) return false
  return true
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
const CLIP_STEP = 4
function clip(pts, closed, safe, obstacles) {
  // nothing near it: whole
  const bb = bbox(pts)
  if (bb.x0 >= safe.x0 && bb.y0 >= safe.y0 && bb.x1 <= safe.x1 && bb.y1 <= safe.y1
      && !obstacles.some(o => o.r !== undefined ? bb.x0 < o.cx + o.r && bb.x1 > o.cx - o.r && bb.y0 < o.cy + o.r && bb.y1 > o.cy - o.r : bb.x0 < o.x + o.w && bb.x1 > o.x && bb.y0 < o.y + o.h && bb.y1 > o.y))
    return pts.length >= 2 ? [closed && pts.length > 2 ? pts.concat([pts[0]]) : pts] : []
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
  // a stroke well inside the safe rect that comes near no obstacle needs no walking
  const clear = (a, b) => {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
    if (x0 < safe.x0 || y0 < safe.y0 || x1 > safe.x1 || y1 > safe.y1) return false
    for (const o of obstacles) {
      if (o.r !== undefined ? x0 < o.cx + o.r && x1 > o.cx - o.r && y0 < o.cy + o.r && y1 > o.cy - o.r : x0 < o.x + o.w && x1 > o.x && y0 < o.y + o.h && y1 > o.y) return false
    }
    return true
  }
  for (let i = 1; i < seq.length; i++) {
    const b = seq[i], a = seq[i - 1], n = clear(a, b) ? 1 : Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / CLIP_STEP))
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
// the row being told, still: false while the camera moves (what takes long
// waits until it rests) }. Returns null when the record has no row to draw
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
  if (c.a !== undefined && rec.rows.some(r => r.shape && /^shadow|^impact|^limb/.test(r.shape.s))) { const hv = holeView(frame, c, env.still); g = hv ? hv.g : null }
  // fold: a line that lies within FOLD_PX of a neighbour's all the way round joins its label
  const lines = rows.filter(r => !r.point)
  const gone = {}
  for (let i = 0; i < lines.length; i++) for (let j = 0; j < i; j++) {
    const a = lines[i], b = lines[j]
    if (gone[a.row.id] || gone[b.row.id] || Math.abs(a.size - b.size) / 2 >= FOLD_PX) continue
    if (!together(a.geo.curves[0].pts, b.geo.curves[0].pts, FOLD_PX)) continue
    // the one that names its host folds; else the later of the two in the table
    const lose = b.row.fold === a.row.id ? b : a, keep = lose === a ? b : a
    gone[lose.row.id] = true
    keep.folded.push(lose)
  }
  const kept = rows.filter(r => !gone[r.row.id]).sort((a, b) => b.size - a.size)
  if (kept.length === 0) return null
  // lines: clipped to the room there is, dashed by tag
  const out = kept.map(r => {
    const segs = [], seen = []
    for (const cu of r.geo.curves) for (const part of clip(cu.pts, cu.closed, env.safe, env.obstacles)) {
      if (!cu.mark) for (const p of part) seen.push(p)
      for (const d of dash(part, cu.mark ? null : DASH[r.row.tag])) segs.push(d)
    }
    const num = [labelOf(r.row, c, g)].concat(r.folded.map(f => f.row.name.toUpperCase() + " " + labelOf(f.row, c, g))).join("  ·  ")
    return { id: r.row.id, name: r.row.name, text: r.row.name.toUpperCase(), num: num, tag: r.row.tag, soft: !!r.row.shape.soft, size: r.size, point: r.point,
             segs: segs, seen: seen, at: r.geo.at, folded: r.folded.map(f => f.row.id), lab: { show: false, side: 1, x: 0, y: 0, w: 0, h: 0 } }
  }).filter(r => r.segs.length > 0)
  if (out.length === 0) return null
  // labels: the row being told, then the largest rows, until MAX_LABELS have
  // found room; each points at its own line, fanned from the upper right
  // downward so nested rings' names do not stack
  const tok = env.tok, items = [], put = []
  out.forEach((r, n) => {
    let ax, ay
    if (r.at && allowed(r.at[0], r.at[1], env.safe, env.obstacles)) { ax = r.at[0]; ay = r.at[1] }
    else if (r.seen.length > 0) {
      const b = bbox(r.seen), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ang = (-50 + 25 * Math.min(n, 5)) * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang)
      let best = -Infinity
      for (const p of r.seen) { const s = (p[0] - cx) * ux + (p[1] - cy) * uy; if (s > best) { best = s; ax = p[0]; ay = p[1] } }
    } else return
    r.ax = ax; r.ay = ay
    const w = env.textW(r.text, false) + (r.num ? tok.gap + env.textW(r.num, true) : 0)
    items.push({ id: "a-" + rec.id + "-" + r.id, x: ax, y: ay, r: tok.gap + (r.point ? 5 : 0), w: w, h: tok.label * 1.5, pin: false })
    put.push(r)
  })
  // the row being told is placed first: it has its label wherever there is room for one
  const order = items.map((_, i) => i).sort((a, b) => (put[b].id === env.lit) - (put[a].id === env.lit) || a - b)
  const res = Lay.placeLabels(order.map(i => items[i]), env.obstacles, env.safe, env.sides)
  let shown = 0
  order.forEach((i, n) => {
    const it = items[i], b = Lay.labelBoxAt(it, res[n].side), show = res[n].show && shown < MAX_LABELS
    if (show) shown++
    put[i].lab = { show: show, side: res[n].side, x: b.x, y: b.y, w: b.w, h: b.h }
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
