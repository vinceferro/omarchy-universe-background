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

// 7. the glow of the gas falling in ahead of us (hole.frag, infallGlow):
//    the frequency the gas measures along our ray, the turning point, the
//    sampled legs against a fine quadrature, and continuity across the edges
//    where the ray's case changes (e = 0, s = 0, the horizon)
const GLOW = 0.05
// -k.u for radially falling gas of energy Eg at r, our ray having unit
// frequency at us: the general formula the shader specialises to Eg = 1
function omegaGas(r, e, L, sig, Eg) {
  const f = 1 - 1 / r, K = Math.sqrt(Math.max(e * e - f * L * L / (r * r), 0))
  return (e * Eg + sig * K * Math.sqrt(Math.max(Eg * Eg - f, 0))) / f
}
function glowSample(r, e, L, sig) {   // the shader's, with shifted()'s clamps, as a scalar
  const f = 1 - 1 / r, K2 = e * e - f * L * L / (r * r)
  if (K2 <= 0) return 0   // the ray never reaches this radius
  const K = Math.sqrt(K2)
  const kr = K / Math.sqrt(r), g = sig > 0 ? f / (e + kr) : (e + kr) / (e * e + L * L / (r * r * r))
  const k = Math.max(0.05, Math.min(6, g))
  const ss = Math.max(0, Math.min(1, (r - 3) / 2))
  return GLOW / (r * r * r) * (1 - ss * ss * (3 - 2 * ss)) * Math.min(k * k * k, 10) / K
}
function glowLegS(ra, rb, e, L, sig) { if (Math.abs(rb - ra) < 1e-6) return 0; let a = 0; for (let i = 0; i < 12; i++) { const t = (i + 0.5) / 12; a += glowSample(ra + (rb - ra) * t * t * (3 - 2 * t), e, L, sig) * 6 * t * (1 - t) } return a * Math.abs(rb - ra) / 12 }
function glowLegQ(r0, rm, e, L) { const qm = Math.pow(rm, -3.5), h = (Math.pow(r0, -3.5) - qm) / 8; if (h < 1e-7) return 0; let a = 0; for (let i = 0; i < 8; i++) { const q = qm + (i + 0.5) * h, r = Math.pow(q, -2 / 7); a += glowSample(r, e, L, -1) * (2 / 7) * r * r * r * r * Math.sqrt(r) } return a * h }
function turnBelow(c) { return 1 / (1 / 3 + 2 / 3 * Math.cos(Math.acos(Math.max(-1, Math.min(1, 1 - 13.5 * c))) / 3)) }
function infallGlow(r0, e, s, L, leg) {   // leg: the stretch integrator (the shader's, or the reference)
  const S = leg || glowLegS
  if (r0 < 1) {
    const rm = Math.min(1, 2.5 * r0)
    let I = leg ? leg(r0, 1, e, L, -1) : glowLegQ(r0, rm, e, L) + glowLegS(rm, 1, e, L, -1)
    if (e > 0) { const rt = turnBelow(e * e / (L * L)); I += S(rt, 1, e, L, 1) + S(rt, 1, e, L, -1) }
    return I
  }
  if (s < 0) return S(Math.min(r0, 5), 1, e, L, 1)
  const rt = turnBelow(e * e / (L * L))
  return S(rt, 1, e, L, 1) + S(rt, r0, e, L, -1)
}
// reference: 2e5 samples with both ends flattened
function refLeg(ra, rb, e, L, sig) {
  if (Math.abs(rb - ra) < 1e-6) return 0
  const N = 200000; let a = 0
  for (let i = 0; i < N; i++) { const t = (i + 0.5) / N; a += glowSample(ra + (rb - ra) * t * t * (3 - 2 * t), e, L, sig) * 6 * t * (1 - t) }
  return a * Math.abs(rb - ra) / N
}
// our ray's constants for a look angle ang from straight down (the tetrad formulas)
function glowRay(r0, E, w, ang) {
  const n1 = Math.cos(ang), nt = Math.sin(ang)
  const e = E - n1 * w, s = w - n1 * E, L = r0 * nt
  const dark = e <= 0 || (s < 0 ? !(r0 >= 1.5 && L / e > B_CRIT) : r0 < 1.5 && L / e > B_CRIT)
  return { e: e, s: s, L: L, dark: dark }
}
function fallAt(r) { return { E: tl.E, w: Math.sqrt(Math.max(tl.E * tl.E - (1 - 1 / r), 0)) } }
// a. gas beside us with our own energy measures our frequency, 1, whichever way we look
let worstSelf = 0
for (const r0 of [3, 1.3, 0.9, 0.5, 0.1]) {
  const o = fallAt(r0)
  for (let ang = 0; ang < Math.PI; ang += 0.2) {
    const q = glowRay(r0, o.E, o.w, ang)
    worstSelf = Math.max(worstSelf, Math.abs(omegaGas(r0, q.e, q.L, q.s > 0 ? -1 : 1, o.E) - 1))
  }
}
check("the gas beside us, falling with us, measures our frequency (1)", worstSelf < 1e-9, worstSelf)
// b. the radial ray: g = (E_g - w_g(r_e)) / (E_o - w_o), inside and out, and the shader's g is the Eg = 1 case
let worstRad = 0, worstGen = 0
for (const r0 of [3, 1.2, 0.5, 0.2]) {
  const o = fallAt(r0), e = o.E - o.w, sig = r0 < 1 ? -1 : 1
  for (let k = 1; k <= 9; k++) {
    const re = r0 < 1 ? r0 + (1 - r0) * k / 10 : 1 + (r0 - 1) * k / 10
    const closed = (1 - 1 / Math.sqrt(re)) / (o.E - o.w)
    worstRad = Math.max(worstRad, Math.abs(1 / omegaGas(re, e, 0, sig, 1) / closed - 1))
    const f = 1 - 1 / re, kr = Math.abs(e) / Math.sqrt(re), gShader = sig > 0 ? f / (e + kr) : (e + kr) / (e * e)
    worstGen = Math.max(worstGen, Math.abs(gShader * omegaGas(re, e, 0, sig, 1) - 1))
  }
}
check("radial ray: g = (E_g - w_g) / (E_o - w_o) from the general -k.u", worstRad < 1e-9, worstRad)
check("the shader's g is 1 / omega_e for gas from rest far out", worstGen < 1e-9, worstGen)
// c. the turning point below the photon sphere: a root of u^3 - u^2 + 1/b^2 between 1 and 1.5 Rs
let worstTurn = 0, turnIn = true
for (let b = B_CRIT * 1.001; b < 40; b *= 1.3) {
  const c = 1 / (b * b), rt = turnBelow(c), u = 1 / rt
  worstTurn = Math.max(worstTurn, Math.abs(c - u * u + u * u * u))
  if (rt < 1 || rt > 1.5) turnIn = false
}
check("turning point below 1.5 Rs is a root of the shape polynomial", worstTurn < 1e-12 && turnIn, worstTurn)
check("b -> infinity turns at the horizon, b = B_CRIT at the photon sphere", Math.abs(turnBelow(0) - 1) < 1e-9 && Math.abs(turnBelow(4 / 27) - 1.5) < 1e-6)
// d. the 8-sample legs against the fine quadrature, over the dark directions
//    at every depth (hovering at 6 Rs, then the fall); the rim deep inside,
//    where the glow is softly clipped anyway, is not judged
let worstQ = 0, worstQAt = "", nQ = 0
for (const r0 of [6, 3, 1.6, 1.3, 1.1, 1.02, 0.98, 0.9, 0.5, 0.2, 0.1]) {
  const o = r0 >= 6 ? { E: Math.sqrt(1 - 1 / r0), w: 0 } : fallAt(r0)
  for (let deg = 0; deg < 90; deg += 3) {
    const q = glowRay(r0, o.E, o.w, deg * Math.PI / 180)
    if (!q.dark) continue
    const ref = infallGlow(r0, q.e, q.s, q.L, refLeg)
    if (ref > 2.5) continue
    nQ++
    const d = Math.abs(infallGlow(r0, q.e, q.s, q.L) / ref - 1)
    if (d > worstQ) { worstQ = d; worstQAt = "r " + r0 + " look " + deg + " deg" }
  }
}
check("glow legs within 8 % of the fine quadrature (" + nQ + " rays)", worstQ < 0.08, (worstQ * 100).toFixed(2) + " % at " + worstQAt)
// e. no seams: across e = 0 (the cap's edge inside), s = 0 (the shadow's edge
//    below 1.5 Rs) and the horizon the glow changes by less than 2 %
function glowDeg(r0, ang) { const o = fallAt(r0), q = glowRay(r0, o.E, o.w, ang); return infallGlow(r0, q.e, q.s, q.L) }
let worstSeam = 0
for (const r0 of [0.9, 0.5, 0.2]) { const o = fallAt(r0), a0 = Math.acos(o.E / o.w); worstSeam = Math.max(worstSeam, Math.abs(glowDeg(r0, a0 + 1e-5) / glowDeg(r0, a0 - 1e-5) - 1)) }
for (const r0 of [1.3, 1.1]) { const o = fallAt(r0), a0 = Math.acos(o.w / o.E); worstSeam = Math.max(worstSeam, Math.abs(glowDeg(r0, a0 + 1e-5) / glowDeg(r0, a0 - 1e-5) - 1)) }
for (const ang of [0.3, 0.6]) worstSeam = Math.max(worstSeam, Math.abs(glowDeg(1.0005, ang) / glowDeg(0.9995, ang) - 1))
check("no seam across the cap's edge, the shadow's edge or the horizon", worstSeam < 0.02, worstSeam)
// f. faint: the shadow at rest at 6 Rs stays dark, the cap half way down is a dim glow
const hover6 = glowRay(6, Math.sqrt(5 / 6), 0, 0), half = glowRay(0.5, fallAt(0.5).E, fallAt(0.5).w, 0)
check("hovering at 6 Rs: the shadow's glow below 1e-3", infallGlow(6, hover6.e, hover6.s, hover6.L) < 1e-3, infallGlow(6, hover6.e, hover6.s, hover6.L).toExponential(2))
check("at 0.5 Rs, straight down: a dim glow, 0.02 to 0.1", infallGlow(0.5, half.e, half.s, half.L) > 0.02 && infallGlow(0.5, half.e, half.s, half.L) < 0.1, infallGlow(0.5, half.e, half.s, half.L).toFixed(3))
// g. the hover shadow as the march draws it: every ray with h = r0 sin(a) up
//    to B_CRIT fell in (and some a step beyond), so the shader hands the glow
//    L = e h, b clamped a hair under B_CRIT. Across the whole shadow the glow
//    stays faint and rises smoothly to the edge (the photon ring's log
//    brightening), with no ring: L = h instead (b = h / sqrt f > B_CRIT at the
//    outer rays, never reaching 1.5 Rs) once lit a saturated ring there
function hoverGlow(r0, h) { const e0 = Math.sqrt(1 - 1 / r0); return infallGlow(r0, e0, -1, e0 * Math.min(h, B_CRIT * 0.999), undefined) }
let hoverMax = 0, hoverJump = 0, hoverAt = ""
for (const r0 of [6, 20, 60]) {
  let prev = hoverGlow(r0, 0)
  for (let h = 0.01; h <= 2.6; h += 0.01) {
    const I = hoverGlow(r0, h), jump = I / prev - 1
    if (I > hoverMax) { hoverMax = I; hoverAt = "r " + r0 + " h " + h.toFixed(2) }
    if (jump > hoverJump) hoverJump = jump
    prev = I
  }
}
check("hovering at 6, 20, 60 Rs: the shadow's glow below 0.01 out to its edge", hoverMax < 0.01, hoverMax.toExponential(2) + " at " + hoverAt)
check("hovering: the glow rises smoothly toward the edge (< 30 % per 0.01 Rs of h; the ring was 5000x)", hoverJump < 0.3, (hoverJump * 100).toFixed(1) + " %")
// at any hover radius the edge ray (b clamped) stays within 3 % of the fine quadrature: no sample sits on the photon sphere
let worstEdge = 0, worstEdgeAt = 0
for (let r0 = 1.001; r0 < 60; r0 *= 1.002) { const I = hoverGlow(r0, 3); if (I > worstEdge) { worstEdge = I; worstEdgeAt = r0 } }
const edgeE = Math.sqrt(1 - 1 / worstEdgeAt), edgeRef = refLeg(Math.min(worstEdgeAt, 5), 1, edgeE, edgeE * B_CRIT * 0.999, 1)
check("the edge ray at its brightest hover radius matches the fine quadrature within 3 %", Math.abs(worstEdge / edgeRef - 1) < 0.03 && worstEdge < 0.02, worstEdge.toExponential(3) + " at r0 " + worstEdgeAt.toFixed(3) + ", ref " + edgeRef.toExponential(3))

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
