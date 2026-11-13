.pragma library
// camera.js — one camera and one motion law for every view of Universe Background.
//
// Plain JS on arrays of doubles. No Qt value types in here (a vector2d/3d read into
// a const is a live reference; that bug class cannot happen below). QML converts to
// Qt.vector3d only when handing uniforms to the shader.
//
// The camera is an orbit camera around a FOCUS point F:
//   h          world height of the screen at the focus plane; ell = ln h
//   yaw, pitch where the eye sits on the sphere around F (world frame)
//   fov        vertical field of view: 2.4 deg looks orthographic, 53 deg is the chase view
//   C = F - fwd * h * focal,  focal = 0.5 / tan(fov / 2)        (the eye)
//   o          principal point offset, screen units (only the universe corner view)
//   roll       screen spin, radians
//   sigma      world scale blend the world builder reads back (0 squeezed .. 1 true)
// Changing fov with h fixed keeps whatever sits on the focus plane the same size on
// screen (a dolly zoom): that is the orthographic <-> perspective morph, every frame
// of it a valid pinhole camera, so ONE project() serves picks, labels, markers and
// the shader's ray generator.
//
// Motion: every channel is a critically damped spring. Inputs, flights and tracked
// targets write goals (or, for direct manipulation, state + velocity); the spring
// step is the only thing that writes a displayed value. Hence every transition is
// velocity-continuous, every step is exact for any dt (no frame-rate dependence),
// and nothing has a tail: a spring is done 4.75/w s after its last goal change.
// Tracked targets (a planet in sim time, a hotspot in time-lapse, the sun vector in
// chase) are followed with ZERO lag: spring state is kept as an offset from the
// reference and the reference's own motion is carried through x and g alike.

// ---------- vectors ----------
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k] }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function len(a) { return Math.hypot(a[0], a[1], a[2]) }
function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x }
// the angle equal to `goal` mod 2pi that is nearest `near` (the short way round)
function unwrap(goal, near) { return goal + Math.round((near - goal) / (2 * Math.PI)) * 2 * Math.PI }

// ---------- stiffness presets (rad/s): w = 4.75 / t95 ----------
const W_INPUT = 22       // wheel, keys, flings: 95% of a step in 0.22 s
const W_MODE = 8         // fov morph, roll, scale blend, cross-fades: 0.6 s
const FLING_TAU = 0.18   // a released drag coasts v * tau, then stops

// ---------- critically damped spring, closed form ----------
// eps: below this distance and speed the spring snaps to its goal and reports settled.
// It must be perceptual, not numeric: the Camera passes 1e-6 of the view height for
// positions (a snap of 1e-9 * |g| would be visible at true scale, where |g| ~ 1000)
function Spring(x, w) { this.x = x; this.v = 0; this.g = x; this.w = w }
Spring.prototype.step = function(dt, eps) {
  const c1 = this.x - this.g, c2 = this.v + this.w * c1
  const e = Math.exp(-this.w * dt)
  this.x = this.g + (c1 + c2 * dt) * e
  this.v = (c2 - this.w * (c1 + c2 * dt)) * e
  if (eps === undefined) eps = 1e-6
  if (Math.abs(this.x - this.g) < eps && Math.abs(this.v) < eps) { this.x = this.g; this.v = 0 }
  return this.x
}
Spring.prototype.carry = function(d) { this.x += d; this.g += d }              // the reference moved: no lag
Spring.prototype.set = function(x, v) { this.x = x; this.g = x; this.v = v || 0 }   // direct manipulation
Spring.prototype.fling = function(tau) { this.g = this.x + this.v * (tau === undefined ? FLING_TAU : tau) }
Spring.prototype.moving = function() { return this.x !== this.g || this.v !== 0 }

