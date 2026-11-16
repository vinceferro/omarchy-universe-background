// checks for text.js, the text level and its idle clock (run with node; strips the QML pragma)
const fs = require("fs")
const src = fs.readFileSync(process.argv[2], "utf8").replace(".pragma library", "")
const Tx = new Function(src + "\nreturn { LEVELS, GROUPS, HOLD_S, WORDS_PER_S, HOLD_MAX_S, FADE_IN_S, FADE_OUT_S, LEVEL_S, TOAST_S, DIAL_WORDS, EVENT_S, DWELL_S, DWELL_HOLD_S, UNITS_S, touchZone, dwell, parseLevel, next, prev, apply, migrate, effective, shows, words, hold, create, touch, wanted, step, snap, ease, gate, presence, mix };")()
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const run = (m, s, hz, level, zones) => { for (let i = 0; i < Math.round(s * hz); i++) Tx.step(m, 1 / hz, level, zones) }

// 1. levels are sets of groups, nested
check("three levels: off, names, full", Tx.LEVELS.join() === "off,names,full")
check("off shows no group", Tx.GROUPS.every(g => !Tx.shows("off", g)))
check("names shows names only", Tx.shows("names", "names") && !Tx.shows("names", "guide") && !Tx.shows("names", "cockpit"))
check("full shows names, guide and cockpit", Tx.GROUPS.every(g => Tx.shows("full", g)))
check("a story caption and the toast are in no level: always", Tx.LEVELS.every(l => Tx.shows(l, "always")))
check("an unknown level shows nothing", !Tx.shows("", "names") && !Tx.shows("loud", "cockpit"))

// 2. T cycles and wraps, Shift+T goes back
check("next: off, names, full, off", Tx.next("off") === "names" && Tx.next("names") === "full" && Tx.next("full") === "off")
check("prev: full, names, off, full", Tx.prev("full") === "names" && Tx.prev("names") === "off" && Tx.prev("off") === "full")
check("parseLevel: trims, any case; anything else is no level", Tx.parseLevel(" Names\n") === "names" && Tx.parseLevel("on") === "" && Tx.parseLevel(undefined) === "")

// 3. the cockpit key (H, Super+Alt+J, toggleHud): full and the last level below it
let st = { level: "full", lower: "names" }
st = Tx.apply(st, "toggle"); check("toggle from full: names by default", st.level === "names")
st = Tx.apply(st, "toggle"); check("and back to full", st.level === "full" && st.lower === "names")
st = Tx.apply(st, "off"); st = Tx.apply(st, "toggle"); check("off, toggle: full", st.level === "full" && st.lower === "off")
st = Tx.apply(st, "toggle"); check("toggle again returns to off, the previous lower level", st.level === "off")
st = Tx.apply(Tx.apply({ level: "names", lower: "names" }, "next"), "next")
check("names, T, T: off (through full)", st.level === "off" && st.lower === "off")
st = Tx.apply({ level: "off", lower: "off" }, "prev"); check("off, Shift+T: full, and H then returns to off", st.level === "full" && Tx.apply(st, "toggle").level === "off")
check("apply takes a level by name", Tx.apply({ level: "off", lower: "off" }, "FULL").level === "full")
check("apply ignores anything else", Tx.apply({ level: "full", lower: "names" }, "labels") === null && Tx.apply({ level: "full", lower: "names" }, "") === null)
check("a broken lower level falls back to names", Tx.apply({ level: "full", lower: "full" }, "toggle").level === "names" && Tx.apply({ level: "full", lower: "" }, "toggle").level === "names")

// 4. startup: the saved word, else what the machine showed before there was a level
check("migration: no file, hud-hidden present: names", Tx.migrate("", true) === "names")
check("migration: no file, no flag: full", Tx.migrate("", false) === "full")
check("a saved level wins over the old flag", Tx.migrate("off\n", true) === "off" && Tx.migrate("full", true) === "full")
check("a damaged file migrates like a missing one", Tx.migrate("???", true) === "names" && Tx.migrate("???", false) === "full")

// 5. effective level: film is off, a hold stands in, neither touches the saved word
check("film: off whatever is saved or held", Tx.effective("full", "names", true) === "off")
check("a hold stands in for the saved level", Tx.effective("full", "names", false) === "names" && Tx.effective("off", "full", false) === "full")
check("no hold: the saved level", Tx.effective("names", "", false) === "names")
check("nothing loaded yet: off", Tx.effective("", "", false) === "off")

