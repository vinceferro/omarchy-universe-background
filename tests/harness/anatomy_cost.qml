// the anatomy cost harness's driver (anatomy_cost.sh): the same views as
// anatomy.qml, measured instead of checked. Every frame it counts whether
// the anatomy pass ran (anatRun.passes) and what it took; every stage it
// logs one COST row. At a view at rest it times the pass's parts by calling
// lib/anatomy.js with the view's own frame (BENCH rows: what every frame
// pays with nothing to redraw, and one pass part by part). The scene graph's
// own lines (polish, sync, render a frame) land between the STAGE marks.
import QtQuick
import "lib/anatomy.js" as Anat
import "lib/kerr.js" as Kerr
import "lib/layout.js" as Lay
Window {
  id: win; width: 400; height: 300; visible: true
  Bg { id: bg; anchors.fill: parent }
  property var ipc: null
  property int stage: -1
  property real stageAt: 0
  property var acc: null
  function rep() { return JSON.parse(ipc.anatomyReport()) }
  function fresh() { return { frames: 0, passFrames: 0, passes: bg.anatRun.passes, ms: bg.anatRun.ms, maxPass: 0, stillPasses: 0, segs: 0, pts: 0, labels: 0, last: bg.anatRun.passes, out: null, rebinds: 0, lastPassAt: 0 } }
  // N runs of f, in milliseconds each
  function time(f, n) {
    f()
    const t0 = Date.now()
    for (let i = 0; i < n; i++) f()
    return (Date.now() - t0) / n
  }
  function bench(name) {
    const out = bg.anatOut, sel = bg.anatRun.sel
    if (!out) { console.log("BENCH " + JSON.stringify({ stage: name, drawn: "" })); return }
    const sub = bg.anatSubject(), chain = Anat.chain(sub), rec = Anat.byId(out.id), F = bg.anatFrame(rec)
    const L0 = bg.lay0, room = bg.anatRoom(), D = bg.anatLensD(L0)
    const stage = st => ({ W: L0.W, H: L0.H, safe: L0.safe, obstacles: room.obstacles, avoid: room.avoid, math: bg.mathMode, lit: "", still: st,
                           tok: { name: L0.tok.anat, num: L0.tok.anatNum, gap: L0.tok.gap, row: L0.tok.row }, textW: bg.anatTextW })
    const env = st => out.lens ? Object.assign(Anat.lensEnv(stage(st), D, [-600, D / 2]), { still: st }) : stage(st)
    const fr = out.lens ? Anat.lensFrame(rec, F.frame, F.c, bg.mathMode) : F.frame
    const E = env(true), N = 40
    const b = { stage: name, drawn: out.id, where: out.lens ? "lens" : "body", chain: chain.map(r => r.id), rows: out.rows.length }
    // what a frame pays with nothing to redraw: the frames, the room, the choice, the probe
    b.everyFrame = time(() => { const fs = {}, of = r => fs[r.id] !== undefined ? fs[r.id] : (fs[r.id] = bg.anatFrame(r)); bg.anatRoom(); const s = Anat.choose(sub, of, stage(true), sel); const f = of(Anat.byId(s.id)); Anat.probe(s.lens ? Anat.lensFrame(rec, f.frame, f.c, bg.mathMode) : f.frame, f.c, E) }, 200)
    const rows = rec.rows.filter(r => Anat.drawn(r, bg.mathMode))
    b.geometry = time(() => { for (const r of rows) Anat.rowGeometry(r, fr, F.c, E) }, N)
    // each row's own share, the dearest first
    b.dearest = rows.map(r => [r.id, time(() => Anat.rowGeometry(r, fr, F.c, E), 20)]).sort((x, y) => y[1] - x[1]).slice(0, 4).map(x => x[0] + " " + x[1].toFixed(2))
    // the rows compose() keeps: between 24 px and 1.5 screen heights
    const geos = rows.map(r => Anat.rowGeometry(r, fr, F.c, E)).filter(g => g && (g.size === 0 || (g.size >= 24 && g.size <= 1.5 * E.H)))
    const lines = geos.filter(g => g.size > 0)
    b.fold = time(() => { for (let i = 0; i < lines.length; i++) for (let j = 0; j < i; j++) if (Math.abs(lines[i].size - lines[j].size) / 2 < 3) Anat.together(lines[i].curves[0].pts, lines[j].curves[0].pts, 3) }, N)
    b.clip = time(() => { for (const g of geos) for (const cu of g.curves) Anat.clip(cu.pts, cu.closed, E.safe, E.obstacles) }, N)
    b.compose = time(() => Anat.compose(rec, fr, F.c, E), N)
    b.labels = b.compose - b.geometry - b.clip - b.fold   // what is left: the labels' column
    if (rec.id === "sgrA") {
      // the shadow: the eye a hair further (the creep after a flight), and a thousandth further (a drag)
      const x = Anat.camLocal(fr)
      let prev = null
      b.outlineCold = time(() => { prev = Kerr.shadowOutline(x, F.c.a, 48, null) }, 10)
      b.outlineWarm = time(() => { prev = Kerr.shadowOutline(x, F.c.a, 48, prev) }, 10)
      const o = prev
      let near = o.pts[0], far = o.pts[0]
      for (const p of o.pts) { if (p.theta < near.theta) near = p; if (p.theta > far.theta) far = p }
      const dir = p => { const th = p.theta * 1.12; return [0, 1, 2].map(i => Math.cos(th) * o.c[i] + Math.sin(th) * (Math.cos(p.psi) * o.e1[i] + Math.sin(p.psi) * o.e2[i])) }
      b.gasLight2 = time(() => { Kerr.gasLight(x, F.c.a, dir(near)); Kerr.gasLight(x, F.c.a, dir(far)) }, 10)
      let n = 0
      const moved = eps => { n++; const cam = Object.assign({}, fr.cam, { C: fr.cam.C.map(v => v * (1 + eps * n)) }); return Object.assign({}, fr, { cam: cam }) }
      b.composeRestMoved = time(() => Anat.compose(rec, moved(1e-3), F.c, E), 10)            // at rest in a new place: the shape and the gas's light again
      n = 0
      b.composeMoving = time(() => Anat.compose(rec, moved(1e-3), F.c, env(false)), N)       // moving: the shape at most every 60 ms
      Anat.compose(rec, fr, F.c, E)
    }
    for (const k in b) if (typeof b[k] === "number" && k !== "rows") b[k] = Math.round(b[k] * 1000) / 1000
    console.log("BENCH " + JSON.stringify(b))
  }
  function hold(keys) { bg.keysDown = keys }
  readonly property var stages: [
    { name: "galaxy home, anatomy off", go: () => { ipc.text("full"); ipc.anatomy("off"); ipc.milkyway() }, s: 12 },
    { name: "galaxy home, anatomy on (the walk)", go: () => ipc.anatomy("on"), s: 14 },
    { name: "galaxy home, at rest (touched)", go: () => {}, s: 6, touch: true, bench: true },
    { name: "flight to the hole", go: () => ipc.hole(), until: r => r.drawn === "sgrA" && r.mix >= 1, s: 60 },
    { name: "hole, arrived (the creep and the walk)", go: () => {}, s: 40, touch: true },
    { name: "hole, at rest (touched)", go: () => {}, s: 8, touch: true, bench: true },
    { name: "hole, orbiting", go: () => hold({ left: true }), s: 8, touch: true },
    { name: "hole, orbiting, anatomy off", go: () => ipc.anatomy("off"), s: 8, touch: true },
    { name: "hole, at rest, anatomy off", go: () => hold({}), s: 8, touch: true },
    { name: "hole, left alone (the idle clock)", go: () => ipc.anatomy("on"), s: 45 },
    { name: "earth, the flight and arrival", go: () => ipc.focus(3), until: r => r.drawn === "earth" && r.mix >= 1 && r.still, s: 40 },
    { name: "earth, pinned (touched)", go: () => {}, s: 10, touch: true, bench: true },
    { name: "saturn, the flight and arrival", go: () => ipc.focus(6), until: r => r.drawn === "saturn" && r.mix >= 1 && r.still, s: 40 },
    { name: "saturn, pinned (touched)", go: () => {}, s: 10, touch: true, bench: true },
    { name: "saturn, pinned, anatomy off", go: () => ipc.anatomy("off"), s: 6, touch: true },
    { name: "sun, the flight and arrival (the lens)", go: () => { ipc.anatomy("on"); ipc.focus(0) }, until: r => r.drawn === "sun" && r.lensMix >= 1 && r.still, s: 40 },
    { name: "sun, in the lens (touched)", go: () => {}, s: 10, touch: true, bench: true },
    { name: "sun, in the lens, orbiting", go: () => hold({ left: true }), s: 6, touch: true },
    { name: "sky", go: () => { hold({}); ipc.sky() }, s: 10, touch: true, bench: true }
  ]
  function close() {
    const st = stages[stage], a = acc, R = bg.anatRun
    console.log("COST " + JSON.stringify({ stage: st.name, s: (Date.now() - stageAt) / 1000, frames: a.frames, passFrames: a.passFrames, passes: R.passes - a.passes, passMs: R.ms - a.ms, maxPass: a.maxPass,
                                           lastPassS: a.lastPassAt ? (a.lastPassAt - stageAt) / 1000 : -1, strokes: a.segs, points: a.pts, labels: a.labels, drawn: bg.anatOut ? bg.anatOut.id : "", rows: bg.anatOut ? bg.anatOut.rows.length : 0,
                                           still: rep().still, where: rep().lens ? "lens" : "body", presence: bg.presAnat, mix: bg.anatMix, text: bg.textLevel }))
  }
  function next() {
    if (stage >= 0) { if (stages[stage].bench) bench(stages[stage].name); close() }
    stage++
    if (stage >= stages.length) { console.log("DONE"); Qt.quit(); return }
    console.log("STAGE " + stages[stage].name)
    stages[stage].go()
    stageAt = Date.now(); acc = fresh()
  }
  Component.onCompleted: {
    for (const r of bg.resources) if (r && r.target === "background") ipc = r
    bg.displayedBackground = "/x/y-live.webp"
  }
  // one count a frame, after the tick's
  FrameAnimation {
    running: win.stage >= 0
    onTriggered: {
      const a = win.acc, R = bg.anatRun
      if (!a) return
      a.frames++
      if (R.passes !== a.last) {
        a.passFrames++; a.last = R.passes; a.maxPass = Math.max(a.maxPass, R.stage.last, R.glass.last); a.lastPassAt = Date.now()
        // what the renderer is handed again: every row's strokes and points
        const o = bg.anatOut
        if (o) { let s = 0, p = 0, l = 0; for (const r of o.rows) { s += r.segs.length + r.marks.length; for (const g of r.segs.concat(r.marks)) p += g.length; if (r.lab.show) l++ } a.segs = s; a.pts = p; a.labels = l }
      }
    }
  }
  Timer { interval: 250; running: true; repeat: true
    property int n: 0
    onTriggered: {
      if (++n < 4) return
      if (win.stage < 0) { win.next(); return }
      const st = win.stages[win.stage], since = (Date.now() - win.stageAt) / 1000
      if (st.touch && n % 4 === 0) bg.touchText()
      if (st.until ? (st.until(win.rep()) || since > st.s) : since >= st.s) win.next()
    }
  }
}
