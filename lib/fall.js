.pragma library
.import "kerr.js" as Kerr
// fall.js — the fall into Sagittarius A*: the trajectory, the clock and the
// screen timeline. Plain JS on numbers, like camera.js; no Qt types.
//
// Units: radii in Schwarzschild radii (Rs = 2GM/c^2), times in seconds of the
// falling observer's own clock (proper time). Sgr A* has 4.15 million solar
// masses (GRAVITY collaboration 2019), so GM/c^3 = 20.44 s and Rs/c = 40.88 s.
//
// The camera parks at 6 Rs on the hole's spin axis and lets go: free fall
// down the axis (lib/kerr.js, axisFall),
//   (dr/dtau)^2 = E^2 - 1 + 2 M r / (r^2 + a^2),   E^2 = 1 - 2 M r0 / (r0^2 + a^2)
// with E the observer's energy per unit mass (what the shaders need for the
// view: aberration and the frequency shift). For a = 0 this is the
// Schwarzschild cycloid r = r0/2 (1 + cos eta), tau = Tc/2 (eta + sin eta),
// Tc = (Rs/c) r0^(3/2), E = sqrt(1 - 1/r0), kept in closed form; a spinning
// hole has no closed form and r(tau) is tabulated once per fall. From 6 Rs
// the drop takes 944 s at a = 0 (915 s outside the horizon, 28.7 s inside);
// at a/M = 0.94 it is 961 s to the inner horizon, 946 s of them outside r+
// and 14.9 s between the two horizons. Tides at the horizon of a hole this
// large are negligible: nothing is felt on the way down.
//
// Where the fall ends. Realistic mode: at the inner (Cauchy) horizon r-.
// The Kerr solution continues through it, but a real hole's inner horizon is
// unstable (Penrose 1968; Poisson & Israel 1990, mass inflation; Ori 1991):
// light falling in after us arrives there blueshifted without bound, and
// what the solution says beyond it describes nothing observed. The screen
// fades to black as r- is reached. Mathematics mode (`math`): the maximally
// extended solution, followed through r-, through the disk inside the ring
// singularity (r = 0 on the axis is the disk's centre; the ring is never
// touched) into the negative-r sheet, an asymptotically flat universe where
// the hole repels. An observer from rest at 6 Rs cannot get there: the
// potential 1 - 2Mr/(r^2+a^2) peaks at r = -a with 1 + M/a > E^2, so a
// from-rest fall turns back at r = a^2/r0 (0.037 Rs) and is thrown out into
// a new positive-r universe instead. Reaching r < 0 needs E >= sqrt(1 + M/a)
// = 1.44; the mode starts the plunge with E_MATH = 1.5, an impossible shove
// of 0.75 c down the axis, and says so. It ends at R_END_MATH = -12 Rs.
//
// On screen the approach is compressed (15 minutes would be a long wait):
// 6 Rs down to the polar photon orbit in 20 s, the shadow filling the view in
// 4 more to r+, then the inside at the true rate, one second of proper time
// per second, to r- (realistic) or to the disk (math). The slow climb out
// into the other universe (444 s to -10 Rs: the repulsion is gentle) is
// compressed again into S_OTHER = 20 s. The map s -> tau is C1 (monotone
// cubic Hermite on the compressed stretches, slope 1 where the real-time
// stretch begins and ends), so the fall never lurches when the rate changes.

const GM_C3 = 4.925490947e-6 * 4.15e6     // GM/c^3, seconds (G Msun/c^3 times the mass)
const RS_C = 2 * GM_C3                    // Rs/c, seconds: light crosses one radius in 40.88 s
const TAU_MAX_INSIDE = Math.PI * GM_C3    // the longest any observer lasts below a Schwarzschild horizon, s
const R_PHOTON = 1.5                      // the photon sphere (a = 0; the polar photon orbit otherwise)
const S_PHOTON = 20                       // screen seconds from the start to the photon orbit
const S_HORIZON = 24                      // ... and to the (outer) horizon
const S_OTHER = 20                        // ... screen seconds from the disk to the end, in math mode
const E_MATH = 1.5                        // the mathematics mode's plunge energy (from rest it would be 0.913)
const R_END_MATH = -12                    // where the mathematics mode fades out, Rs on the other sheet

