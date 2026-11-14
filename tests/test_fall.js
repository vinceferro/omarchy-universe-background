// numeric checks for fall.js (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Fall = new Function(src + "\nreturn { GM_C3, RS_C, TAU_MAX_INSIDE, S_PHOTON, S_HORIZON, timeline, tauAtR, rAt, speedAt, tau, rate, sAtTau, begin, step };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }

// 1. the numbers on the design page: GM/c^3 ~ 20.4 s, pi GM/c^3 ~ 64 s,
//    a drop from 6 Rs lasts ~15 minutes, ~28 s of it inside the horizon
check("GM/c^3 = 20.4 s for 4.15e6 Msun", Math.abs(Fall.GM_C3 - 20.44) < 0.05, Fall.GM_C3.toFixed(2))
check("longest possible stay inside = pi GM/c^3 = 64 s", Math.abs(Fall.TAU_MAX_INSIDE - 64.2) < 0.2, Fall.TAU_MAX_INSIDE.toFixed(1))
const tl = Fall.timeline(6)
check("drop from 6 Rs: ~15.7 min in all", Math.abs(tl.tauEnd / 60 - 15.7) < 0.1, (tl.tauEnd / 60).toFixed(2) + " min")
const inside = tl.tauEnd - tl.tauHorizon
check("inside the horizon: ~28 s of proper time", Math.abs(inside - 28.7) < 0.3, inside.toFixed(2))
check("inside time is below the pi GM/c^3 bound", inside < Fall.TAU_MAX_INSIDE)
check("free fall from infinity: 2/3 Rs/c = 27 s inside", Math.abs(2 / 3 * Fall.RS_C - 27.25) < 0.05, (2 / 3 * Fall.RS_C).toFixed(2))
check("E = sqrt(1 - 1/6)", Math.abs(tl.E - Math.sqrt(5 / 6)) < 1e-12)

// 2. the trajectory: starts at rest at r0, crosses the horizon at tauHorizon,
//    the photon sphere at tauPhoton, ends at 0; r(tau) inverts tau(r)
check("r(0) = r0", Fall.rAt(tl, 0) === 6)
check("r(tauHorizon) = 1", Math.abs(Fall.rAt(tl, tl.tauHorizon) - 1) < 1e-9, Fall.rAt(tl, tl.tauHorizon))
check("r(tauPhoton) = 1.5", Math.abs(Fall.rAt(tl, tl.tauPhoton) - 1.5) < 1e-9)
check("r(tauEnd) = 0", Fall.rAt(tl, tl.tauEnd) === 0)
let worstInv = 0
for (let r = 0.01; r <= 6; r += 0.07) worstInv = Math.max(worstInv, Math.abs(Fall.rAt(tl, Fall.tauAtR(tl, r)) - r))
check("r(tau(r)) round trip", worstInv < 1e-9, worstInv)
// monotone, and the speed matches dr/dtau = -sqrt(1/r - 1/r0) (energy conservation)
let mono = true, worstV = 0
for (let t = 1; t < tl.tauEnd - 1; t += 2) {
  const h = 1e-3
  const r1 = Fall.rAt(tl, t - h), r2 = Fall.rAt(tl, t + h)
  if (r2 >= r1) mono = false
  const v = (r1 - r2) / (2 * h) * Fall.RS_C      // Rs per second -> fraction of c
  worstV = Math.max(worstV, Math.abs(v - Fall.speedAt(tl, Fall.rAt(tl, t))))
}
check("r(tau) strictly decreasing", mono)
check("dr/dtau = -sqrt(1/r - 1/r0) (max error, c)", worstV < 1e-4, worstV)
check("at the horizon the fall is at 0.913 c", Math.abs(Fall.speedAt(tl, 1) - Math.sqrt(5 / 6)) < 1e-12)

