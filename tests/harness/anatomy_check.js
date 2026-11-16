// anatomy_check.js <log>: reads anatomy.sh's log (anatomy.qml's ROW lines and
// whatever the QML engine complained about) and checks the layer end to end
const fs = require("fs")
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n")
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const errs = lines.filter(l => /Bg\.qml:\d+:(\d+:)? ?\w*Error/.test(l) || /(anatomy|anatomy-data|kerr|layout)\.js:\d+/.test(l) || /main\.qml:\d+: \w*Error/.test(l))
check("no JavaScript error in Background.qml or lib/ during the run", errs.length === 0, errs.length ? errs.length + " lines, first: " + errs[0].slice(-220) : "")
check("the run finished", lines.some(l => l.endsWith("DONE")))
const late = lines.filter(l => l.indexOf("STAGE TIMEOUT") >= 0)
check("every stage reached what it waited for", late.length === 0, late.map(l => l.slice(l.indexOf("STAGE"))).join("; "))
const rows = lines.filter(l => l.indexOf("ROW {") >= 0).map(l => JSON.parse(l.slice(l.indexOf("ROW ") + 4)))
const of = name => rows.filter(r => r.stage === name), last = name => { const s = of(name); return s[s.length - 1] || { rep: { rows: [] }, text: { showing: [], screens: [] } } }
const ids = r => r.rep.rows.map(x => x.id)

