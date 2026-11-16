// numeric checks for kerr.js (run with node; strips the QML pragma): the
// hole's numbers against the closed forms, the Kerr-Schild metric and its
// frames, the march against the exact Schwarzschild integral at a = 0 and
// against the old Verlet tracer, the shadow-edge classifier against the
// march, the gas's orbits, the axis fall, and the mathematics mode's rays
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const K = new Function(src + "\nreturn { M, horizons, photonOrbit, polarPhotonOrbit, isco, horizonOmega, ksRadius, ksMetric, sheetAt, lower, gdot, frame, staticObserver, axisInfaller, axisEnergyFromRest, axisSpeed, axisEscapeEnergy, cameraRay, motion, carterK, carterKAxis, radialClass, traceRay, pixelRay, bendBasis, bendEncode, bendDecode, gasOmega, gasVelocity, gasShift, axisFall, tableR, tableTau };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const M = K.M, RS_C = 2 * 4.925490947e-6 * 4.15e6
const A94 = 0.94 * M
const eta = (i, j) => i === j ? (i === 0 ? -1 : 1) : 0
const norm = v => Math.hypot(v[0], v[1], v[2])
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180 / Math.PI

// 1. horizons: r+- = M +- sqrt(M^2 - a^2); chi = 1 is extremal
for (const chi of [0, 0.5, 0.94, 0.998]) {
  const h = K.horizons(chi * M), s = Math.sqrt(1 - chi * chi) * M
  check("horizons at chi = " + chi, Math.abs(h.rPlus - (M + s)) < 1e-15 && Math.abs(h.rMinus - (M - s)) < 1e-15, h.rPlus.toFixed(4) + " / " + h.rMinus.toFixed(4))
}
check("chi = 1: r+ = r- = M", K.horizons(M).rPlus === M && K.horizons(M).rMinus === M)
check("chi = 0.94: r+ = 0.6706, r- = 0.3294 Rs", Math.abs(K.horizons(A94).rPlus - 0.6706) < 1e-4 && Math.abs(K.horizons(A94).rMinus - 0.3294) < 1e-4)

// 2. photon orbits: the closed form against the roots of the circular-orbit
//    condition r^3 - 3 M r^2 -+ 2 a sqrt(M) r^(3/2) = 0 (prograde has the minus), a = 0 gives 3M
for (const chi of [0, 0.5, 0.94, 0.998]) {
  const a = chi * M
  for (const sign of [1, -1]) {
    const r = K.photonOrbit(a, sign)
    const res = r * r * r - 3 * M * r * r + sign * 2 * a * Math.sqrt(M) * Math.pow(r, 1.5)
    check("photon orbit chi " + chi + (sign > 0 ? " prograde" : " retrograde") + " solves the orbit condition", Math.abs(res) < 1e-12 && r > K.horizons(a).rPlus, r.toFixed(4))
  }
}
check("a = 0: photon sphere 1.5 Rs", Math.abs(K.photonOrbit(0, 1) - 1.5) < 1e-12 && Math.abs(K.photonOrbit(0, -1) - 1.5) < 1e-12 && Math.abs(K.polarPhotonOrbit(0) - 1.5) < 1e-12)
check("chi = 0.94: prograde 0.7126, retrograde 1.9732, polar 1.2535 Rs", Math.abs(K.photonOrbit(A94, 1) - 0.7126) < 1e-4 && Math.abs(K.photonOrbit(A94, -1) - 1.9732) < 1e-4 && Math.abs(K.polarPhotonOrbit(A94) - 1.2535) < 1e-4)
{
  const r = K.polarPhotonOrbit(A94)
  check("polar photon orbit solves r^3 - 3Mr^2 + a^2 r + M a^2 = 0 (Teo 2003)", Math.abs(r * r * r - 3 * M * r * r + A94 * A94 * r + M * A94 * A94) < 1e-12, r.toFixed(6))
  check("polar orbit lies between the prograde and retrograde ones", r > K.photonOrbit(A94, 1) && r < K.photonOrbit(A94, -1))
}

// 3. the ISCO (Bardeen, Press & Teukolsky 1972): 6M, M and 9M at the extremes, 2.0236 M at 0.94
check("ISCO a = 0: 6M = 3 Rs", Math.abs(K.isco(0, 1) - 3) < 1e-12 && Math.abs(K.isco(0, -1) - 3) < 1e-12)
check("ISCO chi = 1: M prograde, 9M retrograde", Math.abs(K.isco(M, 1) - M) < 1e-9 && Math.abs(K.isco(M, -1) - 9 * M) < 1e-9, K.isco(M, 1) + " " + K.isco(M, -1))
check("ISCO chi = 0.94: 2.0236 M prograde", Math.abs(K.isco(A94, 1) / M - 2.0236) < 1e-4, (K.isco(A94, 1) / M).toFixed(4))
check("ISCO chi = 0.94: 8.8308 M retrograde", Math.abs(K.isco(A94, -1) / M - 8.8308) < 1e-4, (K.isco(A94, -1) / M).toFixed(4))
// the ISCO is where the circular orbit's energy is least: E(r) = (r^1.5 - 2M r^0.5 + a sqrt M) / (r^0.75 sqrt(r^1.5 - 3M r^0.5 + 2 a sqrt M))
{
  const a = A94, Ecirc = r => (Math.pow(r, 1.5) - 2 * M * Math.sqrt(r) + a * Math.sqrt(M)) / (Math.pow(r, 0.75) * Math.sqrt(Math.pow(r, 1.5) - 3 * M * Math.sqrt(r) + 2 * a * Math.sqrt(M)))
  const ri = K.isco(a, 1), d = (Ecirc(ri + 1e-4) - Ecirc(ri - 1e-4)) / 2e-4
  check("the prograde ISCO is the minimum of the orbital energy", Math.abs(d) < 1e-6 && Ecirc(ri + 0.05) > Ecirc(ri) && Ecirc(ri - 0.05) > Ecirc(ri), d.toExponential(2))
}

// 4. the metric: r solves its quartic on both branches, the sheet rule, and
//    the tetrad is orthonormal for every observer at points outside, in the
//    ergoregion, between the horizons, inside r- and on the r < 0 sheet
{
  const a = A94
  let worstQ = 0
  for (const [x, sheet] of [[[3, 2, 1], 1], [[0.5, 0.2, 0.1], 1], [[0.3, 0.1, 0.05], 1], [[0.2, 0.1, -0.1], -1], [[0, 0, 5], 1], [[0, 0, -2], -1], [[0.45, 0.05, 0.001], 1], [[0.1, 0.1, 0.0001], 1], [[0.1, 0.1, -0.0001], -1]]) {
    const r = K.ksRadius(x, a, sheet), rho2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2]
    worstQ = Math.max(worstQ, Math.abs(r * r * r * r - (rho2 - a * a) * r * r - a * a * x[2] * x[2]))
    if (Math.sign(r) !== sheet && r !== 0) worstQ = 1
  }
  check("ksRadius solves r^4 - (rho^2 - a^2) r^2 - a^2 z^2 = 0 and carries the sheet's sign", worstQ < 1e-12, worstQ.toExponential(2))
  check("a = 0: r = rho", Math.abs(K.ksRadius([1, 2, 2], 0, 1) - 3) < 1e-15)
  check("on the axis r = |z|, on the equator outside the ring r^2 = rho^2 - a^2", Math.abs(K.ksRadius([0, 0, 2.5], a, 1) - 2.5) < 1e-15 && Math.abs(K.ksRadius([1, 0, 0], a, 1) - Math.sqrt(1 - a * a)) < 1e-15)
  check("the disk (rho < a, z = 0) is r = 0", K.ksRadius([0.3, 0.1, 0], a, 1) === 0)
  check("sheet flips crossing z = 0 inside the ring, not outside", K.sheetAt([0.1, 0, 0.1], 1, [0.1, 0, -0.1], a) === -1 && K.sheetAt([1, 0, 0.1], 1, [1, 0, -0.1], a) === 1 && K.sheetAt([0.1, 0, 0.1], 1, [0.1, 0, 0.05], a) === 1)
  // the metric's functions are continuous through the disk with the flip
  const mA = K.ksMetric([0.2, 0.1, 1e-8], a, 1), mB = K.ksMetric([0.2, 0.1, -1e-8], a, -1)
  check("f and l continuous through the disk with the sheet flipped", Math.abs(mA.f - mB.f) < 1e-6 && Math.abs(mA.l[2] - mB.l[2]) < 1e-6 && Math.abs(mA.l[0] - mB.l[0]) < 1e-6, (mA.f - mB.f).toExponential(1))
  check("f < 0 on the r < 0 sheet (repulsion), f = 2Mr/(r^2+a^2) on the axis", K.ksMetric([0, 0, -2], a, -1).f < 0 && Math.abs(K.ksMetric([0, 0, 2], a, 1).f - 2 * M * 2 / (4 + a * a)) < 1e-14)
  // the gradients against finite differences
  let worstG = 0
  for (const [x, sheet] of [[[3, 2, 1], 1], [[0.6, 0.3, 0.2], 1], [[0.3, 0.2, -0.1], -1], [[0.1, 0.05, 0.4], 1]]) {
    const m = K.ksMetric(x, a, sheet)
    for (let i = 0; i < 3; i++) {
      const h = 1e-6, xp = x.slice(), xm = x.slice(); xp[i] += h; xm[i] -= h
      const mp = K.ksMetric(xp, a, sheet), mm = K.ksMetric(xm, a, sheet)
      worstG = Math.max(worstG, Math.abs((mp.f - mm.f) / (2 * h) - m.df[i]), Math.abs((mp.r - mm.r) / (2 * h) - m.dr[i]))
      for (let j = 0; j < 3; j++) worstG = Math.max(worstG, Math.abs((mp.l[j] - mm.l[j]) / (2 * h) - m.dl[i][j]))
    }
  }
  check("df, dr and dl match finite differences", worstG < 1e-6, worstG.toExponential(2))
  let worstT = 0, nT = 0
  for (const [x, sheet] of [[[3, 2, 1], 1], [[0.9, 0.0, 0.01], 1], [[0.5, 0.2, 0.1], 1], [[0.3, 0.1, 0.05], 1], [[0.2, 0.1, -0.1], -1], [[0, 0, 5], 1], [[0, 0, 0.5], 1], [[0, 0, 0.2], 1], [[0, 0, -2], -1], [[0, 0, -0.3], -1]]) {
    const m = K.ksMetric(x, a, sheet)
    const us = [[1 + m.f / 2, -m.f / 2 * m.l[0], -m.f / 2 * m.l[1], -m.f / 2 * m.l[2]]]   // the KS observer
    if (m.f < 1) us.push(K.staticObserver(m))
    if (x[0] === 0 && x[1] === 0) { us.push(K.axisInfaller(m.r, a, 1.5, [0, 0, 1])); if (K.axisSpeed(m.r, a, K.axisEnergyFromRest(6, a)) > 0) us.push(K.axisInfaller(m.r, a, K.axisEnergyFromRest(6, a), [0, 0, 1])) }
    for (const u of us) {
      const E = K.frame(m, u); nT++
      worstT = Math.max(worstT, Math.abs(K.gdot(m, u, u) + 1))
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) worstT = Math.max(worstT, Math.abs(K.gdot(m, E[i], E[j]) - eta(i, j)))
    }
  }
  check("tetrads orthonormal, g(E_a, E_b) = eta_ab, for " + nT + " observers in every region", worstT < 1e-11, worstT.toExponential(2))
  // the axis infaller: unit, falling, u^t regular across both horizons
  const h = K.horizons(a)
  let okU = true
  for (const r of [6, 2, h.rPlus + 1e-9, h.rPlus, h.rPlus - 1e-9, 0.5, h.rMinus, 0.2, 0.05, -0.05, -a, -3]) {
    const u = K.axisInfaller(r, a, 1.5, [0, 0, 1])
    const m = K.ksMetric([0, 0, Math.abs(r) < 1e-6 ? 1e-6 : r], a, r >= 0 ? 1 : -1)
    if (Math.abs(K.gdot(m, u, u) + 1) > 1e-9 || !(u[0] > 0) || !isFinite(u[0]) || u[3] > 0) okU = false
  }
  check("axis infaller (E = 1.5): unit timelike, future-directed and finite from 6 Rs through both horizons to r = -3", okU)
}

