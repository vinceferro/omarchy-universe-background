// numeric checks for camera.js (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Cam = new Function(src + "\nreturn { Spring, VSpring, Camera, planPath, pathAt, hermite, add, sub, mul, dot, len };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }

// 1. spring: same curve at 165 Hz, 60 Hz and one 30 ms hiccup
function run(dts) { const s = new Cam.Spring(0, 22); s.g = 1; let t = 0; for (const dt of dts) { s.step(dt); t += dt } return { x: s.x, t } }
const a = run(new Array(165).fill(1 / 165)), b = run(new Array(60).fill(1 / 60))
check("spring frame-rate independent (1 s)", Math.abs(a.x - b.x) < 1e-9, (a.x - b.x))
const c = run([0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03].concat(new Array(116).fill(1 / 165)))
check("spring exact through hiccups", Math.abs(c.x - a.x) < 1e-9, c.x - a.x)
// settle: 95% at 4.75/w
const s95 = new Cam.Spring(0, 22); s95.g = 1; for (let i = 0; i < 165 * 4.75 / 22; i++) s95.step(1 / 165)
check("spring 95% at t = 4.75/w", Math.abs(s95.x - 0.95) < 0.01, s95.x)
// velocity continuity when the goal changes mid-way
const sv = new Cam.Spring(0, 22); sv.g = 1; for (let i = 0; i < 10; i++) sv.step(1 / 165)
const vBefore = sv.v; sv.g = 3; sv.step(1 / 165)
check("goal change: velocity continuous (|dv| <= w^2 dg dt)", Math.abs(sv.v - vBefore) <= 22 * 22 * 2 * (1 / 165), (sv.v - vBefore).toFixed(4))

// 2. camera: project/unproject round trip, tilted overview with roll
const cam = new Cam.Camera({ ell: [-12, 2] })
cam.ell.set(Math.log(1 / 3.2)); cam.pitch.set(Math.asin(0.30)); cam.roll.set(-0.10); cam.update(0)
const s0 = [0.37, -0.21]
const P0 = cam.unproject(s0)
const pr = cam.project(P0)
check("project(unproject(s)) == s", Math.hypot(pr.x - s0[0], pr.y - s0[1]) < 1e-9)
const ecl = { n: [0, 1, 0], d: 0 }
const Q0 = cam.unproject(s0, ecl)
const prQ = cam.project(Q0)
check("plane hit projects back to s", Q0 && Math.hypot(prQ.x - s0[0], prQ.y - s0[1]) < 1e-9)

// 3. zoom to cursor on the ecliptic: the point stays under the pointer at EVERY frame
cam.zoomAt(s0, -Math.log(1.25), ecl)
const hStart = cam.h()   // after the refocus onto the ecliptic point (image unchanged)
let worst = 0
for (let i = 0; i < 260; i++) {
  if (i === 20) cam.zoomAt(s0, -Math.log(1.25), ecl)   // a second notch mid-ease
  cam.update(1 / 165)
  const p = cam.project(Q0)
  worst = Math.max(worst, Math.hypot(p.x - s0[0], p.y - s0[1]))
}
check("zoom-to-cursor exact every frame (max drift, screen units)", worst < 1e-9, worst)
check("zoom landed on h / 1.25^2", Math.abs(cam.h() - hStart / 1.5625) < 1e-6, cam.h() / hStart)

// 4. refocus keeps the image: eye and basis unchanged
const before = cam.basis(); cam.refocus(0.05); const after = cam.basis()
check("refocus leaves the eye in place", Cam.len(Cam.sub(before.C, after.C)) < 1e-12 && Math.abs(before.focal - after.focal) < 1e-12)

// 5. flight to a MOVING target lands exactly on it, at the asked size, velocity-continuous
const cam2 = new Cam.Camera({ ell: [-12, 2] })
cam2.ell.set(Math.log(1 / 3.2)); cam2.pitch.set(Math.asin(0.30)); cam2.update(0)
let simT = 0
const R = 0.0045
const body = () => ({ p: [0.15 * Math.cos(simT), 0, 0.15 * Math.sin(simT)], lnr: Math.log(R) })
const T = cam2.flyTo({ track: body, ellRel: Math.log(16.7), sigma: 1 })
let maxJump = 0, lastV = null
for (let t = 0; t < T + 0.5; t += 1 / 165) {
  simT += 0.8 / 165        // the body moves fast (0.8 rad/s)
  cam2.update(1 / 165)
  const v = cam2.F.v
  if (lastV) maxJump = Math.max(maxJump, Cam.len(Cam.sub(v, lastV)) * 165)   // acceleration
  lastV = v
}
const bp = body().p
check("flight lands on the moving body", Cam.len(Cam.sub(cam2.F.x, bp)) < 1e-9, Cam.len(Cam.sub(cam2.F.x, bp)))
check("flight lands at the asked size (h = 16.7 R)", Math.abs(cam2.h() / R - 16.7) < 1e-6, cam2.h() / R)
check("flight+landing never jumps (max |accel| sane)", maxJump < 200, maxJump.toFixed(2))
check("after landing the body is centred and tracked", (() => { simT += 0.3; cam2.update(1 / 165); const p = cam2.project(body().p); return Math.hypot(p.x, p.y) < 1e-9 })())

// 6. dolly zoom: fov morph keeps the focused body's apparent size exactly
const size0 = R * cam2.project(body().p).scale
cam2.fovT.g = Math.log(Math.tan(0.46))   // ~53 deg chase
for (let i = 0; i < 200; i++) cam2.update(1 / 165)
const size1 = R * cam2.project(body().p).scale
check("ortho->perspective morph keeps focus size", Math.abs(size1 / size0 - 1) < 1e-9, (size1 / size0).toFixed(9))
check("eye came in to h*focal", Math.abs(cam2.b.D - cam2.h() * cam2.b.focal) < 1e-12)