function VSpring(x, w) { this.s = x.map(xi => new Spring(xi, w)) }
VSpring.prototype.step = function(dt, eps) { return this.s.map(s => s.step(dt, eps)) }
VSpring.prototype.carry = function(d) { this.s.forEach((s, i) => s.carry(d[i])) }
VSpring.prototype.set = function(x, v) { this.s.forEach((s, i) => s.set(x[i], v ? v[i] : 0)) }
VSpring.prototype.fling = function(tau) { this.s.forEach(s => s.fling(tau)) }
VSpring.prototype.moving = function() { return this.s.some(s => s.moving()) }
Object.defineProperty(VSpring.prototype, "x", { get() { return this.s.map(s => s.x) } })
Object.defineProperty(VSpring.prototype, "v", { get() { return this.s.map(s => s.v) } })
Object.defineProperty(VSpring.prototype, "g", { get() { return this.s.map(s => s.g) }, set(g) { this.s.forEach((s, i) => s.g = g[i]) } })
Object.defineProperty(VSpring.prototype, "w", { set(w) { this.s.forEach(s => s.w = w) } })

// ---------- flights: van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003) ----------
// u = distance along the straight line from start to end, w = view height h. The path
// rises (zooms out) and descends so that perceived speed is constant; rho is how high
// it rises (1.42 is the paper's optimum, 1.6 shows the destination sooner).
function planPath(u1, w0, w1, rho) {
  if (u1 < 1e-9 * Math.max(w0, w1)) {
    return { pure: true, w0: w0, k: w1 > w0 ? 1 : -1, S: Math.abs(Math.log(w1 / w0)) / rho, rho: rho, u1: 0 }
  }
  const b = (i, wi) => (w1 * w1 - w0 * w0 + (i ? -1 : 1) * Math.pow(rho, 4) * u1 * u1) / (2 * wi * rho * rho * u1)
  const r = (bb) => Math.log(-bb + Math.sqrt(bb * bb + 1))
  const r0 = r(b(0, w0)), r1 = r(b(1, w1))
  return { pure: false, w0: w0, r0: r0, S: (r1 - r0) / rho, rho: rho, u1: u1 }
}
function pathAt(P, s) {
  if (P.pure) return { u: 0, w: P.w0 * Math.exp(P.k * P.rho * s) }
  const c = Math.cosh(P.r0), rr = P.rho * P.rho
  return { u: P.w0 / rr * (c * Math.tanh(P.rho * s + P.r0) - Math.sinh(P.r0)), w: P.w0 * c / Math.cosh(P.rho * s + P.r0) }
}
// time law 0..1: cubic Hermite whose initial slope m0 matches the motion already
// under way (a click mid-glide does not kink) and that ends at rest
function hermite(tau, m0) { return m0 * tau * (1 - tau) * (1 - tau) + tau * tau * (3 - 2 * tau) }

// ---------- the camera ----------
// cfg: e1, e2, up    the frame of the yaw/pitch sphere:
//                    dir(yaw, pitch) = cos(pitch) (sin(yaw) e1 + cos(yaw) e2) + sin(pitch) up
//      rollUp        which world axis is "up on screen" (default: up)
//      atFocus       the eye sits on F and looks outward along dir (sky mode)
//      ell, pitch    [min, max];  rho
function Camera(cfg) {
  this.e1 = cfg.e1 || [1, 0, 0]
  this.e2 = cfg.e2 || [0, 0, 1]
  this.up = cfg.up || [0, 1, 0]
  this.rollUp = cfg.rollUp || this.up
  this.atFocus = !!cfg.atFocus
  this.rho = cfg.rho || 1.6
  this.lim = { ell: cfg.ell || [-60, 60], pitch: cfg.pitch || [-1.45, 1.45],
               fovT: [Math.log(Math.tan(0.021)), Math.log(Math.tan(1.2))] }

  this.F = new VSpring([0, 0, 0], W_INPUT)
  this.ell = new Spring(0, W_INPUT)
  this.yaw = new Spring(0, W_INPUT)
  this.pitch = new Spring(0.3, W_INPUT)
  this.fovT = new Spring(Math.log(Math.tan(0.021)), W_MODE)   // ln tan(fov/2); 2.4 deg: the orthographic look
  this.o = new VSpring([0, 0], W_MODE)
  this.roll = new Spring(0, W_MODE)
  this.sigma = new Spring(0, W_MODE)

  this.track = null              // () => { p: [x,y,z], lnr?: ln(radius), az?: azimuth }, evaluated every frame
  this.ref = { p: [0, 0, 0], lnr: 0, az: 0 }
  this.anchor = null             // zoom to cursor: { s: screen point, P: world point held under it }
  this.grab = null               // drag: { P0: grabbed world point, plane, s, t, vel }
  this.flight = null
  this.b = null
  this.update(0)
}

