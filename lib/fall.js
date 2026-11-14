.pragma library
// fall.js — the fall into Sagittarius A*: the trajectory, the clock and the
// screen timeline. Plain JS on numbers, like camera.js; no Qt types.
//
// Units: radii in Schwarzschild radii (Rs = 2GM/c^2), times in seconds of the
// falling observer's own clock (proper time). Sgr A* has 4.15 million solar
// masses (GRAVITY collaboration 2019), so GM/c^3 = 20.44 s and Rs/c = 40.88 s.
//
// The camera parks at 6 Rs and lets go: radial free fall from rest at r0, the
// Schwarzschild cycloid
//   r = r0/2 (1 + cos eta),  tau = Tc/2 (eta + sin eta),  Tc = (Rs/c) r0^(3/2)
// with E = sqrt(1 - 1/r0) the observer's energy per unit mass (what the
// shaders need for the view: aberration and the frequency shift). The whole
// drop from 6 Rs takes 944 s (eta = pi), 915 s of it outside the horizon and
// 28.7 s inside; the most any observer can last inside is pi GM/c^3 = 64 s,
// and only with an ideal rocket. Tides at the horizon of a hole this large
// are negligible: nothing is felt on the way down.
//
// On screen the approach is compressed (15 minutes would be a long wait): 6 Rs
// down to the photon sphere in 20 s, the shadow filling the view in 4 more,
// then the inside at the true rate, one second of proper time per second.
// The map s -> tau is C1 (monotone cubic Hermite on the two compressed
// stretches, slope 1 where the real-time stretch begins), so the fall never
// lurches when the rate changes.

const GM_C3 = 4.925490947e-6 * 4.15e6     // GM/c^3, seconds (G Msun/c^3 times the mass)
const RS_C = 2 * GM_C3                    // Rs/c, seconds: light crosses one radius in 40.88 s
const TAU_MAX_INSIDE = Math.PI * GM_C3    // the longest any observer lasts below the horizon, s
const R_PHOTON = 1.5                      // the photon sphere
const S_PHOTON = 20                       // screen seconds from the start to the photon sphere
const S_HORIZON = 24                      // ... and to the horizon

// a drop from rest at r0 (Rs): its constants and the screen timeline
function timeline(r0) {
  const Tc = RS_C * Math.pow(r0, 1.5)
  const tl = { r0: r0, E: Math.sqrt(1 - 1 / r0), Tc: Tc, tauEnd: Tc / 2 * Math.PI }
  tl.tauPhoton = tauAtR(tl, Math.min(R_PHOTON, r0))
  tl.tauHorizon = tauAtR(tl, Math.min(1, r0))
  tl.sEnd = S_HORIZON + (tl.tauEnd - tl.tauHorizon)
  // Hermite slopes: the secant on the first stretch, the harmonic mean of the
  // two secants at the join (Fritsch-Carlson: monotone), 1 where real time begins
  const mA = tl.tauPhoton / S_PHOTON, mB = (tl.tauHorizon - tl.tauPhoton) / (S_HORIZON - S_PHOTON)
  tl.m0 = mA
  tl.m1 = mA > 0 && mB > 0 ? 2 / (1 / mA + 1 / mB) : 0
  return tl
}

// proper time from the start of the drop to radius r (the cycloid's angle)
function tauAtR(tl, r) {
  const eta = Math.acos(Math.max(-1, Math.min(1, 2 * r / tl.r0 - 1)))
  return tl.Tc / 2 * (eta + Math.sin(eta))
}
// radius at proper time tau: invert eta + sin eta = 2 tau / Tc (monotone;
// bisection, since Newton stalls at the singularity where the slope is 0)
function rAt(tl, tau) {
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
// the observer's speed toward the centre, dr/dtau in units of c
function speedAt(tl, r) { return Math.sqrt(Math.max(0, 1 / r - 1 / tl.r0)) }

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
  return tl.tauHorizon + (s - S_HORIZON)
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
  return 1
}
// screen time at proper time tau (the inverse; bisection on the compressed part)
function sAtTau(tl, t) {
  if (t <= 0) return 0
  if (t >= tl.tauHorizon) return S_HORIZON + (t - tl.tauHorizon)
  let lo = 0, hi = S_HORIZON
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi)
    if (tau(tl, mid) < t) lo = mid; else hi = mid
  }
  return 0.5 * (lo + hi)
}

// the state of a fall that starts at radius rStart: let go from the parked
// camera (from rest there), or picked up at the crossing when free flight
// carried the camera below the horizon (the canonical drop from 6 Rs, joined
// at that radius)
function begin(rStart) {
  const r0 = rStart >= 2 ? rStart : 6
  const tl = timeline(r0)
  const s = sAtTau(tl, tauAtR(tl, Math.min(rStart, r0)))
  return { tl: tl, s: s }
}
// one frame: advances the screen clock, returns the radius, the proper time
// left and the current rate
function step(F, dt) {
  F.s += dt
  const t = tau(F.tl, F.s)
  return { r: rAt(F.tl, t), left: Math.max(0, F.tl.tauEnd - t), rate: rate(F.tl, F.s), tau: t }
}