// 5. a = 0: the axis infaller's frame gives hole.frag's old formulas
//    e = E - n_r w, b = r n_t / e, s = w - n_r E (n the light's direction,
//    n_r its outward part), for every look angle, outside and inside
{
  let worst = 0
  for (const r of [6, 3, 1.4, 1.0, 0.5, 0.2]) {
    const E = Math.sqrt(1 - 1 / 6), f = 1 - 1 / r, w = Math.sqrt(Math.max(E * E - f, 0))
    const x = [0, 0, r], m = K.ksMetric(x, 0, 1), u = K.axisInfaller(r, 0, E, [0, 0, 1])
    for (let ang = 0.05; ang < Math.PI; ang += 0.2) {
      const v = [Math.sin(ang), 0, Math.cos(ang)]           // look direction, ang from straight up (outward)
      const n1 = -v[2], nt = Math.abs(v[0])
      const e = E - n1 * w, s = w - n1 * E
      const cr = K.cameraRay(m, x, u, v)
      const ck = K.carterKAxis(m, [cr.k[1], cr.k[2], cr.k[3]], cr.E)
      worst = Math.max(worst, Math.abs(cr.E - e), Math.abs(Math.sqrt(ck.K) - r * nt), Math.abs(Math.sign(-ck.rdot) - Math.sign(s)))
    }
  }
  check("a = 0: the KS frame reproduces e = E - n_r w, L = r n_t and the climb/dive sign", worst < 1e-7, worst.toExponential(2))
  // the hovering camera at a = 0: E = sqrt(1 - 1/r), b = r sin(angle) / sqrt(1 - 1/r)
  const x = [0, 20, 0], m = K.ksMetric(x, 0, 1), u = K.staticObserver(m)
  const cr = K.cameraRay(m, x, u, [Math.sin(0.3), -Math.cos(0.3), 0])
  check("hovering at 20 Rs, a = 0: E = sqrt(1 - 1/20), b = r sin(a)/sqrt(1 - 1/r)", Math.abs(cr.E - Math.sqrt(0.95)) < 1e-12 && Math.abs(Math.abs(cr.Lz) / cr.E - 20 * Math.sin(0.3) / Math.sqrt(0.95)) < 1e-12)
  // both Carter forms agree for the hovering camera at the pole and off it
  const ck1 = K.carterK(m, 0, [cr.k[1], cr.k[2], cr.k[3]], cr.E, cr.Lz), ck2 = K.carterKAxis(K.ksMetric([0, 0, 20], 0, 1), [cr.k[1], cr.k[3], cr.k[2]], cr.E)
  check("Carter's K: the Delta form equals L^2 at a = 0", Math.abs(ck1.K - cr.Lz * cr.Lz) < 1e-9, (ck1.K - cr.Lz * cr.Lz).toExponential(1))
  const vp0 = [Math.sin(0.3), 0.1, -Math.cos(0.3)], vp = vp0.map(c => c / norm(vp0))
  const mp = K.ksMetric([0, 0, 20], A94, 1), up = K.staticObserver(mp), crp = K.cameraRay(mp, [0, 0, 20], up, vp)
  const kp = [crp.k[1], crp.k[2], crp.k[3]]
  check("Carter's K: the Delta form and the axis form agree at the pole (chi = 0.94)", Math.abs(K.carterK(mp, A94, kp, crp.E, crp.Lz).K - K.carterKAxis(mp, kp, crp.E).K) < 1e-9)
  // K is conserved along the march (the Hamiltonian flow is the Kerr geodesic)
  let worstK = 0
  // (the Delta form cancels two terms of order r^4 far out, so the check stops at 10 Rs)
  for (const x of [[0, 0, 6], [0, 6, 0], [3, 4, 3]]) {
    const m = K.ksMetric(x, A94, 1), u = K.staticObserver(m)
    for (let i = 0; i < 12; i++) {
      const th = 2.6 + 0.4 * (i / 12), ph = i * 0.9, v = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
      const vv = x[2] === 6 ? v : [v[0], -Math.abs(v[2]), v[1]]
      const pr = K.pixelRay(x, A94, 1, u, vv)
      const t = K.traceRay(x, pr.k, A94, 1, pr.E, { rOut: 10, noTail: true })
      if (t.out !== "sky" || t.steps > 40) continue
      const me = K.ksMetric(t.x, A94, 1)
      worstK = Math.max(worstK, Math.abs(K.carterK(me, A94, t.k, pr.E, t.Lz).K - K.carterK(m, A94, pr.k, pr.E, pr.Lz).K) / K.carterK(m, A94, pr.k, pr.E, pr.Lz).K)
    }
  }
  // (the march's step is 0.18 of the distance to r = 0.3; at the 0.12 it had, this was under 1e-3)
  check("Carter's K conserved along traced rays (relative; the Delta form loses ~300x to cancellation at 10 Rs)", worstK < 3e-3, worstK.toExponential(2))
}