// ---- derived ----
Camera.prototype.h = function() { return Math.exp(this.ell.x) }
Camera.prototype.focal = function() { return 0.5 / Math.exp(this.fovT.x) }
Camera.prototype.dir = function(yaw, pitch) {
  const cp = Math.cos(pitch)
  return add(mul(add(mul(this.e1, Math.sin(yaw)), mul(this.e2, Math.cos(yaw))), cp), mul(this.up, Math.sin(pitch)))
}
// yaw/pitch that put the eye in world direction `dir` from the focus (galactic view
// poses are given as directions in the Sun's velocity frame; this maps them onto
// the one yaw/pitch state)
Camera.prototype.anglesOf = function(dir) {
  const d = norm(dir)
  return { yaw: Math.atan2(dot(d, this.e1), dot(d, this.e2)), pitch: Math.asin(clamp(dot(d, this.up), -1, 1)) }
}
Camera.prototype.basis = function() {
  const d = this.dir(this.yaw.x, this.pitch.x)
  const fwd = this.atFocus ? d : mul(d, -1)
  let right = cross(fwd, this.rollUp)
  right = norm(len(right) < 1e-6 ? cross(fwd, this.e1) : right)
  let up = cross(right, fwd)
  if (this.roll.x !== 0) {
    const c = Math.cos(this.roll.x), s = Math.sin(this.roll.x)
    const r2 = add(mul(right, c), mul(up, s))
    up = sub(mul(up, c), mul(right, s)); right = r2
  }
  const focal = this.focal(), h = this.h(), D = this.atFocus ? 0 : h * focal
  const F = this.F.x
  return { F: F, fwd: fwd, right: right, up: up, focal: focal, h: h, D: D, o: this.o.x,
           C: sub(F, mul(fwd, D)), relC: mul(fwd, -D) }   // relC: the eye relative to F, what the shader gets
}
// world -> screen: x in [-aspect/2, aspect/2], y in [-0.5, 0.5] (the shader's p), z depth,
// scale = screen units per world unit there. Pixels: ((x / aspect + 0.5) W, (y + 0.5) H).
Camera.prototype.project = function(P, b) {
  b = b || this.b
  const v = sub(P, b.C), z = dot(v, b.fwd)
  const k = b.focal / Math.max(Math.abs(z), 1e-12)
  return { x: dot(v, b.right) * k + b.o[0], y: -dot(v, b.up) * k + b.o[1], z: z, scale: k, front: z > 0 }
}
// screen -> world: on the focus plane (no plane given) or on a world plane {n, d} (n.P = d)
Camera.prototype.unproject = function(s, plane, b) {
  b = b || this.b
  const sx = s[0] - b.o[0], sy = s[1] - b.o[1]
  if (!plane) return add(b.F, mul(add(mul(b.right, sx), mul(b.up, -sy)), b.h))
  const rd = norm(add(add(mul(b.fwd, b.focal), mul(b.right, sx)), mul(b.up, -sy)))
  const den = dot(rd, plane.n)
  if (Math.abs(den) < 1e-6) return null
  const t = (plane.d - dot(b.C, plane.n)) / den
  return t > 0 ? add(b.C, mul(rd, t)) : null
}
// a screen offset as a world offset on the focus plane
Camera.prototype.screenToWorld = function(ds, b) {
  b = b || this.b
  return mul(add(mul(b.right, ds[0]), mul(b.up, -ds[1])), b.h)
}
// move the focus plane to depth dz along fwd without moving the eye (image unchanged):
// C = F - fwd h focal is invariant under F += fwd dz, h += dz / focal
Camera.prototype.refocus = function(dz) {
  const b = this.b
  const h2 = b.h + dz / b.focal
  if (h2 <= 1e-12) return
  this.F.carry(mul(b.fwd, dz))
  this.ell.carry(Math.log(h2) - this.ell.x)
  this.b = this.basis()
}