// 6. the hold: 8 s, plus the reading time, capped
check("the hold's constants are named", Tx.HOLD_S === 8 && Tx.WORDS_PER_S === 3.5 && Tx.HOLD_MAX_S === 40)
check("a name (no reading to speak of) holds 8 s", Tx.hold(0) === 8 && Tx.hold(2) >= 8 && Tx.hold(2) < 8.6, Tx.hold(2).toFixed(2))
check("a 60-word blurb about 25 s", Math.abs(Tx.hold(60) - 25.1) < 0.1, Tx.hold(60).toFixed(1))
check("a 16-row hint list about 30 s", Math.abs(Tx.hold(78) - 30.3) < 0.1, Tx.hold(78).toFixed(1))
check("capped at 40 s", Tx.hold(112) === 40 && Tx.hold(5000) === 40)
check("words: counted, punctuation alone is not a word", Tx.words("SUN  ·  YOU ARE HERE") === 4 && Tx.words("") === 0 && Tx.words(" · — ") === 0)

// 7. the clock (the five checks lib/labels.js had)
const m = Tx.create()
check("fresh: nothing wanted", Tx.wanted(m, 0) === 0 && Tx.wanted(m, 500) === 0)
Tx.touch(m)
check("touched: wanted", Tx.wanted(m, 0) === 1)
let t = 0
while (Tx.wanted(m, 0) === 1 && t < 100) { Tx.step(m, 1 / 165, "full", {}); t += 1 / 165 }
check("drops at HOLD_S (+- a frame)", Math.abs(t - Tx.HOLD_S) < 2 / 165, t.toFixed(3))
Tx.touch(m)
run(m, Tx.HOLD_S - 1, 165, "full", {})
check("still up 1 s before the hold ends", Tx.wanted(m, 0) === 1)
Tx.touch(m)
run(m, Tx.HOLD_S - 1, 165, "full", {})
check("a second touch restarted it", Tx.wanted(m, 0) === 1)
run(m, 2, 165, "full", {})
check("and it still ends", Tx.wanted(m, 0) === 0)
const o = Tx.create(); Tx.snap(o, "off"); Tx.touch(o); run(o, 1, 165, "off", { label: 0 })
check("off is off, touched or not", Tx.presence(o, "label") === 1 && Tx.mix(o, "names", "label") === 0)
const holdAt = (hz, stall) => { const a = Tx.create(); Tx.touch(a); let ta = 0; if (stall) { Tx.step(a, stall, "full", {}); ta = stall } while (Tx.wanted(a, 0) === 1) { Tx.step(a, 1 / hz, "full", {}); ta += 1 / hz } return ta }
const ta = holdAt(60, 0), tb = holdAt(165, 0.5)
check("same hold at 60 Hz and after a 0.5 s stall", Math.abs(ta - Tx.HOLD_S) < 1 / 60 + 1e-9 && Math.abs(tb - Tx.HOLD_S) < 1 / 165 + 1e-9, ta.toFixed(3) + " " + tb.toFixed(3))

// 8. zones hold by their own words: the name goes first, the blurb later
const z = Tx.create(); Tx.snap(z, "full"); Tx.touch(z)
const zones = { label: 0, card: 60, hints: 78 }
run(z, 1, 165, "full", zones)
check("a second after a touch everything is up", ["label", "card", "hints"].every(k => Tx.presence(z, k) === 1))
run(z, 9, 165, "full", zones)
check("at 10 s the names are gone, the card and hints stay", Tx.presence(z, "label") === 0 && Tx.presence(z, "card") === 1 && Tx.presence(z, "hints") === 1)
run(z, 17, 165, "full", zones)
check("at 27 s the card is gone, the hints stay", Tx.presence(z, "card") === 0 && Tx.presence(z, "hints") === 1)
run(z, 5, 165, "full", zones)
check("at 32 s the hints are gone too", Tx.presence(z, "hints") === 0 && !z.moving)
check("the standing zone never fades", Tx.presence(z, "standing") === 1 && Tx.mix(z, "cockpit", "standing") === 1)