// the setting alone draws nothing where there is no subject
check("on in the universe view: the setting is on and nothing is drawn", of("on in the universe view: no subject").every(r => r.rep.on && r.rep.drawn === "" && r.rep.subject === ""))
// the Galaxy's home: the Sun is the subject, none of its rows suits 34 kpc, the Milky Way's do
const home = last("galaxy home")
check("the Galaxy's home: the Sun is the subject and the Milky Way is drawn", home.rep.subject === "sun" && home.rep.drawn === "milkyWay" && ["bar", "sunOrbit", "fermi"].every(i => ids(home).includes(i)), ids(home).join(" "))
check("rising out of the Sun's neighbourhood is a zoom, not a journey: the lines are there", home.rep.parked && home.rep.mix === 1 && home.rep.still)
check("the key hint is in the rail", home.hint === true)
// the story band: the headline, then the lines one by one, each lit while its fact is up
const told = [...new Set(of("galaxy home").map(r => r.story).filter(s => s))]
check("the headline is said, then the lines are told one by one", told.includes("ANATOMY  ·  Milky Way") && told.length >= 3, told.join(" | "))
const litRows = of("galaxy home").filter(r => r.rep.lit !== "")
check("the line being told is the lit one", litRows.length > 4 && litRows.every(r => (r.rep.rows.find(x => x.id === r.rep.lit) || {}).text === r.story.toUpperCase()), litRows.length + " rows lit")
check("the hub names the anatomy when it comes up, then returns to its figure", of("galaxy home").some(r => r.readout === "ANATOMY") && home.readout !== "ANATOMY")
// the hole
const hole = last("hole")
check("the hole: the shadow, the horizon, the no-spin circle and the spin axis are drawn", hole.rep.drawn === "sgrA" && ["shadow", "horizon", "noSpin", "spinAxis"].every(i => ids(hole).includes(i)), ids(hole).join(" "))
check("the flight to the hole fades the lines", of("hole").some(r => r.rep.mix < 0.5))
check("no mathematics row without K", hole.rep.rows.every(x => x.tag !== "mathematics"))
const k = last("hole with K")
check("K brings the mathematics rows", k.rep.math && k.rep.rows.some(x => x.tag === "mathematics"), k.rep.rows.filter(x => x.tag === "mathematics").map(x => x.id + (x.folded.length ? "+" + x.folded.join("+") : "")).join(" "))
check("the bright side has its figure once the camera rests", hole.rep.rows.some(x => x.id === "brightSide" && /^\d+ times brighter$/.test(x.num)), (hole.rep.rows.find(x => x.id === "brightSide") || {}).num)
// the levels: the drawing stays at every level (the labels' gates are the text's own)
const off = last("text off")
check("at names and at off the lines are still drawn", last("text names").rep.drawn === "sgrA" && off.rep.drawn === "sgrA" && off.rep.rows.length > 0 && off.text.shown === "off")
// the system view
const earth = last("earth"), saturn = last("saturn"), sun = last("sun")
check("Earth pinned: its cores and mantle", earth.rep.subject === "earth" && ["innerCore", "outerCore", "mantle"].every(i => ids(earth).includes(i)), ids(earth).join(" "))
check("a pinned planet comes to rest (the body moves, the view of it does not) and its headline is said", earth.rep.still && earth.story === "ANATOMY  ·  Earth" && /Iron at the centre/.test(earth.body), earth.story)
check("Saturn pinned: its cloud tops and rings", saturn.rep.subject === "saturn" && ids(saturn).includes("cloudTops") && ids(saturn).some(i => /^ring/.test(i)), ids(saturn).join(" "))
check("the pick's flight fades the lines", of("saturn").some(r => r.rep.mix < 1))
check("the Sun in the squeezed overview: nothing outside it is drawn", sun.rep.subject === "sun" && !ids(sun).some(i => ["alfven", "terminationShock", "heliopause"].includes(i)), ids(sun).join(" ") || "nothing at this zoom")
// Sky mode
const sky = last("sky")
check("Sky mode: the Milky Way from inside", sky.rep.subject === "milkyWay" && sky.rep.rows.length > 0, ids(sky).join(" "))
// a frame of its own
const dj = last("demo jupiter"), dor = last("demo orion")
check("anatomyDemo jupiter: Jupiter's rows without flying there", dj.rep.demo === "jupiter" && ids(dj).includes("cloudTops"), ids(dj).join(" "))
check("anatomyDemo orion 6: the Trapezium and the Bar", ids(dor).includes("trapezium") && ids(dor).includes("bar"), ids(dor).join(" "))
check("ending the demo returns to the view's own subject", last("demo off").rep.demo === "" && last("demo off").rep.subject === "milkyWay")
// off, and the idle wallpaper
check("off: nothing drawn, and the band says so", last("off").rep.on === false && last("off").rep.drawn === "" && of("off").some(r => /^ANATOMY OFF/.test(r.story)))
check("the idle wallpaper draws nothing with the setting on", last("idle").rep.on && last("idle").rep.drawn === "" && !last("idle").text.showing.includes("anatomy"))
// room: every stroke's box and every label inside the safe rect, clear of the HUD's disc as the plan has it
const out = []
let n = 0
for (const r of rows) {
  const s = r.text.screens[0], safe = s.safe, hud = s.hud
  for (const x of r.rep.rows) {
    n++
    if (x.box && (x.box[0] < safe.x0 - 1 || x.box[1] < safe.y0 - 1 || x.box[2] > safe.x1 + 1 || x.box[3] > safe.y1 + 1)) out.push(r.stage + ":" + x.id)
    if (x.label) {
      const b = x.label
      if (b.x < safe.x0 - 1 || b.y < safe.y0 - 1 || b.x + b.w > safe.x1 + 1 || b.y + b.h > safe.y1 + 1) out.push(r.stage + ":" + x.id + " label")
      const nx = Math.max(b.x, Math.min(b.x + b.w, hud.centre[0])), ny = Math.max(b.y, Math.min(b.y + b.h, hud.centre[1]))
      if (r.text.showing.includes("cockpit") && Math.hypot(nx - hud.centre[0], ny - hud.centre[1]) < hud.radius - 3) out.push(r.stage + ":" + x.id + " label in the disc")
    }
  }
  if (r.rep.rows.filter(x => x.label).length > 7) out.push(r.stage + ": labels")
}
check("every line and label inside the safe rect, labels out of the HUD's disc, six labels and the one told at most (" + n + " rows drawn)", out.length === 0, [...new Set(out)].slice(0, 6).join(", "))
// what the pass costs, a stage at a time (this machine's CPU, the software backend's JavaScript)
for (const st of ["galaxy home", "hole", "earth", "saturn", "sky"]) {
  const s = of(st)
  if (s.length < 2) continue
  const n = s[s.length - 1].rep.passes - s[0].rep.passes, ms = s[s.length - 1].rep.passMs - s[0].rep.passMs
  console.log("cost " + st + ": " + n + " passes in " + s.length / 4 + " s, " + (n ? (ms / n).toFixed(2) : "0") + " ms each")
}
console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