// ---- tracking ----
Camera.prototype.follow = function(track) {
  // switch references without a jump: the state stays, offsets are re-based
  this.track = track
  const r = track ? track() : { p: this.F.x }
  this.ref = { p: r.p, lnr: r.lnr || 0, az: r.az || 0 }
  this.anchor = null
}
Camera.prototype.free = function() { if (this.track) this.follow(null) }

// ---- direct manipulation: the scene sticks to the pointer, a release coasts ----
// s: screen point ([x, y] in p units), t: seconds, plane: world plane to grab (the
// ecliptic in the overview) or undefined for the focus plane
Camera.prototype.grabBegin = function(s, t, plane) {
  const P0 = this.unproject(s, plane)
  if (!P0) return
  this.free(); this.flight = null; this.anchor = null
  this.grab = { P0: P0, plane: plane, s: s, t: t, vel: [0, 0, 0] }
}
Camera.prototype.grabMove = function(s, t) {
  const g = this.grab
  if (!g) return
  const hit = this.unproject(s, g.plane)
  if (!hit) return
  const d = sub(g.P0, hit)                           // put the grabbed point back under the pointer
  const dt = Math.max(1e-3, t - g.t)
  g.vel = add(mul(g.vel, 0.6), mul(d, 0.4 / dt))     // light low-pass on the pointer's velocity
  g.t = t; g.s = s
  this.F.set(add(this.F.x, d), g.vel)
}
Camera.prototype.grabEnd = function() { if (this.grab) { this.F.fling(); this.grab = null } }
// orbit: by drag (direct, with the pointer's velocity) or by keys (a gliding goal)
Camera.prototype.orbit = function(dyaw, dpitch, direct, dt) {
  const p1 = clamp((direct ? this.pitch.x : this.pitch.g) + dpitch, this.lim.pitch[0], this.lim.pitch[1])
  if (direct) {
    dt = Math.max(1e-3, dt || 0)
    const vy = dyaw / dt, vp = (p1 - this.pitch.x) / dt
    this.ov = this.ov ? [this.ov[0] * 0.6 + vy * 0.4, this.ov[1] * 0.6 + vp * 0.4] : [vy, vp]   // light low-pass, as grabMove
    this.yaw.set(this.yaw.x + dyaw, this.ov[0])
    this.pitch.set(p1, this.ov[1])
  } else { this.yaw.g += dyaw; this.pitch.g = p1 }
}
Camera.prototype.orbitEnd = function() { this.yaw.fling(); this.pitch.fling(); this.ov = null }
// keys: the focus goal glides by a world offset (QML builds it from screenToWorld or a level vector)
Camera.prototype.move = function(dWorld) {
  this.free(); this.flight = null; this.anchor = null
  this.F.g = add(this.F.g, dWorld)
}

