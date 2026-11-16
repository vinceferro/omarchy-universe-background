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
// light falling in after us arrives there blueshifted without bound: it is
// a Cauchy horizon, the edge of what the equations can predict. The fall is
// shown slowing into r- (below), the light closes in, and the screen fades
// to black. Mathematics mode (`math`): the maximally
// extended solution, followed through r-, through the disk inside the ring
// singularity (r = 0 on the axis is the disk's centre; the ring is never
// touched) into the negative-r sheet, an asymptotically flat universe where
// the hole repels. An observer from rest at 6 Rs cannot get there: the
// potential 1 - 2Mr/(r^2+a^2) peaks at r = -a with 1 + M/a > E^2, so a
// from-rest fall turns back at r = a^2/r0 (0.037 Rs) and is thrown out into
// a new positive-r universe instead. Reaching r < 0 needs E >= sqrt(1 + M/a)
// = 1.44; the mode starts the plunge with E_MATH = 1.5, an impossible shove
// (0.75 c at infinity; 0.79 c to someone hovering at the start, 6 Rs: see
// plungeSpeed) down the axis, and says so. It ends at R_END_MATH = -12 Rs.
//
// On screen the approach is compressed (15 minutes would be a long wait):
// 6 Rs down to the polar photon orbit in 20 s, the shadow filling the view in
// 4 more to r+, then the inside at the true rate, one second of proper time
// per second, to r- (realistic) or to the disk (math). The slow climb out
// into the other universe (444 s to -10 Rs: the repulsion is gentle) is
// compressed again into S_OTHER = 20 s. The map s -> tau is C1 (monotone
// cubic Hermite on the compressed stretches, slope 1 where the real-time
// stretch begins and ends), so the fall never lurches when the rate changes.
//
// The ending (realistic mode, a spinning hole). The observer reaches r- at
// full speed in finite proper time, and a camera that did the same would
// just stop there: on screen that reads as a freeze. So the last T_SLOW
// seconds of proper time are shown over S_SLOW screen seconds, the clock
// running down to a stop at r-:
//   tau(s) = tauEnd - T_SLOW (1 - u)^p,   u = (s - sSlow) / S_SLOW,  p = S_SLOW / T_SLOW
// (rate 1 where it begins, so C1; rate (1 - u)^(p - 1), falling to 0 at r-).
// It is a way of showing it, not time dilation: the HUD says "shown slower".
// Over the last S_LIGHT screen seconds the light closes in (light(), 0..1:
// the light falling in after us, blueshifted without bound; a cartoon), and
// the fade to black begins at sEnd, when it has closed (tl.sFade). The other
// endings (a = 0, math) keep the fade's old start, 2.2 s of proper time
// before the end.
//
// The story (story(), CAPTIONS): what the fall says, and when. fall.js only
// names the events and their screen times; the story band (lib/text.js)
// shows each for its reading time, one at a time, so nothing here knows how
// long a caption stands. The events: the glance back at the sky; the event
// horizon at the crossing; the inner horizon, S_TELL seconds before its
// light begins to close in (realistic), or as its phase begins (math); in
// math mode the ring S_RING seconds before the disk and the other universe
// at r = -a. The same events in both modes up to the inner horizon: the
// modes are one fall with two endings.
//
// The view (look(), viewE(), exposure()). Nothing steers the fall, but where
// the camera looks is ours to choose, and a fixed view shows little: the
// shadow is a disc 44 degrees across at 6 Rs and 80 at the horizon (it never
// fills half the sky for someone falling: aberration keeps it ahead), the
// sky beside it is squeezed toward its rim and shifted blue, and the sky
// behind turns red and dim. So the view is scripted, as a tilt from straight
// down (0: at the hole, 180 degrees: back up the axis) and a pan about the
// axis, eased between keys in screen time: down at the hole; a glance back
// up at the sky being left (S_BACK, between about 4 and 2.5 Rs); down again
// to hold the shadow's rim in the lower part of the screen through the
// horizon (rimTilt: the rim's own angle, from the closed form the shaders
// use); a slow look around between the horizons; level for the realistic
// ending, whose light closes in from above; in mathematics mode down through
// the ring and then back at it from the far sheet. The user's own look
// (drag, arrows) is added on top by Background.qml and eases back.
//
// viewE: the energy of the frame the picture is drawn in. The realistic
// fall's own; the mathematics mode's plunge is an impossible shove, and its
// frame comes on over the first S_SHOVE seconds (from rest to E_MATH)
// instead of in one frame: the same shove, shown as an acceleration.
//
// exposure: the eye's adaptation. Light from ahead is shifted blue and
// boosted (g^3.5 for the gas: 47 times at g = 3), light from behind is
// dimmed, so one fixed exposure is either white ahead or black behind. The
// estimate is the mean boost over fifteen directions of the view (those not
// in the shadow), against the same at the start of the fall; the exposure is
// that ratio to the power EXP_ADAPT (partial, as eyes adapt: a boosted view
// still reads brighter), within EXP_MIN..EXP_MAX. Background.qml eases
// toward it; universe.frag applies it to the hole's picture and rolls off
// what is still too bright.

