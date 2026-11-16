.pragma library
// dial.js — the numbers behind the HUD's radial instrument: where a value
// sits on a scale, how a pointer moves there, when an event is one, and how
// a figure is written in a few characters. Plain JS on numbers, checked by
// tests/test_dial.js; Background.qml feeds the results to universe.frag's
// hud() and to the words in the disc.
//
// A position on a scale is g in 0..1 along the gauges' 270-degree sweep
// (7:30 clockwise to 4:30). A value outside a scale is pinned to the end it
// left by and reported `hollow`: drawn as an outline, never as a reading.

const SWEEP_DEG = 270
const BUG_NEAR_DEG = 6        // two bugs closer than this: the second is drawn small
const BUG_APART_DEG = 2       //   and never nearer the first than this, so both show
const SPRING_W = 12           // the needle's spring, 1/s: within 2% of a step in 0.5 s
const EASE_S = 0.3            // bugs, the gap's diamond, the field arc

function clamp01(x) { return Math.max(0, Math.min(1, x)) }

// ---- scales -------------------------------------------------------------------
// log scale from lo to hi (both > 0): { g, hollow }
function logG(v, lo, hi) {
  if (!(v > 0)) return { g: 0, hollow: true }
  const g = Math.log(v / lo) / Math.log(hi / lo)
  return { g: clamp01(g), hollow: g < 0 || g > 1 }
}
function linG(v, lo, hi) {
  const g = (v - lo) / (hi - lo)
  return { g: clamp01(g), hollow: g < 0 || g > 1 }
}
// a signed quantity on -1..1: 0 within +-lo, then log out to +-hi
// (the gap window's diamond: height over the disk plane)
function signedLogG(v, lo, hi) {
  const a = Math.abs(v)
  if (!(a > lo)) return { g: 0, hollow: false }
  const g = Math.log(a / lo) / Math.log(hi / lo)
  return { g: (v < 0 ? -1 : 1) * Math.min(1, g), hollow: g > 1 }
}
// where the dots of that scale stand, as a pitch on 0..1: one per decade
function signedLogPitch(lo, hi) { return Math.log(10) / Math.log(hi / lo) }

// The fall's radius on one signed-log scale that serves both modes:
//   f(r) = sign(r) log10(1 + |r| / 0.1)
// from r0 (g = 0, the pin) to rEnd (g = 1): the inner horizon in the
// realistic fall, -12 Rs on the far sheet in mathematics mode. Monotonic and
// continuous through r = 0, so the needle never has to leave the sweep.
function fallF(r) { return (r < 0 ? -1 : 1) * Math.log10(1 + Math.abs(r) / 0.1) }
function fallG(r, r0, rEnd) {
  const a = fallF(r0), b = fallF(rEnd)
  return a === b ? 0 : clamp01((a - fallF(r)) / (a - b))
}
// the i-th of n detents (the system view's seven time rates)
function detentG(i, n) { return n > 1 ? clamp01(i / (n - 1)) : 0 }
// a temperature on the sweep: 30..100 C
function tempG(c) { return clamp01((c - 30) / 70) }

// ---- range bugs -----------------------------------------------------------------
// list: [{ g, hollow, color }] in drawing order (null entries stay null). A
// bug within BUG_NEAR_DEG of an earlier one is drawn `small` (0.6 size) and
// kept at least BUG_APART_DEG from it, on the side it was on: both show.
function bugs(list) {
  const near = BUG_NEAR_DEG / SWEEP_DEG, apart = BUG_APART_DEG / SWEEP_DEG
  const out = []
  for (const b of list) {
    if (!b || !(b.g >= 0)) { out.push(null); continue }
    const o = { g: clamp01(b.g), hollow: !!b.hollow, color: b.color, small: false }
    for (const p of out) {
      if (!p || Math.abs(o.g - p.g) >= near) continue
      o.small = true
      if (Math.abs(o.g - p.g) < apart) {
        const side = o.g < p.g || p.g + apart > 1 ? -1 : 1
        o.g = clamp01(p.g + side * apart)
      }
    }
    out.push(o)
  }
  return out
}
// a bug as the shader takes it: g, +2 hollow, +4 small; -1 hidden
function bugCode(b) { return b ? b.g + (b.hollow ? 2 : 0) + (b.small ? 4 : 0) : -1 }

// ---- motion ---------------------------------------------------------------------
// one step of a critically damped spring (exact, so any dt is stable and it
// never overshoots from rest): returns [x, v]
function spring(x, v, target, dt, w) {
  const k = w || SPRING_W
  const d = x - target, c = v + k * d, e = Math.exp(-k * dt)
  return [target + (d + c * dt) * e, (v - k * c * dt) * e]
}
// exponential ease toward a target, EASE_S to get 95% of the way
function ease(x, target, dt, s) { return target + (x - target) * Math.exp(-3 * dt / (s || EASE_S)) }