// 3. the screen timeline: hits the knots, is monotone and C1, runs in real
//    time inside, and the whole thing lasts 24 + 28.7 s on screen
check("tau(0) = 0", Fall.tau(tl, 0) === 0)
check("tau(20 s) = the photon sphere", Math.abs(Fall.tau(tl, Fall.S_PHOTON) - tl.tauPhoton) < 1e-9)
check("tau(24 s) = the horizon", Math.abs(Fall.tau(tl, Fall.S_HORIZON) - tl.tauHorizon) < 1e-9)
check("tau(sEnd) = the singularity", Math.abs(Fall.tau(tl, tl.sEnd) - tl.tauEnd) < 1e-9)
check("on screen: 24 s + 28.7 s", Math.abs(tl.sEnd - (24 + inside)) < 1e-9, tl.sEnd.toFixed(2))
let tmono = true, worstC1 = 0, prevRate = Fall.rate(tl, 0)
for (let s = 0.001; s <= tl.sEnd; s += 0.001) {
  if (Fall.tau(tl, s) <= Fall.tau(tl, s - 0.001)) tmono = false
  const rt = Fall.rate(tl, s)
  worstC1 = Math.max(worstC1, Math.abs(rt - prevRate))
  prevRate = rt
}
check("tau(s) strictly increasing", tmono)
check("rate has no jumps (max step per ms)", worstC1 < 0.1, worstC1.toFixed(4))
check("rate = 1 inside (real time)", Fall.rate(tl, 30) === 1 && Fall.rate(tl, 50) === 1)
check("rate reaches 1 right at the horizon", Math.abs(Fall.rate(tl, Fall.S_HORIZON - 1e-9) - 1) < 1e-6, Fall.rate(tl, Fall.S_HORIZON - 1e-9))
check("approach compressed ~45x", Math.abs(Fall.rate(tl, 0) - tl.tauPhoton / 20) < 1e-9, (tl.tauPhoton / 20).toFixed(1))
// numeric derivative of tau matches rate (sampled off the knots, where the
// curvature jumps and a central difference would not apply)
let worstD = 0
for (let s = 0.25; s < tl.sEnd; s += 0.5) worstD = Math.max(worstD, Math.abs((Fall.tau(tl, s + 1e-4) - Fall.tau(tl, s - 1e-4)) / 2e-4 - Fall.rate(tl, s)))
check("rate = d tau / d s", worstD < 1e-5, worstD)
// the inverse
let worstS = 0
for (let s = 0; s < tl.sEnd; s += 0.37) worstS = Math.max(worstS, Math.abs(Fall.sAtTau(tl, Fall.tau(tl, s)) - s))
check("s(tau(s)) round trip", worstS < 1e-8, worstS)

// 4. begin: let go from the parked camera, or join the drop at the crossing
const parked = Fall.begin(6)
check("let go at 6 Rs: starts at s = 0, r = 6", parked.s === 0 && parked.tl.r0 === 6)
const parked2 = Fall.begin(6.2)
check("let go at 6.2 Rs: a drop from rest there", parked2.tl.r0 === 6.2 && parked2.s === 0 && Math.abs(parked2.tl.E - Math.sqrt(1 - 1 / 6.2)) < 1e-12)
const crossed = Fall.begin(0.97)
check("crossed at 0.97 Rs: the 6 Rs drop, joined inside", crossed.tl.r0 === 6 && crossed.s > Fall.S_HORIZON && Math.abs(Fall.rAt(crossed.tl, Fall.tau(crossed.tl, crossed.s)) - 0.97) < 1e-9)
check("... with less than 28.7 s left", crossed.tl.tauEnd - Fall.tau(crossed.tl, crossed.s) < inside)

// 5. stepping at 165 Hz lands at the singularity exactly when the clock says
const F = Fall.begin(6)
let frames = 0, lastLeft = 1e9, leftMono = true, rMono = true, lastR = 7
while (true) {
  const o = Fall.step(F, 1 / 165)
  frames++
  if (o.left > lastLeft || o.r > lastR) { leftMono = false; rMono = false }
  lastLeft = o.left; lastR = o.r
  if (o.left === 0) break
  if (frames > 165 * 120) break
}
check("time left and r only ever shrink", leftMono && rMono)
check("the singularity arrives at sEnd (52.7 s on screen)", Math.abs(frames / 165 - F.tl.sEnd) < 0.02, (frames / 165).toFixed(2))