const GM_C3 = 4.925490947e-6 * 4.15e6     // GM/c^3, seconds (G Msun/c^3 times the mass)
const RS_KM = 2 * GM_C3 * 299792.458      // the Schwarzschild radius, km (12.3 million)
const RS_C = 2 * GM_C3                    // Rs/c, seconds: light crosses one radius in 40.88 s
const TAU_MAX_INSIDE = Math.PI * GM_C3    // the longest any observer lasts below a Schwarzschild horizon, s
const R_PHOTON = 1.5                      // the photon sphere (a = 0; the polar photon orbit otherwise)
const S_PHOTON = 20                       // screen seconds from the start to the photon orbit
const S_HORIZON = 24                      // ... and to the (outer) horizon
const S_OTHER = 20                        // ... screen seconds from the disk to the end, in math mode
const E_MATH = 1.5                        // the mathematics mode's plunge energy (from rest it would be 0.913)
const R_END_MATH = -12                    // where the mathematics mode fades out, Rs on the other sheet
const T_INNER = 4                         // the "inner-horizon" phase begins this many seconds of proper time before r-
const T_SLOW = 2.5                        // realistic: the last seconds of proper time before r- ...
const S_SLOW = 6                          // ... are shown over this many screen seconds, slowing to a stop
const S_LIGHT = 5                         // realistic: the light closes in over the last screen seconds before r-
const T_FADE = 2.2                        // the other endings fade from this much proper time before the end
const S_TELL = 6                          // realistic: the inner horizon is told this long before its light begins to close in
const S_RING = 5.5                        // math: the ring is told this long before the disk
const S_SHOVE = 3                         // math: the plunge's frame comes on over the first screen seconds
const S_BACK = [11.5, 13.5, 16, 19.5]     // the glance back: the turn up begins, is up, the turn down begins, is down
const TILT_BACK = 145 * Math.PI / 180     // ... to this tilt from straight down
const TILT_NEAR = 25 * Math.PI / 180      // before the glance: the hole lowered in the frame
const EXP_ADAPT = 0.8                     // how much of the view's boost the exposure takes back (1: all)
const EXP_MIN = 0.004, EXP_MAX = 6       // the exposure's range
const CAPTIONS = {
  "sky-behind": { title: "Looking back", body: "The sky we came from, reddening and dimming as we pick up speed." },
  "event-horizon": { title: "Event horizon", body: "Crossed, as smoothly as open space. From here every path leads inward, even light's." },
  "inner-horizon": { title: "Inner horizon", body: "Light that fell in after us piles up here, blue and blinding. This is the edge of what physics can predict." },
  "inner-horizon-math": { title: "Inner horizon", body: "Here we leave tested physics and follow Kerr's equations onward, as pure mathematics." },
  "ring": { title: "Through the ring", body: "A spinning hole's singularity is a ring, not a point. We fly through its open middle." },
  "other-universe": { title: "The other universe", body: "Beyond the ring, distance counts below zero and the hole pushes us away. The equations give this side a space of its own; its stars are our invention." }
}

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
  // the ending: a spinning hole's realistic fall slows into r-
  tl.slow = a > 0 && !math
  tl.tSlow = tl.slow ? Math.min(T_SLOW, (tl.tauEnd - tl.tauHorizon) / 2) : 0
  tl.sSlowFor = tl.slow ? S_SLOW * tl.tSlow / T_SLOW : 0
  if (tl.slow) tl.tauReal = tl.tauEnd - tl.tSlow
  tl.sReal = S_HORIZON + (tl.tauReal - tl.tauHorizon)
  tl.sEnd = math ? tl.sReal + S_OTHER : tl.sReal + tl.sSlowFor
  // Hermite slopes: the secant on the first stretch, the harmonic mean of the
  // two secants at the join (Fritsch-Carlson: monotone), 1 where real time begins
  const mA = tl.tauPhoton / S_PHOTON, mB = (tl.tauHorizon - tl.tauPhoton) / (S_HORIZON - S_PHOTON)
  tl.m0 = mA
  tl.m1 = mA > 0 && mB > 0 ? 2 / (1 / mA + 1 / mB) : 0
  // the last stretch (math): slope 1 at the disk, the secant at the end
  tl.m2 = math ? (tl.tauEnd - tl.tauReal) / S_OTHER : 1
  // when the fade to black begins, and the landmarks' screen times
  tl.sFade = tl.slow ? tl.sEnd : sAtTau(tl, tl.tauEnd - T_FADE)
  tl.sInner = a > 0 ? Math.max(S_HORIZON, sAtTau(tl, tl.tauInner - T_INNER)) : Infinity
  tl.sRing = math ? Math.max(sAtTau(tl, tl.tauInner), tl.sReal - S_RING) : Infinity
  tl.sOther = math ? sAtTau(tl, tauAtR(tl, -a)) : Infinity
  tl.E0 = Kerr.axisEnergyFromRest(r0, a)   // from rest at r0: the frame the mathematics mode's view starts in
  tl.look = lookKeys(tl)
  tl.story = story(tl)
  return tl
}
// what the fall says, in order: [{ s: screen time, key: of CAPTIONS }]
function story(tl) {
  const ev = [{ s: S_BACK[0] - 0.5, key: "sky-behind" }, { s: S_HORIZON, key: "event-horizon" }]
  if (tl.math) ev.push({ s: tl.sInner, key: "inner-horizon-math" }, { s: tl.sRing, key: "ring" }, { s: tl.sOther, key: "other-universe" })
  else if (tl.a > 0) ev.push({ s: Math.max(S_HORIZON, Math.min(tl.sInner, tl.sEnd - S_LIGHT - S_TELL)), key: "inner-horizon" })
  return ev.filter(e => isFinite(e.s))
}
// the speed someone hovering at radius r on the axis measures as the
// observer of energy E falls past (units of c): E = gamma sqrt(1 - 2Mr/(r^2+a^2))
function localSpeed(tl, r, E) {
  const f = 1 - r / (r * r + tl.a * tl.a)      // M = 1/2 in Rs
  return f > 0 && E * E > f ? Math.sqrt(1 - f / (E * E)) : 0
}

