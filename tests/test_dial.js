// checks for dial.js, the HUD instrument's scales, motion, events and figures (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const D = new Function(src + "\nreturn { SWEEP_DEG, BUG_NEAR_DEG, BUG_APART_DEG, SPRING_W, EASE_S, logG, linG, signedLogG, signedLogPitch, fallF, fallG, detentG, tempG, bugs, bugCode, spring, ease, event, changed, compact, ly, au, clock, raDec, fit, readout };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol)

// 1. scales: ends at 0 and 1, monotonic, out of range pins hollow
check("log: the ends map to 0 and 1", near(D.logG(1e5, 1e5, 1e13).g, 0) && near(D.logG(1e13, 1e5, 1e13).g, 1))
check("log: a decade is an eighth of the galaxy's speed scale", near(D.logG(1e6, 1e5, 1e13).g, 1 / 8) && near(D.logG(1e9, 1e5, 1e13).g, 0.5))
{
  let mono = true, last = -1
  for (let e = 5; e <= 13; e += 0.01) { const g = D.logG(Math.pow(10, e), 1e5, 1e13).g; if (g < last) mono = false; last = g }
  check("log: monotonic", mono)
}
check("log: below the scale pins at 0, hollow", D.logG(10, 1e5, 1e13).g === 0 && D.logG(10, 1e5, 1e13).hollow)
check("log: above the scale pins at 1, hollow", D.logG(1e15, 1e5, 1e13).g === 1 && D.logG(1e15, 1e5, 1e13).hollow)
check("log: inside is not hollow; zero and NaN are", !D.logG(1e8, 1e5, 1e13).hollow && D.logG(0, 1, 10).hollow && D.logG(NaN, 1, 10).hollow)
check("5,275 ly/s is 1.66e11 x c: between the 10^9 and 10^12 ticks", (() => { const g = D.logG(5275 * 31557600, 1e5, 1e13).g; return g > 0.5 && g < 0.875 && near(g, 0.7777, 0.001) })(), D.logG(5275 * 31557600, 1e5, 1e13).g.toFixed(4))
check("linear: ends, middle, pinned", D.linG(0, 0, 1).g === 0 && D.linG(1, 0, 1).g === 1 && D.linG(0.5, 0, 1).g === 0.5 && D.linG(2, 0, 1).hollow && D.linG(2, 0, 1).g === 1)
check("AU scale: 0.001..100 is five decades", near(D.logG(0.01, 0.001, 100).g, 0.2) && near(D.logG(1, 0.001, 100).g, 0.6))
// the diamond: height over the plane, dots a decade apart, hollow past 1 kpc
const KPC = 3261.56
check("signed log: 0 on the plane, +-1 at a kiloparsec", D.signedLogG(0, 1, KPC).g === 0 && near(D.signedLogG(KPC, 1, KPC).g, 1) && near(D.signedLogG(-KPC, 1, KPC).g, -1))
check("signed log: odd and monotonic", (() => { let ok = true, last = -2; for (let v = -4000; v <= 4000; v += 7) { const g = D.signedLogG(v, 1, KPC).g; if (g < last - 1e-12 || !near(g, -D.signedLogG(-v, 1, KPC).g)) ok = false; last = g } return ok })())
check("signed log: beyond the end it pins hollow (outside the disk)", D.signedLogG(5000, 1, KPC).hollow && D.signedLogG(5000, 1, KPC).g === 1 && D.signedLogG(-5000, 1, KPC).g === -1 && !D.signedLogG(900, 1, KPC).hollow)
check("signed log: the dots are a decade apart: 10, 100, 1000 ly", (() => { const p = D.signedLogPitch(1, KPC); return near(D.signedLogG(10, 1, KPC).g, p) && near(D.signedLogG(100, 1, KPC).g, 2 * p) && near(D.signedLogG(-1000, 1, KPC).g, -3 * p) && 3 * p < 1 && 4 * p > 1 })())
check("detents: seven rates across the sweep", D.detentG(0, 7) === 0 && D.detentG(6, 7) === 1 && near(D.detentG(3, 7), 0.5))
check("temperature: 30..100 C, 90 C at 6/7", D.tempG(30) === 0 && D.tempG(100) === 1 && near(D.tempG(90), 6 / 7) && D.tempG(10) === 0 && D.tempG(120) === 1)

