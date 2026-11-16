.pragma library
// sun.js — daylight at home and the Moon's lit side, for the HUD's day ring
// and gap window. Plain JS on numbers, checked by tests/test_sun.js.
//
// Sunrise and sunset follow NOAA's solar calculator (Meeus, Astronomical
// Algorithms): the Sun's centre 0.833 degrees under the horizon (its radius
// plus the usual refraction), good to about a minute at mid latitudes.

const RAD = Math.PI / 180
const ZENITH = 90.833

// the equation of time (minutes) and the Sun's declination (radians) at a
// Julian day
function solar(jd) {
  const T = (jd - 2451545.0) / 36525
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
          + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD))
  const y = Math.tan(eps * RAD / 2) * Math.tan(eps * RAD / 2)
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
                         - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD))
  return { eot: eot, decl: decl }
}

// Sunrise and sunset on the local calendar day of `date`, as fractions of
// that day on the local clock (0 midnight, 0.5 noon): { rise, set, noon,
// polar }. polar is "" on an ordinary day, "all" when the Sun never sets
// (rise 0, set 1) and "none" when it never rises (rise and set -1).
// lat north and lon east in degrees; tzMinutes: the local clock's offset
// from UTC (east positive), the date's own when left out.
function sunTimes(date, lat, lon, tzMinutes) {
  const tz = tzMinutes === undefined ? -date.getTimezoneOffset() : tzMinutes
  // local midnight of that day as a Julian day, then two passes (the Sun
  // moves during the day)
  const local = new Date(date.getTime() + tz * 60000)
  const jd0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 86400000 + 2440587.5 - tz / 1440
  const at = frac => {
    const s = solar(jd0 + frac)
    const noon = (720 - 4 * lon - s.eot + tz) / 1440
    const c = (Math.cos(ZENITH * RAD) - Math.sin(lat * RAD) * Math.sin(s.decl)) / (Math.cos(lat * RAD) * Math.cos(s.decl))
    return { noon: noon, c: c, ha: Math.abs(c) <= 1 ? Math.acos(c) / RAD * 4 / 1440 : 0 }
  }
  const n = at(0.5)
  if (n.c < -1) return { rise: 0, set: 1, noon: n.noon, polar: "all" }
  if (n.c > 1) return { rise: -1, set: -1, noon: n.noon, polar: "none" }
  const r = at(n.noon - n.ha), s = at(n.noon + n.ha)
  const rise = Math.abs(r.c) <= 1 ? r.noon - r.ha : n.noon - n.ha
  const set = Math.abs(s.c) <= 1 ? s.noon + s.ha : n.noon + n.ha
  return { rise: rise, set: set, noon: n.noon, polar: "" }
}

// The Moon's lit fraction from the cosine of the angle at Earth between the
// Sun and the Moon (1: the Moon stands before the Sun, new; -1: opposite,
// full), and which side is lit: { lit: 0..1, waxing }
function moonLit(sunEarthMoonCos, waxing) {
  return { lit: Math.max(0, Math.min(1, (1 - sunEarthMoonCos) / 2)), waxing: !!waxing }
}
// the fraction of a calendar year gone at `date` (the system view's year ring)
function yearFraction(date) {
  const y = date.getFullYear()
  const a = new Date(y, 0, 1).getTime(), b = new Date(y + 1, 0, 1).getTime()
  return (date.getTime() - a) / (b - a)
}
// the fraction of the local day gone
function dayFraction(date) {
  return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000) / 86400
}
