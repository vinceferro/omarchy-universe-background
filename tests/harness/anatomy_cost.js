// anatomy_cost.js <log>: reads anatomy_cost.sh's log and prints what the
// anatomy layer cost, stage by stage. It fails only when the run itself did
// (a JavaScript error, a stage that never came): the numbers are a report.
const fs = require("fs")
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n")
const errs = lines.filter(l => /Bg\.qml:\d+:(\d+:)? ?\w*Error/.test(l) || /(anatomy|anatomy-data|kerr|layout)\.js:\d+/.test(l) || /main\.qml:\d+: \w*Error/.test(l))
let stage = null
const sg = {}, cost = {}, bench = []
for (const l of lines) {
  let i
  if ((i = l.indexOf("STAGE ")) >= 0) { stage = l.slice(i + 6); sg[stage] = []; continue }
  if ((i = l.indexOf("COST {")) >= 0) { const c = JSON.parse(l.slice(i + 5)); cost[c.stage] = c; continue }
  if ((i = l.indexOf("BENCH {")) >= 0) { bench.push(JSON.parse(l.slice(i + 6))); continue }
  const m = /polish=(\d+), sync=(\d+), render=(\d+), swap=(\d+)/.exec(l)
  if (m && stage) sg[stage].push([+m[1], +m[2], +m[3], +m[4]])
}
const f = (v, d) => v.toFixed(d === undefined ? 2 : d)
console.log("stage | s | frames/s | frames with a pass | pass ms a frame | pass ms (mean, max) | last pass at s | strokes, points, labels | scene graph, whole ms a frame: polish + sync + render (mean, longest)")
for (const name of Object.keys(cost)) {
  const c = cost[name], g = sg[name] || [], n = g.length || 1
  // the scene graph logs whole milliseconds: a frame under 1 ms reads 0
  const all = g.map(r => r[0] + r[1] + r[2])
  console.log([name, f(c.s, 1), f(c.frames / c.s, 0), c.passFrames + " of " + c.frames + " (" + f(100 * c.passFrames / Math.max(1, c.frames), 0) + "%)",
               f(c.passMs / Math.max(1, c.frames), 3), c.passes ? f(c.passMs / c.passes) + ", " + c.maxPass : "-", f(c.lastPassS, 1), c.strokes + ", " + c.points + ", " + c.labels + " (" + c.drawn + (c.where === "lens" ? " in the lens" : "") + ", " + c.rows + " rows)",
               f(all.reduce((x, y) => x + y, 0) / n) + ", " + Math.max(0, ...all)].join(" | "))
}
console.log("")
console.log("the pass's parts at rest, ms (one call each, mean of 40):")
for (const b of bench) console.log("  " + b.stage + ": " + Object.keys(b).filter(k => k !== "stage").map(k => k + " " + (Array.isArray(b[k]) ? b[k].join(k === "chain" ? ">" : "; ") : b[k])).join(", "))
const done = lines.some(l => l.endsWith("DONE"))
if (errs.length) console.log("FAIL " + errs.length + " JavaScript error lines, first: " + errs[0].slice(-220))
if (!done) console.log("FAIL the run did not finish")
process.exit(errs.length || !done ? 1 : 0)