// 6. the shader's exit angle (hole.frag, fall mode): sweepOut / sweepIn /
//    sweepTurn ported line for line, against a fine quadrature of the same
//    integral, phi = int du / sqrt(c - u^2 + u^3), for the falling observer
//    (E of the 6 Rs drop) at every depth and look angle; the 1 % band around
//    the critical impact parameter winds and is not judged
const B_CRIT = 2.598076211
function sweepOut(umax, c) { const h = umax / 48; let acc = 0; for (let i = 0; i < 48; i++) { const u = (i + 0.5) * h; acc += 1 / Math.sqrt(Math.max(c - u * u * (1 - u), 1e-12)) } return acc * h }
function sweepIn(r, c) { const x0 = Math.sqrt(r), h = (1 - x0) / 24; let acc = 0; for (let i = 0; i < 24; i++) { const x = x0 + (i + 0.5) * h, x2 = x * x; acc += 1 / Math.sqrt(Math.max(1 - x2 + c * x2 * x2 * x2, 1e-12)) } return 2 * acc * h }
function sweepTurn(u, c, diving) {
  const ua = 1 / 3 + 2 / 3 * Math.cos(Math.acos(Math.max(-1, Math.min(1, 1 - 13.5 * c))) / 3 - 2.0943951)
  const tu = Math.sqrt(Math.max(1 - u / ua, 0)), h1 = 1 / 32, h2 = tu / 32
  let a1 = 0, a2 = 0
  for (let i = 0; i < 32; i++) {
    let t = (i + 0.5) * h1, q = ua * (1 - t * t); a1 += 1 / Math.sqrt(Math.max(-q * q + (1 - ua) * q + ua * (1 - ua), 1e-12))
    t = (i + 0.5) * h2; q = ua * (1 - t * t); a2 += 1 / Math.sqrt(Math.max(-q * q + (1 - ua) * q + ua * (1 - ua), 1e-12))
  }
  return 2 * Math.sqrt(ua) * (a1 * h1 + (diving ? a2 * h2 : -a2 * h2))
}
// the look direction's ray (the tetrad formulas) -> dark | lost | its exit angle
function shaderExit(E, r, ang) {
  const f = 1 - 1 / r, vr = Math.cos(ang), nt = Math.max(Math.abs(Math.sin(ang)), 1e-3)
  const w = Math.sqrt(Math.max(E * E - f, 0)), n1 = -vr, e = E - n1 * w
  if (e <= 0) return { dark: true }
  const s = w - n1 * E, c = e * e / (r * r * nt * nt), b = r * nt / e
  let phi = -1
  if (r * nt < B_CRIT * e) { if (s > 0) phi = sweepOut(Math.min(1 / r, 1), c) + (r < 1 ? sweepIn(r, c) : 0) }
  else if (r >= 1.5) phi = sweepTurn(1 / r, c, s < 0)
  return phi < 0 ? { lost: true, b: b, s: s } : { phi: phi, b: b, s: s }
}
// reference: 2e5 samples on each smooth stretch (log-spaced where u > 1,
// the t = sqrt(1 - u/ua) substitution round a turning point)
function refSweep(u, c, diving) {
  const N = 200000
  const P = x => c - x * x + x * x * x
  if (c > 4 / 27) {
    const a = Math.min(u, 1); let s = 0
    for (let i = 0; i < N; i++) { const x = (i + 0.5) / N * a; s += 1 / Math.sqrt(P(x)) } s *= a / N
    if (u > 1) { const L = Math.log(u); let t = 0; for (let i = 0; i < N; i++) { const x = Math.exp(L * (i + 0.5) / N); t += x / Math.sqrt(P(x)) } s += t * L / N }
    return s
  }
  const ua = 1 / 3 + 2 / 3 * Math.cos(Math.acos(1 - 13.5 * c) / 3 - 2 * Math.PI / 3)
  const Q = v => -v * v + (1 - ua) * v + ua * (1 - ua)
  const tu = Math.sqrt(Math.max(1 - u / ua, 0))
  let a1 = 0, a2 = 0
  for (let i = 0; i < N; i++) { a1 += 1 / Math.sqrt(Q(ua * (1 - ((i + 0.5) / N) ** 2))); a2 += 1 / Math.sqrt(Q(ua * (1 - (tu * (i + 0.5) / N) ** 2))) }
  return 2 * Math.sqrt(ua) * (a1 / N + (diving ? a2 * tu / N : -a2 * tu / N))
}
let worstExit = 0, worstAt = "", nExit = 0, badClass = 0
for (const r of [6, 3, 1.6, 1.4, 1.0, 0.5, 0.2, 0.05, 0.03]) {
  for (let ang = 0.05; ang < Math.PI; ang += 0.11) {
    const o = shaderExit(tl.E, r, ang)
    if (o.dark) continue
    // the classification universe.frag draws the sky's edge from: climbing
    // below 1.5 Rs needs b < B_CRIT, diving needs b > B_CRIT and r >= 1.5
    const sky = o.s < 0 ? (r >= 1.5 && o.b > B_CRIT) : (r >= 1.5 || o.b < B_CRIT)
    if (sky === !!o.lost) badClass++
    if (o.lost || Math.abs(o.b / B_CRIT - 1) < 0.01) continue
    nExit++
    const d = Math.abs(o.phi - refSweep(1 / r, 1 / (o.b * o.b), o.s < 0)) * 180 / Math.PI
    if (d > worstExit) { worstExit = d; worstAt = "r " + r + " look " + (ang * 180 / Math.PI).toFixed(0) + " deg" }
  }
}
check("exit angle: sky / lost as universe.frag's edge says", badClass === 0, badClass)
check("exit angle within 0.1 deg of the exact integral (" + nExit + " rays)", worstExit < 0.1, worstExit.toFixed(4) + " deg at " + worstAt)
// at rest at 6 Rs the falling frame is the hovering one: a ray b = r sin(a) / sqrt(f) off the radial
check("letting go at 6 Rs: the hovering view (sin a / sqrt f, hardly bent)", Math.abs(shaderExit(tl.E, 6, 0.05).phi - Math.asin(Math.sin(0.05) / Math.sqrt(5 / 6))) < 5e-4, shaderExit(tl.E, 6, 0.05).phi.toFixed(5))

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
