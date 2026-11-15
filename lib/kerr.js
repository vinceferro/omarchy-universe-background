.pragma library
// kerr.js — the Kerr black hole as plain functions on numbers: the horizons and
// the special orbits, the metric in Kerr-Schild Cartesian coordinates with its
// gradients, observers' frames, light rays (the same Hamiltonian step as
// hole.frag, in double precision), the shadow-edge classifier of universe.frag,
// the gas's orbits, and the fall down the spin axis. fall.js builds its
// timeline on axisFall(); tests/test_kerr.js checks everything here against
// closed forms (Bardeen, Press & Teukolsky 1972; Teo 2003; Carter 1968) and
// against the Schwarzschild code it replaces.
//
// Units: lengths in Schwarzschild radii Rs = 2GM/c^2, so the mass is M = 0.5
// and the spin a = chi M = chi / 2 (chi = a/M, between 0 and 1). Signature
// (- + + +), G = c = 1. Vectors are plain arrays; 4-vectors are [t, x, y, z].
//
// Kerr-Schild form (Kerr & Schild 1965; see Visser 2007 for this notation):
//   g_mn = eta_mn + f l_m l_n        g^mn = eta^mn - f l^m l^n
//   f = 2 M r^3 / (r^4 + a^2 z^2)
//   l_m = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z / r)
// with r the Boyer-Lindquist radius, the root of r^4 - (rho^2 - a^2) r^2 -
// a^2 z^2 = 0 (rho^2 = x^2 + y^2 + z^2). l is null in both metrics, so
// l^m = (-1, l_i). The hole's angular momentum is along +z (g_tphi < 0:
// frame dragging turns things counterclockwise seen from +z). The metric is
// regular at both horizons; r = 0 is the disk x^2 + y^2 <= a^2, z = 0, whose
// rim is the ring singularity. Crossing the disk continues r to negative
// values (the "other" sheet), where f < 0: gravity repels. Which sheet a
// point is on is not in its coordinates, so every ray and the camera carry
// `sheet` (+1 or -1): r = sheet * sqrt(r^2), flipped when z changes sign with
// x^2 + y^2 < a^2 at the crossing. With that rule f and l are continuous
// through the disk (on the axis z/r stays 1 when z and r flip together).

const M = 0.5                 // the mass, in Rs
const R_OUT = 60              // beyond this the remaining bend is the weak-field tail (hole.frag's R_OUT)
const STEP_MAX = 180          // the march's step budget (hole.frag)

// ---- the numbers of the hole ----
// horizons r+- = M +- sqrt(M^2 - a^2)
function horizons(a) {
  const s = Math.sqrt(Math.max(M * M - a * a, 0))
  return { rPlus: M + s, rMinus: M - s }
}
// equatorial circular photon orbits, 2M (1 + cos(2/3 arccos(-+ a/M)))
// (Bardeen, Press & Teukolsky 1972): sign +1 prograde, -1 retrograde
function photonOrbit(a, sign) {
  return 2 * M * (1 + Math.cos(2 / 3 * Math.acos(Math.max(-1, Math.min(1, -sign * a / M)))))
}
// the spherical photon orbit through the poles (L_z = 0): the root of
// r^3 - 3 M r^2 + a^2 r + M a^2 = 0 between 2M and 3M (Teo 2003); the rays
// along the axis fall turn here
function polarPhotonOrbit(a) {
  let r = 3 * M
  for (let i = 0; i < 60; i++) {
    const p = r * r * r - 3 * M * r * r + a * a * r + M * a * a
    const dp = 3 * r * r - 6 * M * r + a * a
    r -= p / dp
  }
  return r
}
// the innermost stable circular orbit (Bardeen, Press & Teukolsky 1972, eq. 2.21)
function isco(a, sign) {
  const chi = a / M
  const Z1 = 1 + Math.cbrt(1 - chi * chi) * (Math.cbrt(1 + chi) + Math.cbrt(1 - chi))
  const Z2 = Math.sqrt(3 * chi * chi + Z1 * Z1)
  return M * (3 + Z2 - sign * Math.sqrt(Math.max(0, (3 - Z1) * (3 + Z1 + 2 * Z2))))
}
// the horizon's angular velocity a / (r^2 + a^2): a photon crossing it from
// our side has E - Omega L_z > 0
function horizonOmega(r, a) { return a / (r * r + a * a) }