// 7. chase: yaw rides the sun vector with zero lag
const sun = [0, 0, 0]
const chaseTrack = () => { const p = body().p; const d = Cam.sub(p, sun); return { p, lnr: Math.log(R), az: Math.atan2(d[0], d[2]) } }
cam2.flyTo({ track: chaseTrack, yawRel: 0.35, pitch: 0.18 }, { time: 0.8 })
for (let t = 0; t < 1.5; t += 1 / 165) { simT += 0.8 / 165; cam2.update(1 / 165) }
const az = chaseTrack().az
const yawErr = Math.abs(((cam2.yaw.x - az - 0.35) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI)
check("chase yaw = sun azimuth + offset while the body orbits", yawErr < 1e-5, yawErr)

// 8. drag: scene sticks to the pointer, release coasts and stops
const cam3 = new Cam.Camera({}); cam3.ell.set(Math.log(0.3)); cam3.pitch.set(Math.asin(0.3)); cam3.update(0)
const grabbed = cam3.unproject([0.1, 0.1], ecl)
cam3.grabBegin([0.1, 0.1], 0, ecl)
for (let i = 1; i <= 30; i++) { cam3.grabMove([0.1 + i * 0.01, 0.1], i / 165); cam3.update(1 / 165) }
const pg = cam3.project(grabbed)
check("grabbed ecliptic point stays under the pointer", Math.hypot(pg.x - 0.4, pg.y - 0.1) < 1e-9, Math.hypot(pg.x - 0.4, pg.y - 0.1))
cam3.grabEnd(); const xRel = cam3.F.x
let moved = 0; for (let i = 0; i < 165; i++) { cam3.update(1 / 165); moved = Cam.len(Cam.sub(cam3.F.x, xRel)) }
check("fling coasts a little and settles", moved > 0 && cam3.settled(), moved.toFixed(4))

// 9. exit flight under a collapsing world: the offset rides the rescale and the
//    camera still lands exactly on the destination
{
  const cam4 = new Cam.Camera({ ell: [-12, 2] })
  cam4.F.set([105, 0, 0]); cam4.ell.set(Math.log(0.075)); cam4.pitch.set(Math.asin(0.3)); cam4.update(0)
  let k = 1                                  // world scale about the origin: 1 -> 1/955 over the flight
  const T = cam4.flyTo({ focus: [0, 0, 0], ell: 0 }, { time: 1.0, uScale: 0.11 / 105 })
  let maxOff = 0
  for (let t = 0; t < T; t += 1 / 165) {
    const k2 = Math.exp(Math.log(1 / 955) * Math.min(1, (t + 1 / 165) / 0.8))
    cam4.scaleFlight(k2 / k); k = k2
    cam4.update(1 / 165)
    // the body that was at the start point is now at 105 k: it must stay within a screen height of the focus
    maxOff = Math.max(maxOff, Math.abs(105 * k - cam4.F.x[0]) / cam4.h())
  }
  check("scaled exit flight lands on the destination", Cam.len(cam4.F.x) < 1e-9 && Math.abs(cam4.ell.x) < 1e-9, Cam.len(cam4.F.x))
  check("start body stays near the focus during the collapse (screen heights)", maxOff < 1.5, maxOff.toFixed(3))
}

// 7. the skip-box: orbiting a pinned body all the way round, the box either
// holds the body's whole disc or is null (nothing skipped); never a box that
// leaves the body out, which is what happened when the Sun went behind the eye
{
  const camP = new Cam.Camera({ ell: [-12, 2] })
  const body = [5.2, 0.0, 0.0], bodyR = 0.06            // a planet 5.2 units from the Sun
  const r = 10, yh = 2                                   // the system's volume around the Sun
  const corners = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * r, sy * yh, sz * r])
  let bad = 0, nulls = 0, boxes = 0
  // close in (h 0.05) the old box missed the body in a ~12 degree band of yaw
  for (const h of [0.05, 0.4, 2]) for (let k = 0; k < 720; k++) for (const pitch of [-0.6, 0, 0.4]) {
    camP.F.set(body.slice(), [0, 0, 0]); camP.ell.set(Math.log(h)); camP.yaw.set(k * Math.PI / 360); camP.pitch.set(pitch)
    const bb = camP.update(0)
    const box = camP.screenBox(corners, bb)
    if (!box) { nulls++; continue }
    boxes++
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const q = camP.project([body[0] + d[0] * bodyR, body[1] + d[1] * bodyR, body[2] + d[2] * bodyR], bb)
      if (q.front && (Math.abs(q.x - box.x) > box.hx || Math.abs(q.y - box.y) > box.hy)) bad++
    }
  }
  check("skip-box never leaves the pinned body out, any yaw/pitch", bad === 0, bad + " misses, " + boxes + " boxes, " + nulls + " unbounded")
  const far = new Cam.Camera({ ell: [-12, 2] })
  far.F.set([0, 0, 0], [0, 0, 0]); far.ell.set(Math.log(60)); far.pitch.set(0.5); const fb = far.update(0)
  const fbox = far.screenBox(corners, fb)
  check("skip-box from afar is a real box smaller than the screen", fbox && fbox.hx < 1 && fbox.hy < 1, fbox && fbox.hx.toFixed(3) + " x " + fbox.hy.toFixed(3))
}

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