// 9. fades take their stated time at any frame rate
const fadeOut = hz => { const a = Tx.create(); Tx.snap(a, "full"); Tx.touch(a); run(a, 1, hz, "full", { label: 0 }); let n = 0; while (a.since < Tx.HOLD_S) Tx.step(a, 1 / hz, "full", { label: 0 }); while (Tx.presence(a, "label") > 0 && n < 1e5) { Tx.step(a, 1 / hz, "full", { label: 0 }); n++ } return n / hz }
check("a zone fades out in 0.8 s at 30, 60 and 165 Hz", [30, 60, 165].every(hz => Math.abs(fadeOut(hz) - Tx.FADE_OUT_S) <= 2 / hz + 1e-9), [30, 60, 165].map(hz => fadeOut(hz).toFixed(3)).join(" "))
const fadeIn = hz => { const a = Tx.create(); Tx.snap(a, "full"); Tx.touch(a); let n = 0; while (Tx.presence(a, "label") < 1 && n < 1e5) { Tx.step(a, 1 / hz, "full", { label: 0 }); n++ } return n / hz }
check("and comes up in 0.25 s", [30, 60, 165].every(hz => Math.abs(fadeIn(hz) - Tx.FADE_IN_S) <= 1 / hz + 1e-9), [30, 60, 165].map(hz => fadeIn(hz).toFixed(3)).join(" "))
const levelFade = hz => { const a = Tx.create(); Tx.snap(a, "full"); let n = 0; while (Tx.gate(a, "cockpit") > 0 && n < 1e5) { Tx.step(a, 1 / hz, "names", {}); n++ } return n / hz }
check("a level change takes 1.5 s (film too: it is the off level)", [30, 60, 165].every(hz => Math.abs(levelFade(hz) - Tx.LEVEL_S) <= 1 / hz + 1e-9), [30, 165].map(hz => levelFade(hz).toFixed(3)).join(" "))
const half = Tx.create(); Tx.snap(half, "full"); run(half, 0.75, 240, "off", {})
check("one easing: half way is half", Math.abs(Tx.gate(half, "names") - 0.5) < 0.01 && Tx.ease(0) === 0 && Tx.ease(1) === 1)
check("a stall never overshoots", (() => { const a = Tx.create(); Tx.snap(a, "full"); Tx.step(a, 30, "off", { label: 0 }); return Tx.gate(a, "names") === 0 && Tx.presence(a, "label") === 0 })())

// 10. names to full leaves the names up; snap is the startup level, not a fade
const g = Tx.create(); Tx.snap(g, "names")
check("snap: the level is simply there", Tx.gate(g, "names") === 1 && Tx.gate(g, "guide") === 0 && Tx.gate(g, "cockpit") === 0)
run(g, 0.5, 165, "full", {})
check("names to full: names never dip", Tx.gate(g, "names") === 1 && Tx.gate(g, "cockpit") > 0 && Tx.gate(g, "cockpit") < 1 && g.moving)
run(g, 1.1, 165, "full", {})
check("and it settles", Tx.gate(g, "cockpit") === 1 && Tx.gate(g, "guide") === 1 && !g.moving)

// 11. a fall touches the clock every tick: its text never fades mid-fall
const f = Tx.create(); Tx.snap(f, "full"); let low = 1
for (let i = 0; i < 165 * 120; i++) { Tx.touch(f); Tx.step(f, 1 / 165, "full", { card: 75, hints: 30, label: 0 }); if (i > 165) low = Math.min(low, Tx.presence(f, "card"), Tx.presence(f, "hints"), Tx.presence(f, "label")) }
check("two minutes of falling: presence stays 1", low === 1)
run(f, 31, 165, "full", { card: 75, hints: 30, label: 0 })
check("and it fades once the fall is over", Tx.presence(f, "card") === 0)