// ---- the metric ----
// the Boyer-Lindquist radius of a Cartesian point, signed by the sheet; both
// branches of the quartic's root are written without cancellation
function ksRadius(x, a, sheet) {
  const rho2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2]
  const d = rho2 - a * a
  const S = Math.sqrt(d * d + 4 * a * a * x[2] * x[2])
  const r2 = d >= 0 ? 0.5 * (d + S) : 2 * a * a * x[2] * x[2] / (S - d)
  return sheet * Math.sqrt(r2)
}
// the sheet after moving from x0 (on sheet s0) to x1: flipped if the segment
// crosses z = 0 inside the ring
function sheetAt(x0, s0, x1, a) {
  if (x0[2] === 0 || (x0[2] > 0) === (x1[2] > 0)) return s0
  const t = x0[2] / (x0[2] - x1[2])
  const cx = x0[0] + (x1[0] - x0[0]) * t, cy = x0[1] + (x1[1] - x0[1]) * t
  return cx * cx + cy * cy < a * a ? -s0 : s0
}
// everything the equations of motion need at x: r, f, l_i, df/dx_i and
// dl_j/dx_i (as dl[i][j]). From the defining quartic, with D = r^4 + a^2 z^2:
//   dr/dx = r^3 x / D     dr/dy = r^3 y / D     dr/dz = r z (r^2 + a^2) / D
function ksMetric(x, a, sheet) {
  let r = ksRadius(x, a, sheet)
  if (Math.abs(r) < 1e-7) r = sheet * 1e-7          // the centre of the disk: 1/r terms below stay finite times f
  const r2 = r * r, A = r2 + a * a
  const D = Math.max(r2 * r2 + a * a * x[2] * x[2], 1e-14)
  const r3 = r2 * r
  const f = 2 * M * r3 / D
  // z / r, guarded where both vanish (near the disk): (z/r)^2 = (r^2 - rho^2 + a^2) / a^2
  let cz
  if (r2 > 1e-6 || a === 0) cz = x[2] / r
  else cz = (x[2] >= 0 ? 1 : -1) * (r >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, (r2 - (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + a * a) / (a * a)))
  const l = [(r * x[0] + a * x[1]) / A, (r * x[1] - a * x[0]) / A, cz]
  const dr = [r3 * x[0] / D, r3 * x[1] / D, r * x[2] * A / D]
  const df = [0, 0, 0], dl = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    // f = 2 M r^3 / D: d f = 2M (3 r^2 dr D - r^3 dD) / D^2, dD = 4 r^3 dr + 2 a^2 z dz
    const dD = 4 * r3 * dr[i] + (i === 2 ? 2 * a * a * x[2] : 0)
    df[i] = (6 * M * r2 * dr[i] - f * dD) / D
    const q = 2 * r * dr[i] / A          // d(1/A)/A^-1
    dl[i][0] = (x[0] * dr[i] + (i === 0 ? r : 0) + (i === 1 ? a : 0)) / A - l[0] * q
    dl[i][1] = (x[1] * dr[i] + (i === 1 ? r : 0) - (i === 0 ? a : 0)) / A - l[1] * q
    dl[i][2] = ((i === 2 ? 1 : 0) - cz * dr[i]) / r
  }
  return { r: r, f: f, l: l, dr: dr, df: df, dl: dl, D: D, A: A }
}
// lower an index: V_m = eta_mn V^n + f l_m (l_n V^n), l_t = 1
function lower(m, V) {
  const lv = V[0] + m.l[0] * V[1] + m.l[1] * V[2] + m.l[2] * V[3]
  return [-V[0] + m.f * lv, V[1] + m.f * m.l[0] * lv, V[2] + m.f * m.l[1] * lv, V[3] + m.f * m.l[2] * lv]
}
function dot4(Vlow, W) { return Vlow[0] * W[0] + Vlow[1] * W[1] + Vlow[2] * W[2] + Vlow[3] * W[3] }
// g(V, W) at m
function gdot(m, V, W) { return dot4(lower(m, V), W) }

