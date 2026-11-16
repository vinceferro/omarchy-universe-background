#!/bin/bash
# anatomy_cost.sh [--keep <dir>]: what the anatomy layer costs a frame, measured headless.
#
# Like anatomy.sh, with one difference: the scene graph is the real one
# (QT_QUICK_BACKEND=rhi) on Qt's Null device, so Shape's curve renderer, the
# text and the batching do all their CPU work and nothing reaches a GPU or a
# screen. anatomy_cost.qml goes through the views with the layer off and on,
# at rest, creeping in after a flight and orbiting; anatomy_cost.js prints,
# stage by stage, how many frames ran the pass and what it took, the scene
# graph's polish, sync and render time a frame, and the pass's parts
# (frames, keys, geometry, clip, dash, labels, the shadow). It measures CPU
# time on this machine: the GPU's own time is not in it. About five minutes.
# Needs qmlscene6 (qt6-declarative) and node.
set -e
H=$(dirname "$(readlink -f "$0")"); WT=${WT:-$(dirname "$(dirname "$H")")}
keep=""
while [ $# -gt 0 ]; do case $1 in --keep) keep=$2; shift;; esac; shift; done
RUN=${keep:-$(mktemp -d)}; mkdir -p "$RUN"; RUN=$(readlink -f "$RUN")
[ -n "$keep" ] || trap 'rm -rf "${RUN:?}"' EXIT
rm -rf "${RUN:?}/stub" "${RUN:?}/run"; cp -r "$H/stub" "$RUN/stub"; mkdir "$RUN/run"
sed -i "s/property string fakeOut: \"\"/property string fakeOut: command.join(' ').indexOf('class\/drm') >= 0 ? '* nvidia\\\\nDP-1 nvidia\\\\n' : ''/" "$RUN/stub/SQ/Io/Process.qml"
sed -e 's/^import Quickshell/import SQ/' -e 's/Commons\.Color\./SColor./g' -e 's/\bColor\./SColor./g' -e '/WlrLayershell\./d' -e '/exclusionMode: ExclusionMode/d' \
    -e '/anchors { top: true; bottom: true; left: true; right: true }/d' "$WT/Background.qml" > "$RUN/run/Bg.qml"
ln -s "$WT/lib" "$RUN/run/lib"; ln -s "$WT/textures" "$RUN/run/textures"; for f in "$WT"/*.qsb; do ln -s "$f" "$RUN/run/"; done
cp "$H/anatomy_cost.qml" "$RUN/run/main.qml"
cd "$RUN/run"
env QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=null QT_FORCE_STDERR_LOGGING=1 QML_IMPORT_PATH="$RUN/stub" \
  QT_LOGGING_RULES="qt.scenegraph.time.renderloop=true" \
  timeout 420 qmlscene6 -I "$RUN/stub" main.qml > "$RUN/log" 2>&1 || true
node "$H/anatomy_cost.js" "$RUN/log"
