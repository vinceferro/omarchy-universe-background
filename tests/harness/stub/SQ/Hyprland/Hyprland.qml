pragma Singleton
import QtQuick
QtObject {
  property var monitors: ({ values: [ { name: "DP-1", width: 5120, height: 2160, scale: 1, activeWorkspace: { hasFullscreen: false },
                                        lastIpcObject: { reserved: [0, 0, 0, 0], transform: 0, refreshRate: 165 } } ] })
  property var focusedWorkspace: ({ toplevels: { values: [] } })
  function refreshMonitors() {} }