// ---- observers ----
// Because l is null, e_a = delta_a - (f/2) l_a l is an orthonormal tetrad
// everywhere (its e_0 is an observer falling in along the KS congruence).
// Any other observer u is a boost of it: with U^a the components of u in that
// frame, gamma = U^0, beta_i = U^i / gamma, the boosted spatial legs are
//   E_i = e_i + (gamma - 1) (beta_i / beta^2) beta . e + gamma beta_i e_0
// and E_0 = u. Returns the four legs as 4-vectors (upper index).
function frame(m, u) {
  const f2 = 0.5 * m.f, l = m.l
  const e = [
    [1 + f2, -f2 * l[0], -f2 * l[1], -f2 * l[2]],
    [f2 * l[0], 1 - f2 * l[0] * l[0], -f2 * l[0] * l[1], -f2 * l[0] * l[2]],
    [f2 * l[1], -f2 * l[1] * l[0], 1 - f2 * l[1] * l[1], -f2 * l[1] * l[2]],
    [f2 * l[2], -f2 * l[2] * l[0], -f2 * l[2] * l[1], 1 - f2 * l[2] * l[2]]
  ]
  const ul = lower(m, u)
  const gamma = -dot4(ul, e[0])
  const beta = [dot4(ul, e[1]) / gamma, dot4(ul, e[2]) / gamma, dot4(ul, e[3]) / gamma]
  const b2 = beta[0] * beta[0] + beta[1] * beta[1] + beta[2] * beta[2]
  const be = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) be[c] = beta[0] * e[1][c] + beta[1] * e[2][c] + beta[2] * e[3][c]
  const E = [u.slice(), [], [], []]
  for (let i = 0; i < 3; i++) {
    const k1 = b2 > 1e-24 ? (gamma - 1) * beta[i] / b2 : 0, k2 = gamma * beta[i]
    for (let c = 0; c < 4; c++) E[i + 1][c] = e[i + 1][c] + k1 * be[c] + k2 * e[0][c]
  }
  return E
}
// hovering: u = (1 / sqrt(1 - f), 0, 0, 0), wherever f < 1 (outside the ergoregion)
function staticObserver(m) { return [1 / Math.sqrt(1 - m.f), 0, 0, 0] }
// falling along the axis, position pole * r (pole a unit vector, r signed by
// the sheet), with energy per unit mass E:
//   w = dr/dtau = -sqrt(E^2 - 1 + f),  f = 2 M r / (r^2 + a^2)
//   u^t = (E^2 (1 + f) + f^2) / (E + f w)     (= (E - f w) / (1 - f), regular at both horizons)
// the spatial velocity is -w along the pole, on both sheets (the fall goes on
// through the disk in the same direction)
function axisInfaller(r, a, E, pole) {
  const f = 2 * M * r / (r * r + a * a)
  const w = Math.sqrt(Math.max(E * E - 1 + f, 0))
  const ut = (E * E * (1 + f) + f * f) / (E + f * w)
  return [ut, -w * pole[0], -w * pole[1], -w * pole[2]]
}
// the fall's speed and energy for a start from rest at r0
function axisEnergyFromRest(r0, a) { return Math.sqrt(1 - 2 * M * r0 / (r0 * r0 + a * a)) }
function axisSpeed(r, a, E) { return Math.sqrt(Math.max(E * E - 1 + 2 * M * r / (r * r + a * a), 0)) }
// the least energy that carries an axis fall through the disk to r < 0: the
// potential 1 - 2Mr/(r^2+a^2) peaks at r = -a with 1 + M/a
function axisEscapeEnergy(a) { return Math.sqrt(1 + M / a) }

