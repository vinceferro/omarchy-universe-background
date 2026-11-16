#!/bin/bash
# fall.sh [--math] [--gpu <driver>] [--keep <dir>]: one whole fall into Sgr A*, run headless.
#
# Background.qml's own logic (the tick, lib/*.js, the IPC) runs under qmlscene6
# on the offscreen platform against stub Quickshell modules (stub/): no shell,
# no screen, no GPU, and no shader is drawn. main.qml flies to the hole, lets
# go and logs the camera, the phase and what the hole's tracer was handed;
# fall_check.js then asks what no node suite can: that the tick ran without a
# JavaScript error on every frame of the fall and that the camera reaching
# the tracer (holePass) moved all the way down. About a minute and a half of
# real time (the fall is not sped up). --gpu: the DRM driver the stub probe
# reports (default nvidia). Needs qmlscene6 (qt6-declarative) and node.
set -e
H=$(dirname "$(readlink -f "$0")"); WT=${WT:-$(dirname "$(dirname "$H")")}   # WT=<another checkout>: its Background.qml, with this driver
math=""; gpu=nvidia; keep=""
while [ $# -gt 0 ]; do case $1 in --math) math=--math;; --gpu) gpu=$2; shift;; --keep) keep=$2; shift;; esac; shift; done
RUN=${keep:-$(mktemp -d)}; mkdir -p "$RUN"; RUN=$(readlink -f "$RUN"); [ -n "$keep" ] || trap 'rm -rf "$RUN"' EXIT
rm -rf "$RUN/stub" "$RUN/run"; cp -r "$H/stub" "$RUN/stub"; mkdir "$RUN/run"
# the GPU probe's answer: one card, and the stub screen's connector on it
sed -i "s/property string fakeOut: \"\"/property string fakeOut: command.join(' ').indexOf('class\/drm') >= 0 ? '* $gpu\\\\nDP-1 $gpu\\\\n' : ''/" "$RUN/stub/SQ/Io/Process.qml"
sed -e 's/^import Quickshell/import SQ/' -e 's/Commons\.Color\./SColor./g' -e 's/\bColor\./SColor./g' -e '/WlrLayershell\./d' -e '/exclusionMode: ExclusionMode/d' \
    -e '/anchors { top: true; bottom: true; left: true; right: true }/d' "$WT/Background.qml" > "$RUN/run/Bg.qml"
ln -s "$WT/lib" "$RUN/run/lib"; ln -s "$WT/textures" "$RUN/run/textures"; for f in "$WT"/*.qsb; do ln -s "$f" "$RUN/run/"; done
cp "$H/main.qml" "$RUN/run/main.qml"
cd "$RUN/run"
QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software QT_FORCE_STDERR_LOGGING=1 QML_IMPORT_PATH="$RUN/stub" \
  timeout 200 qmlscene6 -I "$RUN/stub" main.qml $math > "$RUN/log" 2>&1 || true
node "$H/fall_check.js" "$RUN/log" $math --gpu "$gpu"
