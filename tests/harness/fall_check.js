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
check("the run finished (back home, the last caption read)", lines.some(l => l.endsWith("DONE")))

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
  const gpu = process.argv.includes("--gpu") ? process.argv[process.argv.indexOf("--gpu") + 1] : "nvidia"
  const size = gpu === "nvidia" ? [2560, 1080] : [1707, 720]
  check("the tracer's layer on " + gpu + " (5120x2160): " + size.join("x"), hp.every(r => r.hole.w === size[0] && r.hole.h === size[1]), hp[0].hole.w + "x" + hp[0].hole.h)
  check("the tracer's gas clock runs", new Set(hp.map(r => r.hole.flowTime.toFixed(2))).size > 0.5 * hp.length)
  // 4. the view: the frame's energy, the script, the exposure, the landmark ahead
  if (fall[0].s !== undefined) {
    const at = t => fall.reduce((b, r) => Math.abs(r.s - t) < Math.abs(b.s - t) ? r : b)
    const deg = r => r.tilt * 180 / Math.PI
    check("the script looks down at the hole first, back up at 14.5 s, at the rim through the horizon",
          deg(at(2)) < 5 && deg(at(14.5)) > 135 && deg(at(24)) > 12 && deg(at(24)) < 45, [2, 14.5, 24].map(t => deg(at(t)).toFixed(0)).join(", ") + " deg from straight down")
    check("the exposure starts at 1, opens for the dim sky behind and closes for the boosted rim", Math.abs(fall[0].exp - 1) < 0.2 && at(15).exp > 1.3 && at(24).exp < 0.2,
          [fall[0], at(15), at(24)].map(r => r.exp.toFixed(3)).join(", "))
    // (the steepest stretch, the turn back down onto the boosted gas at 18.9 s, is 2.5 to 2.8x a row depending on where the rows fall in it; a jump would be 10x)
    check("the exposure stays in its range and eases (never more than 3.2x between rows a quarter second apart)", fall.every(r => r.exp >= 0.0039 && r.exp <= 6.01) && fall.every((r, i) => i === 0 || Math.max(r.exp / fall[i - 1].exp, fall[i - 1].exp / r.exp) < 3.2),
          "worst " + Math.max(...fall.map((r, i) => i === 0 ? 1 : Math.max(r.exp / fall[i - 1].exp, fall[i - 1].exp / r.exp))).toFixed(2) + "x")
    check("the landmark ahead: the outer horizon, then the inner one" + (math ? ", the disk, the end" : ""), at(10).next.what === "outer-horizon" && at(26).next.what === "inner-horizon"
          && (!math || (at(40).next.what === "disk" && fall[fall.length - 1].next.what === "end")) && at(10).next.left > at(20).next.left && at(20).next.left > 0)
    check("the frame's energy: " + (math ? "from rest to 1.5 over the first 3 s" : "the fall's own, 0.913"), math ? fall[0].E < 1.2 && at(4).E === 1.5 && fall.every((r, i) => i === 0 || r.E >= fall[i - 1].E) : fall.every(r => Math.abs(r.E - 0.9136) < 2e-3),
          fall[0].E.toFixed(3) + " -> " + at(4).E.toFixed(3))
    check("the tracer hears the same energy and carries the layer's margin", hp.every(r => Math.abs(r.hole.fallE - r.E) < 1e-6 && r.hole.over === 1.04))
    // the caption's detail line: "<where>  ·  AHEAD: <landmark>  ·  <km> BELOW  ·  <time> AWAY ON OUR OWN CLOCK"
    const ahead = r => ((r.detail || "").match(/AHEAD: .*? ON OUR OWN CLOCK/) || [""])[0]
    check("the caption's detail names the landmark ahead: distance in km and time on our own clock", /^AHEAD: EVENT HORIZON  ·  [\d.]+ MILLION KM BELOW  ·  \d+ MIN \d+ S AWAY ON OUR OWN CLOCK$/.test(ahead(at(8)))
          && /^AHEAD: INNER HORIZON  ·  [\d.,]+ (MILLION )?KM BELOW  ·  [\d.]+ S AWAY ON OUR OWN CLOCK$/.test(ahead(at(27))), ahead(at(8)) + " | " + ahead(at(27)))
    check("the detail is short: where we are and what is ahead" + (math ? ", and that this is mathematics" : ""), fall.every(r => (r.detail || "").split("  ·  ").length <= (math ? 6 : 5)) && (!math || fall.every(r => /KERR'S EQUATIONS, BEYOND TESTED PHYSICS$/.test(r.detail))) && fall.every(r => !/PROPER|SHEET|0\.75/.test(r.detail)))
  }
  if (math) check("the tracer changes sheet with the camera", hp.some(r => r.hole.camSheet === -1) && hp.every(r => r.hole.camSheet === r.sheet || Math.abs(r.fallR) < 0.05))
}
// 5. the story band: what the fall says, each caption up for its reading time
//    (lib/text.js: 1.5 s + 0.3 s a word; the rows are a quarter second apart)
{
  const want = math ? ["Looking back", "Event horizon", "Inner horizon", "Through the ring", "The other universe", "Back home"] : ["Looking back", "Event horizon", "Inner horizon", "Back home"]
  const seen = []
  for (const r of rows) if (r.caption && seen[seen.length - 1] !== r.caption) seen.push(r.caption)
  check("the story band says, in order: " + want.join(", "), seen.join("|") === want.join("|"), seen.join(" | "))
  // the rule itself, on the words as shown (lib/text.js words() and read())
  const need = t => { const r = rows.find(q => q.caption === t); return Math.max(3, 1.5 + 0.3 * ((r.caption + " " + r.capBody).match(/[A-Za-z0-9][^\s]*/g) || []).length) }
  const upFor = t => rows.filter(r => r.caption === t && r.capUp === 1).length * 0.25
  const short = want.filter(t => seen.includes(t) && upFor(t) < need(t) - 0.6)
  check("every caption stands fully up for its reading time", short.length === 0, want.filter(t => seen.includes(t)).map(t => t + " " + upFor(t).toFixed(1) + "/" + need(t).toFixed(1)).join(", "))
  check("one caption at a time: the band is never two things at once (it empties between them)", want.every((t, i) => i === 0 || rows.some(r => r.capUp < 0.2 && rows.indexOf(r) > rows.findIndex(q => q.caption === want[i - 1]) && rows.indexOf(r) <= rows.findIndex(q => q.caption === t))))
}
// 6. the way home: black, the view over the Galactic Centre, one flight out to the Sun
{
  const SUN = [0, 8.15, 0.0208]
  const out = rows.filter(r => r.home === "out"), open = rows.filter(r => r.home === "open"), fl = rows.filter(r => r.home === "flight")
  const after = rows.slice(rows.indexOf(fl[fl.length - 1]) + 1)
  check("the return was logged: black, the opening, the flight", out.length >= 4 && open.length >= 1 && fl.length >= 16, out.length + " + " + open.length + " + " + fl.length + " rows")
  check("the status says out, then in until the landing, then -", out.every(r => r.phase === "out") && open.concat(fl).every(r => r.phase === "in") && after.every(r => r.phase === "") && after.length > 8)
  check("the fall goes on under the black, and ends with it (no fall state once the view opens)", out.every(r => r.falling) && open.concat(fl).every(r => !r.falling))
  check("the view opens over the Galactic Centre, 1.2 kpc out, and holds there while the black lifts", open.every(r => len(r.focus) < 1e-6 && Math.abs(r.dist - 1.2) < 1e-6) && open[0].fade > 0.5)
  const prog = fl.map(r => r.focus[1] / SUN[1])
  check("then one flight: the focus goes from the Centre to the Sun, never back", prog.every((v, i) => i === 0 || v >= prog[i - 1] - 1e-9) && prog[0] < 0.2 && prog[prog.length - 1] > 0.9, prog[0].toFixed(2) + " -> " + prog[prog.length - 1].toFixed(2))
  check("no jump on the way: the focus never moves more than 1.2 kpc between rows", fl.every((r, i) => i === 0 || len([0, 1, 2].map(j => r.focus[j] - fl[i - 1].focus[j])) < 1.2))
  check("the camera pulls back all the way: the distance only grows, from 1.2 to the home view's 34 kpc", fl.every((r, i) => i === 0 || r.dist >= fl[i - 1].dist - 1e-9) && fl[0].dist < 2 && Math.abs(fl[fl.length - 1].dist / 34 - 1) < 0.04)
  check("it takes 6 to 9 s, and the picture is back for nearly all of it", fl.length * 0.25 > 6 && fl.length * 0.25 < 9 && fl.filter(r => r.fade < 0.1).length > 0.8 * fl.length, (fl.length * 0.25).toFixed(1) + " s")
  check("the Sun is the chosen place all the way, and its card is the one up: THE SUN · YOU ARE HERE", fl.concat(after).every(r => r.sel === -1 && /^THE SUN {2}· {2}YOU ARE HERE$/.test(r.card)))
  const last = rows[rows.length - 1]
  check("it lands on the Sun and stays", len([0, 1, 2].map(j => last.focus[j] - SUN[j])) < 0.02 && Math.abs(last.dist - 34) < 0.1 && last.status.indexOf("galaxy - ") === 0)
  check("the story band says where we are once landed: Back home", after.some(r => r.caption === "Back home") && !fl.slice(0, -2).some(r => r.caption === "Back home"))
  check(math ? "after the mathematics there is no invitation to it" : "after a realistic fall the hints offer the mathematics: K, then B",
        math ? after.every(r => !r.invite && !/^K, THEN B/.test(r.hint0)) : after.every(r => r.invite && /^K, THEN B: next time, follow the mathematics through the ring$/.test(r.hint0)), after[0].hint0)
}
console.log(fails ? fails + " FAILED" : "all passed")
process.exit(fails ? 1 : 0)