// 6. a = 0 regression: the KS march against the exact Schwarzschild integral
//    (the position angle swept from the camera to infinity, test_fall.js's
//    reference) and against the old Verlet tracer of hole.frag, ported, for a
//    hovering camera at 20 Rs and a fan of impact parameters; captured or not
//    agrees on every ray outside the 1 % band at b_crit
const B_CRIT = 2.598076211
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
// the old tracer: velocity Verlet on a = -3/2 h^2 x / r^5 from the camera, 200 steps
function verlet(x0, v0) {
  let x = x0.slice(), v = v0.slice()
  const h3 = [x[1] * v[2] - x[2] * v[1], x[2] * v[0] - x[0] * v[2], x[0] * v[1] - x[1] * v[0]], h2 = h3[0] * h3[0] + h3[1] * h3[1] + h3[2] * h3[2]
  for (let i = 0; i < 200; i++) {
    const r = norm(x)
    if (r < 1) return { fell: true }
    if (r > 61 && x[0] * v[0] + x[1] * v[1] + x[2] * v[2] > 0) break
    const dt = Math.min(3, Math.max(0.025, 0.11 * (r - 0.9)))
    const r2 = r * r, a0 = x.map(c => -1.5 * h2 * c / (r2 * r2 * r))
    const vh = v.map((c, j) => c + a0[j] * dt * 0.5)
    x = x.map((c, j) => c + vh[j] * dt)
    const r1 = norm(x), r12 = r1 * r1
    v = vh.map((c, j) => c - 1.5 * h2 * x[j] / (r12 * r12 * r1) * dt * 0.5)
  }
  return { fell: false, dir: v.map(c => c / norm(v)) }
}
{
  const x = [0, 20, 0], m = K.ksMetric(x, 0, 1), u = K.staticObserver(m)
  let worstExact = 0, worstVerlet = 0, badClass = 0, n = 0, worstAt = ""
  for (let b = 0.5; b < 50; b *= 1.08) {
    const ang = Math.asin(Math.min(1, b * Math.sqrt(0.95) / 20))    // b = r sin(a) / sqrt(f)
    const v = [Math.sin(ang), -Math.cos(ang), 0]
    const pr = K.pixelRay(x, 0, 1, u, v)
    const t = K.traceRay(x, pr.k, 0, 1, pr.E, {})
    const bb = Math.abs(pr.Lz) / pr.E
    const captured = bb < B_CRIT
    if (Math.abs(bb / B_CRIT - 1) < 0.01) continue
    if ((t.out === "lost") !== captured) badClass++
    if (captured) continue
    n++
    // exact: the sweep from u = 1/20 to infinity for a diving ray with c = 1/b^2, direction x̂ cos(phi) + th sin(phi)
    const phi = refSweep(1 / 20, 1 / (bb * bb), true)
    const xh = [0, 1, 0], th = [1, 0, 0]
    const dExact = [xh[0] * Math.cos(phi) + th[0] * Math.sin(phi), xh[1] * Math.cos(phi) + th[1] * Math.sin(phi), 0]
    // the march's direction without the tail, which the exact sweep from 20 Rs has, but compare with it: the tail is what makes the two agree
    const dAng = angle(t.dir, dExact)
    if (dAng > worstExact) { worstExact = dAng; worstAt = "b " + bb.toFixed(2) }
    // the old tracer from the same point with the flat direction (sin a = b / r):
    // its orbit lacks the u^3 term in the first integral at the start, which
    // is the "Euclidean direction" approximation of the old hovering camera
    if (bb < 19) {
      const angF = Math.asin(bb / 20), vF = [Math.sin(angF), -Math.cos(angF), 0]
      const vr = verlet(x, vF)
      if (!vr.fell) worstVerlet = Math.max(worstVerlet, Math.abs(angle(vr.dir, vF) - angle(t.raw, v)))
    }
  }
  check("a = 0: captured / escaped agrees with b < B_CRIT on every ray", badClass === 0, badClass)
  check("a = 0: escape direction within 0.1 deg of the exact Schwarzschild integral (" + n + " rays)", worstExact < 0.1, worstExact.toFixed(4) + " deg at " + worstAt)
  check("a = 0, hovering at 20 Rs: within 1 deg of the old Verlet tracer (its flat start is what changed)", worstVerlet < 1, worstVerlet.toFixed(4) + " deg")
  // from far away (3000 Rs; the march starts at the camera, 20 long steps to
  // 60 Rs): the total deflection against the exact 2 int du/sqrt(P) - pi; the
  // old tracer, started at the R_OUT entry with the flat direction as hole.frag
  // did, is reported too (its start ignored the tilt of the coordinate
  // direction at 60 Rs, up to a degree or so for the widest rays)
  let worstFar = 0, worstOld = 0, nFar = 0
  for (let b = 3; b < 50; b *= 1.15) {
    const xf = [0, 3000, 0], mf = K.ksMetric(xf, 0, 1), uf = K.staticObserver(mf)
    const ang = Math.asin(b * Math.sqrt(1 - 1 / 3000) / 3000), v = [Math.sin(ang), -Math.cos(ang), 0]   // b = r sin(a) / sqrt(f)
    const pr = K.pixelRay(xf, 0, 1, uf, v)
    const t = K.traceRay(xf, pr.k, 0, 1, pr.E, {})
    if (t.out !== "sky") continue
    nFar++
    const alpha = (refSweep(0, 1 / (b * b), true) - Math.PI) * 180 / Math.PI   // from u = 0 the sweep is the full 2 int_0^ua
    worstFar = Math.max(worstFar, Math.abs(angle(t.dir, v) - alpha))
    const bq = xf[1] * v[1], cq = 3000 * 3000 - 60 * 60, tq = -bq - Math.sqrt(bq * bq - cq)
    const vr = verlet([v[0] * tq, 3000 + v[1] * tq, 0], v)
    if (!vr.fell) worstOld = Math.max(worstOld, Math.abs(angle(vr.dir, v) - alpha))
  }
  check("a = 0, from 3000 Rs: total deflection within 0.1 deg of the exact 2 int du/sqrt(P) - pi (" + nFar + " rays)", worstFar < 0.1, worstFar.toFixed(4) + " deg; the old tracer was off by up to " + worstOld.toFixed(2) + " deg")
}
// the falling camera at a = 0 against the old exit-angle integral (sweepOut / sweepIn / sweepTurn's reference)
{
  const E = Math.sqrt(1 - 1 / 6)
  let worst = 0, n = 0, bad = 0, worstAt = ""
  for (const r of [3, 1.6, 1.4, 1.0, 0.98, 0.5, 0.2]) {
    const x = [0, 0, r], m = K.ksMetric(x, 0, 1), u = K.axisInfaller(r, 0, E, [0, 0, 1])
    const f = 1 - 1 / r, w = Math.sqrt(Math.max(E * E - f, 0))
    for (let ang = 0.05; ang < Math.PI; ang += 0.11) {
      const v = [Math.sin(ang), 0, Math.cos(ang)]
      const n1 = -v[2], nt = Math.max(Math.abs(v[0]), 1e-3), e = E - n1 * w, s = w - n1 * E
      const pr = K.pixelRay(x, 0, 1, u, v)
      const t = K.traceRay(x, pr.k, 0, 1, pr.E, { camInside: r < 1 })
      if (e <= 0) { if (t.out !== "lost") bad++; continue }
      if (Math.abs(s) < 1e-3) continue                 // tangential at the camera: the rule's own boundary
      const b = r * nt / e, c = 1 / (b * b)
      const sky = s < 0 ? (r >= 1.5 && b > B_CRIT) : (r >= 1.5 || b < B_CRIT)
      if (Math.abs(b / B_CRIT - 1) < 0.01) continue
      if (sky !== (t.out === "sky")) { bad++; continue }
      if (!sky) continue
      let phi
      if (b < B_CRIT) phi = refSweep(1 / r, c, true) ; else phi = refSweep(1 / r, c, s < 0)
      if (b < B_CRIT) {
        // climbing: the sweep from u = 1/r outward is the diving sweep to infinity with no turning point: refSweep(u, c, true) covers u <= 1/r
        phi = refSweep(1 / r, c, true)
      }
      const d = [Math.sin(phi), 0, Math.cos(phi)]
      n++
      const dAng = angle(t.dir, d)
      if (dAng > worst) { worst = dAng; worstAt = "r " + r + " look " + (ang * 180 / Math.PI).toFixed(0) + " deg" }
    }
  }
  check("a = 0, falling: sky / dark as the old tetrad rules say", bad === 0, bad)
  check("a = 0, falling: escape direction within 0.15 deg of the exact integral (" + n + " rays)", worst < 0.15, worst.toFixed(4) + " deg at " + worstAt)
}