// ---- light rays ----
// The photon the camera sees in look direction v (world, unit): it travels
// along -v in the camera's frame, k^m = u^m - v^i E_i^m, observed frequency
// 1. Returns the covariant momentum k_m (k_t = -E, E the energy at infinity
// per unit observed frequency: the sky's shift seen/emitted is 1/E) and the
// conserved L_z = x k_y - y k_x.
function cameraRay(m, x, u, v) {
  const E = frame(m, u)
  const k = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) k[c] = u[c] - v[0] * E[1][c] - v[1] * E[2][c] - v[2] * E[3][c]
  const kl = lower(m, k)
  return { k: kl, kup: k, E: -kl[0], Lz: x[0] * kl[2] - x[1] * kl[1] }
}
// the Hamiltonian H = 1/2 g^mn p_m p_n = 1/2 (eta^mn p_m p_n) - 1/2 f (l.p)^2,
// l.p = E + l_i k_i; the photon's own motion (forward in its affine parameter):
//   dx^i/dL = k_i - f (l.p) l_i
//   dk_i/dL = 1/2 (l.p)^2 df/dx^i + f (l.p) (dl_j/dx^i) k_j
function motion(m, k, E) {
  const lp = E + m.l[0] * k[0] + m.l[1] * k[1] + m.l[2] * k[2]
  const flp = m.f * lp
  const dx = [k[0] - flp * m.l[0], k[1] - flp * m.l[1], k[2] - flp * m.l[2]]
  const dk = [0, 0, 0]
  for (let i = 0; i < 3; i++) dk[i] = 0.5 * lp * lp * m.df[i] + flp * (m.dl[i][0] * k[0] + m.dl[i][1] * k[1] + m.dl[i][2] * k[2])
  return { dx: dx, dk: dk, lp: lp }
}
// Carter's constant in the form K = Q + (L_z - a E)^2, which is what the
// radial potential needs: R(r) = (E (r^2 + a^2) - a L_z)^2 - Delta K.
// From the radial equation Sigma^2 (dr/dL)^2 = R at the camera, Delta =
// r^2 - 2Mr + a^2 (fine for a hovering camera, never near a horizon):
function carterK(m, a, k, E, Lz) {
  const mo = motion(m, k, E)
  const rdot = m.dr[0] * mo.dx[0] + m.dr[1] * mo.dx[1] + m.dr[2] * mo.dx[2]
  const Sigma = m.D / (m.r * m.r)
  const Delta = m.r * m.r - 2 * M * m.r + a * a
  const EA = E * m.A - a * Lz
  return { K: (EA * EA - Sigma * Sigma * rdot * rdot) / Delta, rdot: rdot }
}
// on the axis (where L_z = 0) instead: K = p_theta^2 = (r^2 + a^2) (k_x^2 + k_y^2)
// in Cartesian terms (rho_c = sqrt(r^2 + a^2) sin theta there), regular everywhere
function carterKAxis(m, k, E) {
  const mo = motion(m, k, E)
  const rdot = m.dr[0] * mo.dx[0] + m.dr[1] * mo.dx[1] + m.dr[2] * mo.dx[2]
  return { K: m.A * (k[0] * k[0] + k[1] * k[1]), rdot: rdot }
}
// The shadow's edge without a march (universe.frag). With the ray's E, L_z
// and K, P(r) = R(r) / (E^2 r^4) -> 1 at infinity; R has no r^3 term, so
// dP/dr = 0 is the quadratic 2 c2 r^2 + 3 c1 r + 4 c0 = 0 for
// R = E^2 r^4 + c2 r^2 + c1 r + c0. A ray traced backward that climbs
// escapes iff P > 0 at every critical point above the camera; one that dives
// escapes iff P < 0 at some critical point between the horizon and the
// camera. Returned signed, positive on the sky's side, scaled so that at
// a = 0 it is (b^2/B_CRIT^2 - 1) / 2, close to universe.frag's old
// b / B_CRIT - 1 near the edge. From between the horizons (every backward
// ray climbs) a ray needs E > 0 first.
function radialClass(E, Lz, K, a, rCam, climbing, rPlus) {
  if (E <= 0) return -1
  const A0 = E * a * a - a * Lz
  const c2 = 2 * E * A0 - K, c1 = 2 * M * K, c0 = A0 * A0 - a * a * K
  const P = r => (E * E * r * r * r * r + c2 * r * r + c1 * r + c0) / (E * E * r * r * r * r)
  const roots = []
  const qa = 2 * c2, qb = 3 * c1, qc = 4 * c0
  if (Math.abs(qa) < 1e-12 * (Math.abs(qb) + Math.abs(qc))) { if (Math.abs(qb) > 0) roots.push(-qc / qb) }
  else {
    const disc = qb * qb - 4 * qa * qc
    if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-qb + s) / (2 * qa), (-qb - s) / (2 * qa)) }
  }
  const lo = climbing ? rCam : rPlus, hi = climbing ? Infinity : rCam
  let m = Infinity
  for (const r of roots) if (r > lo && r < hi) m = Math.min(m, P(r))
  if (m === Infinity) m = climbing ? 1 : P(rCam)
  return climbing ? 0.5 * m : -0.5 * m
}