// ---- events ---------------------------------------------------------------------
// A threshold with hysteresis: on once the value has been at or over `on` for
// `dwell` seconds, off once it is under `off` (and never before `minHold`
// seconds have passed). st: { on, over, held } (start with {}). Returns true
// on the step the event fires, so a value flickering around the threshold
// fires once.
function event(st, value, on, off, dt, minHold, dwell) {
  st.held = (st.held || 0) + dt
  if (st.on) {
    if (value < off && st.held >= (minHold || 0)) { st.on = false; st.over = 0 }
    return false
  }
  st.over = value >= on ? (st.over || 0) + dt : 0
  if (value >= on && st.over >= (dwell || 0)) { st.on = true; st.held = 0; return true }
  return false
}
// a change of state (the nearest place, a side of the disk plane, a horizon
// crossed): true when `value` differs from the last one seen; the first
// value is not a change
function changed(st, value) {
  const was = st.last
  st.last = value
  return was !== undefined && was !== value
}

// ---- figures --------------------------------------------------------------------
function trim(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s }
function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") }
// three significant figures with K, M, G, T: 166G, 5.2M, 950
function compact(n) {
  const a = Math.abs(n)
  if (!(a >= 0)) return "-"
  const units = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "K"]]
  for (const [u, s] of units) {
    if (a >= u * 0.9995) {
      const x = n / u, ax = Math.abs(x)
      return (ax >= 99.95 ? x.toFixed(0) : ax >= 9.995 ? trim(x.toFixed(1)) : trim(x.toFixed(2))) + s
    }
  }
  return a >= 99.95 ? n.toFixed(0) : a >= 9.995 ? trim(n.toFixed(1)) : trim(n.toFixed(2))
}
// light years in at most 8 characters: 2.48 MLY, 26.6K LY, 1,344 LY, 4.2 LY, 0.25 LY, 950 AU
function ly(v) {
  if (v >= 999500) return compact(v / 1e6) + " MLY"
  if (v >= 9999.5) return compact(v) + " LY"
  if (v >= 99.95) return group(v) + " LY"
  if (v >= 0.0995) return (v >= 9.995 ? v.toFixed(1) : v.toFixed(2)) + " LY"
  return compact(v * 63241.1) + " AU"       // under a tenth of a light year: astronomical units
}
function au(v) {
  if (v < 0.01) return group(v * 149597870.7) + " KM"
  return (v >= 99.95 ? v.toFixed(0) : v >= 9.995 ? v.toFixed(1) : v.toFixed(v < 1 ? 3 : 2)) + " AU"
}
// seconds as the hub shows them: 4:12, or 12.4 S under a minute
function clock(s) {
  if (!(s >= 0)) return "-"
  if (s < 60) return s.toFixed(1) + " S"
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return m + ":" + (r < 10 ? "0" : "") + r
}
// right ascension and declination: RA 5H35 +22
function raDec(raHours, decDeg) {
  let h = Math.floor(raHours), m = Math.round((raHours - h) * 60)
  if (m === 60) { m = 0; h = (h + 1) % 24 }
  const d = Math.round(decDeg)
  return "RA " + h + "H" + (m < 10 ? "0" : "") + m + " " + (d >= 0 ? "+" : "-") + Math.abs(d)
}
function fit(s, maxChars) {
  const m = maxChars || 11
  return s.length <= m ? s : s.replace(/\s+/g, "").slice(0, m)
}

// The hub's readout line: one number with its unit, never a list, never over
// maxChars. v holds what the view knows; a missing figure is left out.
//   galaxy  moving: the speed as a multiple of light (xc); a target and not
//           moving: its distance (targetLy); else the distance from the Sun
//   system  chasing: the target's distance (targetAu); time-lapsing: the
//           simulated date (date); else the pinned body's distance from the Sun
//   sky     where the view points (ra hours, dec degrees)
//   fall    the radius in Schwarzschild radii (r)
//   flight  the throttle, percent of full (thrust, signed)
function readout(view, v, maxChars) {
  let s = ""
  if (view === "galaxy") {
    if (v.xc > 0) s = compact(v.xc) + " × C"
    else if (v.targetLy >= 0) s = "> " + ly(v.targetLy)
    else if (v.sunLy >= 0) s = ly(v.sunLy)
  } else if (view === "system") {
    if (v.targetAu >= 0) s = "> " + au(v.targetAu)
    else if (v.date) s = String(v.date)
    else if (v.sunAu > 0) s = au(v.sunAu)
  } else if (view === "sky") {
    if (v.ra >= 0) s = raDec(v.ra, v.dec || 0)
  } else if (view === "fall") {
    if (v.r !== undefined) s = v.r.toFixed(Math.abs(v.r) < 10 ? 2 : 1) + " RS"
  } else if (view === "flight") {
    if (v.thrust !== undefined) s = Math.round(v.thrust) + "%"
  }
  return fit(s, maxChars)
}
