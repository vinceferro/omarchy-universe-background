// fall_check.js <log> [--math]: reads fall.sh's log (main.qml's ROW lines and
// whatever the QML engine complained about) and checks the fall end to end
const fs = require("fs")
const math = process.argv.includes("--math")
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n")
let fails = 0
function check(name, ok, info) { console.log((ok ? "ok   " : "FAIL ") + name + (info !== undefined ? "  " + info : "")); if (!ok) fails++ }
const len = v => Math.hypot(v[0], v[1], v[2])

// 1. the tick ran clean: an exception in it skips the rest of the frame
//    (the camera, the tracer, the labels), silently on screen
const errs = lines.filter(l => /Bg\.qml:\d+:(\d+:)? ?\w*Error/.test(l))
check("no JavaScript error in Background.qml during the run", errs.length === 0, errs.length ? errs.length + " lines, first: " + errs[0].replace(/^.*Bg\.qml/, "Bg.qml") : undefined)
check("the run finished (back beside the Sun)", lines.some(l => l.endsWith("DONE")))

const rows = lines.filter(l => l.indexOf("ROW {") >= 0).map(l => JSON.parse(l.slice(l.indexOf("ROW ") + 4)))
const fall = rows.filter(r => r.falling && r.phase !== "out" && r.phase !== "in" && r.phase !== "")
check("the fall was logged", fall.length >= 40, fall.length + " rows")
if (fall.length >= 40) {
  const phases = [...new Set(fall.map(r => r.phase))]
  const want = math ? ["falling", "outer-horizon", "inner-horizon", "ring", "other-universe"] : ["falling", "outer-horizon", "inner-horizon"]
  check("phases: " + want.join(", "), want.every(p => phases.includes(p)), phases.join(", "))
  // 2. the camera itself follows the trajectory
  const rs = fall.map(r => len(r.camRs))
  const rEnd = math ? 11 : 0.36
  check("the camera rides the trajectory: |gxCamRs| = |fallR| on every row", fall.every((r, i) => Math.abs(rs[i] - Math.abs(r.fallR)) < 2e-3),
        "worst " + Math.max(...fall.map((r, i) => Math.abs(rs[i] - Math.abs(r.fallR)))).toExponential(1))
  check("it starts near 6 Rs and gets below the outer horizon (0.67 Rs)", rs[0] > 5 && Math.min(...rs) < 0.6, rs[0].toFixed(2) + " -> min " + Math.min(...rs).toFixed(3))
  check(math ? "it ends far out on the other sheet" : "it ends at the inner horizon (0.33 Rs)", math ? rs[rs.length - 1] > rEnd && fall[fall.length - 1].sheet === -1 : Math.abs(rs[rs.length - 1] - 0.33) < 0.04, rs[rs.length - 1].toFixed(3))
  // 3. the regression this harness exists for: the hole's tracer is handed
  //    the moving camera (it was frozen at the start of the fall while the
  //    HUD counted down)
  const hp = fall.filter(r => r.hole)
  check("the tracer was found on every row", hp.length === fall.length)
  const hr = hp.map(r => len(r.hole.camPos))
  const distinct = new Set(hr.map(x => x.toFixed(4))).size
  check("the tracer's camera changes during the fall", distinct > 0.8 * hp.length, distinct + " positions over " + hp.length + " rows")
  // (logged between frames: the tracer may be one of its own ticks behind)
  const lag = Math.max(...hp.map((r, i) => Math.abs(hr[i] - len(r.camRs)) / Math.max(len(r.camRs), 0.3)))
  check("the tracer's camera stays with the camera (within 10%)", lag < 0.10, "worst " + (100 * lag).toFixed(1) + "%")
  check("the tracer's camera gets below the outer horizon too", Math.min(...hr) < 0.6, "min " + Math.min(...hr).toFixed(3))
  const fwdLag = Math.max(...hp.map(r => Math.hypot(r.hole.camFwd[0] - r.fwd[0], r.hole.camFwd[1] - r.fwd[1], r.hole.camFwd[2] - r.fwd[2])))
  check("the tracer's view direction stays with the view (within 0.1 rad)", fwdLag < 0.1, "worst " + fwdLag.toFixed(4))
  const turned = Math.max(...hp.map(r => Math.hypot(r.hole.camFwd[0] - hp[0].hole.camFwd[0], r.hole.camFwd[1] - hp[0].hole.camFwd[1], r.hole.camFwd[2] - hp[0].hole.camFwd[2])))
  check("the tracer's view direction turns during the fall", turned > 0.5, turned.toFixed(2))
  check("the tracer is near the hole and in the fall's frame throughout", hp.every(r => r.hole.near && r.hole.fallE > 0 && r.hole.w > 100))
  check("the tracer's gas clock runs", new Set(hp.map(r => r.hole.flowTime.toFixed(2))).size > 0.5 * hp.length)
  if (math) check("the tracer changes sheet with the camera", hp.some(r => r.hole.camSheet === -1) && hp.every(r => r.hole.camSheet === r.sheet || Math.abs(r.fallR) < 0.05))
}
console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