// The march: the shader's step (RK4 on (x, k_i), E constant), its step rule
// and its exits, in double precision. x0, k0 at the camera (k covariant,
// spatial), E the energy, sheet0 the camera's sheet; opts.camInside: the
// camera is below r+ (rays may then reach r+ from inside). Steps are set by a
// length in space, ds = max(0.02, 0.12 (|r| - 0.3)), divided by the coordinate
// speed, so the march slows toward the horizons and the ring and lengthens
// without bound far out (a ray from 3000 Rs reaches 60 Rs in 33 steps). The
// sheet rule is applied at every stage point. Exits: "sky" (our universe, the
// weak-field tail added), "other" (r -> -infinity), "lost" (the step budget,
// the ring within 0.005 Rs, stuck at a horizon for 30 steps: light from the
// chart's edge, or below r+ from a camera outside).
function traceRay(x0, k0, a, sheet0, E, opts) {
  opts = opts || {}
  const h = horizons(a)
  const maxSteps = opts.maxSteps || STEP_MAX
  const rPh = 0.98 * photonOrbit(a, 1)
  const rOut = opts.rOut || R_OUT
  let x = x0.slice(), k = k0.slice(), sheet = sheet0
  let stall = 0, steps = 0, out = "lost"
  if (E <= 0) return { out: out, dir: [0, 0, 0], x: x, k: k, sheet: sheet, steps: 0, Lz: 0 }   // light from the chart's edge
  const stage = (xs, ks, sheetRef) => {
    const m = ksMetric(xs, a, sheetRef)
    const mo = motion(m, ks, E)
    return { dx: mo.dx.map(v => -v), dk: mo.dk.map(v => -v), r: m.r, m: m }   // backward
  }
  let m0 = ksMetric(x, a, sheet)
  for (; steps < maxSteps; steps++) {
    const r = m0.r
    const rho2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2]
    const d0 = stage(x, k, sheet)
    const outward = x[0] * d0.dx[0] + x[1] * d0.dx[1] + x[2] * d0.dx[2] > 0
    if (rho2 > (rOut + 1) * (rOut + 1) && outward) { out = sheet > 0 ? "sky" : "other"; break }
    const rc = Math.sqrt(x[0] * x[0] + x[1] * x[1])
    if ((rc - a) * (rc - a) + x[2] * x[2] < 2.5e-5) break                          // the ring
    // outside r+ and diving below the innermost photon orbit: no way back out
    // (from a camera outside, below r+ at all)
    const rdot = m0.dr[0] * d0.dx[0] + m0.dr[1] * d0.dx[1] + m0.dr[2] * d0.dx[2]
    if (r > h.rPlus - 0.01 && r < rPh && rdot < 0) break
    if (!opts.camInside && r < h.rPlus - 0.01) break                                // fell in
    if (Math.abs(r - h.rPlus) < 0.03 || Math.abs(r - h.rMinus) < 0.03) { if (++stall > 30) break } else stall = 0
    const ds = Math.max(0.02, 0.12 * (Math.abs(r) - 0.3)) * (steps === 0 && opts.jitter ? opts.jitter : 1)
    const speed = Math.hypot(d0.dx[0], d0.dx[1], d0.dx[2])
    const hh = ds / Math.max(speed, 1e-9)
    // RK4
    const x1 = x.map((v, i) => v + 0.5 * hh * d0.dx[i]), k1 = k.map((v, i) => v + 0.5 * hh * d0.dk[i])
    const d1 = stage(x1, k1, sheetAt(x, sheet, x1, a))
    const x2 = x.map((v, i) => v + 0.5 * hh * d1.dx[i]), k2 = k.map((v, i) => v + 0.5 * hh * d1.dk[i])
    const d2 = stage(x2, k2, sheetAt(x, sheet, x2, a))
    const x3 = x.map((v, i) => v + hh * d2.dx[i]), k3 = k.map((v, i) => v + hh * d2.dk[i])
    const d3 = stage(x3, k3, sheetAt(x, sheet, x3, a))
    const xn = x.map((v, i) => v + hh / 6 * (d0.dx[i] + 2 * d1.dx[i] + 2 * d2.dx[i] + d3.dx[i]))
    const kn = k.map((v, i) => v + hh / 6 * (d0.dk[i] + 2 * d1.dk[i] + 2 * d2.dk[i] + d3.dk[i]))
    sheet = sheetAt(x, sheet, xn, a)
    x = xn; k = kn
    m0 = ksMetric(x, a, sheet)
  }
  const mo = motion(m0, k, E)
  let dir = [-mo.dx[0], -mo.dx[1], -mo.dx[2]]
  let dl = Math.hypot(dir[0], dir[1], dir[2]); dir = dir.map(v => v / dl)
  const raw = dir.slice()
  if (out === "sky" && !opts.noTail) dir = weakTail(x, dir)
  return { out: out, dir: dir, raw: raw, x: x, k: k, sheet: sheet, steps: steps, Lz: x[0] * k[1] - x[1] * k[0] }
}
// The direction still turns beyond R, but less than the Newtonian estimate
// says: the coordinate direction at finite R is already tilted toward the
// asymptote, because the coordinate speed in r is sqrt(E^2 - f L^2/r^2)
// rather than the flat one. To first order in M, for a ray leaving at R with
// impact parameter b (s = b/R), the asymptotic direction is the coordinate
// direction turned toward the hole by
//   delta = (M/b) (2 - (2 - s^2 - s^4) / sqrt(1 - s^2))  ~  3 M b^3 / (4 R^4)
// (the two terms are the remaining sweep of the position angle and the
// tilt; checked against the exact integral in test_kerr.js).
function weakTail(x, dir) {
  const R = Math.hypot(x[0], x[1], x[2])
  const along = x[0] * dir[0] + x[1] * dir[1] + x[2] * dir[2]
  const perp = [x[0] - dir[0] * along, x[1] - dir[1] * along, x[2] - dir[2] * along]
  const b = Math.hypot(perp[0], perp[1], perp[2])
  if (b < 1e-9) return dir
  const s2 = Math.min(b * b / (R * R), 0.81)
  const delta = (M / b) * (2 - (2 - s2 - s2 * s2) / Math.sqrt(1 - s2))
  const n = perp.map(v => -v / b)          // toward the hole
  const c = Math.cos(delta), sn = Math.sin(delta)
  return [dir[0] * c + n[0] * sn, dir[1] * c + n[1] * sn, dir[2] * c + n[2] * sn]
}
// the camera's pixel ray as hole.frag starts it: look direction v (world),
// position x, sheet, 4-velocity u -> the state for traceRay and the constants
function pixelRay(x, a, sheet, u, v) {
  const m = ksMetric(x, a, sheet)
  const cr = cameraRay(m, x, u, v)
  return { x: x, k: [cr.k[1], cr.k[2], cr.k[3]], E: cr.E, Lz: cr.Lz, m: m, kup: cr.kup }
}
// the "bend vector" hole.frag hands universe.frag: the escape direction d as
// (alpha cos psi, alpha sin psi) about the look direction v, in the basis
// n1 (toward the hole, perpendicular to v) and n2 = v x n1
function bendBasis(camPos, v) {
  const toHole = [-camPos[0], -camPos[1], -camPos[2]]
  const along = toHole[0] * v[0] + toHole[1] * v[1] + toHole[2] * v[2]
  let n1 = [toHole[0] - v[0] * along, toHole[1] - v[1] * along, toHole[2] - v[2] * along]
  let nl = Math.hypot(n1[0], n1[1], n1[2])
  if (nl < 1e-6) { n1 = Math.abs(v[0]) < 0.9 ? [0, v[2], -v[1]] : [v[2], 0, -v[0]]; nl = Math.hypot(n1[0], n1[1], n1[2]) }
  n1 = n1.map(c => c / nl)
  const n2 = [v[1] * n1[2] - v[2] * n1[1], v[2] * n1[0] - v[0] * n1[2], v[0] * n1[1] - v[1] * n1[0]]
  return { n1: n1, n2: n2 }
}
function bendEncode(v, n1, n2, d) {
  const c = Math.max(-1, Math.min(1, d[0] * v[0] + d[1] * v[1] + d[2] * v[2]))
  const alpha = Math.acos(c)
  const p1 = d[0] * n1[0] + d[1] * n1[1] + d[2] * n1[2], p2 = d[0] * n2[0] + d[1] * n2[1] + d[2] * n2[2]
  const pl = Math.hypot(p1, p2)
  return pl < 1e-9 ? [alpha, 0] : [alpha * p1 / pl, alpha * p2 / pl]
}
function bendDecode(v, n1, n2, bv) {
  const alpha = Math.hypot(bv[0], bv[1])
  if (alpha < 1e-9) return v.slice()
  const c = Math.cos(alpha), s = Math.sin(alpha), cp = bv[0] / alpha, sp = bv[1] / alpha
  return [v[0] * c + (n1[0] * cp + n2[0] * sp) * s, v[1] * c + (n1[1] * cp + n2[1] * sp) * s, v[2] * c + (n1[2] * cp + n2[2] * sp) * s]
}