// ---- zoom ----
Camera.prototype.zoomBy = function(dEll) {
  this.flight = null
  this.ell.g = clamp(this.ell.g + dEll, this.lim.ell[0], this.lim.ell[1])
}
// zoom about the point under screen point s: it stays under s at EVERY frame however
// the zoom eases, because while anchored the focus is a function of h (see update).
// plane: a world plane whose point under the pointer is the one to hold (the ecliptic);
// without it, the point on the focus plane.
Camera.prototype.zoomAt = function(s, dEll, plane) {
  if (this.track) return this.zoomBy(dEll)            // following a body: zoom about the body
  const a = this.anchor
  if (!a || Math.hypot(a.s[0] - s[0], a.s[1] - s[1]) > 0.004) {
    if (plane) {
      const Q = this.unproject(s, plane)
      if (Q) this.refocus(dot(sub(Q, this.b.F), this.b.fwd))   // focus plane through the held point
    }
    this.anchor = { s: s, P: this.unproject(s) }
  }
  this.zoomBy(dEll)
}
Camera.prototype.fovBy = function(dFovT) { this.fovT.g = clamp(this.fovT.g + dFovT, this.lim.fovT[0], this.lim.fovT[1]) }

// ---- flights ----
// dest: track?: fn | focus?: [x,y,z];  ellRel?: ln(h / radius) with a track that has lnr,
//       or ell?: absolute;  yawRel? (from the track's azimuth) | yaw?;  pitch?, fovT?, roll?, sigma?, o?
// opts: time? (s; default from the path length), rho?,
//       uScale? plan the path for a trip uScale times the current offset: the
//       world is being rescaled under the flight (see scaleFlight) and will have
//       shrunk or grown by that factor when it lands
// Returns the flight time.
Camera.prototype.flyTo = function(dest, opts) {
  opts = opts || {}
  const x0 = this.F.x, v0 = this.F.v, ell0 = this.ell.x, dell0 = this.ell.v
  this.anchor = null; this.grab = null
  this.follow(dest.track || null)                      // zero-lag tracking from the first frame
  const ref = this.ref
  const target = dest.track ? ref.p : (dest.focus || x0)
  const d0 = sub(x0, target), u1 = len(d0) * (opts.uScale || 1)
  const ell1 = dest.ellRel !== undefined ? ref.lnr + dest.ellRel : dest.ell !== undefined ? dest.ell : ell0
  const P = planPath(u1, Math.exp(ell0), Math.exp(ell1), opts.rho || this.rho)
  const T = opts.time || clamp(0.55 + 0.3 * Math.abs(P.S), 0.8, 2.2)
  // slope of the time law from the velocity already under way, projected on the
  // path's initial direction (per unit tau)
  let m0 = 0
  if (P.S > 1e-9) {
    const a0 = pathAt(P, 0), a1 = pathAt(P, P.S * 1e-3)
    const du = (a1.u - a0.u) / 1e-3, dl = (Math.log(a1.w) - Math.log(a0.w)) / 1e-3
    const dir = u1 > 1e-12 ? mul(d0, -1 / u1) : [0, 0, 0]
    const dd = du * du + dl * dl
    m0 = dd > 1e-18 ? clamp((dot(v0, dir) * T * du + dell0 * T * dl) / dd, 0, 2) : 0
  }
  this.flight = { P: P, T: T, t: 0, m0: m0, d0: d0, u1: u1, dest: target, ell1: ell1, lnr0: ref.lnr,
                  lastF: x0, lastEll: ell0, scaled: opts.uScale !== undefined }
  // the angular and modal channels glide alongside, settling with the flight
  const w = 4.75 / Math.max(0.3, T * 0.8)
  if (dest.yaw !== undefined) { this.yaw.w = w; this.yaw.g = unwrap(dest.yaw, this.yaw.x) }
  if (dest.yawRel !== undefined) { this.yaw.w = w; this.yaw.g = unwrap(ref.az + dest.yawRel, this.yaw.x) }
  if (dest.pitch !== undefined) { this.pitch.w = w; this.pitch.g = clamp(dest.pitch, this.lim.pitch[0], this.lim.pitch[1]) }
  if (dest.fovT !== undefined) { this.fovT.w = w; this.fovT.g = dest.fovT }
  if (dest.roll !== undefined) { this.roll.w = w; this.roll.g = dest.roll }
  if (dest.sigma !== undefined) { this.sigma.w = w; this.sigma.g = dest.sigma }
  if (dest.o !== undefined) { this.o.w = w; this.o.g = dest.o }
  return T
}
Camera.prototype.flying = function() { return !!this.flight }
// the world rescaled about the destination by k since the last frame (the
// scale blend running under an exit flight): the remaining offset rides with it
Camera.prototype.scaleFlight = function(k) { if (this.flight) this.flight.d0 = mul(this.flight.d0, k) }
Camera.prototype.settled = function() {
  return !this.flight && !this.grab && ![this.F, this.ell, this.yaw, this.pitch, this.fovT, this.o, this.roll, this.sigma].some(s => s.moving())
}

