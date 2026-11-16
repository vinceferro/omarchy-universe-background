// the anatomy harness's driver: turns the anatomy on and visits a view after
// another (the Galaxy's home, the black hole with and without K, Earth,
// Saturn, Sky mode, a body in a frame of its own), logging IPC
// anatomyReport and the story band four times a second (anatomy.sh reads
// the rows). Each stage waits for what it is about, or times out.
import QtQuick
Window {
  id: win; width: 400; height: 300; visible: true
  Bg { id: bg; anchors.fill: parent }
  property var ipc: null
  property int stage: -1
  property int ticks: 0
  property int since: 0
  function rep() { return JSON.parse(ipc.anatomyReport()) }
  readonly property var stages: [
    { name: "on in the universe view: no subject", go: () => { ipc.text("full"); ipc.anatomy("on") }, until: r => since > 6 },
    { name: "galaxy home", go: () => ipc.milkyway(), until: r => r.drawn === "milkyWay" && r.mix >= 1 && since > 150, max: 220 },
    { name: "hole", go: () => ipc.hole(), until: r => r.drawn === "sgrA" && r.mix >= 1 && r.still && since > 24, max: 240 },
    { name: "hole with K", go: () => ipc.mathMode(true), until: r => since > 8 },
    { name: "text names", go: () => { ipc.mathMode(false); ipc.text("names") }, until: r => since > 10 },
    { name: "text off", go: () => ipc.text("off"), until: r => since > 10 },
    { name: "earth", go: () => { ipc.text("full"); ipc.focus(3) }, until: r => r.drawn === "earth" && r.mix >= 1 && r.still && /Earth/.test(bg.storyTitle), max: 160 },
    { name: "saturn", go: () => ipc.focus(6), until: r => r.drawn === "saturn" && r.mix >= 1 && since > 12, max: 120 },
    { name: "sun", go: () => ipc.focus(0), until: r => r.parked && since > 30, max: 120 },
    { name: "sky", go: () => ipc.sky(), until: r => r.drawn === "milkyWay" && r.mix >= 1 && since > 12, max: 80 },
    { name: "demo jupiter", go: () => ipc.anatomyDemo("jupiter", 0), until: r => r.drawn === "jupiter" && since > 8, max: 60 },
    { name: "demo orion", go: () => ipc.anatomyDemo("orion", 6), until: r => r.drawn === "orion" && since > 8, max: 60 },
    { name: "demo off", go: () => ipc.anatomyDemo("", 0), until: r => since > 8 },
    { name: "off", go: () => ipc.anatomy("off"), until: r => r.mix === 0 && /^ANATOMY OFF/.test(bg.storyTitle) && bg.storyShow > 0, max: 80 },
    { name: "idle", go: () => { ipc.anatomy("on"); ipc.universe() }, until: r => since > 12 }
  ]
  Component.onCompleted: {
    for (const r of bg.resources) if (r && r.target === "background") ipc = r
    bg.displayedBackground = "/x/y-live.webp"
  }
  Timer { interval: 250; running: true; repeat: true
    onTriggered: {
      win.ticks++; win.since++
      if (win.ticks < 3) return
      const r = win.stage >= 0 ? win.rep() : null
      const st = win.stage >= 0 ? win.stages[win.stage] : null
      if (st) console.log("ROW " + JSON.stringify({ stage: st.name, since: win.since, status: win.ipc.status(), rep: r, story: bg.storyShow > 0 ? bg.storyTitle : "", body: bg.storyShow > 0 ? bg.storyBody : "",
                                                    text: JSON.parse(win.ipc.textReport()), hint: bg.railRows.some(h => h[0] === "C"), readout: bg.dialRun && bg.dialRun.want ? bg.dialRun.want.readout : "" }))
      if (!st || st.until(r) || win.since > (st.max || 40)) {
        if (st && !st.until(r)) console.log("STAGE TIMEOUT " + st.name)
        win.stage++; win.since = 0
        if (win.stage >= win.stages.length) { console.log("DONE"); Qt.quit(); return }
        win.stages[win.stage].go()
      }
    }
  }
}
