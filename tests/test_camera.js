// numeric checks for camera.js (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Cam = new Function(src + "\nreturn { Spring, VSpring, Camera, planPath, pathAt, hermite, add, sub, mul, dot, len, cross, norm, Voyage, homeBegin, homeStep, W_TRAVEL, HOME_S };")()
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
cam3.grabBegin([0.1, 0.1], ecl)
for (let i = 1; i <= 30; i++) { cam3.grabMove([0.1 + i * 0.01, 0.1]); cam3.update(1 / 165) }
const pg = cam3.project(grabbed)
check("grabbed ecliptic point stays under the pointer", Math.hypot(pg.x - 0.4, pg.y - 0.1) < 1e-9, Math.hypot(pg.x - 0.4, pg.y - 0.1))
cam3.grabEnd(Cam.mul(Cam.sub(cam3.F.x, grabbed), 0.5)); const xRel = cam3.F.x
let moved = 0; for (let i = 0; i < 330; i++) { cam3.update(1 / 165); moved = Cam.len(Cam.sub(cam3.F.x, xRel)) }
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

// ---- the Galaxy view's travel, and the way home ----
{
  const SUN = [0, 8.15, 0.0208], CENTRE = [0, 0, 0]
  // the poses Background.qml uses: over the centre, then home
  const OPEN = { dist: 1.2, pitch: 0.45 }, HOME = { dist: 34, pitch: 1.0, yaw: 0.35 }
  // the whole return as the tick runs it: the black (a spring, 2.9 rad/s), the script, the travel, the orbit's pitch
  function fly(hz, blind, hold) {
    const dt = 1 / hz, V = new Cam.Voyage([0, 0, 1e-9], 2.5e-9)   // deep in the hole
    const black = new Cam.Spring(0, 2.9), pitch = new Cam.Spring(0.2, Cam.W_INPUT)
    const H = Cam.homeBegin(blind, hold), rows = [], events = []
    let goal = CENTRE, distGoal = 2.5e-9, key = "hole", t = 0
    for (let i = 0; i < hz * 40 && H.phase !== ""; i++) {
      const ev = Cam.homeStep(H, dt, black.x, V.arrived())
      if (ev !== "") events.push({ ev: ev, t: t })
      if (ev === "place") { V.place(CENTRE, OPEN.dist); pitch.set(OPEN.pitch) }
      if (ev === "place" || ev === "depart") {
        goal = SUN; distGoal = HOME.dist; key = "sun"; V.depart(Cam.HOME_S)
        pitch.w = 4.75 / Cam.HOME_S; pitch.g = HOME.pitch
      }
      black.g = H.phase === "out" ? 1 : 0
      black.step(dt, 1e-4); pitch.step(dt, 1e-7)
      const F = key === "sun" ? V.step(goal, distGoal, dt, key, true) : V.F.x
      t += dt
      // the camera, and where the centre and the Sun fall on a 21:9 screen (focal length 1)
      const cp = Math.cos(pitch.x), off = [cp * Math.sin(HOME.yaw), cp * Math.cos(HOME.yaw), Math.sin(pitch.x)]
      const C = Cam.add(F, Cam.mul(off, V.dist())), fwd = Cam.mul(off, -1), right = Cam.norm(Cam.cross(fwd, [0, 0, 1])), up = Cam.cross(right, fwd)
      const proj = P => { const v = Cam.sub(P, C), z = Cam.dot(v, fwd); return { x: Cam.dot(v, right) / z, y: -Cam.dot(v, up) / z, front: z > 0 } }
      rows.push({ t: t, phase: H.phase, black: black.x, F: F, dist: V.dist(), sun: proj(SUN), centre: proj(CENTRE), height: C[2] })
    }
    return { rows: rows, events: events, H: H }
  }
  const r = fly(165, true, 2)
  const placeAt = r.events[0].t, arriveAt = r.events[r.events.length - 1].t
  const flight = r.rows.filter(q => q.t > placeAt + 1e-9)
  check("the return from inside the hole: black, then placed over the centre, then it arrives; each once", r.events.map(e => e.ev).join(",") === "place,arrive" && r.H.phase === "", r.events.map(e => e.ev + " " + e.t.toFixed(2)).join(", "))
  check("the camera is placed only once the screen is black, after 2 s of black", r.rows.filter(q => q.t <= placeAt).slice(-1)[0].black >= 0.98 && placeAt > 3 && placeAt < 4.5, placeAt.toFixed(2))
  check("the view opens over the Galactic Centre, 1.2 kpc out, at rest", Cam.len(flight[0].F) < 1e-3 && Math.abs(flight[0].dist - OPEN.dist) < 0.01)
  const step = flight.map((q, i) => i === 0 ? 0 : Cam.len(Cam.sub(q.F, flight[i - 1].F)))
  const prog = flight.map(q => q.F[1] / SUN[1])
  check("one continuous flight: the focus moves from the centre to the Sun, never back, never past it", prog.every((v, i) => i === 0 || v >= prog[i - 1] - 1e-12) && Math.max(...prog) <= 1 + 1e-9 && prog[prog.length - 1] > 0.95, (100 * prog[prog.length - 1]).toFixed(1) + "% at the landing")
  check("it starts from rest and never lurches (the speed changes by less than 3% of its peak a frame)", step[1] < 0.05 * Math.max(...step) && step.every((v, i) => i < 2 || Math.abs(v - step[i - 1]) < 0.03 * Math.max(...step)),
        "peak " + (Math.max(...step) * 165).toFixed(2) + " kpc/s")
  check("the camera pulls back all the way, smoothly: the distance only grows, to the home view's 34 kpc", flight.every((q, i) => i === 0 || q.dist >= flight[i - 1].dist - 1e-12) && Math.abs(flight[flight.length - 1].dist / HOME.dist - 1) < 0.011)
  check("it rises above the disk and stays above it", flight.every((q, i) => i === 0 || q.height >= flight[i - 1].height - 1e-9) && flight[flight.length - 1].height > 20)
  const seen = flight.filter(q => q.black < 0.5)
  const inFrame = p => p.front && Math.abs(p.x) < 2.37 / 2 * 0.9 && Math.abs(p.y) < 0.45
  check("the Galaxy stays in frame: the Centre is on screen from the first frame to the last", flight.every(q => inFrame(q.centre)))
  const sunIn = flight.findIndex(q => inFrame(q.sun))
  check("the Sun's place comes into frame within 2 s and stays", sunIn >= 0 && flight[sunIn].t - placeAt < 2 && flight.slice(sunIn).every(q => inFrame(q.sun)),
        (flight[sunIn].t - placeAt).toFixed(2) + " s, " + (100 * prog[sunIn]).toFixed(0) + "% of the way")
  check("the flight is still under way when the picture is back (more than half of it to go at half black)", prog[flight.indexOf(seen[0])] < 0.5, prog[flight.indexOf(seen[0])].toFixed(2))
  const last = flight[flight.length - 1]
  check("it lands with the Sun in the middle of the screen and the Centre beside it", Math.hypot(last.sun.x, last.sun.y) < 0.011 && inFrame(last.centre) && Math.hypot(last.centre.x, last.centre.y) > 0.1)
  check("a journey, not a cut: 5 to 8 s from the centre to the landing", arriveAt - placeAt > 5 && arriveAt - placeAt < 8, (arriveAt - placeAt).toFixed(2) + " s")
  const r60 = fly(60, true, 2)
  check("the same timeline at 60 Hz", Math.abs(r60.events[0].t - placeAt) < 0.05 && Math.abs(r60.events[1].t - arriveAt) < 0.1, r60.events.map(e => e.t.toFixed(2)).join(" "))
  const quick = fly(165, true, 0.5)
  check("Esc on the way down: the same script with half a second of black", quick.events.map(e => e.ev).join(",") === "place,arrive" && placeAt - quick.events[0].t > 1.4 && placeAt - quick.events[0].t < 1.6)
  // from a view that can be flown out of: no black, the same flight
  {
    const H = Cam.homeBegin(false), V = new Cam.Voyage([-3, 2, 0.1], 0.5)
    const e0 = Cam.homeStep(H, 1 / 165, 0, V.settled())
    let n = 0, ev = ""
    V.depart(Cam.HOME_S)
    do { V.step(SUN, HOME.dist, 1 / 165, "sun", true); ev = Cam.homeStep(H, 1 / 165, 0, V.arrived()); n++ } while (ev === "" && n < 5000)
    check("from anywhere else: it departs at once, no black, and arrives", e0 === "depart" && ev === "arrive" && Cam.len(Cam.sub(V.F.x, SUN)) < 0.34 && n / 165 > 1.9 && n / 165 < 9, (n / 165).toFixed(2) + " s")
  }
  // the travel itself
  {
    const V = new Cam.Voyage(SUN, 30)
    for (let i = 0; i < 165 * 1; i++) V.step([3, -2, 0], 0.002, 1 / 165, 1, true)
    const v0 = V.F.v
    V.step([-5, 4, 0], 0.01, 1 / 165, 2, true)
    check("a new destination on the way: the velocity carries on (no kink)", Cam.len(Cam.sub(V.F.v, v0)) < 0.15 * Cam.len(v0))
    for (let i = 0; i < 165 * 12; i++) V.step([-5, 4, 0], 0.01, 1 / 165, 2, true)
    check("it lands exactly, at the asked distance, and its pace is back to a short hop's", V.settled() && Cam.len(Cam.sub(V.F.x, [-5, 4, 0])) < 1e-9 && Math.abs(V.dist() - 0.01) < 1e-9 && V.F.s[0].w === Cam.W_TRAVEL)
    // a place that moves (the time-lapse): followed with zero lag
    let g = [-5, 4, 0], lag = 0
    for (let i = 0; i < 165 * 3; i++) { g = [g[0] + 0.03, g[1] - 0.01, g[2]]; V.step(g, 0.01, 1 / 165, 2, true); lag = Math.max(lag, Cam.len(Cam.sub(V.F.x, g))) }
    check("a moving place is followed with zero lag", lag < 1e-6, lag.toExponential(1))
    const far = new Cam.Voyage(SUN, 0.0008); let top = 0
    for (let i = 0; i < 165 * 13.5; i++) { far.step([0, 0, 0], 8e-9, 1 / 165, "hole", true); top = Math.max(top, far.dist()) }
    check("a long trip (the Sun to the hole's edge, 21 powers of e) rises above the disk, comes back down and has arrived within 13.5 s (it took 14)", top > 1 && far.arrived() && Math.abs(far.dist() / 8e-9 - 1) < 0.011, top.toFixed(1) + " kpc at the top")
    far.place([1, 2, 3], 5)
    check("place: there, at rest", far.settled() && far.dist() === 5 && far.F.x.join() === "1,2,3")
  }
}

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