// ---- the one per-frame step; returns the basis ----
Camera.prototype.update = function(dt) {
  // 1. tracked reference: carry its motion through state and goals (zero lag)
  if (this.track) {
    const r = this.track()
    this.F.carry(sub(r.p, this.ref.p))
    if (r.lnr !== undefined) this.ell.carry(r.lnr - this.ref.lnr)
    let az = this.ref.az
    if (r.az !== undefined) { az = unwrap(r.az, this.ref.az); this.yaw.carry(az - this.ref.az) }
    this.ref = { p: r.p, lnr: r.lnr || 0, az: az }
  }
  const fl = this.flight
  if (fl && dt > 0) {
    // 2a. a flight writes F and ell along the path, in offsets from the destination (which
    //     may be moving: the carry above already moved it). Goals follow, so an
    //     interruption continues from here with this velocity.
    fl.t = Math.min(fl.T, fl.t + dt)
    const a = pathAt(fl.P, fl.P.S * hermite(fl.t / fl.T, fl.m0))
    const dest = this.track ? this.ref.p : fl.dest
    const F = add(dest, mul(fl.d0, fl.u1 > 1e-12 ? 1 - a.u / fl.u1 : 0))
    const ell = Math.log(a.w) + (this.track ? this.ref.lnr - fl.lnr0 : 0)
    this.F.set(F, mul(sub(F, fl.lastF), 1 / dt))
    this.ell.set(ell, (ell - fl.lastEll) / dt)
    fl.lastF = F; fl.lastEll = ell
    if (fl.t >= fl.T) {
      this.F.set(dest, [0, 0, 0])
      this.ell.set(fl.ell1 + (this.track ? this.ref.lnr - fl.lnr0 : 0), 0)
      this.flight = null
      this.yaw.w = W_INPUT; this.pitch.w = W_INPUT
      this.fovT.w = W_MODE; this.roll.w = W_MODE; this.sigma.w = W_MODE; this.o.w = W_MODE
    }
  } else {
    // 2b. free motion: springs toward goals
    this.ell.g = clamp(this.ell.g, this.lim.ell[0], this.lim.ell[1])
    this.ell.step(dt)
    if (this.anchor && !this.track) {
      // zoom about the pointer: the focus is a function of h, exact at every frame
      const b = this.basis()
      const S = add(mul(b.right, this.anchor.s[0] - b.o[0]), mul(b.up, -(this.anchor.s[1] - b.o[1])))
      this.F.set(sub(this.anchor.P, mul(S, b.h)), mul(S, -b.h * this.ell.v))
      if (!this.ell.moving()) this.anchor = null
    } else if (!this.grab) this.F.step(dt, 1e-6 * this.h())
  }
  this.pitch.g = clamp(this.pitch.g, this.lim.pitch[0], this.lim.pitch[1])   // a fling never leaves the range
  this.yaw.step(dt, 1e-7); this.pitch.step(dt, 1e-7)
  this.fovT.step(dt); this.o.step(dt); this.roll.step(dt, 1e-7); this.sigma.step(dt)
  this.b = this.basis()
  return this.b
}