// 12. the cockpit's words: the dial zone, its own touches, the quiet zones
const DZ = { label: 0, dial: Tx.DIAL_WORDS, sys: 0, units: 0 }, QUIET = ["sys", "units"]
const dz = Tx.create(); Tx.snap(dz, "full"); Tx.touch(dz)
run(dz, 1, 165, "full", DZ)
check("a touch brings the dial zone up with the names", Tx.presence(dz, "dial") === 1 && Tx.presence(dz, "label") === 1)
{
  const q = Tx.create(); Tx.snap(q, "full"); Tx.touch(q); for (let i = 0; i < 165; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("a quiet zone ignores the clock", Tx.presence(q, "dial") === 1 && Tx.presence(q, "sys") === 0 && Tx.presence(q, "units") === 0)
  for (let i = 0; i < 165 * 11; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("after 12 s idle at full: the dial zone is gone and the cockpit's gate is 1 (geometry and the clock stand)", Tx.presence(q, "dial") === 0 && Tx.gate(q, "cockpit") === 1 && Tx.mix(q, "cockpit", "standing") === 1 && !q.moving)
  check("the dial zone holds about 11 s: 8 s and ten words", Math.abs(Tx.hold(Tx.DIAL_WORDS) - 10.86) < 0.01, Tx.hold(Tx.DIAL_WORDS).toFixed(2))
  // an event: the dial zone alone, at least 4 s
  Tx.touchZone(q, "dial")
  let up = 0, others = 0
  for (let i = 0; i < 165 * 8; i++) { Tx.step(q, 1 / 165, "full", DZ, QUIET); if (Tx.presence(q, "dial") === 1) up += 1 / 165; others = Math.max(others, Tx.presence(q, "label"), Tx.presence(q, "sys")) }
  check("an event raises the dial zone for 4 s and nothing else", Math.abs(up - (Tx.EVENT_S - Tx.FADE_IN_S)) < 0.05 && others === 0 && Tx.presence(q, "dial") === 0, up.toFixed(2) + " s at full")
  check("it never touched the idle clock", q.since > 12)
  // a machine event: the machine labels only
  Tx.touchZone(q, "sys")
  for (let i = 0; i < 165; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("a machine event raises sys alone (presSys is the larger of dial and sys)", Tx.presence(q, "sys") === 1 && Tx.presence(q, "dial") === 0 && Tx.presence(q, "units") === 0)
  for (let i = 0; i < 165 * 5; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("and it goes after its 4 s", Tx.presence(q, "sys") === 0)
  // the longer of two touches wins; a shorter one does not cut it
  Tx.touchZone(q, "units", Tx.UNITS_S); Tx.touchZone(q, "units", 1)
  for (let i = 0; i < 165 * 2.5; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("unit words after a view change: 3 s, and a shorter touch does not cut them", Tx.presence(q, "units") === 1 && Tx.UNITS_S === 3)
  for (let i = 0; i < 165 * 2; i++) Tx.step(q, 1 / 165, "full", DZ, QUIET)
  check("then gone", Tx.presence(q, "units") === 0)
}
{
  // the pointer resting inside the disc
  const p = Tx.create(); Tx.snap(p, "full")
  const go = (s, inside) => { for (let i = 0; i < Math.round(s * 165); i++) { Tx.dwell(p, inside, 1 / 165); Tx.step(p, 1 / 165, "full", DZ, QUIET) } }
  go(0.25, true)
  check("the pointer crossing the disc (0.25 s) raises nothing", Tx.presence(p, "dial") === 0)
  go(0.1, false); go(0.25, true)
  check("nor do two short visits add up", Tx.presence(p, "dial") === 0)
  go(0.4, true)
  check("resting 0.3 s inside brings the dial zone up, and only it", Tx.presence(p, "dial") > 0 && Tx.presence(p, "label") === 0 && Tx.presence(p, "sys") === 0)
  go(30, true)
  check("it stays for as long as the pointer rests there", Tx.presence(p, "dial") === 1)
  go(1.5, false)
  check("and 2 s after it leaves", Tx.presence(p, "dial") === 1)
  go(1.5, false)
  check("then fades", Tx.presence(p, "dial") === 0)
  check("the dwell's constants are named", Tx.DWELL_S === 0.3 && Tx.DWELL_HOLD_S === 2 && Tx.EVENT_S === 4)
}
{
  // a fall touches the clock every tick: the dial's words stay for the fall; at names there is no cockpit at all
  const a = Tx.create(); Tx.snap(a, "full"); let low = 1
  for (let i = 0; i < 165 * 60; i++) { Tx.touch(a); Tx.step(a, 1 / 165, "full", DZ, QUIET); if (i > 165) low = Math.min(low, Tx.presence(a, "dial")) }
  check("a minute of falling: the dial zone stays", low === 1)
  const n = Tx.create(); Tx.snap(n, "names"); Tx.touch(n); Tx.touchZone(n, "dial"); for (let i = 0; i < 165; i++) Tx.step(n, 1 / 165, "names", DZ, QUIET)
  check("at names (and off) the cockpit's gate is 0 whatever the zone says", Tx.mix(n, "cockpit", "dial") === 0 && Tx.presence(n, "dial") === 1)
}

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
