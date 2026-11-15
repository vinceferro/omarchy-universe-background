.pragma library
// drag.js — one pointer gesture for every explore view of Universe Background.
//
// The pointer is a grab: what it holds follows it 1:1 while the button is
// down, and on release the view coasts with the pointer's measured velocity
// along the critically damped springs that move everything else (camera.js
// Spring.fling). Pressing on a coasting view stops it dead where it is: the
// spring's velocity goes to zero, its position does not change. The views
// differ only in WHAT the pointer holds:
//   sky      the direction under the pointer: an exact angular grab, the
//            patch of sky pressed on stays under the pixel all the way
//            (skyAnglesFor); longitude therefore runs faster near the poles
//   galaxy   the orbit about the focus, arcball style: half a screen height
//            of drag turns the camera a right angle (ORBIT_RATE). Under a
//            rotation about the focus nothing at the focus depth can stay
//            under the pointer, so the arcball is the mapping hands know
//   system   the same arcball orbit on the left button, everywhere (overview,
//            pinned body, chase, galactic); the ecliptic grabbed and panned on
//            the right or middle button or with Shift (camera.js grabBegin)
// The host (Background.qml) owns the state and writes it; this file holds the
// pure parts: the gesture record with its click classification and release
// velocity, the sky's angular grab, the orbit rate. Node-testable
// (tests/test_drag.js).
//
// Timing: samples carry the host's clock in seconds (Date.now() / 1000; a QML
// MouseEvent has no timestamp). Nothing divides by one event's dt: the release
// velocity is a least-squares slope over the last VEL_WINDOW seconds of the
// STATE the drag wrote, so two events in one millisecond, a coalesced burst
// (Wayland hands Qt one move per frame) or a 60 Hz pointer give the same coast
// as a 165 Hz one. A pointer that stopped before the button came up (REST_S)
// gives no coast, nor does release jitter that would coast under MIN_FLING_PX.

const CLICK_PX = 4          // moved less than this (pixels) ...
const CLICK_S = 0.35        // ... and let go within this (seconds): a click, else a drag
const VEL_WINDOW = 0.06     // seconds of samples the release velocity is fitted over
const REST_S = 0.08         // no move for this long before release: the pointer had stopped
const MIN_FLING_PX = 3      // a coast shorter than this (pixels) is jitter, not a throw
const ORBIT_RATE = Math.PI  // orbit views: radians per screen height of drag (arcball)
const LOOK_RATE = 2 * Math.atan(0.5)   // the fall's look-around at the shader's focal 1: the far field stays under the pointer

// s: pointer in screen units (p: x in +-aspect/2, y in +-0.5 downward), t: seconds,
// px: one pixel in screen units (1 / height), x: the state the drag will write, at press
function Gesture(s, t, px, x) {
  this.s0 = s; this.t0 = t; this.px = px
  this.s = s; this.t = t
  this.dragging = false                 // moved past CLICK_PX: never a click again
  this.x0 = x.slice()
  this.samples = [{ t: t, s: s, x: x.slice() }]
  this.held = null                      // what the pointer holds (the sky: the ray at press)
}
// the pointer moved; returns whether this is a drag now
Gesture.prototype.move = function(s, t) {
  this.s = s; this.t = t
  if (!this.dragging && Math.hypot(s[0] - this.s0[0], s[1] - this.s0[1]) > CLICK_PX * this.px) this.dragging = true
  return this.dragging
}
// the pointer's offset from the press, in screen heights
Gesture.prototype.offset = function() { return [this.s[0] - this.s0[0], this.s[1] - this.s0[1]] }
// the state the host wrote for the current pointer sample (after move)
Gesture.prototype.record = function(x) {
  this.samples.push({ t: this.t, s: this.s, x: x.slice() })
  while (this.samples.length > 64 || this.samples[0].t < this.t - 4 * VEL_WINDOW) this.samples.shift()
}
Gesture.prototype.isClick = function(t) { return !this.dragging && t - this.t0 < CLICK_S }
// mean velocity of f(sample) over the last VEL_WINDOW seconds: the end sample
// against the trail interpolated at exactly t1 - VEL_WINDOW, so the sample rate
// does not enter (a shorter trail uses all of it); null when it has no span
function windowVelocity(samples, f, n) {
  const last = samples[samples.length - 1], tw = last.t - VEL_WINDOW
  let i = samples.length - 1
  while (i > 0 && samples[i - 1].t > tw) i--
  let a = f(samples[i]), ta = samples[i].t
  if (i > 0) {                                  // samples[i-1].t <= tw < samples[i].t: interpolate
    const p = samples[i - 1], k = (tw - p.t) / (samples[i].t - p.t), fp = f(p)
    a = fp.map((v, j) => v + (a[j] - v) * k); ta = tw
  }
  if (last.t - ta < 1e-4) return null
  const b = f(last)
  return b.map((v, j) => (v - a[j]) / (last.t - ta)).slice(0, n)
}
// the state's velocity at release (t: now), for Spring.set(x, v) + fling(tau);
// zeros when the pointer had stopped, or the coast would be jitter
Gesture.prototype.velocity = function(t, tau) {
  const n = this.x0.length, zero = new Array(n).fill(0)
  if (this.samples.length < 2 || t - this.samples[this.samples.length - 1].t > REST_S) return zero
  const vs = windowVelocity(this.samples, a => a.s, 2)
  if (!vs || Math.hypot(vs[0], vs[1]) * tau < MIN_FLING_PX * this.px) return zero
  return windowVelocity(this.samples, a => a.x, n) || zero
}