// 7. conservation along traced rays: E exact by construction, L_z to 1e-6
//    relative, and the null condition g^mn k_m k_n = 0 kept, for rays from
//    the 20 Rs and 6 Rs hover cameras, the falling camera near r+, between
//    the horizons and (math) at r = -2
{
  const a = A94, h = K.horizons(a)
  let worstL = 0, worstN = 0, n = 0
  const cams = [
    { x: [0, 20, 0], sheet: 1, u: null }, { x: [3, 5, 2], sheet: 1, u: null },
    { x: [0, 0, h.rPlus + 0.05], sheet: 1, u: K.axisInfaller(h.rPlus + 0.05, a, 0.913, [0, 0, 1]), inside: false },
    { x: [0, 0, 0.5], sheet: 1, u: K.axisInfaller(0.5, a, 0.913, [0, 0, 1]), inside: true },
    { x: [0, 0, -2], sheet: -1, u: K.axisInfaller(-2, a, 1.5, [0, 0, 1]), inside: true }
  ]
  for (const c of cams) {
    const m = K.ksMetric(c.x, a, c.sheet), u = c.u || K.staticObserver(m)
    for (let i = 0; i < 24; i++) {
      const th = Math.acos(1 - 2 * (i + 0.5) / 24), ph = i * 2.399
      const v = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
      const pr = K.pixelRay(c.x, a, c.sheet, u, v)
      if (pr.E <= 0) continue
      const t = K.traceRay(c.x, pr.k, a, c.sheet, pr.E, { camInside: !!c.inside })
      if (t.out === "lost") continue          // a stalled or ring-struck state is not a geodesic's end
      n++
      const tol = t.steps > 40 ? 3e-3 : 1e-4  // winding rays near the photon orbits amplify the step error
      worstL = Math.max(worstL, Math.abs(t.Lz - pr.Lz) / Math.max(Math.abs(pr.Lz), 1) / tol * 1e-6)
      const me = K.ksMetric(t.x, a, t.sheet), k4 = [-pr.E, t.k[0], t.k[1], t.k[2]]
      const lk = -k4[0] * (-1) * 0 + (pr.E + me.l[0] * t.k[0] + me.l[1] * t.k[1] + me.l[2] * t.k[2])
      const H = -pr.E * pr.E + t.k[0] * t.k[0] + t.k[1] * t.k[1] + t.k[2] * t.k[2] - me.f * lk * lk
      worstN = Math.max(worstN, Math.abs(H) / (pr.E * pr.E) / tol * 1e-6)
    }
  }
  check("L_z conserved along " + n + " escaped rays (1e-4, 3e-3 for winding ones)", worstL < 1e-6, (worstL * 1e6).toExponential(2) + " of the tolerance")
  check("the null condition holds at the end of every escaped trace", worstN < 1e-6, (worstN * 1e6).toExponential(2) + " of the tolerance")
}