// 2. the fall's scale: one formula, both modes
const RP = 0.6706, RM = 0.3294   // a/M = 0.94
{
  let mono = true, last = -1, jump = 0
  for (let r = 6; r >= -12; r -= 0.001) { const g = D.fallG(r, 6, -12); if (g < last) mono = false; if (last >= 0) jump = Math.max(jump, g - last); last = g }
  check("fall (mathematics): monotonic from 6 through r+, r-, 0 to -12", mono && near(D.fallG(6, 6, -12), 0) && near(D.fallG(-12, 6, -12), 1))
  check("fall: continuous at r = 0 (no step over 0.001 Rs larger than 0.002)", jump < 0.002, jump.toExponential(2))
  check("fall: the marks are in order: photon orbit, r+, r-, 0", D.fallG(1.5, 6, -12) < D.fallG(RP, 6, -12) && D.fallG(RP, 6, -12) < D.fallG(RM, 6, -12) && D.fallG(RM, 6, -12) < D.fallG(0, 6, -12) && D.fallG(0, 6, -12) < 1)
}
check("fall (realistic): the inner horizon is the end of the sweep", near(D.fallG(RM, 6, RM), 1) && D.fallG(RP, 6, RM) < 1 && D.fallG(RP, 6, RM) > 0.5, D.fallG(RP, 6, RM).toFixed(3))
check("fall: a = 0 works (r- = 0)", near(D.fallG(0, 6, 0), 1) && near(D.fallG(6, 6, 0), 0) && D.fallG(1, 6, 0) > 0 && D.fallG(1, 6, 0) < 1 && !isNaN(D.fallG(0.5, 6, 0)))
check("fall: never leaves the sweep", D.fallG(7, 6, -12) === 0 && D.fallG(-20, 6, -12) === 1 && D.fallG(3, 3, 3) === 0)

// 3. bugs: pinned, hollow, and two close ones both stay visible
{
  const b = D.bugs([{ g: 0.40, color: "a" }, { g: 0.41, color: "b" }, null, { g: 0.9, hollow: true, color: "c" }])
  check("two bugs within 6 degrees: both drawn, the second small", b[0] && b[1] && !b[0].small && b[1].small && b[1].g === 0.41)
  check("a hidden slot stays hidden, a far bug is full size and keeps its hollow", b[2] === null && !b[3].small && b[3].hollow)
  const same = D.bugs([{ g: 0.5 }, { g: 0.5 }, { g: 0.5001 }])
  check("on the same spot: kept 2 degrees apart, never hidden", same.every(x => x) && Math.abs(same[1].g - same[0].g) >= 2 / 270 - 1e-12 && same[1].small && same[2].small, same.map(x => x.g.toFixed(4)).join(" "))
  const end = D.bugs([{ g: 1, hollow: true }, { g: 1, hollow: true }])
  check("both pinned at the end: the second steps back inside the scale", end[1].g < 1 && end[1].g >= 0 && end[1].small)
  check("6 degrees apart or more: both full size", D.bugs([{ g: 0.3 }, { g: 0.3 + 6.01 / 270 }]).every(x => !x.small))
  check("the shader's code: g, +2 hollow, +4 small, -1 hidden", D.bugCode(null) === -1 && D.bugCode({ g: 0.25 }) === 0.25 && D.bugCode({ g: 0.25, hollow: true }) === 2.25 && D.bugCode({ g: 0.25, small: true }) === 4.25 && D.bugCode({ g: 1, hollow: true, small: true }) === 7)
}