// ---- the gas ----
// prograde circular orbits in the equatorial plane (Bardeen, Press &
// Teukolsky 1972): Omega = sqrt(M) / (r^(3/2) + a sqrt(M)). The gas at
// Boyer-Lindquist radius r turns rigidly with the plane's Omega(r) about the
// spin axis, u = N (d_t + Omega (x d_y - y d_x)), N from g(u, u) = -1; on
// the plane that is the geodesic (u^t = N). A ray with constants E, L_z is
// seen by that gas with frequency -k.u = N (E - Omega L_z): one line gives
// Doppler, the gravitational shift and frame dragging together.
function gasOmega(r, a) { return Math.sqrt(M) / (Math.pow(Math.max(r, 1e-6), 1.5) + a * Math.sqrt(M)) }
function gasVelocity(m, x, a, rOrbit) {
  const Om = gasOmega(rOrbit, a)
  const V = [1, -Om * x[1], Om * x[0], 0]
  const gVV = gdot(m, V, V)
  if (gVV >= -1e-6) return null                     // no timelike orbit here
  const N = 1 / Math.sqrt(-gVV)
  return { u: V.map(c => c * N), N: N, Omega: Om }
}
// the shift seen/emitted of a gas sample for a ray with E, L_z: 1 / (N (E - Omega L_z))
function gasShift(N, Omega, E, Lz) { return 1 / (N * (E - Omega * Lz)) }

