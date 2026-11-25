// the idle harness's driver (idle.sh): the parked sky on the real scene
// graph (Qt's Null device), counted. The offscreen platform has no vsync
// to hold frames back, so a frame is presented whenever anything in the
// window asks for one: what the window draws a second is what Background.qml
// asks for. Each stage waits for the sky to settle (nothing easing), then
// logs one MEASURE row: frames presented, ticks, draws of the full pass (its
// `time` changing) and the uniforms of the full pass and the nebula that
// changed between ticks. The machine's figures change all the time (a fake
// /proc/stat and nvidia-smi), as on a desk.
import QtQuick
Window {
  id: win; width: 400; height: 300; visible: true
  Bg { id: bg; anchors.fill: parent }
  property var ipc: null
  property var stats: null
  property var full: null
  property var nebula: null
  property int stage: -1
  property real stageAt: 0
  property real settledAt: 0
  property var m: null
  property real tickAt: 0
  property real cpuT: 1000
  readonly property var stages: [
    { name: "parked", go: () => {}, settle: true, measure: 8000 },
    { name: "wake", go: () => {}, settle: true, measure: 0 },
    { name: "parked through a texture", go: () => ipc.quality("balanced"), settle: true, measure: 8000 },
    { name: "exploring", go: () => { ipc.quality("auto"); ipc.milkyway() }, settle: false, wait: 3000, measure: 4000 }
  ]
  function find(item, file) {
    if (!item) return null
    if (item.fragmentShader !== undefined && String(item.fragmentShader).endsWith(file)) return item
    const kids = item.children || []
    for (let i = 0; i < kids.length; i++) { const r = find(kids[i], file); if (r) return r }
    return null
  }
  // every uniform of the full pass: how often each changed, and how often outside a tick
  function hook(obj) {
    for (const k in obj) {
      if (!k.endsWith("Changed") || ["widthChanged", "heightChanged", "xChanged", "yChanged"].indexOf(k) >= 0) continue
      const s = obj[k]
      if (!s || typeof s.connect !== "function") continue
      const name = k.slice(0, -7)
      try { s.connect(function() { if (win && win.m && Date.now() - win.tickAt > 3) win.m.between[name] = (win.m.between[name] || 0) + 1 }) } catch (e) {}
    }
    obj.timeChanged.connect(function() { if (win && win.m) win.m.draws++ })
  }
  Connections { target: win; function onFrameSwapped() { if (win.m) win.m.frames++ } }
  Connections { target: bg; function onLastTickChanged() { win.tickAt = Date.now(); if (win.m) win.m.ticks++ } }
  Component.onCompleted: {
    for (const r of bg.resources) {
      if (r && r.target === "background") ipc = r
      if (r && r.command && String(r.command).indexOf("nvidia-smi") >= 0) stats = r
    }
    bg.displayedBackground = "/x/y-live.webp"
    ipc.text("full")
  }
  // the machine's figures, changing like a desk's
  Timer { interval: 300; running: true; repeat: true
    onTriggered: {
      win.cpuT += 100
      const busy = 5 + Math.floor(Math.random() * 20)
      win.stats.fakeOut = "cpu  " + Math.round(win.cpuT * busy / 100) + " 0 0 " + Math.round(win.cpuT * (100 - busy) / 100) + " 0 0 0\nMemTotal: 32000000 kB\nMemAvailable: "
        + (20000000 + Math.floor(Math.random() * 1e6)) + " kB\n" + Math.floor(Math.random() * 30) + ", 90.1, 45\n41000\n"
    }
  }
  Timer { interval: 50; running: true; repeat: true
    onTriggered: {
      const now = Date.now()
      if (win.stage < 0) { if (now - win.stageAt > 3000) next(); return }
      const st = win.stages[win.stage]
      if (!win.m) {
        // waiting: for the sky to settle (nothing easing for a second), or for a while
        const ready = st.settle ? (bg.idleBusy ? (win.settledAt = 0, false) : (win.settledAt === 0 ? (win.settledAt = now, false) : now - win.settledAt > 1000))
                                : now - win.stageAt > st.wait
        if (!ready && now - win.stageAt > 40000) { console.log("STAGE TIMEOUT " + st.name); next(); return }
        if (!ready) return
        if (st.name === "wake") {
          // the pointer's first move: the tick runs on that event, not on the clock's next firing
          const before = bg.lastTick, busy = bg.idleBusy
          bg.viewTarget = Qt.vector2d(0.2, -0.1)
          console.log("WAKE " + JSON.stringify({ settled: !busy, tickedAtOnce: bg.lastTick !== before, lively: bg.idleBusy }))
          next(); return
        }
        if (!win.full) { win.full = find(bg, "universe.qsb"); win.nebula = find(bg, "nebula.qsb"); win.hook(win.full)
          win.nebula.timeChanged.connect(function() { if (win && win.m && Date.now() - win.tickAt > 3) win.m.between["nebula time"] = (win.m.between["nebula time"] || 0) + 1 }) }
        win.m = { stage: st.name, t0: now, frames: 0, ticks: 0, draws: 0, between: {}, idleFps: bg.idleFps, quality: ipc.qualityInfo().split(" | ")[0], busy: 0, n: 0 }
        return
      }
      win.m.n++; if (bg.idleBusy) win.m.busy++
      if (now - win.m.t0 < st.measure) return
      const s = (now - win.m.t0) / 1000, r = win.m
      win.m = null
      console.log("MEASURE " + JSON.stringify({ stage: r.stage, quality: r.quality, idleFps: r.idleFps, explore: bg.explore, fps: r.frames / s, ticks: r.ticks / s, draws: r.draws / s,
                                             busy: r.busy / Math.max(1, r.n), between: r.between }))
      next()
    }
  }
  function next() {
    win.stage++; win.stageAt = Date.now(); win.settledAt = 0
    // the full pass is made again when the quality changes: find it again
    win.full = null
    if (win.stage >= win.stages.length) { console.log("DONE"); Qt.quit(); return }
    win.stages[win.stage].go()
  }
}