// 8. the classifier against the march: hovering at 20 Rs (also at the pole)
//    and 6 Rs, falling outside r+, between the horizons; agreement everywhere
//    but within 1 % of the critical curve, where |xs| is small
{
  const a = A94, h = K.horizons(a)
  let bad = 0, n = 0, worstBad = 0
  const cams = [
    { x: [0, 20, 0], sheet: 1 }, { x: [0, 0, 20], sheet: 1 }, { x: [0, 6, 0], sheet: 1 }, { x: [3, 4, 3], sheet: 1 },
    { x: [0, 0, 2], sheet: 1, E: 0.913 }, { x: [0, 0, 1.0], sheet: 1, E: 0.913 }, { x: [0, 0, h.rPlus + 0.02], sheet: 1, E: 0.913 },
    { x: [0, 0, 0.6], sheet: 1, E: 0.913, inside: true }, { x: [0, 0, 0.4], sheet: 1, E: 0.913, inside: true }
  ]
  for (const c of cams) {
    const m = K.ksMetric(c.x, a, c.sheet), u = c.E ? K.axisInfaller(c.x[2], a, c.E, [0, 0, 1]) : K.staticObserver(m)
    const rCam = m.r
    for (let i = 0; i < 400; i++) {
      const th = Math.acos(1 - 2 * (i + 0.5) / 400), ph = i * 2.399963
      const v = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
      const pr = K.pixelRay(c.x, a, c.sheet, u, v)
      const ck = c.E ? K.carterKAxis(m, pr.k, pr.E) : K.carterK(m, a, pr.k, pr.E, pr.Lz)
      const xs = K.radialClass(pr.E, pr.Lz, ck.K, a, rCam, ck.rdot < 0, h.rPlus)
      const t = K.traceRay(c.x, pr.k, a, c.sheet, pr.E, { camInside: !!c.inside })
      if (Math.abs(xs) < 0.01) continue
      n++
      if ((xs > 0) !== (t.out === "sky")) { bad++; worstBad = Math.max(worstBad, Math.abs(xs)) }
    }
  }
  check("classifier agrees with the march on " + n + " rays from 9 cameras (|xs| > 0.01)", bad === 0, bad + " disagreements, worst |xs| " + worstBad.toFixed(3))
  // at a = 0 it is the sign of b - B_CRIT with the old s rule, and ~ (b/B_CRIT)^2 - 1)/2
  let worst0 = 0
  const m0 = K.ksMetric([0, 20, 0], 0, 1), u0 = K.staticObserver(m0)
  for (let b = 1; b < 5; b += 0.1) {
    const ang = Math.asin(Math.min(1, b * Math.sqrt(0.95) / 20)), v = [Math.sin(ang), -Math.cos(ang), 0]
    const pr = K.pixelRay([0, 20, 0], 0, 1, u0, v), ck = K.carterK(m0, 0, pr.k, pr.E, pr.Lz)
    const xs = K.radialClass(pr.E, pr.Lz, ck.K, 0, 20, ck.rdot < 0, 1)
    worst0 = Math.max(worst0, Math.abs(xs - 0.5 * ((b / B_CRIT) ** 2 - 1)))
  }
  check("a = 0: the classifier is (b^2/B_CRIT^2 - 1)/2 exactly", worst0 < 1e-9, worst0.toExponential(2))
}