// ---- the fall down the axis ----
// r(tau) for a drop along the axis: r'' = M (a^2 - r^2) / (r^2 + a^2)^2 (the
// derivative of half of E^2 - 1 + 2Mr/(r^2+a^2)), integrated with RK4 from
// r0 with speed -w0 (w0 = 0 from rest), through the disk if the energy allows
// (r < 0: the other universe), until r reaches rEnd (<= r0) or turns back.
// Returns a table { tau[], r[], v[] } (tau in Rs/c), read by rAt/tauAtR with
// cubic Hermite interpolation between samples.
function axisFall(r0, a, E, rEnd, n) {
  n = n || 8192
  const acc = r => M * (a * a - r * r) / ((r * r + a * a) * (r * r + a * a))
  // the span: the quadrature of dtau = dr / w from r0 down to rEnd (w ~ sqrt
  // of the distance from r0 at a start from rest, so the start is substituted)
  const w0 = axisSpeed(r0, a, E)
  let span = 0
  {
    const N = 20000
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N                       // r = r0 - (r0 - rEnd) s^2
      const r = r0 - (r0 - rEnd) * s * s
      const w = axisSpeed(r, a, E)
      if (w <= 0) { span = Infinity; break }
      span += 2 * (r0 - rEnd) * s / w / N
    }
  }
  if (!isFinite(span)) span = 4 * (r0 - rEnd) / Math.max(w0, 0.05)   // a turning fall: integrate long enough, then cut
  const tau = [0], R = [r0], V = [-w0]
  const h = span / n
  let r = r0, v = -w0
  for (let i = 0; i < n * 2; i++) {
    const k1v = acc(r), k1r = v
    const k2v = acc(r + 0.5 * h * k1r), k2r = v + 0.5 * h * k1v
    const k3v = acc(r + 0.5 * h * k2r), k3r = v + 0.5 * h * k2v
    const k4v = acc(r + h * k3r), k4r = v + h * k3v
    const rn = r + h / 6 * (k1r + 2 * k2r + 2 * k3r + k4r)
    const vn = v + h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
    if (rn <= rEnd) {
      // land exactly on rEnd: Hermite root in this step
      let lo = 0, hi = 1
      for (let j = 0; j < 60; j++) { const mid = 0.5 * (lo + hi); if (hermiteR(r, v, rn, vn, h, mid) > rEnd) lo = mid; else hi = mid }
      const t = 0.5 * (lo + hi)
      tau.push(tau[tau.length - 1] + h * t); R.push(rEnd); V.push(hermiteV(r, v, rn, vn, h, t))
      break
    }
    if (vn >= 0 && i > 0) { tau.push(tau[tau.length - 1] + h); R.push(rn); V.push(0); break }   // turned back
    r = rn; v = vn
    tau.push(tau[tau.length - 1] + h); R.push(r); V.push(v)
  }
  return { tau: tau, r: R, v: V, r0: r0, a: a, E: E, rEnd: R[R.length - 1], tauEnd: tau[tau.length - 1] }
}
function hermiteR(r0, v0, r1, v1, h, t) {
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * r0 + (t3 - 2 * t2 + t) * h * v0 + (-2 * t3 + 3 * t2) * r1 + (t3 - t2) * h * v1
}
function hermiteV(r0, v0, r1, v1, h, t) {
  const t2 = t * t
  return ((6 * t2 - 6 * t) * r0 + (3 * t2 - 4 * t + 1) * h * v0 + (-6 * t2 + 6 * t) * r1 + (3 * t2 - 2 * t) * h * v1) / h
}
// radius at proper time tau (Rs/c) from the table
function tableR(T, tau) {
  if (tau <= 0) return T.r[0]
  if (tau >= T.tauEnd) return T.rEnd
  const n = T.tau.length - 1
  let i = Math.min(n - 1, Math.floor(tau / T.tau[1]))
  while (i > 0 && T.tau[i] > tau) i--
  while (i < n - 1 && T.tau[i + 1] < tau) i++
  const h = T.tau[i + 1] - T.tau[i]
  return hermiteR(T.r[i], T.v[i], T.r[i + 1], T.v[i + 1], h, (tau - T.tau[i]) / h)
}
// proper time at radius r (the table is monotone in r until it ends; bisection)
function tableTau(T, r) {
  if (r >= T.r[0]) return 0
  if (r <= T.rEnd) return T.tauEnd
  let lo = 0, hi = T.tauEnd
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (tableR(T, mid) > r) lo = mid; else hi = mid }
  return 0.5 * (lo + hi)
}
