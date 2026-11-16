// checks for sun.js, daylight at home and the Moon's lit side (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Sn = new Function(src + "\nreturn { solar, sunTimes, moonLit, yearFraction, dayFraction };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const min = f => f * 1440
const hm = f => { const m = Math.round(min(f)); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") }
const at = (h, m) => (h * 60 + m) / 1440
const AMS = [52.37, 4.90]

// 1. Amsterdam on the solstices and equinoxes of 2026, against the published
// almanac times (local clock: CET +60, CEST +120), within 2 minutes
for (const [day, tz, rise, set] of [["2026-03-20", 60, at(6, 44), at(18, 53)], ["2026-06-21", 120, at(5, 18), at(22, 6)],
                                    ["2026-09-23", 120, at(7, 27), at(19, 37)], ["2026-12-21", 60, at(8, 48), at(16, 29)]]) {
  const t = Sn.sunTimes(new Date(day + "T12:00:00Z"), AMS[0], AMS[1], tz)
  check("Amsterdam " + day + ": sunrise and sunset within 2 minutes", Math.abs(min(t.rise - rise)) <= 2 && Math.abs(min(t.set - set)) <= 2 && t.polar === "", hm(t.rise) + " " + hm(t.set))
}
const jun = Sn.sunTimes(new Date("2026-06-21T12:00:00Z"), AMS[0], AMS[1], 120), dec = Sn.sunTimes(new Date("2026-12-21T12:00:00Z"), AMS[0], AMS[1], 60)
check("June: the day is 16 h 48 long", Math.abs(min(jun.set - jun.rise) - (16 * 60 + 48)) <= 2, hm(jun.set - jun.rise))
check("December: 7 h 40", Math.abs(min(dec.set - dec.rise) - (7 * 60 + 40)) <= 2, hm(dec.set - dec.rise))
check("noon lies between them, near 12:40 (CET) and 13:42 (CEST)", Math.abs(min(dec.noon - at(12, 38))) < 4 && Math.abs(min(jun.noon - at(13, 42))) < 4, hm(dec.noon) + " " + hm(jun.noon))

// 2. the calendar day is the local one, whatever the hour asked at
{
  const a = Sn.sunTimes(new Date("2026-06-21T00:30:00+02:00"), AMS[0], AMS[1], 120), b = Sn.sunTimes(new Date("2026-06-21T23:30:00+02:00"), AMS[0], AMS[1], 120)
  check("just after midnight and just before the next give the same day", a.rise === b.rise && a.set === b.set)
  const c = Sn.sunTimes(new Date("2026-06-22T00:30:00+02:00"), AMS[0], AMS[1], 120)
  check("and the next day differs by seconds, not hours", c.rise !== a.rise && Math.abs(min(c.rise - a.rise)) < 1)
  const own = Sn.sunTimes(new Date("2026-06-21T12:00:00Z"), AMS[0], AMS[1])
  check("without an offset the date's own time zone is used", own.rise > -1 && own.rise < 1 && Math.abs((own.set - own.rise) - (jun.set - jun.rise)) < 2 / 1440)
}
// the year round: sunrise before noon before sunset, all inside the day
{
  let ok = true, shortest = 2, longest = 0
  for (let d = 0; d < 365; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d, 12))
    const t = Sn.sunTimes(date, AMS[0], AMS[1], 60)
    if (!(t.rise > 0 && t.rise < t.noon && t.noon < t.set && t.set < 1) || t.polar !== "") ok = false
    shortest = Math.min(shortest, t.set - t.rise); longest = Math.max(longest, t.set - t.rise)
  }
  check("Amsterdam, every day of 2026: rise < noon < set, between 7 h 39 and 16 h 49", ok && min(shortest) >= 7 * 60 + 38 && min(longest) <= 16 * 60 + 50, hm(shortest) + " .. " + hm(longest))
}

// 3. polar day and night
const TR = [69.65, 18.96]
const trJ = Sn.sunTimes(new Date("2026-06-21T12:00:00Z"), TR[0], TR[1], 120), trD = Sn.sunTimes(new Date("2026-12-21T12:00:00Z"), TR[0], TR[1], 60)
check("Tromso in June: all (the whole ring is daylight)", trJ.polar === "all" && trJ.rise === 0 && trJ.set === 1)
check("Tromso in December: none (no arc)", trD.polar === "none" && trD.rise < 0 && trD.set < 0)
check("Tromso at the equinox: an ordinary day of about 12 h", (() => { const t = Sn.sunTimes(new Date("2026-03-20T12:00:00Z"), TR[0], TR[1], 60); return t.polar === "" && Math.abs(min(t.set - t.rise) - 735) < 20 })())
check("the equator: about 12 h 07 all year", [0, 90, 180, 270].every(d => { const t = Sn.sunTimes(new Date(Date.UTC(2026, 0, 1 + d, 12)), 0, 0, 0); return Math.abs(min(t.set - t.rise) - 727) < 3 }))
check("the declination swings +-23.44 degrees", Math.abs(Sn.solar(2461213.0).decl * 180 / Math.PI - 23.43) < 0.05 && Math.abs(Sn.solar(2461396.0).decl * 180 / Math.PI + 23.43) < 0.05, (Sn.solar(2461213.0).decl * 180 / Math.PI).toFixed(3) + " " + (Sn.solar(2461396.0).decl * 180 / Math.PI).toFixed(3))

// 4. the Moon
check("new moon: nothing lit", Sn.moonLit(1, true).lit === 0)
check("quarter: half", Math.abs(Sn.moonLit(0, true).lit - 0.5) < 1e-12)
check("full: all of it", Sn.moonLit(-1, false).lit === 1)
check("the lit fraction never leaves 0..1, and the side is kept", Sn.moonLit(1.0000001, true).lit === 0 && Sn.moonLit(-1.0000001, false).lit === 1 && Sn.moonLit(0.3, true).waxing && !Sn.moonLit(0.3, false).waxing)

// 5. the rings' fractions
check("dayFraction: noon is a half, 18:00 three quarters", Sn.dayFraction(new Date(2026, 10, 16, 12, 0, 0)) === 0.5 && Sn.dayFraction(new Date(2026, 10, 16, 18, 0, 0)) === 0.75)
check("yearFraction: 0 on 1 January, a half on 2 July (noon), under 1 on 31 December", Sn.yearFraction(new Date(2026, 0, 1)) === 0 && Math.abs(Sn.yearFraction(new Date(2026, 6, 2, 12)) - 0.5) < 0.001 && Sn.yearFraction(new Date(2026, 11, 31, 23, 59)) < 1)

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
