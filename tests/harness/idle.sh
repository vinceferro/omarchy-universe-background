#!/bin/bash
# idle.sh [--keep <dir>]: what the parked wallpaper draws a second, measured headless.
#
# Background.qml under qmlscene6 on the offscreen platform against stub
# Quickshell modules, on Qt's real scene graph with the Null device
# (QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=null): no GPU, no screen, and no
# vsync, so the window presents a frame whenever anything in it asks for
# one. idle.qml lets the sky settle and counts frames, ticks, draws of the
# full pass and the uniforms that change between ticks, parked on the
# screen (NVIDIA, direct, idle 60) and through a texture (`balanced`, idle
# 30), wakes it with the pointer and explores; idle_check.js checks the
# idle cap holds. About a minute. Needs qmlscene6 (qt6-declarative) and node.
set -e
H=$(dirname "$(readlink -f "$0")"); WT=${WT:-$(dirname "$(dirname "$H")")}   # WT=<another checkout>: its Background.qml, with this driver
keep=""
while [ $# -gt 0 ]; do case $1 in --keep) keep=$2; shift;; esac; shift; done
RUN=${keep:-$(mktemp -d)}; mkdir -p "$RUN"; RUN=$(readlink -f "$RUN")
[ -n "$keep" ] || trap 'rm -rf "${RUN:?}"' EXIT
rm -rf "${RUN:?}/stub" "${RUN:?}/run"; cp -r "$H/stub" "$RUN/stub"; mkdir "$RUN/run"
sed -i "s/property string fakeOut: \"\"/property string fakeOut: command.join(' ').indexOf('class\/drm') >= 0 ? '* nvidia\\\\nDP-1 nvidia\\\\n' : ''/" "$RUN/stub/SQ/Io/Process.qml"
sed -e 's/^import Quickshell/import SQ/' -e 's/Commons\.Color\./SColor./g' -e 's/\bColor\./SColor./g' -e '/WlrLayershell\./d' -e '/exclusionMode: ExclusionMode/d' \
    -e '/anchors { top: true; bottom: true; left: true; right: true }/d' "$WT/Background.qml" > "$RUN/run/Bg.qml"
ln -s "$WT/lib" "$RUN/run/lib"; ln -s "$WT/textures" "$RUN/run/textures"; for f in "$WT"/*.qsb; do ln -s "$f" "$RUN/run/"; done
cp "$H/idle.qml" "$RUN/run/main.qml"
cd "$RUN/run"
env QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=null QT_FORCE_STDERR_LOGGING=1 QML_IMPORT_PATH="$RUN/stub" \
  timeout 240 nice qmlscene6 -I "$RUN/stub" main.qml > "$RUN/log" 2>&1 || true
node "$H/idle_check.js" "$RUN/log"