// ---------- the sky's angular grab ----------
// The sky camera (Background.qml skyFwd/skyRight/skyUp, universe.frag): the eye
// at the origin looks along fw(l, b) with up toward the pole,
//   fw = (cos b sin l, -cos b cos l, sin b),  rt = (-cos l, -sin l, 0),  up = rt x fw
// and screen point s sees the ray  fw focal + rt sx - up sy  (y down). l, b radians.
function skyRay(l, b, s, focal) {
  const cl = Math.cos(l), sl = Math.sin(l), cb = Math.cos(b), sb = Math.sin(b)
  const x = focal * cb * sl - s[0] * cl + s[1] * sl * sb
  const y = -focal * cb * cl - s[0] * sl - s[1] * cl * sb
  const z = focal * sb - s[1] * cb
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n]
}
// the (l, b) that put the unit ray d under screen point s: the inverse of skyRay,
// closed form. In z: focal sin b - sy cos b = dz n (n the unnormalised ray's
// length), i.e. R sin(b - phi) = dz n with R = hypot(focal, sy), phi = atan2(sy,
// focal); two branches, the one nearer bNear. Then the xy plane: with
// A = focal cos b + sy sin b,  (-y + i x) = (A - i sx) e^{il} / n,  so
// l = atan2(dx, -dy) + atan2(sx, A). l comes back unwrapped to the turn of
// lNear. Not every pull is possible without roll (a patch near the pole cannot
// reach a pixel far down the screen), and b is clamped to +-bMax (the pole never
// crosses the screen's middle): then the patch slides and `exact` is false.
function skyAnglesFor(d, s, focal, lNear, bNear, bMax) {
  const n = Math.hypot(focal, s[0], s[1]), R = Math.hypot(focal, s[1]), phi = Math.atan2(s[1], focal)
  const q0 = d[2] * n / R, q = Math.max(-1, Math.min(1, q0)), a = Math.asin(q)
  let b = phi + a
  const b2 = phi + Math.PI - a
  const nearer = (x) => { const w = x - 2 * Math.PI * Math.round((x - bNear) / (2 * Math.PI)); return w }
  b = nearer(b); const bb = nearer(b2)
  if (Math.abs(bb - bNear) < Math.abs(b - bNear)) b = bb
  const bc = Math.max(-bMax, Math.min(bMax, b))
  const A = focal * Math.cos(bc) + s[1] * Math.sin(bc)
  let l = Math.atan2(d[0], -d[1]) + Math.atan2(s[0], A)
  l -= 2 * Math.PI * Math.round((l - lNear) / (2 * Math.PI))
  return { l: l, b: bc, exact: q === q0 && bc === b }
}