// 4. the needle's spring: settles within 0.6 s, no overshoot, at any frame rate
for (const hz of [30, 60, 165]) {
  let x = 0, v = 0, t = 0, over = 0, settled = -1
  while (t < 2) {
    [x, v] = D.spring(x, v, 1, 1 / hz); t += 1 / hz
    over = Math.max(over, x - 1)
    if (settled < 0 && Math.abs(x - 1) < 0.02) settled = t
    if (Math.abs(x - 1) >= 0.02) settled = -1
  }
  check("spring at " + hz + " Hz: within 2% by 0.6 s, no overshoot", settled > 0 && settled <= 0.6 && over <= 1e-12, settled.toFixed(3) + " s")
}
check("spring: a 5 s stall lands on the target", (() => { const [x, v] = D.spring(0.2, 3, 0.8, 5); return near(x, 0.8, 1e-9) && near(v, 0, 1e-9) })())
check("spring: the same place at 60 and 165 Hz after 0.25 s", (() => { const run = hz => { let x = 0, v = 0; for (let i = 0; i < Math.round(0.25 * hz * 4) / 4; i++) [x, v] = D.spring(x, v, 1, 1 / hz); return x }; let a = 0, va = 0, b = 0, vb = 0; for (let i = 0; i < 15; i++) [a, va] = D.spring(a, va, 1, 1 / 60); for (let i = 0; i < 165; i++) [b, vb] = D.spring(b, vb, 1, 0.25 / 165); return near(a, b, 1e-9) })())
check("ease: 95% of the way in 0.3 s, never past the target", (() => { let x = 0; for (let i = 0; i < 30; i++) x = D.ease(x, 1, 0.01); return x > 0.94 && x < 0.96 && D.ease(0, 1, 100) <= 1 })())

// 5. events: hysteresis, a minimum hold, a dwell
{
  // a value flickering around the threshold fires once
  const st = {}; let fired = 0, t = 0
  for (let i = 0; i < 600; i++) { const val = 85 + (i % 2 ? 1 : -1) * 2; if (D.event(st, val, 85, 80, 0.1, 4, 0)) fired++; t += 0.1 }
  check("flickering around the threshold (83..87, off at 80): fires once", fired === 1)
  // it lasts at least 4 s even if the value drops at once
  const s2 = {}; let on = 0
  D.event(s2, 90, 85, 80, 0.1, 4, 0)
  for (let i = 0; i < 100; i++) { D.event(s2, 10, 85, 80, 0.1, 4, 0); if (s2.on) on += 0.1 }
  check("an event lasts at least 4 s", s2.on === false && on >= 3.9 && on <= 4.1, on.toFixed(1) + " s")
  // and fires again only after it went off
  check("after it went off it can fire again", D.event(s2, 90, 85, 80, 0.1, 4, 0) === true)
  // dwell: CPU over 85% for 5 s
  const s3 = {}; let at = -1
  for (let i = 0; i < 100 && at < 0; i++) if (D.event(s3, 0.9, 0.85, 0.80, 2, 4, 5)) at = (i + 1) * 2
  check("a dwell: over the threshold for 5 s before it fires (2 s samples: at 6 s)", at === 6, at)
  const s4 = {}; let f4 = 0
  for (let i = 0; i < 50; i++) if (D.event(s4, i % 2 ? 0.9 : 0.5, 0.85, 0.80, 2, 4, 5)) f4++
  check("a spike shorter than the dwell never fires", f4 === 0)
  const c = {}
  check("changed: the first value is not a change, a new one is, the same one is not", !D.changed(c, "Orion") && !D.changed(c, "Orion") && D.changed(c, "Pleiades") && !D.changed(c, "Pleiades"))
}