// ---- the view ----
function smooth(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u) }
// the scripted view's keys: screen time, tilt from straight down (rad; rim:
// the shadow's rim instead, rimTilt), pan about the axis (rad). The inside's
// keys are placed by fraction between the horizon and where the ending takes
// over (realistic: the light closing in; math: the ring)
function lookKeys(tl) {
  const sIn = tl.math ? tl.sRing : tl.a > 0 ? tl.sEnd - S_LIGHT : tl.sFade
  const at = u => S_HORIZON + (sIn - S_HORIZON) * u
  const d = Math.PI / 180
  const keys = [
    { s: 0, tilt: 0, yaw: 0 }, { s: 4, tilt: 0, yaw: 0 }, { s: 8, tilt: TILT_NEAR, yaw: 0 },
    { s: S_BACK[0], tilt: TILT_NEAR, yaw: 0 }, { s: S_BACK[1], tilt: TILT_BACK, yaw: 0 }, { s: S_BACK[2], tilt: TILT_BACK, yaw: 0 },
    { s: S_BACK[3], rim: true, yaw: 0 }, { s: at(0.15), rim: true, yaw: 0 },
    { s: at(0.48), tilt: 80 * d, yaw: 50 * d }, { s: at(0.80), tilt: 60 * d, yaw: -35 * d },
    tl.math ? { s: at(1), tilt: 12 * d, yaw: 0 } : { s: at(1), tilt: 90 * d, yaw: 0 }
  ]
  return keys
}
// the light seen from the axis at radius r by the observer falling with
// energy E, in the direction psi from straight down (rad): its shift g (seen
// over emitted; 0 for light that would have to come out of the hole) and xs,
// the shaders' signed distance from the shadow's edge (positive: sky)
function ray(tl, r, E, psi) {
  const a = tl.a, sheet = r < 0 ? -1 : 1
  const x = [0, 0, r], m = Kerr.ksMetric(x, a, sheet), u = Kerr.axisInfaller(r, a, E, [0, 0, 1])
  // straight down is the direction of the fall, -z on both sheets
  const cr = Kerr.cameraRay(m, x, u, [Math.sin(psi), 0, -Math.cos(psi)])
  if (cr.E <= 0) return { g: 0, xs: -1 }
  let xs = 1
  if (sheet > 0 && r > tl.rMinus) {
    const ck = Kerr.carterKAxis(m, [cr.k[1], cr.k[2], cr.k[3]], cr.E)
    xs = r > tl.rPlus ? Kerr.radialClass(cr.E, cr.Lz, ck.K, a, r, ck.rdot < 0, tl.rPlus) : Kerr.radialClass(cr.E, cr.Lz, ck.K, a, tl.rPlus, true, tl.rPlus)
  }
  return { g: 1 / cr.E, xs: xs }
}
// the shadow's angular radius about straight down (rad), where the closed
// form draws its edge (above r- on our sheet; 0 elsewhere, and when even the
// ray straight down is sky)
function shadowEdge(tl, r, E) {
  if (r < 0 || r <= tl.rMinus) return 0
  if (ray(tl, r, E, 1e-4).xs > 0) return 0
  let lo = 0, hi = Math.PI
  for (let i = 0; i < 30; i++) { const mid = 0.5 * (lo + hi); if (ray(tl, r, E, mid).xs <= 0) lo = mid; else hi = mid }
  return 0.5 * (lo + hi)
}
// the tilt that holds the shadow's rim in the lower part of the screen
function rimTilt(tl, r, E) {
  const e = shadowEdge(tl, r, E)
  return Math.max(15, Math.min(40, e * 180 / Math.PI - 4)) * Math.PI / 180
}
// the energy of the frame the view is drawn in at screen time s
function viewE(tl, s) {
  if (!tl.math) return tl.E
  return tl.E0 + (tl.E - tl.E0) * smooth(s / S_SHOVE)
}
// the scripted view at screen time s, radius r, in the frame of energy E:
// tilt from straight down and pan about the axis (rad)
function look(tl, s, r, E) {
  const K = tl.look
  let i = 0
  while (i < K.length - 2 && s >= K[i + 1].s) i++
  const k0 = K[i], k1 = K[i + 1]
  const w = smooth((s - k0.s) / Math.max(k1.s - k0.s, 1e-6))
  const rim = k0.rim || k1.rim ? rimTilt(tl, r, E) : 0
  let tilt = (k0.rim ? rim : k0.tilt) * (1 - w) + (k1.rim ? rim : k1.tilt) * w
  // past the disk the ring is behind us: the view turns back to it
  if (r < -tl.a) tilt += (Math.PI - tilt) * smooth((-r - tl.a) / 2.5)
  return { tilt: tilt, yaw: k0.yaw * (1 - w) + k1.yaw * w }
}
// the exposure for the view tilted by `tilt` (rad from straight down) on a
// screen of the given aspect (53 degrees high): see the top
function boost(tl, r, E, tilt, aspect) {
  let sum = 0, n = 0
  for (let iy = -2; iy <= 2; iy++) for (let ix = 0; ix <= 2; ix++) {
    // the screen point (0.2 aspect ix, 0.2 iy), up positive (the picture is
    // the same left and right of the axis): its angle from straight down
    const px = 0.2 * (aspect || 2.37) * ix, py = 0.2 * iy
    const down = Math.cos(tilt) - py * Math.sin(tilt)            // along straight down (fwd.down = cos, up.down = -sin)
    const psi = Math.acos(Math.max(-1, Math.min(1, down / Math.sqrt(1 + px * px + py * py))))
    const q = ray(tl, r, E, psi)
    if (q.xs > 0) { sum += Math.pow(Math.min(q.g, 8), 3.5); n++ }
  }
  return n > 0 ? sum / n : 1
}
function exposure(tl, r, E, tilt, aspect) {
  if (tl.boost0 === undefined) tl.boost0 = boost(tl, tl.r0, tl.E0, 0, aspect)
  const b = boost(tl, r, E, tilt, aspect)
  return Math.max(EXP_MIN, Math.min(EXP_MAX, Math.pow(tl.boost0 / Math.max(b, 1e-9), EXP_ADAPT)))
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
  if (tl.slow && s >= tl.sReal) {
    // the ending: slowing into r-
    if (s >= tl.sEnd) return tl.tauEnd
    return tl.tauEnd - tl.tSlow * Math.pow(1 - (s - tl.sReal) / tl.sSlowFor, tl.sSlowFor / tl.tSlow)
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
  if (tl.slow && s >= tl.sReal) return s >= tl.sEnd ? 0 : Math.pow(1 - (s - tl.sReal) / tl.sSlowFor, tl.sSlowFor / tl.tSlow - 1)
  if (s < tl.sReal || !tl.math) return 1
  if (s >= tl.sEnd) return tl.m2
  const d = tl.tauEnd - tl.tauReal, T = S_OTHER
  return d / T * dhermite((s - tl.sReal) / T, 1 * T / d, tl.m2 * T / d)
}
// screen time at proper time tau (the inverse; bisection on the compressed parts)
function sAtTau(tl, t) {
  if (t <= 0) return 0
  if (t >= tl.tauHorizon && t <= tl.tauReal) return S_HORIZON + (t - tl.tauHorizon)
  if (t >= tl.tauEnd) return tl.sEnd
  // the ending's stretch in closed form (only past tauReal: above the horizon it is the bisection below)
  if (tl.slow && t > tl.tauReal) return tl.sReal + tl.sSlowFor * (1 - Math.pow((tl.tauEnd - t) / tl.tSlow, tl.tSlow / tl.sSlowFor))
  let lo = t < tl.tauHorizon ? 0 : tl.sReal, hi = t < tl.tauHorizon ? S_HORIZON : tl.sEnd
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi)
    if (tau(tl, mid) < t) lo = mid; else hi = mid
  }
  return 0.5 * (lo + hi)
}