// a drop from r0 (Rs) down the axis of a hole with spin a (Rs): its constants
// and the screen timeline; math: the plunge through the ring with E_MATH
function timeline(r0, a, math) {
  a = a || 0
  const h = Kerr.horizons(a)
  const tl = { r0: r0, a: a, math: !!math, rPlus: h.rPlus, rMinus: h.rMinus, rPhoton: a > 0 ? Kerr.polarPhotonOrbit(a) : R_PHOTON }
  if (a === 0 && !math) {
    // Schwarzschild, from rest: the cycloid in closed form
    tl.Tc = RS_C * Math.pow(r0, 1.5)
    tl.E = Math.sqrt(1 - 1 / r0)
    tl.tauEnd = tl.Tc / 2 * Math.PI
    tl.rEnd = 0
  } else {
    tl.E = math ? E_MATH : Kerr.axisEnergyFromRest(r0, a)
    tl.T = Kerr.axisFall(r0, a, tl.E, math ? R_END_MATH : h.rMinus)
    tl.tauEnd = tl.T.tauEnd * RS_C
    tl.rEnd = tl.T.rEnd
  }
  tl.tauPhoton = tauAtR(tl, Math.min(tl.rPhoton, r0))
  tl.tauHorizon = tauAtR(tl, Math.min(h.rPlus, r0))
  tl.tauInner = tauAtR(tl, Math.min(h.rMinus, r0))
  // the real-time stretch ends at the inner horizon (realistic) or the disk (math)
  tl.tauReal = math ? tauAtR(tl, 0) : tl.tauEnd
  tl.sReal = S_HORIZON + (tl.tauReal - tl.tauHorizon)
  tl.sEnd = math ? tl.sReal + S_OTHER : tl.sReal
  // Hermite slopes: the secant on the first stretch, the harmonic mean of the
  // two secants at the join (Fritsch-Carlson: monotone), 1 where real time begins
  const mA = tl.tauPhoton / S_PHOTON, mB = (tl.tauHorizon - tl.tauPhoton) / (S_HORIZON - S_PHOTON)
  tl.m0 = mA
  tl.m1 = mA > 0 && mB > 0 ? 2 / (1 / mA + 1 / mB) : 0
  // the last stretch (math): slope 1 at the disk, the secant at the end
  tl.m2 = math ? (tl.tauEnd - tl.tauReal) / S_OTHER : 1
  return tl
}

// proper time from the start of the drop to radius r
function tauAtR(tl, r) {
  if (tl.T) return Kerr.tableTau(tl.T, r) * RS_C
  const eta = Math.acos(Math.max(-1, Math.min(1, 2 * r / tl.r0 - 1)))   // the cycloid's angle
  return tl.Tc / 2 * (eta + Math.sin(eta))
}
// radius at proper time tau (signed: negative on the far sheet in math mode)
function rAt(tl, tau) {
  if (tl.T) return Kerr.tableR(tl.T, tau / RS_C)
  // invert eta + sin eta = 2 tau / Tc (monotone; bisection, since Newton
  // stalls at the singularity where the slope is 0)
  if (tau <= 0) return tl.r0
  if (tau >= tl.tauEnd) return 0
  const k = 2 * tau / tl.Tc
  let lo = 0, hi = Math.PI
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid + Math.sin(mid) < k) lo = mid; else hi = mid
  }
  const eta = 0.5 * (lo + hi)
  return tl.r0 / 2 * (1 + Math.cos(eta))
}
// the observer's speed along the axis, |dr/dtau| in units of c
function speedAt(tl, r) {
  if (tl.T) return Kerr.axisSpeed(r, tl.a, tl.E)
  return Math.sqrt(Math.max(0, 1 / r - 1 / tl.r0))
}

