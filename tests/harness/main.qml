// the fall harness's driver: opens the galaxy view, flies to the hole, lets
// go, and logs one JSON row every quarter second until the camera is back
// beside the Sun (fall.sh reads the rows)
import QtQuick
Window {
  id: win; width: 400; height: 300; visible: true
  Bg { id: bg; anchors.fill: parent }
  property var ipc: null
  property var hole: null
  property int step: 0
  property bool math: Qt.application.arguments.indexOf("--math") >= 0
  property real t0: 0
  // the hole's tracer: the one item with a camSheet and a flowTime
  function find(item) {
    if (!item) return null
    if (item.camSheet !== undefined && item.flowTime !== undefined) return item
    const kids = item.children
    for (let i = 0; i < kids.length; i++) { const r = find(kids[i]); if (r) return r }
    return null
  }
  function v(a) { return [a.x, a.y, a.z] }
  function log() {
    if (!hole) hole = find(bg)
    const h = hole
    const row = { t: (Date.now() - t0) / 1000, status: ipc.status(), phase: bg.fallPhase, fallR: bg.fallR, left: bg.fallLeft, camRs: v(bg.gxCamRs), fwd: v(bg.gxFwd),
                  sheet: bg.gxCamSheet, E: bg.gxFallE, close: bg.fallClose, fade: bg.fallFade, caption: bg.captionTitle, falling: !!bg.fallState }
    row.up = v(bg.gxUp); row.exp = bg.gxHoleExp
    if (bg.fallState) { row.s = bg.fallState.s; row.tilt = bg.fallState.tilt; row.next = bg.fallState.next }
    row.hud = (bg.navRows || []).map(r => r.label + ": " + r.value)
    if (h) row.hole = { near: h.near, w: h.width, h: h.height, camPos: v(h.camPos), camFwd: v(h.camFwd), camSheet: h.camSheet, flowTime: h.flowTime, fallE: h.fallE, over: h.over }
    console.log("ROW " + JSON.stringify(row))
  }
  Component.onCompleted: {
    for (const r of bg.resources) if (r && r.target === "background") ipc = r
    bg.displayedBackground = "/x/y-live.webp"
    t0 = Date.now()
  }
  Timer { interval: 250; running: true; repeat: true
    onTriggered: {
      const s = win.step++
      if (s === 2) { win.ipc.milkyway(); win.ipc.mathMode(win.math) }
      else if (s === 8) win.ipc.hole()
      else if (s === 12) win.ipc.hole()
      if (s >= 8) win.log()
      if (s > 60 && win.ipc.status().indexOf("galaxy - ") === 0 && bg.fallWhere !== "") { console.log("DONE"); Qt.quit() }
      if (s > 520) { console.log("TIMEOUT"); Qt.quit() }
    }
  }
}