// 9. the gas: unit 4-velocity on the circular orbits from the ISCO to 30 Rs,
//    Kepler far out, the face-on shift sqrt(1 - 3M/r + 2 a sqrt(M) r^-3/2)
{
  const a = A94
  let worstU = 0, worstG = 0
  for (let r = K.isco(a, 1); r < 30; r *= 1.1) {
    const x = [Math.sqrt(r * r + a * a), 0, 0]              // KS cylindrical radius of BL radius r on the plane
    const m = K.ksMetric(x, a, 1)
    const g = K.gasVelocity(m, x, a, r)
    worstU = Math.max(worstU, Math.abs(K.gdot(m, g.u, g.u) + 1), Math.abs(m.r - r))
    const face = K.gasShift(g.N, g.Omega, 1, 0)
    const ut = (Math.pow(r, 1.5) + a * Math.sqrt(M)) / (Math.pow(r, 0.75) * Math.sqrt(Math.pow(r, 1.5) - 3 * M * Math.sqrt(r) + 2 * a * Math.sqrt(M)))
    worstG = Math.max(worstG, Math.abs(face - 1 / ut))
  }
  check("gas 4-velocity is unit timelike from the ISCO out", worstU < 1e-12, worstU.toExponential(2))
  check("face-on shift of the gas = 1 / u^t, u^t = (r^1.5 + a sqrt M) / (r^0.75 sqrt(r^1.5 - 3M r^0.5 + 2a sqrt M)) (BPT 1972)", worstG < 1e-12, worstG.toExponential(2))
  check("Omega -> Kepler sqrt(M/r^3) far out, prograde", Math.abs(K.gasOmega(1000, a) / Math.sqrt(M / 1e9) - 1) < 1e-3 && K.gasOmega(2, a) > 0)
  // -k.u = N (E - Omega L_z) is the full dot product
  const x = [2, 0, 0.3], m = K.ksMetric(x, a, 1), g = K.gasVelocity(m, x, a, m.r)
  const k = [-1.1, 0.3, 0.8, -0.2], Lz = x[0] * k[2] - x[1] * k[1]
  check("the gas's shift is one dot product: -k.u = N (E - Omega L_z)", Math.abs(-(k[0] * g.u[0] + k[1] * g.u[1] + k[2] * g.u[2] + k[3] * g.u[3]) - g.N * (1.1 - g.Omega * Lz)) < 1e-12)
}

