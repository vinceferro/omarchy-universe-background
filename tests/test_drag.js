// numeric checks for drag.js (run with node: node tests/test_drag.js lib/drag.js lib/camera.js)
const fs = require("fs")
const load = (path, names) => new Function(fs.readFileSync(path, "utf8").replace(".pragma library", "") + "\nreturn { " + names + " };")()
const Dr = load(process.argv[2], "Gesture, skyRay, skyAnglesFor, CLICK_PX, CLICK_S, VEL_WINDOW, REST_S, ORBIT_RATE, LOOK_RATE")
const Cam = load(process.argv[3] || process.argv[2].replace("drag.js", "camera.js"), "Spring, FLING_TAU")
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const PX = 1 / 1080

// a pointer path in screen units: starts at rest, accelerates, then runs at a
// steady 1.2 screen heights/s to the right for its last 150 ms
function path(t) { return t < 0.2 ? [0.5 * 1.2 * t * t / 0.2, 0] : [0.5 * 1.2 * 0.2 + 1.2 * (t - 0.2), 0] }
// the gesture driven at `hz` events per second over `T` seconds; the state is
// the arcball yaw, written the way the host does it
function drive(hz, T, scale) {
  scale = scale || Dr.ORBIT_RATE
  const g = new Dr.Gesture(path(0), 0, PX, [0])
  for (let i = 1; i * (1 / hz) < T; i++) {
    const t = i / hz
    g.move(path(t), t)
    g.record([g.x0[0] + g.offset()[0] * scale])
  }
  g.move(path(T), T); g.record([g.x0[0] + g.offset()[0] * scale])   // the release position
  return g
}

// 1. same gesture at 60 and 165 Hz: same coast
{
  const a = drive(60, 0.4), b = drive(165, 0.4)
  const va = a.velocity(0.4 + 0.002, Cam.FLING_TAU)[0], vb = b.velocity(0.4 + 0.002, Cam.FLING_TAU)[0]
  check("release velocity at 60 Hz == 165 Hz (steady run)", Math.abs(va - vb) < 1e-9 * Math.abs(va), (va - vb).toExponential(2))
  check("release velocity is the pointer's, times the orbit rate", Math.abs(va - 1.2 * Dr.ORBIT_RATE) < 1e-9, va.toFixed(4))
  check("both are drags, not clicks", a.dragging && b.dragging && !a.isClick(0.4) && !b.isClick(0.4))
  // an accelerating release (cut inside the ramp): the fit over the window agrees within a few percent
  const c = drive(60, 0.15), d = drive(165, 0.15)
  const vc = c.velocity(0.15, 1)[0], vd = d.velocity(0.15, 1)[0]
  check("accelerating release: 60 vs 165 Hz within 0.5%", Math.abs(vc - vd) < 0.005 * Math.abs(vd), (vc / vd).toFixed(4))
  // millisecond timestamps (the host's Date.now) and a burst of two events in one ms
  const g = new Dr.Gesture(path(0), 0, PX, [0])
  for (let i = 1; i <= 66; i++) { const t = Math.round(i / 165 * 1000) / 1000; g.move(path(t), t); g.record([g.offset()[0] * Dr.ORBIT_RATE]) }
  g.move(path(0.4), 0.4); g.record([g.offset()[0] * Dr.ORBIT_RATE])   // same ms as the last sample
  const vg = g.velocity(0.4, Cam.FLING_TAU)[0]
  check("ms clock + two events in one ms: no spike (within 2%)", Math.abs(vg - va) < 0.02 * va, (vg / va).toFixed(4))
}

// 2. the coast is the spring's fling at the measured velocity, with no jump at release
{
  const g = drive(165, 0.4)
  const x = g.samples[g.samples.length - 1].x[0], v = g.velocity(0.4, Cam.FLING_TAU)[0]
  const s = new Cam.Spring(x, 22); s.set(x, v); s.fling(Cam.FLING_TAU)
  const x1 = s.step(1 / 165)
  check("first coasting frame moves ~v dt (no jump)", Math.abs((x1 - x) - v / 165) < 0.05 * v / 165, ((x1 - x) * 165 / v).toFixed(3))
  let last = x1, vLast = s.v, mono = true, slowing = true
  for (let i = 0; i < 400; i++) { const y = s.step(1 / 165); if (y < last - 1e-12) mono = false; if (s.v > vLast + 1e-12) slowing = false; last = y; vLast = s.v }
  check("coast only ever slows (no kick after release) and stops at x + v tau", mono && slowing && !s.moving() && Math.abs(last - (x + v * Cam.FLING_TAU)) < 1e-6, (last - x).toFixed(4))
  check("fling restored the spring's input stiffness once settled", s.w === 22)
}

// 3. grab mid-fling: the position does not jump and the velocity is dropped
{
  const s = new Cam.Spring(0, 22); s.set(0, 3); s.fling()
  for (let i = 0; i < 5; i++) s.step(1 / 165)
  const xBefore = s.x
  s.hold()                                // what Camera.stop / the host does on press
  const x1 = s.step(1 / 165)
  check("grab mid-fling: x unchanged, no further motion, stiffness home", x1 === xBefore && s.v === 0 && s.w === 22, (x1 - xBefore).toExponential(2))
  const gl = new Cam.Spring(0, 4.75); gl.g = 1; gl.step(0.1); const xg = gl.x
  gl.hold(); gl.step(0.1)
  check("hold leaves a flight's glide alone", gl.x > xg && gl.g === 1)
  // the state written during the drag stays put between pointer events
  s.set(xBefore + 0.01)
  for (let i = 0; i < 10; i++) s.step(1 / 165)
  check("state written by the drag does not drift between events", s.x === xBefore + 0.01)
}

