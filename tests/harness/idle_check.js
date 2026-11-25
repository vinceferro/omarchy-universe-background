// idle_check.js <log>: reads idle.sh's log and checks that the parked sky
// draws at most idleFps a second, on the screen and through a texture, that
// nothing draws the scene between the ticks, that the pointer wakes it at
// once and that exploring is not capped
const fs = require("fs")
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n")
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const errs = lines.filter(l => /Bg\.qml:\d+:(\d+:)? ?\w*Error/.test(l) || /lib\/\w+\.js:\d+/.test(l) || /main\.qml:\d+: \w*Error/.test(l))
check("no JavaScript error in Background.qml or lib/ during the run", errs.length === 0, errs.length ? errs.length + " lines, first: " + errs[0].slice(-220) : "")
check("the run finished", lines.some(l => l.endsWith("DONE")))
const late = lines.filter(l => l.indexOf("STAGE TIMEOUT") >= 0)
check("every stage settled", late.length === 0, late.map(l => l.slice(l.indexOf("STAGE"))).join("; "))
const rows = lines.filter(l => l.indexOf("MEASURE {") >= 0).map(l => JSON.parse(l.slice(l.indexOf("MEASURE ") + 8)))
const of = name => rows.find(r => r.stage === name) || null
const f1 = x => x.toFixed(1)
// the idle clock is a 16 ms timer: "60" is up to 62.5 ticks a second
const cap = fps => fps * 1000 / 960 + 3

const p = of("parked")
check("parked: measured", !!p)
if (p) {
  check("parked: the reference machine, drawn straight to the screen, idle 60", /direct/.test(p.quality) && p.idleFps === 60, p.quality)
  check("parked: nothing was easing", p.busy < 0.05, f1(p.busy))
  check("parked: the window presents at most idleFps frames a second (it was about 125 here, 140-153 on the box)", p.fps <= cap(p.idleFps), f1(p.fps) + " fps, " + f1(p.ticks) + " ticks")
  check("parked: the full pass draws at most idleFps a second", p.draws <= cap(p.idleFps) && p.draws > 0.6 * p.idleFps, f1(p.draws))
  const between = Object.keys(p.between)
  check("parked: no uniform of the full pass or the nebula changes between ticks (the gauges, the clock, the start-up fade, a timer of its own)", between.length === 0, JSON.stringify(p.between))
}
const w = lines.filter(l => l.indexOf("WAKE {") >= 0).map(l => JSON.parse(l.slice(l.indexOf("WAKE ") + 5)))[0]
check("wake: the pointer's first move ticks at once on a settled sky", !!w && w.settled && w.tickedAtOnce && w.lively, JSON.stringify(w))
const t = of("parked through a texture")
check("through a texture: measured", !!t)
if (t) {
  check("through a texture: balanced, idle 30", !/direct/.test(t.quality) && t.idleFps === 30, t.quality)
  check("through a texture: the full pass draws at most idleFps a second", t.draws <= cap(t.idleFps) && t.draws > 0.6 * t.idleFps, f1(t.draws))
  // Qt presents a frame after every frame that drew a layer; here that frame only lays the held texture out again
  check("through a texture: at most one more frame (a layout, no full pass) per draw", t.fps <= 2 * cap(t.idleFps), f1(t.fps) + " fps")
  check("through a texture: no uniform of the full pass or the nebula changes between ticks", Object.keys(t.between).length === 0, JSON.stringify(t.between))
}
const e = of("exploring")
check("exploring: measured, in the Milky Way view", !!e && e.explore === "galaxy")
if (e) check("exploring: not capped (a frame for every frame the platform offers, 60 here)", e.ticks >= 50 && e.fps >= 50, f1(e.fps) + " fps, " + f1(e.ticks) + " ticks")

if (fails) { console.log(fails + " failed"); process.exit(1) }
console.log("all passed")