// 10. the axis fall: the table against a fine quadrature, the proper time
//     between the horizons, a = 0 reproduces fall.js's numbers, and the
//     from-rest fall cannot reach r < 0
{
  const a = A94, h = K.horizons(a)
  const E = K.axisEnergyFromRest(6, a)
  check("from rest at 6 Rs, chi = 0.94: E = 0.9134", Math.abs(E - 0.91343) < 1e-5, E.toFixed(5))
  const T = K.axisFall(6, a, E, h.rMinus)
  // quadrature of dtau = dr / w from r0 (substituting the square-root start)
  function quad(rA, rB) { const N = 400000; let s = 0; for (let i = 0; i < N; i++) { const q = (i + 0.5) / N, r = rA - (rA - rB) * q * q; s += 2 * (rA - rB) * q / K.axisSpeed(r, a, E) / N } return s }
  const tauPlus = K.tableTau(T, h.rPlus), tauMinus = T.tauEnd
  check("tau(r+) matches the quadrature", Math.abs(tauPlus - quad(6, h.rPlus)) < 1e-7, (tauPlus * RS_C).toFixed(3) + " s")
  check("r+ -> r-: 14.90 s of proper time", Math.abs((tauMinus - tauPlus) * RS_C - 14.90) < 0.01, ((tauMinus - tauPlus) * RS_C).toFixed(3))
  check("the whole drop to r-: 960.9 s", Math.abs(tauMinus * RS_C - 960.9) < 0.1, (tauMinus * RS_C).toFixed(1))
  let worstV = 0, worstInv = 0, mono = true
  for (let i = 1; i < 200; i++) {
    const tau = T.tauEnd * i / 200, r = K.tableR(T, tau), hh = 1e-4
    const v = (K.tableR(T, tau - hh) - K.tableR(T, tau + hh)) / (2 * hh)
    worstV = Math.max(worstV, Math.abs(v - K.axisSpeed(r, a, E)))
    worstInv = Math.max(worstInv, Math.abs(K.tableTau(T, r) - tau))
    if (K.tableR(T, tau) >= K.tableR(T, tau - hh)) mono = false
  }
  check("dr/dtau from the table = -sqrt(E^2 - 1 + 2Mr/(r^2+a^2))", worstV < 1e-6, worstV.toExponential(2))
  check("tau(r(tau)) round trip", worstInv < 1e-8, worstInv.toExponential(2))
  check("r(tau) strictly decreasing to r-", mono && T.rEnd === h.rMinus)
  // a = 0: fall.js's cycloid
  // (fall.js keeps the closed form for a = 0; the table is checked against it
  // down to 0.02 Rs, short of the singularity where the acceleration blows up)
  const T0 = K.axisFall(6, 0, Math.sqrt(1 - 1 / 6), 0.02)
  const Tc = RS_C * Math.pow(6, 1.5), cyc = r => { const e = Math.acos(2 * r / 6 - 1); return Tc / 2 * (e + Math.sin(e)) }
  check("a = 0: the table follows the cycloid to 0.02 Rs (943.8 s to the centre)", Math.abs(T0.tauEnd * RS_C - cyc(0.02)) < 1e-3, (T0.tauEnd * RS_C).toFixed(3) + " vs " + cyc(0.02).toFixed(3))
  check("a = 0: 28.75 s inside the horizon", Math.abs((K.tableTau(T0, 0.02) - K.tableTau(T0, 1)) * RS_C - (cyc(0.02) - cyc(1))) < 1e-3)
  // the from-rest fall turns back at a^2/r0 inside r-: r < 0 is forbidden
  let forbidden = true
  for (let r = -0.001; r > -20; r -= 0.1) if (E * E - 1 + 2 * M * r / (r * r + a * a) >= 0) forbidden = false
  check("from rest: (dr/dtau)^2 < 0 for every r < 0 (the other universe is out of reach)", forbidden)
  const Tr = K.axisFall(6, a, E, -12)
  check("from rest: the fall turns at a^2/r0 = 0.0368 Rs", Math.abs(Tr.rEnd - a * a / 6) < 2e-3 && Tr.rEnd > 0, Tr.rEnd.toFixed(4))
  check("the threshold for the plunge is E = sqrt(1 + M/a) = 1.4366", Math.abs(K.axisEscapeEnergy(a) - 1.4366) < 1e-4)
  let open = true
  for (let r = 6; r > -20; r -= 0.01) if (1.5 * 1.5 - 1 + 2 * M * r / (r * r + a * a) <= 0) open = false
  check("E = 1.5: (dr/dtau)^2 > 0 all the way to r = -20", open)
  const Tm = K.axisFall(6, a, 1.5, -12)
  check("E = 1.5 plunge: r+ to r- 9.2 s, r- to the disk 10.0 s, disk to -10 Rs 444 s", Math.abs((K.tableTau(Tm, h.rMinus) - K.tableTau(Tm, h.rPlus)) * RS_C - 9.2) < 0.1 && Math.abs((K.tableTau(Tm, 0) - K.tableTau(Tm, h.rMinus)) * RS_C - 10.0) < 0.1 && Math.abs((K.tableTau(Tm, -10) - K.tableTau(Tm, 0)) * RS_C - 444) < 2,
    ((K.tableTau(Tm, h.rMinus) - K.tableTau(Tm, h.rPlus)) * RS_C).toFixed(2) + " " + ((K.tableTau(Tm, 0) - K.tableTau(Tm, h.rMinus)) * RS_C).toFixed(2) + " " + ((K.tableTau(Tm, -10) - K.tableTau(Tm, 0)) * RS_C).toFixed(1))
  check("E = 1.5 plunge: monotone through the disk to -12 Rs", Tm.rEnd === -12 && Tm.v.every(v => v < 0))
  const slow = K.axisSpeed(-a, a, 1.5), far = K.axisSpeed(-12, a, 1.5)
  check("the plunge slows to 0.43 c at r = -a and recedes at 1.08 c per Rs/c at -12 (repulsion; 1.12 at infinity)", Math.abs(slow - 0.43) < 0.01 && far > 1.05 && Math.abs(K.axisSpeed(-1e6, a, 1.5) - Math.sqrt(1.25)) < 1e-3, slow.toFixed(3) + " " + far.toFixed(3))
}

