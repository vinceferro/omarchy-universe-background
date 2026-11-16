import QtQuick
QtObject { id: p; property var command: []; property bool running: false; property var stdout: null
  signal exited(int code, int status)
  property string fakeOut: ""
  property var log: []
  property Timer t: Timer { interval: 5; onTriggered: { p.running = false; if (p.stdout) { p.stdout.text = p.fakeOut; p.stdout.streamFinished() } p.exited(0, 0) } }
  onRunningChanged: if (running) { console.log("PROC", JSON.stringify(command)); t.restart() } }