// cubic Hermite from (0, 0) to (1, 1) with end slopes m0, m1 (per unit tau)
function hermite(t, m0, m1) {
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * 0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * 1 + (t3 - t2) * m1
}
function dhermite(t, m0, m1) {
  const t2 = t * t
  return (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) + (3 * t2 - 2 * t) * m1
}
// proper time at screen time s
function tau(tl, s) {
  if (s <= 0) return 0
  if (s < S_PHOTON) {
    const d = tl.tauPhoton, T = S_PHOTON
    return d * hermite(s / T, tl.m0 * T / d, tl.m1 * T / d)
  }
  if (s < S_HORIZON) {
    const d = tl.tauHorizon - tl.tauPhoton, T = S_HORIZON - S_PHOTON
    return tl.tauPhoton + d * hermite((s - S_PHOTON) / T, tl.m1 * T / d, 1 * T / d)
  }
  if (s < tl.sReal || !tl.math) return tl.tauHorizon + (s - S_HORIZON)
  if (s >= tl.sEnd) return tl.tauEnd
  const d = tl.tauEnd - tl.tauReal, T = S_OTHER
  return tl.tauReal + d * hermite((s - tl.sReal) / T, 1 * T / d, tl.m2 * T / d)
}
// how many seconds of proper time pass per screen second at s
function rate(tl, s) {
  if (s < 0) return 0
  if (s < S_PHOTON) {
    const d = tl.tauPhoton, T = S_PHOTON
    return d / T * dhermite(s / T, tl.m0 * T / d, tl.m1 * T / d)
  }
  if (s < S_HORIZON) {
    const d = tl.tauHorizon - tl.tauPhoton, T = S_HORIZON - S_PHOTON
    return d / T * dhermite((s - S_PHOTON) / T, tl.m1 * T / d, 1 * T / d)
  }
  if (s < tl.sReal || !tl.math) return 1
  if (s >= tl.sEnd) return tl.m2
  const d = tl.tauEnd - tl.tauReal, T = S_OTHER
  return d / T * dhermite((s - tl.sReal) / T, 1 * T / d, tl.m2 * T / d)
}
// screen time at proper time tau (the inverse; bisection on the compressed parts)
function sAtTau(tl, t) {
  if (t <= 0) return 0
  if (t >= tl.tauHorizon && t <= tl.tauReal) return S_HORIZON + (t - tl.tauHorizon)
  let lo = t < tl.tauHorizon ? 0 : tl.sReal, hi = t < tl.tauHorizon ? S_HORIZON : tl.sEnd
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi)
    if (tau(tl, mid) < t) lo = mid; else hi = mid
  }
  return 0.5 * (lo + hi)
}

// the phase of the fall at radius r and proper time t, for the HUD and
// status(): "falling" (outside r+), "outer-horizon" (between the horizons),
// "inner-horizon" (the last second before r-, and the crossing), "ring"
// (from r- down through the disk, math), "other-universe" (r < -a, math)
function phase(tl, r, t) {
  if (r > tl.rPlus) return "falling"
  if (r <= -tl.a && tl.math) return "other-universe"
  if (r <= tl.rMinus && tl.math && t > tl.tauInner + 1e-9) return "ring"
  if (tl.a > 0 && tl.tauInner - t < 1) return "inner-horizon"
  return "outer-horizon"
}

// the state of a fall that starts at radius rStart: let go from the parked
// camera (from rest there, or the plunge in math mode), or picked up at the
// crossing when free flight carried the camera below the horizon (the
// canonical drop from 6 Rs, joined at that radius)
function begin(rStart, a, math) {
  const r0 = rStart >= 2 ? rStart : 6
  const tl = timeline(r0, a, math)
  const s = sAtTau(tl, tauAtR(tl, Math.min(rStart, r0)))
  return { tl: tl, s: s }
}
// one frame: advances the screen clock, returns the radius (signed), the
// proper time left to the end, the current rate and the phase
function step(F, dt) {
  F.s += dt
  const t = tau(F.tl, F.s)
  const r = rAt(F.tl, t)
  return { r: r, left: Math.max(0, F.tl.tauEnd - t), rate: rate(F.tl, F.s), tau: t, phase: phase(F.tl, r, t) }
}