// 11. mathematics mode: backward rays from the axis camera at r = -3 Rs: aimed
//     at the disk's centre they pass to r > 0, cross r- and r+ and reach our
//     sky; aimed well away they reach r = -60 (the other sky); one at the
//     ring is lost. From between the horizons, rays with E <= 0 are dark and
//     the rest cross r+.
{
  const a = A94, h = K.horizons(a)
  const x = [0, 0, -3], sheet = -1, m = K.ksMetric(x, a, sheet), u = K.axisInfaller(-3, a, 1.5, [0, 0, 1])
  const back = K.pixelRay(x, a, sheet, u, [0, 0, 1])          // looking back at the disk's centre
  const tb = K.traceRay(x, back.k, a, sheet, back.E, { camInside: true })
  check("from r = -3, straight back at the disk: through the throat to our sky", tb.out === "sky" && tb.sheet === 1, tb.out + " in " + tb.steps + " steps, E " + back.E.toFixed(3))
  const away = K.pixelRay(x, a, sheet, u, [Math.sin(1.05), 0, Math.cos(1.05)])
  const ta = K.traceRay(x, away.k, a, sheet, away.E, { camInside: true })
  check("from r = -3, 60 degrees off: the other universe's sky", ta.out === "other", ta.out + " in " + ta.steps + " steps")
  // from the far side the throat (our sky) fills the middle, the other sky the
  // rest, with the change where the ring is: outcomes ordered by look angle
  let seq = ""
  for (let deg = 0; deg <= 90; deg += 0.25) {
    const an = deg * Math.PI / 180, pr = K.pixelRay(x, a, sheet, u, [Math.sin(an), 0, Math.cos(an)])
    seq += K.traceRay(x, pr.k, a, sheet, pr.E, { camInside: true }).out[0]
  }
  check("from r = -3: our sky inside, the other sky outside, one change between (" + seq.indexOf("o") / 4 + " deg)", /^s+l*o+$/.test(seq), seq.replace(/(.)\1+/g, "$1"))
  // a ray in the equatorial plane heading for the ring stays in the plane and is lost on it
  const xe = [a + 0.3, 0, 0], me = K.ksMetric(xe, a, 1)
  const ring = K.pixelRay(xe, a, 1, [1 + me.f / 2, -me.f / 2 * me.l[0], -me.f / 2 * me.l[1], -me.f / 2 * me.l[2]], [-1, 0, 0])
  const tr = K.traceRay(xe, ring.k, a, 1, ring.E, { camInside: true })
  check("a ray along the equator into the ring: lost", tr.out === "lost" && tr.steps < 60, tr.out + " in " + tr.steps + " steps")
  // the sheet flips exactly once on the throat ray and never on the far one
  check("the throat ray ends on the r > 0 sheet, the far one on r < 0", tb.sheet === 1 && ta.sheet === -1)
  // between the horizons: E <= 0 is dark, E > 0 crosses r+
  const xi = [0, 0, 0.5], mi = K.ksMetric(xi, a, 1), ui = K.axisInfaller(0.5, a, 0.913, [0, 0, 1])
  let okE = true, nE = 0
  for (let ang = 0; ang <= Math.PI; ang += 0.1) {
    const pr = K.pixelRay(xi, a, 1, ui, [Math.sin(ang), 0, Math.cos(ang)])
    const t = K.traceRay(xi, pr.k, a, 1, pr.E, { camInside: true })
    if (pr.E <= 0 && t.out === "sky") okE = false
    if (pr.E > 0 && (t.out === "lost") && t.steps >= 150) okE = false   // E > 0 rays never stall at r+
    nE++
  }
  check("between the horizons: E <= 0 never reaches the sky; E > 0 never stalls (" + nE + " rays)", okE)
  // a ray straight down from between the horizons heads for r-: dark in the real hole
  const down = K.pixelRay(xi, a, 1, ui, [0, 0, -1])
  check("looking straight down between the horizons: E = E_f - w < 0 there", down.E < 0, down.E.toFixed(3))
}

// 12. the bend vector round trip
{
  let worst = 0
  for (let i = 0; i < 50; i++) {
    const cam = [Math.sin(i), Math.cos(i * 1.3) * 5, Math.cos(i * 0.7)], v0 = [Math.sin(i * 0.3), -Math.cos(i * 0.3) * Math.cos(i * 0.1), Math.sin(i * 0.1)]
    const v = v0.map(c => c / norm(v0))
    const d0 = [Math.cos(i * 1.7), Math.sin(i * 0.9), Math.sin(i * 2.1) * 0.5], d = d0.map(c => c / norm(d0))
    if (angle(v, d) > 170) continue
    const B = K.bendBasis(cam, v)
    const bv = K.bendEncode(v, B.n1, B.n2, d)
    worst = Math.max(worst, angle(K.bendDecode(v, B.n1, B.n2, bv), d))
  }
  check("bend vector encode/decode round trip", worst < 1e-4, worst.toExponential(2) + " deg")
}

console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