// 4. release jitter and a rested pointer: no fling
{
  const g = new Dr.Gesture([0, 0], 0, PX, [0])
  for (let i = 1; i <= 40; i++) { g.move([i * 0.01, 0], i / 165); g.record([i * 0.01 * Dr.ORBIT_RATE]) }
  const t = 40 / 165
  const vSteady = g.velocity(t, Cam.FLING_TAU)[0]
  check("a steady drag flings", vSteady > 0)
  // two pixels of wobble over the last window, after a stop: jitter
  const j = new Dr.Gesture([0, 0], 0, PX, [0])
  for (let i = 1; i <= 40; i++) { j.move([i * 0.01, 0], i / 165); j.record([i * 0.01 * Dr.ORBIT_RATE]) }
  for (let i = 1; i <= 12; i++) { j.move([0.4 + (i % 2) * PX, (i % 2) * PX], t + i / 165); j.record([(0.4 + (i % 2) * PX) * Dr.ORBIT_RATE]) }
  check("wobble on release: no fling", j.velocity(t + 12 / 165, Cam.FLING_TAU)[0] === 0)
  // held still for longer than REST_S, then released
  check("pointer rested before release: no fling", g.velocity(t + Dr.REST_S + 0.01, Cam.FLING_TAU)[0] === 0)
  check("released right away: fling", g.velocity(t + 0.005, Cam.FLING_TAU)[0] > 0)
}

// 5. click classification
{
  const c = new Dr.Gesture([0, 0], 0, PX, [0])
  c.move([2 * PX, 1 * PX], 0.05)
  check("2 px in 50 ms: a click", c.isClick(0.08) && !c.dragging)
  const d = new Dr.Gesture([0, 0], 0, PX, [0])
  d.move([6 * PX, 0], 0.02)
  d.move([1 * PX, 0], 0.03)              // back to where it started: still a drag
  check("6 px and back: a drag, never a click", d.dragging && !d.isClick(0.05))
  const h = new Dr.Gesture([0, 0], 0, PX, [0])
  h.move([1 * PX, 0], 0.3)
  check("held 0.5 s without moving: not a click", !h.isClick(0.5))
  check("thresholds: 4 px, 0.35 s", Dr.CLICK_PX === 4 && Dr.CLICK_S === 0.35)
}

// 6. the sky's angular grab: the ray pressed on stays under the pointer exactly
{
  let worst = 0, n = 0
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 2000; i++) {
    const focal = 0.5 / Math.tan((8 + rnd() * 122) * Math.PI / 360)
    const l0 = (rnd() - 0.5) * 4 * Math.PI, b0 = (rnd() - 0.5) * 2 * 1.5
    const s0 = [(rnd() - 0.5) * 1.78, rnd() - 0.5], s1 = [(rnd() - 0.5) * 1.78, rnd() - 0.5]
    const d = Dr.skyRay(l0, b0, s0, focal)
    const a = Dr.skyAnglesFor(d, s1, focal, l0, b0, 89 * Math.PI / 180)
    if (!a.exact) continue   // out of reach without roll, or at the pitch clamp: the patch slides, no claim
    const d1 = Dr.skyRay(a.l, a.b, s1, focal)
    worst = Math.max(worst, Math.hypot(d1[0] - d[0], d1[1] - d[1], d1[2] - d[2])); n++
  }
  check("sky grab: ray(l, b, s1) == ray pressed on, " + n + " random cases", worst < 1e-9, worst.toExponential(2))
  // no motion of the pointer: the same angles back (the trivial grab)
  const d = Dr.skyRay(1.0, 0.4, [0.3, -0.2], 1.17)
  const a = Dr.skyAnglesFor(d, [0.3, -0.2], 1.17, 1.0, 0.4, 1.55)
  check("sky grab: pointer still -> same (l, b)", Math.abs(a.l - 1.0) < 1e-12 && Math.abs(a.b - 0.4) < 1e-12)
  // a horizontal drag at the screen's centre, looking at the horizon: l moves by the angle under the pixels
  const f = 0.5 / Math.tan(46 * Math.PI / 360)
  const dc = Dr.skyRay(0.2, 0, [0, 0], f)
  const ac = Dr.skyAnglesFor(dc, [0.1, 0], f, 0.2, 0, 1.55)
  // (the pointer went right, so the camera turned left: +l, as the arrows and the old drag had it)
  check("sky grab: centre drag of 0.1 heights turns l by atan(0.1 / focal)", Math.abs((ac.l - 0.2) - Math.atan2(0.1, f)) < 1e-12 && Math.abs(ac.b) < 1e-12, (ac.l - 0.2).toFixed(5))
  // longitude stays unwrapped near the current value
  const dw = Dr.skyRay(10.0, 0.1, [0, 0], f)
  const aw = Dr.skyAnglesFor(dw, [0.01, 0], f, 10.0, 0.1, 1.55)
  check("sky grab: l unwrapped near the current turn", Math.abs(aw.l - 10.0) < 0.1)
}

// 7. the orbit rate: half a screen height is a right angle; the look rate is the shader's field
check("arcball: half a screen height = 90 deg", Math.abs(0.5 * Dr.ORBIT_RATE - Math.PI / 2) < 1e-12)
check("look rate = the fall shader's vertical field (focal 1)", Math.abs(Dr.LOOK_RATE - 2 * Math.atan(0.5)) < 1e-12)

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