// 6. figures
check("compact: 166B, 5.2M, 12.5K, 950, 1T", D.compact(5275 * 31557600) === "166B" && D.compact(5.2e6) === "5.2M" && D.compact(12500) === "12.5K" && D.compact(950) === "950" && D.compact(1e12) === "1T", [D.compact(5275 * 31557600), D.compact(5.2e6), D.compact(12500), D.compact(950), D.compact(1e12)].join(" "))
check("compact: rounding never gives four digits (999.6K is 1M)", D.compact(999600) === "1M" && D.compact(99960) === "100K" && D.compact(9996) === "10K", [D.compact(999600), D.compact(99960), D.compact(9996)].join(" "))
check("ly: 2.48 MLY, 26.6K LY, 1,344 LY, 4.25 LY", D.ly(2.48e6) === "2.48 MLY" && D.ly(26600) === "26.6K LY" && D.ly(1344) === "1,344 LY" && D.ly(4.246) === "4.25 LY", [D.ly(2.48e6), D.ly(26600), D.ly(1344), D.ly(4.246)].join(" | "))
check("ly: under a tenth of a light year it is AU (Sgr A* from 6 radii: 0.49 AU)", D.ly(0.05) === "3.16K AU" && D.ly(7.8e-6) === "0.49 AU" && D.ly(0.0995) === "0.10 LY", [D.ly(0.05), D.ly(7.8e-6), D.ly(0.0995)].join(" | "))
check("au: 0.983 AU, 5.20 AU, 30.1 AU, the Moon in km", D.au(0.983) === "0.983 AU" && D.au(5.2) === "5.20 AU" && D.au(30.07) === "30.1 AU" && D.au(0.00257) === "384,467 KM", [D.au(0.983), D.au(5.2), D.au(30.07), D.au(0.00257)].join(" | "))
check("clock: 4:12, 12.4 S, 15:44", D.clock(252.7) === "4:12" && D.clock(12.44) === "12.4 S" && D.clock(944) === "15:44")
check("raDec: RA 5H35 +22, and minutes never read 60", D.raDec(5.5833, 22.01) === "RA 5H35 +22" && D.raDec(5.9999, -5.4) === "RA 6H00 -5" && D.raDec(23.9999, 0) === "RA 0H00 +0", D.raDec(5.5833, 22.01))
check("readout: the galaxy's 5,275 ly/s is 166B × C", D.readout("galaxy", { xc: 5275 * 31557600, targetLy: 2.48e6, sunLy: 100 }, 11) === "166B × C")
check("readout: a target and not moving: its distance", D.readout("galaxy", { xc: 0, targetLy: 2.48e6, sunLy: 100 }, 11) === "→ 2.48 MLY")
check("readout: neither: the distance from the Sun", D.readout("galaxy", { xc: 0, targetLy: -1, sunLy: 26600 }, 11) === "26.6K LY")
check("readout: system: target, else the simulated date, else the distance from the Sun", D.readout("system", { targetAu: 0.52 }, 11) === "→ 0.520 AU" && D.readout("system", { targetAu: -1, date: "16 NOV 2026" }, 11) === "16 NOV 2026" && D.readout("system", { targetAu: -1, date: "", sunAu: 5.2 }, 11) === "5.20 AU" && D.readout("system", { targetAu: -1, date: "", sunAu: 0 }, 11) === "")
check("readout: sky, fall, flight", D.readout("sky", { ra: 5.5833, dec: 22 }, 11) === "RA 5H35 +22" && D.readout("fall", { r: 1.84 }, 11) === "1.84 RS" && D.readout("fall", { r: -11.96 }, 11) === "-12.0 RS" && D.readout("flight", { thrust: 80.4 }, 11) === "80%")
check("readout: the universe and unknown views say nothing", D.readout("universe", {}, 11) === "" && D.readout("x", {}, 11) === "")
{
  // never over maxChars, over the whole range of every figure
  let worst = "", n = 0
  const see = s => { n++; if (s.length > worst.length) worst = s }
  for (let e = -3; e <= 16; e += 0.013) {
    const v = Math.pow(10, e)
    see(D.readout("galaxy", { xc: v }, 11)); see(D.readout("galaxy", { xc: 0, targetLy: v }, 11)); see(D.readout("galaxy", { xc: 0, targetLy: -1, sunLy: v }, 11))
    see(D.readout("system", { targetAu: v / 1e4 }, 11)); see(D.readout("system", { targetAu: -1, sunAu: v / 1e4 }, 11))
  }
  for (let r = -12; r <= 6; r += 0.007) see(D.readout("fall", { r: r }, 11))
  for (let ra = 0; ra < 24; ra += 0.0131) for (const dec of [-90, -33.4, 0, 9.5, 89.6]) see(D.readout("sky", { ra: ra, dec: dec }, 11))
  for (let t = -100; t <= 100; t += 0.7) see(D.readout("flight", { thrust: t }, 11))
  see(D.readout("system", { targetAu: -1, date: "30 SEPTEMBER 2026" }, 11))
  check("readout: never over 11 characters (" + n + " figures)", worst.length <= 11, JSON.stringify(worst))
  check("readout: a smaller cap is kept too", D.readout("galaxy", { xc: 0, targetLy: 2.48e6 }, 8).length <= 8)
}

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
