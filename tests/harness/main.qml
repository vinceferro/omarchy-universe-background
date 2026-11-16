// the fall harness's driver: opens the galaxy view, flies to the hole, lets
// go, and logs one JSON row every quarter second until the camera is back
// home and the way home's caption has been read (fall.sh reads the rows).
// --esc <s>: Esc (back()) once the fall's screen clock has reached s
import QtQuick
Window {
  id: win; width: 400; height: 300; visible: true
  Bg { id: bg; anchors.fill: parent }
  property var ipc: null
  property var hole: null
  property int step: 0
  property bool math: Qt.application.arguments.indexOf("--math") >= 0
  property real esc: { const a = Qt.application.arguments.find(x => x.indexOf("--esc=") === 0); return a ? Number(a.slice(6)) : -1 }
  property bool escaped: false
  property real t0: 0
  property int landed: -1
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
                  sheet: bg.gxCamSheet, E: bg.gxFallE, close: bg.fallClose, fade: bg.fallFade, caption: bg.storyShow > 0 ? bg.storyTitle : "", capBody: bg.storyShow > 0 ? bg.storyBody : "", capUp: bg.storyShow, falling: !!bg.fallState }
    row.up = v(bg.gxUp); row.exp = bg.gxHoleExp
    if (bg.fallState) { row.s = bg.fallState.s; row.tilt = bg.fallState.tilt; row.next = bg.fallState.next }
    row.detail = bg.fallDetail
    row.sel = bg.gxSel; row.dist = bg.gxDist; row.focus = bg.gxTarget; row.cam = v(bg.gxCamPos); row.home = bg.gxReturn ? bg.gxReturn.phase : ""; row.invite = bg.fallInvite
    row.card = bg.cardTitle; row.hint0 = bg.railRows.length ? bg.railRows[0].join(": ") : ""
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
      if (win.esc >= 0 && !win.escaped && bg.fallState && bg.fallState.s >= win.esc) { win.escaped = true; bg.back() }
      if (s >= 8) win.log()
      if (s > 60 && win.ipc.status().indexOf("galaxy - ") === 0 && bg.fallWhere !== "") { if (win.landed < 0) win.landed = s; if (s - win.landed > 44) { console.log("DONE"); Qt.quit() } }
      if (s > 640) { console.log("TIMEOUT"); Qt.quit() }
    }
  }
}