// the phase of the fall at radius r and proper time t, for the HUD and
// status(): "falling" (outside r+), "outer-horizon" (between the horizons),
// "inner-horizon" (the last T_INNER seconds before r-, and the crossing: it
// has to begin before the fade does, or the realistic fall would never
// report it), "ring" (from r- down through the disk, math), "other-universe"
// (r < -a, math)
function phase(tl, r, t) {
  if (r > tl.rPlus) return "falling"
  if (r <= -tl.a && tl.math) return "other-universe"
  if (r <= tl.rMinus && tl.math && t > tl.tauInner + 1e-9) return "ring"
  if (tl.a > 0 && tl.tauInner - t < T_INNER) return "inner-horizon"
  return "outer-horizon"
}

// the light closing in at the inner horizon, 0..1 over the last S_LIGHT
// screen seconds before r- (realistic, spinning; 0 otherwise). Linear: the
// shader shapes it
function light(tl, s) {
  if (!tl.slow) return 0
  return Math.max(0, Math.min(1, 1 - (tl.sEnd - s) / S_LIGHT))
}
// the state of a fall that starts at radius rStart: let go from the parked
// camera (from rest there, or the plunge in math mode), or picked up at the
// crossing when free flight carried the camera below the horizon (the
// canonical drop from 6 Rs, joined at that radius)
function begin(rStart, a, math) {
  const r0 = rStart >= 2 ? rStart : 6
  const tl = timeline(r0, a, math)
  const s = sAtTau(tl, tauAtR(tl, Math.min(rStart, r0)))
  // told: how many of the story's events lie before the start. The crossing
  // is always told: a fall joined below the horizon begins on its caption
  return { tl: tl, s: s, told: tl.story.filter(e => e.s < Math.min(s, S_HORIZON) - 1e-9).length }
}
// what comes next on the way down and how long until it, on the falling
// clock (s of proper time): the outer horizon, the inner horizon, then (math)
// the disk inside the ring and the end of the far sheet
function next(tl, t) {
  if (t < tl.tauHorizon) return { what: "outer-horizon", left: tl.tauHorizon - t }
  if (tl.a > 0 && t < tl.tauInner) return { what: "inner-horizon", left: tl.tauInner - t }
  if (tl.math && t < tl.tauReal) return { what: "disk", left: tl.tauReal - t }
  return { what: "end", left: Math.max(0, tl.tauEnd - t) }
}
// one frame: advances the screen clock, returns the radius (signed), the
// proper time left to the end, the current rate and the phase; fade: the
// screen should be fading to black by now; light: the inner horizon's light
// closing in, 0..1; say: the story event reached on this frame (a key of
// CAPTIONS, "" on every other frame); E: the energy of the
// frame the view is drawn in; tilt, yaw: the scripted view; next: the next
// landmark and the proper time to it
function step(F, dt) {
  F.s += dt
  const t = tau(F.tl, F.s)
  const r = rAt(F.tl, t)
  const E = viewE(F.tl, F.s), lk = look(F.tl, F.s, r, E)
  let say = ""
  while (F.told < F.tl.story.length && F.tl.story[F.told].s <= F.s) say = F.tl.story[F.told++].key
  return { r: r, left: Math.max(0, F.tl.tauEnd - t), rate: rate(F.tl, F.s), tau: t, phase: phase(F.tl, r, t),
           fade: F.s >= F.tl.sFade, light: light(F.tl, F.s), say: say,
           E: E, tilt: lk.tilt, yaw: lk.yaw, next: next(F.tl, t) }
}
