import QtQuick
Item { id: v; property var model: []; default property Component delegate
  Repeater { model: v.model; delegate: v.delegate } }
