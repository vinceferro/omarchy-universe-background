import QtQuick
Item { property var screen; property color color; property bool updatesEnabled: true
  width: screen ? screen.width : 0; height: screen ? screen.height : 0 }
